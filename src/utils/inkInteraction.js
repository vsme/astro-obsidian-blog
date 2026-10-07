const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const strong = kind => kind === "dodge" || kind === "scatter";

// Hover selects a few fish; taps reach every fish in a small local radius.
// The pond's fixed-step clock owns all motion;
// there are no timers, extra animation frames, DOM writes, or fixed actors.
export function createFishInteraction() {
  let previous = null,
    followAt = 0,
    startledAt = 0,
    lastMoveAt = -Infinity;
  const point = { x: 0, y: 0 };
  const steering = { x: 0, y: 0 };
  const random = (lo, hi) => lo + Math.random() * (hi - lo);
  const init = fish =>
    (fish.reaction = {
      kind: "none",
      active: false,
      elapsed: 0,
      delay: 0,
      duration: 0,
      recovery: 0,
      heading: 0,
      rate: 0,
      drive: 0,
      mix: 0,
      until: 0,
      cooldown: 0,
      phase: "idle",
      turnDuration: 0,
      originX: 0,
      originY: 0,
      width: 0,
      height: 0,
      spread: 0,
      wallEscape: false,
    });
  const reset = r => {
    r.kind = "none";
    r.active = false;
    r.phase = "idle";
    r.wallEscape = false;
    r.mix = r.drive = r.elapsed = 0;
  };
  function select(fish, count, radius, distance, time, allowFollow = false) {
    return fish
      .filter(
        f =>
          !f.variablePace &&
          !strong(f.reaction.kind) &&
          (f.reaction.cooldown <= time ||
            (allowFollow && f.reaction.kind === "follow"))
      )
      .map(f => ({ fish: f, distance: distance(f) }))
      .filter(candidate => candidate.distance < radius)
      .map(candidate => ({
        ...candidate,
        score: candidate.distance + Math.random() * radius * 0.3,
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, count)
      .map(candidate => candidate.fish);
  }
  function releaseFollowers(fish, time) {
    for (const f of fish)
      if (f.reaction.kind === "follow")
        f.reaction.until = Math.min(f.reaction.until, time);
  }
  function escapeHeading(f, r) {
    // Once an escape meets a wall, keep its direction for this reaction. Chasing
    // a clamped target reverses the heading whenever the fish crosses it.
    if (r.wallEscape) return r.heading;
    const dx = f.x - r.originX,
      dy = f.y - r.originY;
    const angle =
      (Math.hypot(dx, dy) > 0.001 ? Math.atan2(dy, dx) : f.a) + r.spread;
    let vx = Math.cos(angle),
      vy = Math.sin(angle);
    const reach = Math.max(18, f.v * 0.4),
      margin = Math.min(f.len * 0.5 + 10, r.height * 0.25),
      nextX = f.x + vx * reach,
      nextY = f.y + vy * reach,
      hitX = nextX < margin || nextX > r.width - margin,
      hitY = nextY < margin || nextY > r.height - margin;
    if (!hitX && !hitY) return angle;

    const inwardX = f.x < r.width * 0.5 ? 1 : -1,
      inwardY = f.y < r.height * 0.5 ? 1 : -1;
    if (hitX && hitY) {
      // Leave a corner along one edge with a small inward component.
      if (Math.abs(vx) > Math.abs(vy)) {
        vx = inwardX * 0.3;
        vy = inwardY;
      } else {
        vx = inwardX;
        vy = inwardY * 0.3;
      }
    } else if (hitX) {
      vx = inwardX * 0.3;
      if (Math.abs(vy) < 0.3) vy = inwardY;
    } else {
      vy = inwardY * 0.3;
      if (Math.abs(vx) < 0.3) vx = inwardX;
    }
    r.wallEscape = true;
    return Math.atan2(vy, vx);
  }
  function startle(fish, time, bounds, origin, distance, radius, kind) {
    if (time < startledAt) return;
    let chosen;
    if (kind === "scatter") {
      // A tap reaches every fish inside the disturbance, including an existing
      // automatic burst or dodge. Counts only limit hover and swipe responses.
      chosen = fish
        .filter(f => distance(f) <= radius)
        .sort((a, b) => distance(a) - distance(b));
    } else {
      const occupied = fish.filter(f => strong(f.reaction.kind)).length;
      const count = Math.min(5 - occupied, 2 + Math.floor(Math.random() * 3));
      if (count <= 0) return;
      chosen = select(fish, count, radius, distance, time, true);
    }
    if (!chosen.length) return;
    releaseFollowers(fish, time);
    startledAt = time + 0.9;
    followAt = time + 1.8;
    for (let index = 0; index < chosen.length; index++) {
      const f = chosen[index],
        r = f.reaction,
        from = origin(f);
      r.originX = from.x;
      r.originY = from.y;
      r.width = bounds.width;
      r.height = bounds.height;
      r.spread = kind === "scatter" ? 0 : random(-0.55, 0.55);
      r.kind = kind;
      r.active = true;
      r.wallEscape = false;
      r.heading = escapeHeading(f, r);
      r.elapsed =
        kind === "scatter"
          ? -random(0.012, 0.05) - (distance(f) / radius) * 0.07
          : -random(0.05, 0.18) - index * random(0.035, 0.075);
      r.phase = "wait";
      r.turnDuration = kind === "scatter" ? random(0.12, 0.26) : 0;
      r.delay = -r.elapsed;
      r.duration = random(0.6, 2);
      r.recovery = random(1.1, 1.8);
      r.rate = kind === "scatter" ? random(24, 32) : random(18, 26);
      r.drive = r.mix = 0;
      r.cooldown = time + r.delay + r.duration + r.recovery + 0.6;
    }
  }
  function move(next, stamp, time, fish, bounds) {
    point.x = next.x;
    point.y = next.y;
    lastMoveAt = time;
    const before = previous;
    previous = { x: next.x, y: next.y, stamp };
    const dx = before ? next.x - before.x : 0,
      dy = before ? next.y - before.y : 0;
    const elapsed = before ? stamp - before.stamp : 0;
    const speed =
      elapsed > 0 && elapsed < 180
        ? (Math.hypot(dx, dy) * 1000) / Math.max(8, elapsed)
        : 0;
    if (speed > 500 && Math.hypot(dx, dy) > 8) {
      const squared = dx * dx + dy * dy;
      const closest = f => {
        const projection = clamp(
          ((f.x - before.x) * dx + (f.y - before.y) * dy) / squared,
          0,
          1
        );
        return { x: before.x + dx * projection, y: before.y + dy * projection };
      };
      startle(
        fish,
        time,
        bounds,
        closest,
        f => {
          const p = closest(f);
          return Math.hypot(f.x - p.x, f.y - p.y);
        },
        bounds.width < 600 ? 65 : 82,
        "dodge"
      );
      return;
    }
    if (
      time < followAt ||
      fish.some(f => f.reaction.kind === "follow" && f.reaction.until > time)
    )
      return;
    const chosen = select(
      fish,
      2 + Math.floor(Math.random() * 3),
      Math.min(210, bounds.width * 0.5),
      f => Math.hypot(f.x - point.x, f.y - point.y),
      time
    );
    if (!chosen.length) return;
    followAt = time + 2;
    for (const f of chosen) {
      const r = f.reaction;
      r.kind = "follow";
      r.phase = "follow";
      r.active = true;
      r.elapsed = r.drive = r.mix = 0;
      r.duration = random(2.8, 4.2);
      r.until = time + r.duration;
      r.cooldown = r.until + 0.8;
    }
  }
  function tap(at, time, fish, bounds) {
    startle(
      fish,
      time,
      bounds,
      () => at,
      f => Math.hypot(f.x - at.x, f.y - at.y),
      bounds.width < 600 ? 60 : 75,
      "scatter"
    );
  }
  function step(dt, time, fish) {
    for (const f of fish) {
      const r = f.reaction;
      if (r.kind === "none") continue;
      r.elapsed += dt;
      if (r.kind === "follow") {
        const engaged =
          time < r.until && time - lastMoveAt < 1.6 && !f.variablePace;
        r.mix +=
          ((engaged ? 1 : 0) - r.mix) * Math.min(1, dt * (engaged ? 3 : 5));
        r.active = engaged || r.mix > 0.02;
        if (!r.active) reset(r);
      } else if (r.elapsed >= 0) {
        const total = r.duration + r.recovery;
        if (r.elapsed >= total) {
          reset(r);
          continue;
        }
        const scatter = r.kind === "scatter";
        r.phase =
          r.elapsed < r.turnDuration
            ? "turn"
            : r.elapsed < r.duration
              ? "swim"
              : "coast";
        if (scatter && r.elapsed < r.duration) r.heading = escapeHeading(f, r);
        const depth = 0.45 + f.depth * 0.55;
        const envelope =
          r.elapsed < r.duration
            ? Math.pow(Math.sin((Math.PI * r.elapsed) / r.duration), 0.65)
            : 0;
        const kick = scatter && r.phase === "turn" ? 0.9 : envelope;
        r.drive +=
          (kick * depth - r.drive) * Math.min(1, dt * (scatter ? 26 : 18));
        const settle = clamp((total - r.elapsed) / r.recovery, 0, 1);
        r.mix +=
          (settle * (scatter ? 0.98 : 0.86) - r.mix) *
          Math.min(1, dt * (scatter ? 16 : 9));
      }
    }
  }
  function steer(f, vx, vy) {
    const r = f.reaction;
    if (r.kind !== "follow" || r.mix < 0.001) return null;
    const dx = point.x - f.x,
      dy = point.y - f.y,
      distance = Math.hypot(dx, dy);
    if (distance < 0.001) return null;
    const comfort = Math.max(38, f.len * 0.9);
    const force =
      clamp((distance - comfort) / 65, -0.9, 2.2) *
      r.mix *
      (0.6 + f.depth * 0.4);
    steering.x = vx + (dx / distance) * force;
    steering.y = vy + (dy / distance) * force;
    return steering;
  }
  return {
    init,
    move,
    tap,
    step,
    steer,
    leave(fish, time) {
      previous = null;
      lastMoveAt = -Infinity;
      releaseFollowers(fish, time);
    },
    clear(fish) {
      previous = null;
      followAt = startledAt = 0;
      lastMoveAt = -Infinity;
      for (const f of fish) {
        reset(f.reaction);
        f.reaction.cooldown = 0;
      }
    },
  };
}
