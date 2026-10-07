interface TrailSample {
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  createdAt: number;
  speed: number;
}
const smooth = (lo: number, hi: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
// These coefficients depend on the trail and frame, not on the fragment pixel.
export function packRippleTrails(
  trails: readonly TrailSample[],
  now: number,
  radius: number,
  coordinates: Float32Array,
  geometry: Float32Array,
  waves: Float32Array,
  lifetime: number
): number {
  coordinates.fill(0);
  geometry.fill(0);
  waves.fill(0);
  let headAmplitude = 0;
  for (let index = 0; index < trails.length; index++) {
    const trail = trails[index],
      offset = index * 4;
    coordinates[offset] = trail.fromX;
    coordinates[offset + 1] = trail.fromY;
    coordinates[offset + 2] = trail.x;
    coordinates[offset + 3] = trail.y;
    const dx = trail.x - trail.fromX,
      dy = trail.y - trail.fromY,
      squared = dx * dx + dy * dy;
    if (squared < 0.0001) continue;
    const length = Math.sqrt(squared),
      age = Math.max(0, (now - trail.createdAt) / 1000);
    const speed = Math.max(0, Math.min(1, trail.speed / 20)),
      growth = Math.max(0, Math.min(1, age / lifetime));
    const weight = 0.56 + (0.44 * (index + 1)) / Math.max(trails.length, 1);
    const life = Math.exp(-age * 2.15) * (1 - smooth(1.35, lifetime, age));
    geometry[offset] = dx / length;
    geometry[offset + 1] = dy / length;
    geometry[offset + 2] = 1 / squared;
    geometry[offset + 3] = age;
    waves[offset] = 5 + age * radius * 0.95;
    waves[offset + 1] = 8 + 11 * smooth(0, 1, growth);
    waves[offset + 2] = (1.4 + 5.8 * speed) * weight * life;
    waves[offset + 3] = 10 + 9 * speed;
    if (index === trails.length - 1)
      headAmplitude = (3.2 + 7.3 * speed) * Math.exp(-age * 12);
  }
  return headAmplitude;
}
