// Leaf silhouettes and brush strokes are rigid in their local coordinates.
// One atlas retains their original appearance while roots and angles still sway.
export function createPlantAtlas(plants, dpr) {
  const canvas = document.createElement("canvas");
  const painter = canvas.getContext("2d");
  const tiles = [];
  let x = 0,
    y = 0,
    rowHeight = 0;
  for (const p of plants)
    for (const leaf of p.leaves) {
      const L = leaf.length,
        mid = [],
        left = [],
        right = [];
      let minY = 0,
        maxY = 0;
      for (let i = 0; i <= 20; i++) {
        const u = i / 20,
          bow = L * leaf.bend * Math.sin(Math.PI * u);
        const width =
          L *
          leaf.width *
          Math.pow(Math.sin(Math.PI * Math.pow(u, 0.86)), 0.48) *
          (1 - 0.22 * u);
        const grain =
          1 +
          0.07 * Math.sin(u * 31 + leaf.phase) +
          0.035 * Math.sin(u * 67 + leaf.phase);
        mid.push({ x: L * u, y: bow });
        left.push({ x: L * u, y: bow + width * grain });
        right.push({ x: L * u, y: bow - width * 0.75 });
        minY = Math.min(minY, left[i].y, right[i].y);
        maxY = Math.max(maxY, left[i].y, right[i].y);
      }
      const pad = 2 + Math.max(0.25, L * 0.08) / 2;
      const width = Math.ceil((L + pad * 2) * dpr),
        height = Math.ceil((maxY - minY + pad * 2) * dpr);
      if (x + width > 1024) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }
      leaf.sprite = { x, y, width, height, left: -pad, top: minY - pad };
      leaf.root = { x: 0, y: 0 };
      leaf.prev = { x: 0, y: 0 };
      leaf.next = { x: 0, y: 0 };
      tiles.push({ p, leaf, mid, left, right });
      x += width;
      rowHeight = Math.max(rowHeight, height);
    }
  canvas.width = 1024;
  canvas.height = y + rowHeight;
  const paintLeaf = (context, { p, leaf, mid, left, right }) => {
    const L = leaf.length;
    const line = (points, from = 0, to = points.length) => {
      context.moveTo(points[from].x, points[from].y);
      for (let i = from + 1; i < to; i++)
        context.lineTo(points[i].x, points[i].y);
    };
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    line(left);
    for (let i = 20; i >= 0; i--) context.lineTo(right[i].x, right[i].y);
    context.closePath();
    const wash = context.createLinearGradient(0, 0, L, mid[20].y);
    wash.addColorStop(0, p.color);
    wash.addColorStop(0.48, p.color);
    wash.addColorStop(1, "#738772");
    context.fillStyle = wash;
    context.globalAlpha = p.alpha * leaf.ink;
    context.fill();
    context.strokeStyle = p.color;
    context.lineWidth = Math.max(0.25, L * 0.08);
    context.globalAlpha = p.alpha * 0.08;
    context.stroke();
    context.save();
    context.clip();
    context.beginPath();
    line(mid, 3, 17);
    context.strokeStyle = "#e9ebda";
    context.lineWidth = Math.max(0.22, L * 0.039);
    context.globalAlpha = 0.12 + leaf.dry * 0.15;
    context.stroke();
    context.restore();
    context.beginPath();
    line(mid, 0, 7);
    context.strokeStyle = "#2f554c";
    context.lineWidth = Math.max(0.25, L * 0.037);
    context.globalAlpha = p.alpha * 0.3;
    context.stroke();
  };
  const fallback = painter
    ? null
    : new Map(tiles.map(tile => [tile.leaf, tile]));
  if (painter) {
    for (const tileData of tiles) {
      const tile = tileData.leaf.sprite;
      painter.save();
      painter.setTransform(
        dpr,
        0,
        0,
        dpr,
        tile.x - tile.left * dpr,
        tile.y - tile.top * dpr
      );
      paintLeaf(painter, tileData);
      painter.restore();
    }
  }
  return {
    draw(context, leaf, root, angle) {
      const tile = leaf.sprite;
      context.save();
      context.translate(root.x, root.y);
      context.rotate(angle);
      context.globalAlpha = 1;
      if (fallback) paintLeaf(context, fallback.get(leaf));
      else
        context.drawImage(
          canvas,
          tile.x,
          tile.y,
          tile.width,
          tile.height,
          tile.left,
          tile.top,
          tile.width / dpr,
          tile.height / dpr
        );
      context.restore();
    },
    pixels: painter ? canvas.width * canvas.height : 0,
    destroy() {
      canvas.width = canvas.height = 0;
      fallback?.clear();
    },
  };
}
