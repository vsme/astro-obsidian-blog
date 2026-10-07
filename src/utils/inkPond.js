import { createWatercolorBackground } from "./watercolorBackground.js";
import { createPlantAtlas } from "./inkPlants.js";
import { createFishInteraction } from "./inkInteraction.js";

/*!
Constraint-chain reference: animal-proc-anim, Copyright (c) 2024 argonaut.
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
// Adapted from Library 游鱼.html v10; fish geometry, pigment and plants preserved.
/* Independent Canvas2D study. No assets, libraries, tracking, or network requests.
   Schooling: separation + alignment + cohesion, bounded steering.
   Body: persistent world-space, distance/angle constrained spine.
   Inspired by argonaut’s animal-proc-anim (MIT):
   https://github.com/argonautcode/animal-proc-anim
   Original Canvas implementation; no external code is loaded or executed.
   Simulation uses a fixed 1/120 s step; rendering follows requestAnimationFrame. */
export function createInkPond(canvas, container, viewportMask = null) {
  const ctx = canvas.getContext("2d");
  if (!ctx)
    return {
      destroy() {},
      getFrameVersion: () => 0,
      subscribeFrame: () => () => {},
      getState: () => ({ time: 0, paused: true }),
    };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const TAU = Math.PI * 2,
    clamp = (x, a, b) => Math.max(a, Math.min(b, x)),
    rand = (a, b) => a + Math.random() * (b - a),
    angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  let W = 1,
    H = 1,
    dpr = 1,
    overflow = 0,
    swimOverflow = 0,
    sceneLeft = 0,
    sceneRight = 1,
    time = 0,
    nextBurstAt = 0,
    recentBurstFish = [],
    fish = [],
    drawOrder = [],
    particles = [],
    neighborStates = [],
    plants = [],
    plantAtlas = null,
    paused = reducedMotion.matches,
    last = 0,
    acc = 0;
  const pointer = { x: 0, y: 0 },
    palette = [
      ["#ec713b", "#be432f"],
      ["#248e9b", "#285960"],
      ["#e9b93e", "#bc7b31"],
      ["#e75b3f", "#a9362a"],
      ["#299aa2", "#285968"],
    ];
  let dark = document.documentElement.getAttribute("data-theme") === "dark";
  const background = createWatercolorBackground();
  const interaction = createFishInteraction();
  let tapCandidate = null;
  const plantSeed = Math.floor(Math.random() * 1000000);
  const frameListeners = new Set();
  let frameVersion = 0;
  let backgroundTimer = 0;
  function resize() {
    const oldW = W,
      oldH = H;
    const bounds = container.getBoundingClientRect();
    W = Math.max(1, Math.round(bounds.width));
    H = Math.max(1, Math.round(bounds.height));
    overflow = Math.round(Math.min(80, H * 0.3, W * 0.18));
    // Keep the large drawing apron for tails and water distortion, while heads
    // only venture a little beyond the paper. These are independent boundaries.
    swimOverflow = Math.round(Math.min(18, H * 0.08, W * 0.04));
    sceneLeft = -Math.min(swimOverflow, Math.max(0, bounds.left - 6));
    sceneRight =
      W +
      Math.min(
        swimOverflow,
        Math.max(
          0,
          (document.documentElement.clientWidth || W + bounds.left) -
            bounds.left -
            W -
            6
        )
      );
    const sceneWidth = W + overflow * 2,
      sceneHeight = H + overflow * 2;
    const nextDpr = Math.min(
      devicePixelRatio || 1,
      2,
      Math.sqrt(1600000 / (sceneWidth * sceneHeight))
    );
    // Let fish cross the pond edge without extending the mobile page width.
    let layoutChanged = false;
    if (viewportMask) {
      for (const [key, value] of Object.entries({
        left: `${-bounds.left}px`,
        top: `${-overflow}px`,
        width: `${document.documentElement.clientWidth}px`,
        height: `${sceneHeight}px`,
      })) {
        if (viewportMask.style[key] !== value) {
          viewportMask.style[key] = value;
          layoutChanged = true;
        }
      }
    }
    for (const [key, value] of Object.entries({
      width: `${sceneWidth}px`,
      height: `${sceneHeight}px`,
      left: `${viewportMask ? bounds.left - overflow : -overflow}px`,
      top: viewportMask ? "0" : `${-overflow}px`,
    })) {
      if (canvas.style[key] !== value) {
        canvas.style[key] = value;
        layoutChanged = true;
      }
    }
    if (W === oldW && H === oldH && nextDpr === dpr) return layoutChanged;
    dpr = nextDpr;
    canvas.width = Math.round(sceneWidth * dpr);
    canvas.height = Math.round(sceneHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const f of fish) {
      f.x *= W / oldW;
      f.y *= H / oldH;
      initSpine(f);
    }
    interaction.clear(fish);
    tapCandidate = null;
    makeBackground();
    makePlants();
    return true;
  }
  // The pigment simulation shares the host's clock and one small backing canvas.
  function makeBackground() {
    background.rebuild(W, H, dark);
  }
  // Small rooted clumps: staggered stems open into one coherent ink silhouette.
  function makePlants() {
    // All roots sit below the lower edge; tall sides frame the low central sprigs.
    const hash = n => {
      const value = Math.sin((n + plantSeed) * 12.9898 + 4.13) * 43758.5453;
      return value - Math.floor(value);
    };
    const zones = [
      [0.015, 0.095],
      [0.13, 0.25],
      [0.29, 0.43],
      [0.46, 0.54],
      [0.57, 0.71],
      [0.75, 0.87],
      [0.905, 0.985],
    ];
    const clusters = zones.map(([lo, hi], c) => {
      const x = lo + (hi - lo) * hash(c * 41 + 37),
        edge = Math.abs(x - 0.5) * 2;
      return [
        x,
        1.03 + hash(c * 41 + 38) * 0.04,
        (0.44 + 1.45 * Math.pow(edge, 1.25)) *
          (0.92 + hash(c * 41 + 39) * 0.16),
        0.28 + edge * 0.16,
      ];
    });
    plants = [];
    clusters.forEach(([x, y, size, alpha], c) => {
      const seed = c * 41,
        base = Math.min(130, H * 0.52) * size;
      const count = 2 + Math.floor(hash(seed + 40) * 3),
        phase = hash(seed + 30) * TAU,
        period = 4.9 + hash(seed + 27) * 1.9;
      for (let j = 0; j < count; j++) {
        const spread = (j / (count - 1) - 0.5) * 2,
          zs = seed + j * 7.31;
        const h =
          base *
          (0.74 + 0.26 * (1 - Math.abs(spread)) + (hash(zs + 2) - 0.5) * 0.17);
        const p = {
          cluster: c,
          x: W * x + spread * base * 0.055,
          y: H * y + hash(zs + 3) * base * 0.027,
          h,
          angle: -Math.PI / 2 + spread * 0.265 + (hash(zs + 8) - 0.5) * 0.05,
          curve: spread * 0.025 + (hash(zs + 12) - 0.5) * 0.055,
          phase: phase + (hash(zs + 30) - 0.5) * 0.16,
          period,
          alpha: clamp(
            alpha +
              (j % 2 === 0 ? -0.065 : 0.095) +
              (hash(zs + 5) - 0.5) * 0.055,
            0.2,
            0.6
          ),
          color: dark
            ? ["#76a98c", "#65998b", "#8db3a0"][c % 3]
            : ["#4b7366", "#5a795e", "#6b8667"][c % 3],
          leaves: [],
        };
        if (!dark) p.alpha = Math.min(0.72, p.alpha * 1.15 + 0.02);
        const n = 6 + Math.floor(hash(zs + 19) * 2);
        for (let k = 0; k < n; k++)
          for (let side = -1; side <= 1; side += 2) {
            const z = zs + k * 2.93 + side * 0.67,
              u = 0.14 + (k / (n - 1)) * 0.74 + side * 0.017;
            p.leaves.push({
              u,
              side,
              length: h * (0.16 + hash(z + 2) * 0.06) * (1 - 0.38 * u),
              width: 0.18 + hash(z + 3) * 0.07,
              lean: 0.55 + hash(z + 4) * 0.35,
              bend: (hash(z + 9) - 0.5) * 0.18,
              ink: 0.76 + hash(z + 5) * 0.35,
              dry: hash(z + 13),
              phase: hash(z + 14) * TAU,
            });
          }
        plants.push(p);
      }
    });
    plants.sort((a, b) => a.alpha - b.alpha);
    plantAtlas?.destroy();
    plantAtlas = createPlantAtlas(plants, dpr);
    for (const p of plants) {
      p.cos = Math.cos(p.angle);
      p.sin = Math.sin(p.angle);
      p.stem = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
    }
  }
  function plantPoint(p, u, out) {
    const along = p.h * u,
      across =
        p.h * p.curve * u * u + Math.min(15, p.h * 0.105) * u * u * p.current;
    out.x = p.x + p.cos * along - p.sin * across;
    out.y = p.y + p.sin * along + p.cos * across;
    return out;
  }
  function drawPlants() {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const p of plants) {
      p.current =
        Math.sin((time * TAU) / p.period + p.phase) * 0.9 +
        Math.sin((time * TAU) / (p.period * 1.8) + p.phase) * 0.1;
      for (let i = 0; i <= 20; i++) plantPoint(p, i / 20, p.stem[i]);
      ctx.beginPath();
      ctx.moveTo(p.stem[0].x, p.stem[0].y);
      for (let i = 1; i <= 20; i++) ctx.lineTo(p.stem[i].x, p.stem[i].y);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = p.alpha * 0.7;
      ctx.lineWidth = Math.max(0.38, p.h * 0.017);
      ctx.stroke();
      for (const leaf of p.leaves) {
        const root = plantPoint(p, leaf.u, leaf.root),
          prev = plantPoint(p, Math.max(0, leaf.u - 0.008), leaf.prev),
          next = plantPoint(p, Math.min(1, leaf.u + 0.008), leaf.next);
        const angle =
          Math.atan2(next.y - prev.y, next.x - prev.x) +
          leaf.side * (1.3 - leaf.lean * 0.35) +
          0.032 * Math.sin(time * 0.36 + p.phase + leaf.u * 2) * leaf.u;
        plantAtlas.draw(ctx, leaf, root, angle);
      }
    }
    ctx.restore();
  }
  const shoals = [
    { x: 0.85, y: 0.52, rx: 0.12, ry: 0.17 },
    { x: 0.35, y: 0.26, rx: 0.17, ry: 0.08 },
    { x: 0.32, y: 0.78, rx: 0.22, ry: 0.12 },
    { x: 0.66, y: 0.65, rx: 0.29, ry: 0.28 },
  ];
  function newFish(i) {
    let u = Math.random(),
      group = u < 0.46 ? 0 : u < 0.73 ? 1 : u < 0.9 ? 2 : 3,
      g = shoals[group],
      r = Math.sqrt(Math.random()),
      theta = rand(0, TAU),
      depth = rand(0.1, 1),
      size = rand(0.86, 1.16),
      len = (18 + 41 * Math.pow(depth, 1.5)) * size * (W < 600 ? 0.74 : 1),
      base = (13 + 19 * depth) * rand(0.85, 1.12),
      p = palette[i % palette.length];
    const f = {
      x: clamp(W * (g.x + Math.cos(theta) * r * g.rx), 20, W - 20),
      y: clamp(H * (g.y + Math.sin(theta) * r * g.ry), 20, H - 20),
      a: rand(-Math.PI, Math.PI),
      v: base,
      base,
      len,
      phase: rand(0, TAU),
      turn: 0,
      bank: 0,
      pitch: 0,
      group,
      color: p[0],
      dark: p[1],
      depth,
      seed: rand(0, TAU),
      id: i,
      variablePace: false,
      requestBurst: false,
      glideElapsed: 0,
      burstElapsed: 0,
      burstDuration: 0,
      burstBeats: 0,
      burstHeading: 0,
      burstKind: "swim",
      burstCount: 0,
      turnBursts: 0,
      tailDrive: 0,
      steeringEffort: 0,
      tailAmplitude: 0.022,
      tailSweep: 0.065,
      tailRate: 5.5 + base * 0.05,
      pattern: i % 6,
      roaming: i % 10 === 0,
    };
    // Start in natural shoals; every fish can later cross the paper edge.
    if (f.roaming) f.len *= 0.75;
    const inset = f.len + 4;
    f.x = clamp(f.x, inset, W - inset);
    f.y = clamp(f.y, inset, H - inset);
    interaction.init(f);
    f.spots = Array.from({ length: 3 }, (_, j) => {
      const t = 0.18 + j * 0.23 + Math.sin(f.seed + j) * 0.035;
      return Array.from({ length: 25 }, (_, k) => {
        const a = (k / 24) * TAU,
          r = 1 + 0.14 * Math.sin(k * 1.15 + f.seed + j);
        return {
          t: clamp(t + Math.cos(a) * (j === 0 ? 0.048 : 0.069) * r, 0, 1),
          across: Math.sin(f.seed + j * 4) * 0.024 + Math.sin(a) * 0.057 * r,
        };
      });
    });
    f.flecks = Array.from({ length: 21 }, (_, j) => ({
      t: 0.1 + j * 0.038,
      across: Math.sin(j * 2.39 + f.seed) * 0.056,
      angle: Math.sin(j),
    }));
    initSpine(f);
    return f;
  }
  function reset() {
    fish = Array.from({ length: 32 }, (_, i) => newFish(i));
    drawOrder = [...fish].sort((a, b) => a.depth - b.depth);
    particles = Array.from({ length: 70 }, () => ({
      x: rand(0, 1),
      y: rand(0, 1),
      r: rand(0.5, 1.5),
      phase: rand(0, TAU),
      v: rand(0.5, 1.5),
    }));
    time = 0;
    nextBurstAt = 3;
    recentBurstFish = [];
    render();
  }
  function update(dt) {
    time += dt;
    interaction.step(dt, time, fish);
    // Select at each three-second event; any ten consecutive events use ten fish.
    if (time + 1e-8 >= nextBurstAt) {
      const available = fish.filter(
        f =>
          !f.variablePace &&
          (f.reaction.kind === "scatter" || !f.reaction.active) &&
          !recentBurstFish.includes(f.id)
      );
      if (available.length) {
        const chosen = available[Math.floor(Math.random() * available.length)];
        chosen.variablePace = true;
        chosen.requestBurst = true;
        recentBurstFish.push(chosen.id);
        if (recentBurstFish.length > 9) recentBurstFish.shift();
      }
      nextBurstAt += 3;
    }
    const states = neighborStates;
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i],
        state = states[i] ?? (states[i] = {});
      state.x = f.x;
      state.y = f.y;
      state.cos = Math.cos(f.a);
      state.sin = Math.sin(f.a);
      state.group = f.group;
      state.depth = f.depth;
      state.len = f.len;
    }
    for (let i = 0; i < fish.length; i++) {
      let f = fish[i],
        sx = 0,
        sy = 0,
        ax = 0,
        ay = 0,
        cx = 0,
        cy = 0,
        n = 0;
      for (let j = 0; j < states.length; j++) {
        if (i === j) continue;
        let g = states[j],
          dx = f.x - g.x,
          dy = f.y - g.y,
          d2 = dx * dx + dy * dy;
        let separation = (f.len + g.len) * 0.33 + 8;
        if (
          Math.abs(f.depth - g.depth) < 0.3 &&
          d2 < separation * separation &&
          d2 > 0.001
        ) {
          let d = Math.sqrt(d2),
            k = (separation - d) / separation;
          sx += (dx / d) * k * 2.9;
          sy += (dy / d) * k * 2.9;
        }
        if (g.group === f.group && d2 < 32000) {
          ax += g.cos;
          ay += g.sin;
          cx += g.x;
          cy += g.y;
          n++;
        }
      }
      let vx = Math.cos(f.a) * 1.4,
        vy = Math.sin(f.a) * 1.4;
      if (n && !f.roaming) {
        vx += (ax / n) * 0.8 + (cx / n - f.x) * 0.003;
        vy += (ay / n) * 0.8 + (cy / n - f.y) * 0.003;
      }
      vx += sx;
      vy += sy;
      // Broad, slowly moving destinations prevent a single stationary flock.
      let g = shoals[f.group],
        goalX = W * (g.x + 0.065 * Math.sin(time * 0.055 + f.group * 2)),
        goalY = H * (g.y + 0.06 * Math.sin(time * 0.07 + f.group));
      if (f.roaming) {
        const orbit = time * 0.08 + f.seed;
        goalX = W * 0.5 + Math.cos(orbit) * (W * 0.5 + 4);
        goalY = H * 0.5 + Math.sin(orbit) * (H * 0.5 + 4);
      }
      vx += (goalX - f.x) * (f.roaming ? 0.035 : 0.005);
      vy += (goalY - f.y) * (f.roaming ? 0.035 : 0.005);
      vx += Math.cos(time * 0.32 + f.seed) * 0.14;
      vy += Math.sin(time * 0.27 + f.seed) * 0.14;
      const minX = sceneLeft,
        maxX = sceneRight,
        minY = -swimOverflow,
        maxY = H + swimOverflow;
      // Look ahead and turn before the body reaches the scene or viewport edge.
      const margin = f.roaming ? f.len + 12 : Math.max(35, f.len * 0.65 + 12),
        x = f.x + Math.cos(f.a) * f.v * 0.8 - minX,
        y = f.y + Math.sin(f.a) * f.v * 0.8 - minY,
        limitX = maxX - minX,
        limitY = maxY - minY;
      vx +=
        Math.pow(Math.max(0, (margin - x) / margin), 2) * 6 -
        Math.pow(Math.max(0, (x - limitX + margin) / margin), 2) * 6;
      vy +=
        Math.pow(Math.max(0, (margin - y) / margin), 2) * 6 -
        Math.pow(Math.max(0, (y - limitY + margin) / margin), 2) * 6;
      const response = interaction.steer(f, vx, vy);
      if (response) {
        vx = response.x;
        vy = response.y;
      }
      const reaction = f.reaction,
        reacting = reaction.kind === "dodge" || reaction.kind === "scatter";
      let target = Math.atan2(vy, vx);
      if (f.variablePace) {
        if (f.requestBurst) {
          const headingError = angleDelta(target, f.a),
            nearEdge =
              Math.min(f.x - minX, maxX - f.x, f.y - minY, maxY - f.y) <
              Math.min(f.len + 18, (maxY - minY) * 0.23),
            turning = Math.abs(headingError) > 1.15 || Math.random() < 0.32;
          f.requestBurst = false;
          f.burstKind = turning ? "turn" : "forward";
          f.burstDuration = rand(0.6, 2);
          f.burstBeats = Math.max(
            2,
            Math.round(f.burstDuration * rand(3.6, 4.8))
          );
          f.burstElapsed = 0;
          f.glideElapsed = 0;
          f.burstHeading =
            nearEdge || Math.abs(headingError) > 1.15
              ? target
              : f.a + (Math.random() < 0.5 ? -1 : 1) * rand(1.5, 2.3);
          f.burstCount++;
          if (turning) f.turnBursts++;
        } else if (f.burstKind === "coast") {
          f.glideElapsed += dt;
          if (f.glideElapsed >= 3) {
            f.variablePace = false;
            f.burstKind = "swim";
          }
        } else {
          f.burstElapsed += dt;
          if (f.burstElapsed >= f.burstDuration) {
            f.burstKind = "coast";
            f.glideElapsed = 0;
          }
        }
        const stroking = f.burstKind === "forward" || f.burstKind === "turn",
          envelope = stroking
            ? Math.sin(Math.PI * clamp(f.burstElapsed / f.burstDuration, 0, 1))
            : 0;
        f.tailDrive += (envelope - f.tailDrive) * Math.min(1, dt * 16);
        // Longer random bursts add quick beats, then the tail quiets for the glide.
        if (stroking && !reacting) {
          const rate = (TAU * f.burstBeats) / f.burstDuration;
          f.tailRate += (rate - f.tailRate) * Math.min(1, dt * 18);
        }
        if (f.burstKind === "turn") target = f.burstHeading;
      }
      if (reacting && reaction.mix > 0.001) {
        target = Math.atan2(
          Math.sin(target) * (1 - reaction.mix) +
            Math.sin(reaction.heading) * reaction.mix,
          Math.cos(target) * (1 - reaction.mix) +
            Math.cos(reaction.heading) * reaction.mix
        );
      }
      const turningBurst =
          (f.variablePace && f.burstKind === "turn") ||
          (reacting && reaction.drive > 0.12),
        headingError = angleDelta(target, f.a),
        scatterTurn =
          reaction.kind === "scatter" &&
          reaction.elapsed >= 0 &&
          reaction.elapsed < reaction.duration &&
          (reaction.phase === "turn" || Math.abs(headingError) > 0.6),
        effort = clamp((Math.abs(headingError) - 0.12) / 0.9, 0, 1);
      f.steeringEffort += (effort - f.steeringEffort) * Math.min(1, dt * 8);
      // Ordinary turns are powered by alternating tail strokes too: the head
      // turns more during each stroke, with a softer glide between strokes.
      const stroke = 0.55 + 0.45 * Math.pow(Math.sin(f.phase), 2),
        turnLimit = scatterTurn
          ? 10.5
          : turningBurst
            ? 4.2
            : (1.15 + f.steeringEffort * 0.7) * stroke,
        turn = clamp(
          headingError *
            (scatterTurn
              ? 11
              : turningBurst
                ? 4.8
                : (2.2 + f.steeringEffort * 0.9) * stroke),
          -turnLimit,
          turnLimit
        );
      f.turn += (turn - f.turn) * Math.min(1, dt * (turningBurst ? 12 : 8));
      f.a += f.turn * dt;
      f.bank +=
        (clamp(f.turn * 0.58, -0.61, 0.61) - f.bank) * Math.min(1, dt * 2.7);
      f.pitch += (Math.sin(time * 0.22 + f.seed) * 0.1 - f.pitch) * dt;
      if (reacting && reaction.mix > 0.001) {
        const thrust =
          f.base *
          2.7 *
          reaction.drive *
          // Tail-driven turning comes first; forward thrust follows alignment.
          (reaction.kind === "scatter"
            ? reaction.phase === "turn"
              ? 0.12
              : Math.max(0, Math.cos(angleDelta(reaction.heading, f.a)))
            : 1) *
          (0.35 + 0.65 * Math.abs(Math.sin(f.phase)));
        const drag = (f.base * 0.72 - f.v) * 0.75;
        f.v = clamp(f.v + (thrust + drag) * dt, f.base * 0.5, f.base * 1.8);
      } else if (f.variablePace) {
        // Tail strokes provide thrust; drag slows the following glide naturally.
        const thrust =
            f.base *
            3.2 *
            f.tailDrive *
            (0.35 + 0.65 * Math.abs(Math.sin(f.phase))) *
            (turningBurst ? 0.72 : 1),
          drag = (f.base * 0.62 - f.v) * 0.7;
        f.v = clamp(f.v + (thrust + drag) * dt, f.base * 0.5, f.base * 2);
      } else {
        const desired = f.base * (1 - 0.2 * Math.min(1, Math.abs(f.turn)));
        f.v += (desired - f.v) * dt * 2;
      }
      f.x += Math.cos(f.a) * f.v * dt;
      f.y += Math.sin(f.a) * f.v * dt;
      f.x = clamp(f.x, minX + 6, maxX - 6);
      f.y = clamp(f.y, minY + 6, maxY - 6);
      const amplitude = reacting
        ? 0.008 + reaction.drive * 0.07 + f.steeringEffort * 0.035
        : f.variablePace
          ? 0.004 + f.tailDrive * 0.075 + f.steeringEffort * 0.04
          : 0.022 + f.steeringEffort * 0.045;
      f.tailAmplitude += (amplitude - f.tailAmplitude) * Math.min(1, dt * 12);
      const sweep =
        0.065 +
        f.steeringEffort * 0.2 +
        Math.max(f.tailDrive, reaction.drive) * 0.2;
      f.tailSweep += (sweep - f.tailSweep) * Math.min(1, dt * 12);
      const steeringRate = 5.5 + f.v * 0.05 + f.steeringEffort * 6.5;
      if (!f.variablePace) f.tailDrive *= Math.max(0, 1 - dt * 16);
      if (reacting) {
        const rate =
          reaction.elapsed > reaction.duration
            ? Math.max(3 + f.v * 0.035, steeringRate * f.steeringEffort)
            : steeringRate + reaction.drive * (reaction.rate - steeringRate);
        f.tailRate += (rate - f.tailRate) * Math.min(1, dt * 16);
      } else if (!f.variablePace) {
        f.tailRate += (steeringRate - f.tailRate) * Math.min(1, dt * 12);
      } else if (f.burstKind === "coast") {
        // Quiet straight glides remain quiet; steering can briefly engage the
        // tail without assigning another random acceleration event.
        f.tailRate +=
          (Math.max(2.6 + f.v * 0.035, steeringRate * f.steeringEffort) -
            f.tailRate) *
          Math.min(1, dt * 12);
      }
      f.phase += dt * f.tailRate;
      solveSpine(f);
    }
  }
  // Head-led distance/angle constraints, evaluated on persistent WORLD positions.
  // A turn changes the head first; the other vertebrae retain their previous
  // positions until the preceding link draws them along. Never rotate the whole rig.
  const LINKS = 14;
  function initSpine(f) {
    f.skinKey = null;
    f.skinVersion = 0;
    f.tangents ??= Array.from({ length: 15 }, () => ({ x: 0, y: 0 }));
    f.rawSkin ??= Array.from({ length: 65 }, () => ({ x: 0, y: 0 }));
    f.skin ??= Array.from({ length: 65 }, () => ({ x: 0, y: 0 }));
    f.geomCache = null;
    f.spine = Array.from({ length: LINKS + 1 }, (_, i) => ({
      x: f.x - (Math.cos(f.a) * f.len * i) / LINKS,
      y: f.y - (Math.sin(f.a) * f.len * i) / LINKS,
      a: f.a,
    }));
  }
  function solveSpine(f) {
    f.skinKey = null;
    if (!f.spine) initSpine(f);
    const spine = f.spine,
      step = f.len / LINKS;
    spine[0].x = f.x;
    spine[0].y = f.y;
    spine[0].a = f.a;
    for (let i = 1; i <= LINKS; i++) {
      const p = spine[i - 1],
        q = spine[i],
        t = i / LINKS;
      let desired = Math.atan2(p.y - q.y, p.x - q.x);
      // An anterior stiff region, progressively more supple towards the tail.
      const maxBend = 0.105 + 0.1 * t;
      q.a = p.a + clamp(angleDelta(desired, p.a), -maxBend, maxBend);
      q.x = p.x - Math.cos(q.a) * step;
      q.y = p.y - Math.sin(q.a) * step;
    }
  }
  function spinePoint(f, t, tangents, out) {
    t = clamp(t, 0, 1);
    const u = t * LINKS,
      i = Math.min(LINKS - 1, Math.floor(u)),
      v = u - i,
      p = f.spine[i],
      q = f.spine[i + 1];
    // Cubic Hermite interpolation gives a continuous skin through the vertebrae.
    const a = tangents[i],
      b = tangents[i + 1],
      h = f.len / LINKS,
      v2 = v * v,
      v3 = v2 * v;
    out.x =
      (2 * v3 - 3 * v2 + 1) * p.x +
      (v3 - 2 * v2 + v) * a.x * h +
      (-2 * v3 + 3 * v2) * q.x +
      (v3 - v2) * b.x * h;
    out.y =
      (2 * v3 - 3 * v2 + 1) * p.y +
      (v3 - 2 * v2 + v) * a.y * h +
      (-2 * v3 + 3 * v2) * q.y +
      (v3 - v2) * b.y * h;
    return out;
  }
  // Cache one smooth skin per pose. Shadow, outline, pigment and fins all
  // share it; no repeated spline solves in the inner drawing loops.
  function skinCurve(f) {
    const key = f.skinKey;
    if (
      key &&
      key.x === f.x &&
      key.y === f.y &&
      key.a === f.a &&
      key.phase === f.phase &&
      key.len === f.len
    )
      return f.skin;
    // Each of the 65 skin samples shares the same 15 spinal tangents.
    const tangents = f.tangents,
      raw = f.rawSkin;
    for (let k = 0; k <= LINKS; k++) {
      const a = f.spine[Math.max(0, k - 1)],
        b = f.spine[Math.min(LINKS, k + 1)],
        distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      tangents[k].x = (b.x - a.x) / distance;
      tangents[k].y = (b.y - a.y) / distance;
    }
    for (let i = 0; i <= 64; i++) spinePoint(f, i / 64, tangents, raw[i]);
    const c = Math.cos(f.a),
      sn = Math.sin(f.a);
    for (let i = 0; i <= 64; i++) {
      const p = raw[i],
        u = raw[Math.max(0, i - 1)],
        v = raw[Math.min(64, i + 1)],
        dx = u.x - v.x,
        dy = u.y - v.y,
        d = Math.hypot(dx, dy) || 1,
        t = i / 64,
        w = Math.sin(f.phase - t * 5.1) * f.len * f.tailAmplitude * t * t * t,
        x = p.x - f.x - (dy / d) * w,
        y = p.y - f.y + (dx / d) * w;
      f.skin[i].x = x * c + y * sn;
      f.skin[i].y = -x * sn + y * c;
    }
    f.skinVersion++;
    f.skinKey = { x: f.x, y: f.y, a: f.a, phase: f.phase, len: f.len };
    return f.skin;
  }
  function bodyPoint(f, t, out = {}) {
    const a = skinCurve(f),
      u = clamp(t, 0, 1) * 64,
      i = Math.min(63, Math.floor(u)),
      v = u - i;
    out.x = a[i].x + (a[i + 1].x - a[i].x) * v;
    out.y = a[i].y + (a[i + 1].y - a[i].y) * v;
    return out;
  }
  const surfaceScratch = Array.from({ length: 3 }, () => ({ x: 0, y: 0 }));
  function surface(f, t, across = 0, z = 0, along = 0, out = {}) {
    const p = bodyPoint(f, t, surfaceScratch[0]),
      u = bodyPoint(f, Math.max(0, t - 0.004), surfaceScratch[1]),
      v = bodyPoint(f, Math.min(1, t + 0.004), surfaceScratch[2]);
    let a = Math.atan2(u.y - v.y, u.x - v.x),
      roll = 0.46 + f.bank,
      w = across * Math.cos(roll) - z * Math.sin(roll);
    out.x = p.x + Math.cos(a) * along - Math.sin(a) * w;
    out.y = p.y + Math.sin(a) * along + Math.cos(a) * w;
    return out;
  }
  const bodyWidths = Array.from({ length: 33 }, (_, i) => {
    const t = i / 32;
    return (
      (0.007 + 0.137 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.76)), 1.2)) *
      (1 - 0.42 * t)
    );
  });
  function fishGeometry(f) {
    skinCurve(f);
    if (
      f.geomCache &&
      f.geomCache.version === f.skinVersion &&
      f.geomCache.bank === f.bank &&
      f.geomCache.turn === f.turn
    )
      return f.geometry;
    const geom =
      f.geometry ??
      (f.geometry = {
        body: Array.from({ length: 33 }, () => ({ x: 0, y: 0 })),
        left: Array.from({ length: 33 }, () => ({ x: 0, y: 0 })),
        right: Array.from({ length: 33 }, () => ({ x: 0, y: 0 })),
        fins: [-1, 1].map(side => ({ side, root: {}, tip: {}, end: {} })),
      });
    const roll = 0.46 + f.bank,
      c = Math.cos(roll),
      sn = Math.sin(roll);
    for (let i = 0; i <= 32; i++) {
      const t = i / 32,
        p = bodyPoint(f, t, geom.body[i]),
        width = f.len * bodyWidths[i],
        height = width * 0.72,
        extent = Math.hypot(width * c, height * sn),
        u = bodyPoint(f, Math.max(0, t - 0.004), surfaceScratch[0]),
        v = bodyPoint(f, Math.min(1, t + 0.004), surfaceScratch[1]),
        yaw = Math.atan2(u.y - v.y, u.x - v.x);
      p.t = t;
      p.width = width;
      p.height = height;
      geom.left[i].x = p.x + Math.sin(yaw) * extent;
      geom.left[i].y = p.y - Math.cos(yaw) * extent;
      geom.right[i].x = p.x - Math.sin(yaw) * extent;
      geom.right[i].y = p.y + Math.cos(yaw) * extent;
    }
    for (const fin of geom.fins) {
      const side = fin.side,
        flare = 1 + side * f.turn * 0.16;
      surface(f, 0.33, side * f.len * 0.074, 0, 0, fin.root);
      surface(
        f,
        0.4,
        side * f.len * 0.23 * flare,
        -f.len * 0.048 + side * f.turn * f.len * 0.05,
        -f.len * 0.12,
        fin.tip
      );
      surface(f, 0.52, side * f.len * 0.047, 0, 0, fin.end);
      fin.near = side * sn > 0;
    }
    f.geomCache = { version: f.skinVersion, bank: f.bank, turn: f.turn };
    return geom;
  }
  function drawFish(f, shadow = false) {
    ctx.save();
    ctx.translate(
      f.x + (shadow ? 8 + f.depth * 8 : 0),
      f.y + (shadow ? 10 + f.depth * 8 : 0)
    );
    ctx.rotate(f.a);
    const alpha = dark
      ? 0.22 + 0.78 * Math.pow(f.depth, 0.65)
      : 0.4 + 0.6 * Math.pow(f.depth, 0.65);
    const geom = fishGeometry(f),
      L = f.len;
    ctx.globalAlpha = shadow ? 0.025 * f.depth : alpha;
    const finColor = f.pattern === 0 || f.pattern === 3 ? "#597d71" : f.dark;
    const fin = v => {
      ctx.beginPath();
      ctx.moveTo(v.root.x, v.root.y);
      ctx.quadraticCurveTo(v.tip.x + L * 0.075, v.tip.y, v.tip.x, v.tip.y);
      ctx.quadraticCurveTo(v.tip.x + L * 0.01, v.end.y, v.end.x, v.end.y);
      ctx.closePath();
      ctx.fillStyle = shadow ? "#001d22" : finColor;
      ctx.globalAlpha = shadow ? 0.022 : alpha * 0.4;
      ctx.fill();
      if (!shadow) {
        ctx.strokeStyle = "#375c55";
        ctx.lineWidth = 0.4;
        ctx.globalAlpha = alpha * 0.24;
        for (let u of [0.3, 0.65, 1]) {
          ctx.beginPath();
          ctx.moveTo(v.root.x, v.root.y);
          ctx.lineTo(
            v.end.x * (1 - u) + v.tip.x * u,
            v.end.y * (1 - u) + v.tip.y * u
          );
          ctx.stroke();
        }
      }
    };
    for (let v of geom.fins) if (!v.near) fin(v);
    // Caudal fin is a folded fan in 3D, rooted to the final spinal tangent.
    let sweep = Math.sin(f.phase - 5.45) * f.tailSweep;
    const tp = (u, z) => surface(f, 1, u * L * Math.sin(sweep), z * L, -u * L);
    let root = tp(0, 0),
      upper = tp(0.215, 0.15),
      notch = tp(0.135, 0),
      lower = tp(0.215, -0.15);
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    const bendUpper = tp(0.1, 0.07),
      notchUpper = tp(0.18, 0.055),
      notchLower = tp(0.18, -0.055),
      bendLower = tp(0.1, -0.07);
    ctx.quadraticCurveTo(bendUpper.x, bendUpper.y, upper.x, upper.y);
    ctx.quadraticCurveTo(notchUpper.x, notchUpper.y, notch.x, notch.y);
    ctx.quadraticCurveTo(notchLower.x, notchLower.y, lower.x, lower.y);
    ctx.quadraticCurveTo(bendLower.x, bendLower.y, root.x, root.y);
    ctx.fillStyle = shadow ? "#001d22" : finColor;
    ctx.globalAlpha = shadow ? 0.025 : alpha * 0.61;
    ctx.fill();
    if (!shadow) {
      ctx.strokeStyle = "#385c51";
      ctx.lineWidth = 0.4;
      ctx.globalAlpha = alpha * 0.3;
      for (let z of [-0.13, -0.07, 0.07, 0.13]) {
        let end = tp(0.2, z);
        ctx.beginPath();
        ctx.moveTo(root.x, root.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    }
    const outline = () => {
      ctx.beginPath();
      geom.left.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)
      );
      for (let i = 32; i >= 0; i--) {
        let p = geom.right[i];
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    };
    outline();
    ctx.globalAlpha = shadow ? 0.025 : alpha;
    let cream = f.pattern === 0 || f.pattern === 3,
      ink = f.pattern === 1;
    if (shadow) ctx.fillStyle = "#00171e";
    else {
      let g = ctx.createLinearGradient(0, -L * 0.13, 0, L * 0.13);
      g.addColorStop(0, ink ? "#244846" : cream ? "#a4b0a0" : f.dark);
      g.addColorStop(0.42, ink ? "#63867b" : cream ? "#f3efdb" : f.color);
      g.addColorStop(1, ink ? "#183d3a" : cream ? "#cbd2bd" : f.dark);
      ctx.fillStyle = g;
    }
    ctx.fill();
    if (!shadow) {
      ctx.strokeStyle = "#274f48";
      ctx.globalAlpha = alpha * (dark ? 0.15 : 0.34);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.07;
      ctx.lineWidth = 2.1;
      ctx.stroke();
    }
    if (!shadow) {
      ctx.save();
      outline();
      ctx.clip();
      if (cream || ink) {
        for (let j = 0; j < 3; j++) {
          ctx.fillStyle = cream
            ? j === 1 && f.pattern === 3
              ? "#284c42"
              : j === 2
                ? "#435749"
                : "#df4d2e"
            : j === 1
              ? "#e3e3c8"
              : "#ce913b";
          ctx.beginPath();
          for (let k = 0; k <= 24; k++) {
            const sample = f.spots[j][k],
              tt = sample.t,
              v = surface(
                f,
                tt,
                sample.across * L,
                geom.body[Math.round(tt * 32)].height * 0.65
              );
            if (k) ctx.lineTo(v.x, v.y);
            else ctx.moveTo(v.x, v.y);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      // Dry-brush pigment flecks follow the spine, never the screen.
      ctx.fillStyle = "#234e43";
      ctx.globalAlpha = alpha * 0.13;
      for (let j = 0; j < 21; j++) {
        const sample = f.flecks[j],
          tt = sample.t,
          v = surface(
            f,
            tt,
            sample.across * L,
            geom.body[Math.round(tt * 32)].height * 0.5
          );
        ctx.beginPath();
        ctx.ellipse(
          v.x,
          v.y,
          Math.max(0.25, L * 0.01),
          Math.max(0.18, L * 0.004),
          sample.angle,
          0,
          TAU
        );
        ctx.fill();
      }
      // A dorsal ridge follows the lifted back, rather than a fixed screen-space line.
      ctx.beginPath();
      for (let i = 4; i < 25; i++) {
        let p = geom.body[i],
          v = surface(f, p.t, 0, p.height * 0.82);
        if (i === 4) ctx.moveTo(v.x, v.y);
        else ctx.lineTo(v.x, v.y);
      }
      ctx.strokeStyle = "#edf1d3";
      ctx.globalAlpha = alpha * 0.27;
      ctx.lineWidth = Math.max(0.45, L * 0.018);
      ctx.stroke();
      // Distant bodies take on the surrounding cool water tint.
      outline();
      ctx.globalAlpha = (1 - f.depth) * (dark ? 0.53 : 0.28);
      ctx.fillStyle = dark ? "#23494c" : "#c6dbcd";
      ctx.fill();
      ctx.restore();
      for (let v of geom.fins) if (v.near) fin(v);
      ctx.globalAlpha = alpha * 0.85;
      let head = geom.body[3];
      for (let side of [-1, 1]) {
        if (side * Math.sin(0.46 + f.bank) < -0.7) continue;
        let e = surface(
          f,
          head.t,
          side * head.width * 0.82,
          head.height * 0.34
        );
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, L * 0.015, L * 0.012, 0, 0, TAU);
        ctx.fillStyle = "#173333";
        ctx.fill();
      }
    }
    ctx.restore();
  }
  function render(now = performance.now()) {
    ctx.clearRect(0, 0, W + overflow * 2, H + overflow * 2);
    ctx.save();
    ctx.translate(overflow, overflow);
    // Round only the paper and rooted plants; fish can use the transparent apron.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 8);
    ctx.clip();
    background.draw(ctx, time);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < (dark ? 0 : 5); i++) {
      let x = W * (0.2 + i * 0.19) + Math.sin(time * 0.09 + i) * 35;
      let g = ctx.createLinearGradient(x, 0, x + W * 0.17, H);
      g.addColorStop(0, "rgba(255,253,226,.025)");
      g.addColorStop(1, "rgba(95,185,173,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - 25, 0);
      ctx.lineTo(x + 25, 0);
      ctx.lineTo(x + W * 0.32, H);
      ctx.lineTo(x + W * 0.02, H);
      ctx.fill();
    }
    ctx.restore();
    drawPlants();
    ctx.restore();
    for (let f of drawOrder) {
      if (f.depth > 0.48) drawFish(f, true);
      drawFish(f);
    }
    ctx.save();
    for (let p of particles) {
      let x = (p.x * W + Math.sin(time * 0.09 + p.phase) * 18 + W) % W,
        y = (p.y * H - ((time * p.v * 2) % H) + H) % H;
      ctx.globalAlpha =
        0.035 + 0.045 * (0.5 + 0.5 * Math.sin(time * 0.7 + p.phase));
      ctx.fillStyle = dark ? "#bdd9c8" : "#6b9580";
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
    frameVersion++;
    for (const listener of frameListeners) listener(now);
  }

  // The host owns lifecycle; no standalone title, controls or global keyboard shortcuts.
  let frameId = 0,
    disposed = false,
    inView = true,
    paintedAt = 0,
    resizePending = false,
    resizeFrameId = 0;
  function running() {
    return !disposed && !paused && inView && !document.hidden;
  }
  function stop() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    last = 0;
    acc = 0;
  }
  function schedule() {
    if (running() && !frameId) frameId = requestAnimationFrame(frame);
  }
  function frame(now) {
    frameId = 0;
    if (!running()) return;
    const resized = resizePending && applyResize();
    if (resized || now - paintedAt >= 1000 / 30) {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      paintedAt = now;
      acc += dt;
      while (acc >= 1 / 120) {
        update(1 / 120);
        acc -= 1 / 120;
      }
      render(now);
    }
    schedule();
  }
  function sync() {
    if (!running()) {
      interaction.clear(fish);
      tapCandidate = null;
    }
    stop();
    schedule();
  }
  function applyResize() {
    resizePending = false;
    const changed = resize();
    if (changed) {
      last = 0;
      acc = 0;
    }
    return changed;
  }
  function onResize() {
    if (disposed) return;
    resizePending = true;
    if (running()) schedule();
    else if (!resizeFrameId)
      resizeFrameId = requestAnimationFrame(now => {
        resizeFrameId = 0;
        if (!disposed && resizePending && applyResize()) render(now);
      });
  }
  function interactiveTarget(e) {
    return !!e.target?.closest?.(
      "a, button, input, select, textarea, [role='button'], [contenteditable='true']"
    );
  }
  function locate(e) {
    if (interactiveTarget(e)) return false;
    const b = container.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return false;
    pointer.x = ((e.clientX - b.left) * W) / b.width;
    pointer.y = ((e.clientY - b.top) * H) / b.height;
    if (pointer.x < 0 || pointer.x > W || pointer.y < 0 || pointer.y > H)
      return false;
    return true;
  }
  function onMove(e) {
    if (!running()) return;
    if (
      tapCandidate &&
      Math.hypot(e.clientX - tapCandidate.x, e.clientY - tapCandidate.y) > 12
    )
      tapCandidate = null;
    // A touch drag belongs to page scrolling; only a completed tap affects fish.
    if (e.pointerType === "touch") return;
    if (!locate(e)) {
      interaction.leave(fish, time);
      return;
    }
    interaction.move(pointer, performance.now(), time, fish, {
      width: W,
      height: H,
    });
  }
  function onDown(e) {
    tapCandidate = null;
    if (!running() || (e.button !== undefined && e.button !== 0) || !locate(e))
      return;
    tapCandidate = {
      x: e.clientX,
      y: e.clientY,
      stamp: performance.now(),
      id: e.pointerId,
    };
  }
  function onLeave() {
    tapCandidate = null;
    interaction.leave(fish, time);
  }
  function onUp(e) {
    const start = tapCandidate;
    tapCandidate = null;
    if (
      running() &&
      start &&
      start.id === e.pointerId &&
      performance.now() - start.stamp <= 500 &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 12 &&
      locate(e)
    ) {
      interaction.tap(pointer, time, fish, { width: W, height: H });
    }
  }
  function onMotion() {
    paused = reducedMotion.matches;
    interaction.clear(fish);
    tapCandidate = null;
    sync();
    render();
  }
  function onTheme() {
    const nextDark =
      document.documentElement.getAttribute("data-theme") === "dark";
    if (nextDark === dark || disposed) return;
    dark = nextDark;
    makeBackground();
    makePlants();
    render();
  }
  const themeObserver = new MutationObserver(onTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  const resizeObserver = new ResizeObserver(onResize);
  const intersectionObserver = new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    sync();
  });
  container.addEventListener("pointermove", onMove, { passive: true });
  container.addEventListener("pointerdown", onDown, { passive: true });
  container.addEventListener("pointerleave", onLeave);
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onLeave);
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", sync);
  reducedMotion.addEventListener("change", onMotion);
  resize();
  reset();
  sync();
  resizeObserver.observe(container);
  intersectionObserver.observe(container);
  return {
    getFrameVersion: () => frameVersion,
    subscribeFrame(listener) {
      if (disposed) return () => {};
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    setWatercolorSettings(next) {
      if (disposed) return;
      background.setSettings(next);
      window.clearTimeout(backgroundTimer);
      backgroundTimer = window.setTimeout(() => {
        if (disposed) return;
        makeBackground();
        render();
      }, 120);
    },
    getState: () => ({
      watercolor: background.getState(time),
      time,
      paused: !running(),
      width: W,
      height: H,
      fishCount: fish.length,
      fishMotion: fish.map(f => ({
        id: f.id,
        x: f.x,
        y: f.y,
        active: f.variablePace,
        reaction: {
          kind: f.reaction.kind,
          phase: f.reaction.phase,
          active: f.reaction.active,
          drive: f.reaction.drive,
          mix: f.reaction.mix,
          elapsed: f.reaction.elapsed,
          delay: f.reaction.delay,
          duration: f.reaction.duration,
        },
        speed: f.v,
        base: f.base,
        tailDrive: f.tailDrive,
        steeringEffort: f.steeringEffort,
        turn: f.turn,
        heading: f.a,
        tailPhase: f.phase,
        tailAmplitude: f.tailAmplitude,
        tailSweep: f.tailSweep,
        tailRate: f.tailRate,
        burstKind: f.burstKind,
        burstCount: f.burstCount,
        burstDuration: f.burstDuration,
        burstBeats: f.burstBeats,
        turnBursts: f.turnBursts,
      })),
      overflow,
      roamingFish: fish.filter(f => f.roaming).map(f => ({ x: f.x, y: f.y })),
      theme: dark ? "dark" : "light",
      plantRoots: plants.map(p => ({ x: p.x, y: p.y })),
      plantClusters: new Set(plants.map(p => p.cluster)).size,
      plantCachePixels: plantAtlas?.pixels ?? 0,
    }),
    destroy() {
      disposed = true;
      interaction.clear(fish);
      tapCandidate = null;
      frameListeners.clear();
      if (resizeFrameId) cancelAnimationFrame(resizeFrameId);
      resizeFrameId = 0;
      window.clearTimeout(backgroundTimer);
      background.destroy();
      plantAtlas?.destroy();
      plantAtlas = null;
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onLeave);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", onMotion);
    },
  };
}
