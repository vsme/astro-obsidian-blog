/*!
Adapted from watercolor-canvas, Copyright (c) 2017 Taylor Baldwin.
https://github.com/rolyatmax/watercolor-canvas
The MIT License (MIT)
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// One cached pigment: polygon subdivision, Gaussian deformation, masked washes.
// No drawing framework or third-party runtime dependencies.
export default function watercolor({
  context,
  colors,
  colorSize,
  sigma,
  randomFn,
}) {
  const random = randomFn;
  function gaussianPair(scale) {
    let x, y, square;
    do {
      x = random() * 2 - 1;
      y = random() * 2 - 1;
      square = x * x + y * y;
    } while (!square || square >= 1);
    const factor = scale * Math.sqrt((-2 * Math.log(square)) / square);
    return [x * factor, y * factor];
  }
  function deform(points) {
    const split = [];
    points.forEach((point, i) => {
      const next = points[(i + 1) % points.length],
        t = random();
      split.push(point, [
        point[0] + (next[0] - point[0]) * t,
        point[1] + (next[1] - point[1]) * t,
      ]);
    });
    return split.map((point, i) => {
      const previous = split[(i + split.length - 1) % split.length],
        next = split[(i + 1) % split.length];
      const distance =
        (Math.hypot(point[0] - previous[0], point[1] - previous[1]) +
          Math.hypot(point[0] - next[0], point[1] - next[1])) /
        2;
      const [dx, dy] = gaussianPair((distance * 0.45) / sigma);
      return [point[0] + dx, point[1] + dy];
    });
  }
  const shapes = colors.map(({ color, position }) => {
    let points = Array.from({ length: 5 }, (_, i) => {
      const angle = (i * Math.PI * 2) / 5;
      return [
        position[0] + Math.cos(angle) * colorSize,
        position[1] + Math.sin(angle) * colorSize,
      ];
    });
    for (let i = 0; i < 4; i++) points = deform(points);
    return { color, points };
  });
  return () => {
    context.save();
    context.globalCompositeOperation = "source-over";
    for (const shape of shapes) {
      for (let layer = 0; layer < 40; layer++) {
        const points = deform(deform(shape.points));
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const [x, y] of points) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        context.save();
        context.beginPath();
        for (let i = 0; i < 130; i++) {
          const x = minX + random() * (maxX - minX),
            y = minY + random() * (maxY - minY);
          const radius = random() * Math.max(8, context.canvas.width * 0.095);
          context.moveTo(x + radius, y);
          context.arc(x, y, radius, 0, Math.PI * 2);
        }
        context.clip();
        context.beginPath();
        context.moveTo(...points[0]);
        for (let i = 1; i < points.length; i++) context.lineTo(...points[i]);
        context.closePath();
        context.fillStyle = `rgba(${shape.color.join(",")},${1 / 44})`;
        context.fill();
        context.restore();
      }
    }
    context.restore();
  };
}
