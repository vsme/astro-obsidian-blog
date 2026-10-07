/*!
Simplified CPU adaptation of watercolor-playground's wet-paper transport and
WebGL-Fluid-Simulation's pressure projection. No painting UI or runtime dependencies.
https://github.com/msurguy/watercolor-playground
https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
Wet-paper transport also follows inkwash: https://github.com/johnowhitaker/inkwash
Copyright (c) 2026 Maksim Surguy
Copyright (c) 2017 Pavel Dobryakov
Copyright (c) 2026 Jonathan Whitaker
MIT License
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
const PIGMENTS = 6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (lo, hi, value) => {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const LIGHT = [
  [69, 171, 181],
  [239, 146, 156],
  [243, 203, 108],
  [176, 156, 216],
  [119, 194, 167],
  [104, 177, 218],
];
const DARK = [
  [44, 110, 123],
  [146, 73, 101],
  [127, 106, 56],
  [82, 80, 133],
  [51, 119, 96],
  [60, 105, 146],
];

// Six independent pigment fields share one incompressible water flow. Mixing
// uses a three-channel absorbance approximation, not the upstream spectral model.
export function createPigmentFluid() {
  // One random layout per scene. The indexed hash keeps it stable when resized
  // and avoids sampling randomness during animation or theme repaints.
  const seed = (Math.random() * 0x100000000) >>> 0;
  const random = key => {
    let value = (seed + Math.imul(key + 1, 0x9e3779b9)) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
  };
  const paletteOrder = Array.from({ length: PIGMENTS }, (_, i) => i);
  for (let i = PIGMENTS - 1; i > 0; i--) {
    const j = Math.floor(random(100 + i) * (i + 1));
    [paletteOrder[i], paletteOrder[j]] = [paletteOrder[j], paletteOrder[i]];
  }
  const flowPhase = random(200) * Math.PI * 2;
  const limitedSlope = (backward, forward) => {
    if (backward * forward <= 0) return 0;
    const a = Math.abs(backward),
      b = Math.abs(forward);
    return (
      Math.sign(backward) * Math.max(Math.min(2 * a, b), Math.min(a, 2 * b))
    );
  };
  let w = 0,
    h = 0,
    cells = 0,
    cssWidth = 1,
    cssHeight = 1,
    config;
  let u,
    v,
    nextU,
    nextV,
    pressure,
    nextPressure,
    divergence,
    wet,
    nextWet,
    mobility,
    dye,
    nextDye,
    transported,
    left,
    right,
    up,
    down,
    forceU,
    forceV;
  let lastTime = null,
    accumulator = 0,
    simTime = 0,
    steps = 0,
    forceTime = -Infinity,
    disposed = false;
  let a, b, c, d, wa, wb, wc, wd;
  function trace(x, y, dx, dy, dt) {
    const px = clamp(x - dx * dt, 0, w - 1);
    const py = clamp(y - dy * dt, 0, h - 1),
      ix = Math.floor(px),
      iy = Math.floor(py),
      fx = px - ix,
      fy = py - iy;
    a = iy * w + ix;
    b = iy * w + Math.min(ix + 1, w - 1);
    c = Math.min(iy + 1, h - 1) * w + ix;
    d = Math.min(iy + 1, h - 1) * w + Math.min(ix + 1, w - 1);
    wa = (1 - fx) * (1 - fy);
    wb = fx * (1 - fy);
    wc = (1 - fx) * fy;
    wd = fx * fy;
  }
  const sample = field =>
    field[a] * wa + field[b] * wb + field[c] * wc + field[d] * wd;
  function reset(width, height, settings) {
    if (disposed) return;
    cssWidth = width;
    cssHeight = height;
    config = { ...settings };
    const scale = Math.min(192 / width, 96 / height);
    w = Math.max(32, Math.round(width * scale));
    h = Math.max(24, Math.round(height * scale));
    cells = w * h;
    u = new Float32Array(cells);
    v = new Float32Array(cells);
    nextU = new Float32Array(cells);
    nextV = new Float32Array(cells);
    pressure = new Float32Array(cells);
    nextPressure = new Float32Array(cells);
    divergence = new Float32Array(cells);
    wet = new Float32Array(cells).fill(0.35);
    nextWet = new Float32Array(cells);
    mobility = new Float32Array(cells);
    dye = new Float32Array(cells * PIGMENTS);
    nextDye = new Float32Array(cells * PIGMENTS);
    transported = new Float32Array(cells * PIGMENTS);
    forceU = new Float32Array(cells);
    forceV = new Float32Array(cells);
    left = new Uint32Array(cells);
    right = new Uint32Array(cells);
    up = new Uint32Array(cells);
    down = new Uint32Array(cells);
    const drift = (4.5 * w) / cssWidth;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        left[i] = y * w + Math.max(0, x - 1);
        right[i] = y * w + Math.min(w - 1, x + 1);
        up[i] = Math.max(0, y - 1) * w + x;
        down[i] = Math.min(h - 1, y + 1) * w + x;
        u[i] = drift;
      }
    // Flat pigment interiors, irregular feathery borders and clear spaces between
    // washes. Initial patches are present across the paper, not fed in at startup.
    const radius = (settings.colorSize * 0.8 * w) / width;
    const gap = (Math.max(70, settings.spread * 0.4) * w) / width;
    const count = Math.max(5, Math.ceil(w / gap) + 1);
    for (let patch = 0; patch < count; patch++) {
      const cx = ((patch + 0.2 + (random(patch * 9) - 0.5) * 0.35) * w) / count,
        cy = h * (0.24 + random(patch * 9 + 1) * 0.52),
        patchRadius = radius * (0.86 + random(patch * 9 + 2) * 0.24),
        patchPhase = random(patch * 9 + 3) * Math.PI * 2,
        color = paletteOrder[patch % PIGMENTS];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x,
            dx = (x - cx) / patchRadius,
            dy = (y - cy) / (patchRadius * 0.85);
          const irregular =
            1 +
            0.12 * Math.sin(x * 0.27 + y * 0.19 + patchPhase) +
            0.08 * Math.sin(y * 0.43 - x * 0.11);
          const distance = Math.sqrt(dx * dx + dy * dy) / irregular;
          const ribbon =
            0.72 + 0.28 * Math.sin(x * 0.31 + y * 0.17 + patchPhase) ** 2;
          const ink = (1 - smooth(0.72, 1.03, distance)) * ribbon;
          dye[i * PIGMENTS + color] = Math.min(
            0.9,
            dye[i * PIGMENTS + color] + ink * 0.68
          );
          wet[i] = Math.max(wet[i], 1 - smooth(0.85, 1.45, distance));
        }
    }
    // Seed an already curled wash with an inverse vortex map. This is a single
    // initialization pass, rather than seconds of hidden fluid warm-up.
    const initialEddies = makeInitialEddies();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let px = x,
          py = y;
        for (const eddy of initialEddies) {
          let dx = px - eddy.x;
          dx -= Math.round(dx / w) * w;
          const dy = py - eddy.y;
          const angle =
            -eddy.sign *
            eddy.twist *
            Math.exp(-(dx * dx + dy * dy) / (eddy.radius * eddy.radius));
          const cos = Math.cos(angle),
            sin = Math.sin(angle);
          px = (((eddy.x + dx * cos - dy * sin) % w) + w) % w;
          py = clamp(eddy.y + dx * sin + dy * cos, 0, h - 1);
        }
        const i = y * w + x;
        trace(x, y, x - px, y - py, 1);
        nextWet[i] = sample(wet);
        for (let color = 0; color < PIGMENTS; color++)
          nextDye[i * PIGMENTS + color] =
            dye[a * PIGMENTS + color] * wa +
            dye[b * PIGMENTS + color] * wb +
            dye[c * PIGMENTS + color] * wc +
            dye[d * PIGMENTS + color] * wd;
      }
    [dye, nextDye] = [nextDye, dye];
    [wet, nextWet] = [nextWet, wet];
    for (let i = 0; i < cells; i++) {
      let total = 0;
      for (let color = 0; color < PIGMENTS; color++)
        total += dye[i * PIGMENTS + color];
      if (total > 1.1)
        for (let color = 0; color < PIGMENTS; color++)
          dye[i * PIGMENTS + color] *= 1.1 / total;
    }
    accumulator = 0;
    steps = 0;
    forceTime = -Infinity;
    buildForces(simTime);
  }
  function makeInitialEddies() {
    return Array.from({ length: 10 }, (_, j) => ({
      x: (w * (j + 0.5 + (random(300 + j * 5) - 0.5) * 0.35)) / 10,
      y: h * (0.26 + random(301 + j * 5) * 0.48),
      radius:
        h * (j % 3 === 0 ? 0.16 : 0.29) * (0.85 + random(302 + j * 5) * 0.3),
      sign: (j % 2 ? 1 : -1) * (random(299) > 0.5 ? 1 : -1),
      twist: 1.9 + random(303 + j * 5) * 0.7,
    }));
  }
  function buildForces(time) {
    const drift = (4.5 * w) / cssWidth;
    const jet = (3 * w) / cssWidth,
      radius = h * 0.23;
    // The inlet current meanders across the paper. Weak shear eddies travel
    // downstream with it, instead of continually stirring fixed points.
    const span = w + 4 * radius;
    const vortices = Array.from({ length: 6 }, (_, j) => ({
      x:
        ((time * drift + ((j + random(400 + j * 4) * 0.3) * span) / 6) % span) -
        2 * radius,
      y: h * (0.25 + random(401 + j * 4) * 0.5),
      radius: radius * (0.85 + random(402 + j * 4) * 0.3),
      sign: (j % 2 ? 1 : -1) * (random(299) > 0.5 ? 1 : -1),
    }));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const phase = (x / w) * Math.PI * 2 - time * 0.025 + flowPhase;
        const center = h * (0.5 + 0.12 * Math.sin(phase));
        const centerSlope = h * 0.12 * ((Math.PI * 2) / w) * Math.cos(phase);
        const jetProfile = Math.exp(-(((y - center) / (h * 0.28)) ** 2));
        let fx = drift + jet * jetProfile,
          fy = jet * centerSlope * jetProfile;
        for (const vortex of vortices) {
          const dx = x - vortex.x;
          const dy = y - vortex.y;
          const falloff = Math.exp(
            -(dx * dx + dy * dy) / (vortex.radius * vortex.radius)
          );
          fx -=
            (dy / vortex.radius) * falloff * vortex.sign * ((6 * w) / cssWidth);
          fy +=
            (dx / vortex.radius) * falloff * vortex.sign * ((6 * w) / cssWidth);
        }
        const i = y * w + x;
        forceU[i] = fx;
        forceV[i] = fy;
      }
    forceTime = time;
  }
  function transport(source, target, vertical, dt) {
    const back = vertical ? up : left,
      front = vertical ? down : right;
    const velocity = vertical ? v : u;
    for (let i = 0; i < cells; i++) {
      const center = i * PIGMENTS,
        behind = back[i] * PIGMENTS,
        ahead = front[i] * PIGMENTS;
      for (let color = 0; color < PIGMENTS; color++)
        transported[center + color] = limitedSlope(
          source[center + color] - source[behind + color],
          source[ahead + color] - source[center + color]
        );
    }
    for (let i = 0; i < cells; i++) {
      const center = i * PIGMENTS,
        behind = back[i] * PIGMENTS,
        ahead = front[i] * PIGMENTS;
      const incoming =
        (velocity[i] + velocity[back[i]]) *
        0.5 *
        Math.min(mobility[i], mobility[back[i]]);
      const outgoing =
        (velocity[i] + velocity[front[i]]) *
        0.5 *
        Math.min(mobility[i], mobility[front[i]]);
      for (let color = 0; color < PIGMENTS; color++) {
        const value = source[center + color];
        const entering =
          incoming >= 0
            ? source[behind + color] +
              0.5 * (1 - incoming * dt) * transported[behind + color]
            : value - 0.5 * (1 + incoming * dt) * transported[center + color];
        const leaving =
          outgoing >= 0
            ? value + 0.5 * (1 - outgoing * dt) * transported[center + color]
            : source[ahead + color] -
              0.5 * (1 + outgoing * dt) * transported[ahead + color];
        // Correct the small residual divergence from the pressure solve so a
        // uniform concentration is transported without being compressed.
        target[center + color] = Math.max(
          0,
          value -
            dt *
              (outgoing * leaving -
                incoming * entering -
                value * (outgoing - incoming))
        );
      }
    }
  }
  function step(dt) {
    simTime += dt;
    if (simTime - forceTime >= 0.5) buildForces(simTime);
    // Advect velocity and gently drive the persistent current and soft vortices.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        trace(x, y, u[i], v[i], dt);
        nextU[i] = sample(u) + (forceU[i] - u[i]) * dt * 0.65;
        nextV[i] =
          (sample(v) + (forceV[i] - v[i]) * dt * 0.65) *
          (y === 0 || y === h - 1 ? 0 : 1);
      }
    [u, nextU] = [nextU, u];
    [v, nextV] = [nextV, v];
    // Pressure projection (the same divergence / Jacobi / gradient sequence as
    // the upstream solver), with open left/right boundaries. Pigment leaving
    // the right edge cannot wrap around and reappear at the inlet.
    pressure.fill(0);
    for (let i = 0; i < cells; i++)
      divergence[i] = 0.5 * (u[right[i]] - u[left[i]] + v[down[i]] - v[up[i]]);
    for (let iteration = 0; iteration < 10; iteration++) {
      // Edge pressure stays zero in both buffers; solve only interior columns.
      for (let y = 0; y < h; y++)
        for (let i = y * w + 1, end = (y + 1) * w - 1; i < end; i++)
          nextPressure[i] =
            (pressure[left[i]] +
              pressure[right[i]] +
              pressure[up[i]] +
              pressure[down[i]] -
              divergence[i]) *
            0.25;
      [pressure, nextPressure] = [nextPressure, pressure];
    }
    for (let i = 0; i < cells; i++) {
      u[i] -= 0.5 * (pressure[right[i]] - pressure[left[i]]);
      v[i] =
        i < w || i >= cells - w
          ? 0
          : v[i] - 0.5 * (pressure[down[i]] - pressure[up[i]]);
    }
    for (let y = 0; y < h; y++) {
      const inlet = y * w,
        outlet = inlet + w - 1;
      u[inlet] = forceU[inlet];
      v[inlet] = y === 0 || y === h - 1 ? 0 : forceV[inlet];
      u[outlet] = u[outlet - 1];
      v[outlet] = v[outlet - 1];
    }
    // Water creeps outward. A very gentle decay avoids dark drying ridges in an
    // ambient pond; clear water at the inlet keeps this background alive.
    const wetDecay = Math.exp(-dt * 0.0015);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        trace(x, y, u[i], v[i], dt);
        const average =
          (wet[left[i]] + wet[right[i]] + wet[up[i]] + wet[down[i]]) * 0.25;
        nextWet[i] = clamp(
          (sample(wet) + (average - wet[i]) * dt * 0.6) * wetDecay,
          0,
          1
        );
      }
    [wet, nextWet] = [nextWet, wet];
    for (let i = 0; i < cells; i++) mobility[i] = smooth(0.02, 0.38, wet[i]);
    // Bounded finite-volume transport avoids repeatedly blurring a pigment
    // image with bilinear samples. Alternating axes limits directional bias;
    // Superbee face reconstruction keeps the original wash borders distinct.
    transport(dye, nextDye, steps % 2 === 0, dt);
    transport(nextDye, dye, steps % 2 !== 0, dt);
    const diffusion = (dt * 0.004) / config.sigma,
      fade = Math.exp(-dt * 0.0008);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x,
          m = mobility[i];
        const center = i * PIGMENTS;
        // Water/face coefficients are shared by all six pigments. Compute
        // them once per cell and preserve the same diffusion/edge flux.
        const l = left[i],
          r = right[i],
          top = up[i],
          bottom = down[i];
        const gl = m * mobility[l],
          gr = m * mobility[r],
          gt = m * mobility[top],
          gb = m * mobility[bottom];
        const el = clamp((wet[i] - wet[l]) * dt * 0.08, -0.008, 0.008) * gl,
          er = clamp((wet[i] - wet[r]) * dt * 0.08, -0.008, 0.008) * gr,
          et = clamp((wet[i] - wet[top]) * dt * 0.08, -0.008, 0.008) * gt,
          eb = clamp((wet[i] - wet[bottom]) * dt * 0.08, -0.008, 0.008) * gb;
        const il = diffusion * gl - Math.min(el, 0),
          ir = diffusion * gr - Math.min(er, 0),
          it = diffusion * gt - Math.min(et, 0),
          ib = diffusion * gb - Math.min(eb, 0);
        const remaining =
          1 -
          diffusion * (gl + gr + gt + gb) -
          Math.max(el, 0) -
          Math.max(er, 0) -
          Math.max(et, 0) -
          Math.max(eb, 0);
        let total = 0;
        for (let color = 0; color < PIGMENTS; color++) {
          let value =
            dye[center + color] * remaining +
            dye[l * PIGMENTS + color] * il +
            dye[r * PIGMENTS + color] * ir +
            dye[top * PIGMENTS + color] * it +
            dye[bottom * PIGMENTS + color] * ib;
          value = Math.max(0, value * fade);
          nextDye[center + color] = value;
          total += value;
        }
        // Bound overlapping washes so the backdrop never fills with dark pigment.
        if (total > 1.1)
          for (let color = 0; color < PIGMENTS; color++)
            nextDye[center + color] *= 1.1 / total;
      }
    [dye, nextDye] = [nextDye, dye];
    // Feed pigment through a moving inlet in the left two columns. The wider
    // current pulls it across the paper and transports it out of the right edge.
    const cycle = Math.floor(simTime / 40),
      phase = simTime / 40 - cycle,
      color = paletteOrder[cycle % PIGMENTS];
    const cy = h * (0.5 + 0.2 * Math.sin(simTime * 0.025 + flowPhase)),
      radius = (config.colorSize * 0.8 * w) / cssWidth;
    const pulse = smooth(0, 0.18, phase) * (1 - smooth(0.55, 0.9, phase));
    for (let y = 0; y < h; y++) {
      const distance = Math.abs(y - cy) / (radius * 0.85);
      const ink = (1 - smooth(0.62, 1.05, distance)) * pulse * 0.68;
      for (let x = 0; x < 2; x++) {
        const i = y * w + x;
        wet[i] = 1;
        for (let pigment = 0; pigment < PIGMENTS; pigment++) {
          const target = pigment === color ? ink : 0;
          dye[i * PIGMENTS + pigment] +=
            (target - dye[i * PIGMENTS + pigment]) * dt * 1.5;
        }
      }
    }
    steps++;
  }
  function advance(time) {
    if (disposed || !cells) return 0;
    if (lastTime === null) {
      lastTime = time;
      return 0;
    }
    accumulator += clamp(time - lastTime, 0, 0.1);
    lastTime = time;
    let count = 0;
    while (accumulator + 1e-8 >= 0.05 && count < 2) {
      step(0.05);
      accumulator -= 0.05;
      count++;
    }
    return count;
  }
  function paint(pixels, dark) {
    if (disposed || !cells) return;
    const paper = dark ? [20, 44, 52] : [234, 245, 248],
      palette = dark ? DARK : LIGHT;
    const absorb = palette.map(color =>
      color.map((value, c) => Math.max(0, -Math.log(value / paper[c])))
    );
    for (let i = 0; i < cells; i++) {
      const index = i * PIGMENTS;
      let mass = 0,
        r = 0,
        g = 0,
        b = 0;
      for (let color = 0; color < PIGMENTS; color++) {
        const concentration = dye[index + color];
        mass += concentration;
        const tint = dark ? palette[color] : absorb[color];
        r += tint[0] * concentration;
        g += tint[1] * concentration;
        b += tint[2] * concentration;
      }
      const out = i * 4;
      if (dark) {
        const strength = mass
          ? Math.min(0.55, 1 - Math.exp(-mass * 0.8)) / mass
          : 0;
        pixels[out] = paper[0] + (r - paper[0] * mass) * strength;
        pixels[out + 1] = paper[1] + (g - paper[1] * mass) * strength;
        pixels[out + 2] = paper[2] + (b - paper[2] * mass) * strength;
      } else {
        pixels[out] = paper[0] * Math.exp(-r * 0.6);
        pixels[out + 1] = paper[1] * Math.exp(-g * 0.6);
        pixels[out + 2] = paper[2] * Math.exp(-b * 0.6);
      }
      pixels[out + 3] = 255;
    }
  }
  return {
    reset,
    advance,
    paint,
    getState() {
      const mass = Array(PIGMENTS).fill(0),
        xs = Array(PIGMENTS).fill(0),
        ys = Array(PIGMENTS).fill(0);
      for (let i = 0; i < cells; i++)
        for (let color = 0; color < PIGMENTS; color++) {
          const value = dye[i * PIGMENTS + color];
          mass[color] += value;
          xs[color] += (i % w) * value;
          ys[color] += Math.floor(i / w) * value;
        }
      return {
        gridWidth: w,
        gridHeight: h,
        steps,
        pigmentCount: disposed ? 0 : PIGMENTS,
        mass,
        positions: mass.map((amount, i) => ({
          x: amount ? ((xs[i] / amount) * cssWidth) / w : 0,
          y: amount ? ((ys[i] / amount) * cssHeight) / h : 0,
        })),
      };
    },
    destroy() {
      disposed = true;
      cells = 0;
      u =
        v =
        nextU =
        nextV =
        pressure =
        nextPressure =
        divergence =
        wet =
        nextWet =
        mobility =
        dye =
        nextDye =
        transported =
        left =
        right =
        up =
        down =
        forceU =
        forceV =
          null;
    },
  };
}
