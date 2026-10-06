import watercolor from "./watercolorCanvas.js";

// watercolor-canvas (MIT), Copyright (c) 2017 Taylor Baldwin.
// Full upstream license is retained in watercolorCanvas.js.
export const watercolorDefaults = {
  spread: 300,
  colorSize: 100,
  sigma: 1.1,
  animate: true,
};

export function createWatercolorBackground() {
  const settings = { ...watercolorDefaults };
  let width = 1,
    height = 1,
    dark = false,
    sprites = [],
    lastDrawnTime = 0,
    motionOffset = 0,
    frozenTime = 0;
  function seeded(seed) {
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  function rebuild(w, h, isDark) {
    width = w;
    height = h;
    dark = isDark;
    const pigments = dark
      ? [
          [44, 110, 123],
          [146, 73, 101],
          [127, 106, 56],
          [82, 80, 133],
          [51, 119, 96],
          [60, 105, 146],
        ]
      : [
          [69, 171, 181],
          [239, 146, 156],
          [243, 203, 108],
          [176, 156, 216],
          [119, 194, 167],
          [104, 177, 218],
        ];
    const radius = settings.colorSize * Math.pow(width / 736, 0.7);
    const side = Math.min(640, Math.max(96, Math.ceil(radius * 4.4)));
    sprites = pigments.map((color, i) => {
      const variants = [0, 1].map(variant => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = side;
        const context = canvas.getContext("2d");
        watercolor({
          context,
          colors: [{ color, position: [side / 2, side / 2] }],
          colorSize: Math.min(radius, side / 4.4),
          sigma: settings.sigma,
          randomFn: seeded(217 + i * 7919 + variant * 104729),
        })();
        return canvas;
      });
      return { variants, radius };
    });
  }
  function motionClock(time) {
    return settings.animate ? time - motionOffset : frozenTime;
  }
  function flow(time) {
    const clock = motionClock(time);
    const radius = settings.colorSize * Math.pow(width / 736, 0.7);
    // Wrap only after even the largest, rotated cached canvas is fully outside.
    const margin = radius * 2.2 * 1.9 + 24;
    const desiredGap = (Math.max(60, (settings.spread * 2) / 5) * width) / 736;
    const count = Math.min(
      32,
      Math.max(6, Math.ceil((width + margin * 2) / desiredGap))
    );
    const span = Math.max(width + margin * 2, count * desiredGap);
    const gap = span / count;
    const velocity = 4.5 * Math.pow(width / 736, 0.65);
    const yOffsets = [-0.27, 0.09, -0.15, 0.28, -0.06, 0.15];
    const positions = [],
      appearance = [];
    for (let i = 0; i < count; i++) {
      const distance = i * gap + clock * velocity;
      const cycle = Math.floor(distance / span);
      const offset = distance - cycle * span;
      // Grow from 80 to 100 while crossing the visible paper, then hold at 100.
      const progress = Math.max(0, Math.min(1, (offset - margin) / width));
      const phase = i * 1.73;
      positions.push({
        x: offset - margin,
        y: height / 2 + (yOffsets[i % 6] * height * settings.spread) / 390,
      });
      appearance.push({
        colorSize: settings.colorSize * (0.8 + progress * 0.2),
        mix: 0.5 + 0.5 * Math.sin(clock * 0.13 + phase),
        rotation: Math.sin(clock * 0.09 + phase) * 0.045,
      });
    }
    return { positions, appearance };
  }
  function draw(context, time) {
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.fillStyle = dark ? "#142c34" : "#eaf5f8";
    context.fillRect(0, 0, width, height);
    lastDrawnTime = time;
    const { positions: points, appearance: shapes } = flow(time);
    const opacity = dark ? 0.48 : 0.6;
    context.globalCompositeOperation = dark ? "screen" : "source-over";
    points.forEach((point, i) => {
      const s = sprites[i % sprites.length];
      const shape = shapes[i];
      const size = (s.radius * 4.4 * shape.colorSize) / settings.colorSize;
      // Skip fully invisible cached canvases. Include rotation in their bounds
      // so ink edges still enter and leave continuously without being clipped.
      const half =
        (size / 2) *
        (Math.abs(Math.cos(shape.rotation)) +
          Math.abs(Math.sin(shape.rotation)));
      if (
        point.x + half < 0 ||
        point.x - half > width ||
        point.y + half < 0 ||
        point.y - half > height
      )
        return;
      context.save();
      context.translate(point.x, point.y);
      context.rotate(shape.rotation);
      // Crossfade two cached ink silhouettes; edges change without noisy redraws.
      s.variants.forEach((canvas, variant) => {
        context.globalAlpha = opacity * (variant ? shape.mix : 1 - shape.mix);
        context.drawImage(canvas, -size / 2, -size / 2, size, size);
      });
      context.restore();
    });
    context.restore();
  }
  return {
    rebuild,
    draw,
    setSettings(next) {
      for (const [key, lo, hi] of [
        ["spread", 0, 1000],
        ["colorSize", 20, 400],
        ["sigma", 0.5, 3],
      ]) {
        if (Number.isFinite(next[key]))
          settings[key] = Math.max(lo, Math.min(hi, next[key]));
      }
      if (
        typeof next.animate === "boolean" &&
        next.animate !== settings.animate
      ) {
        if (next.animate) motionOffset = lastDrawnTime - frozenTime;
        else frozenTime = motionClock(lastDrawnTime);
        settings.animate = next.animate;
      }
    },
    getState: time => ({
      ...settings,
      ...flow(time),
      cacheCount: sprites.length * 2,
      spriteCount: sprites.length,
    }),
    destroy() {
      sprites = [];
    },
  };
}
