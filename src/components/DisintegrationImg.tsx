import React, { useEffect, useRef } from "react";

interface Props {
  image: {
    src: string;
    width: number;
    height: number;
    format: string;
  };
}

interface Particle {
  homeX: number;
  homeY: number;
  width: number;
  height: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  startX: number;
  startY: number;
  delay: number;
  spin: number;
  phase: number;
  mobility: number;
  energy: number;
  settleAt: number;
}

interface Swipe {
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

interface Segment {
  start: number;
  size: number;
}

type AnimationMode = "idle" | "intro" | "interactive";

const INTRO_DURATION = 900;
const INTRO_STAGGER = 520;
const INTRO_TOTAL = INTRO_DURATION + INTRO_STAGGER + 80;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const random = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const backOut = (progress: number) => {
  const overshoot = 1.45;
  const shifted = progress - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
};

const buildSegments = (length: number): Segment[] =>
  Array.from({ length }, (_, start) => ({ start, size: 1 }));

const DisintegrationImg: React.FC<Props> = ({ image }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!img || !canvas || !container) return;

    const context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
      willReadFrequently: true,
    });
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let particles: Particle[] = [];
    const activeParticles = new Set<Particle>();
    let sourcePixels: Uint8ClampedArray | null = null;
    let frameImageData: ImageData | null = null;
    let mode: AnimationMode = "idle";
    let frameId = 0;
    let resizeFrameId = 0;
    let introStartedAt = 0;
    let lastFrameAt = 0;
    let lastInteractionAt = 0;
    let previousPointer: { x: number; y: number } | null = null;
    let pendingSwipe: Swipe | null = null;
    let width = 0;
    let height = 0;
    let bleed = 0;
    let surfaceWidth = 0;
    let surfaceHeight = 0;
    let boundarySoftness = 0;

    const blitParticle = (particle: Particle, opacity = 1) => {
      if (!sourcePixels || !frameImageData || opacity <= 0) return;

      const sourceX = bleed + particle.homeX;
      const sourceY = bleed + particle.homeY;
      const destinationX = Math.round(sourceX + particle.x);
      const destinationY = Math.round(sourceY + particle.y);
      const framePixels = frameImageData.data;

      for (let row = 0; row < particle.height; row += 1) {
        const targetY = destinationY + row;
        if (targetY < 0 || targetY >= surfaceHeight) continue;

        for (let column = 0; column < particle.width; column += 1) {
          const targetX = destinationX + column;
          if (targetX < 0 || targetX >= surfaceWidth) continue;

          const sourceOffset =
            ((sourceY + row) * surfaceWidth + sourceX + column) * 4;
          const targetOffset = (targetY * surfaceWidth + targetX) * 4;
          framePixels[targetOffset] = sourcePixels[sourceOffset];
          framePixels[targetOffset + 1] = sourcePixels[sourceOffset + 1];
          framePixels[targetOffset + 2] = sourcePixels[sourceOffset + 2];
          framePixels[targetOffset + 3] = Math.round(
            sourcePixels[sourceOffset + 3] * opacity
          );
        }
      }
    };

    const clearParticleHome = (particle: Particle) => {
      if (!frameImageData) return;
      const framePixels = frameImageData.data;
      const startX = bleed + particle.homeX;
      const startY = bleed + particle.homeY;

      for (let row = 0; row < particle.height; row += 1) {
        for (let column = 0; column < particle.width; column += 1) {
          const offset = ((startY + row) * surfaceWidth + startX + column) * 4;
          framePixels[offset] = 0;
          framePixels[offset + 1] = 0;
          framePixels[offset + 2] = 0;
          framePixels[offset + 3] = 0;
        }
      }
    };

    const presentFrame = () => {
      if (frameImageData) context.putImageData(frameImageData, 0, 0);
    };

    const renderIntro = (now: number) => {
      if (!frameImageData) return;
      frameImageData.data.fill(0);
      const elapsed = now - introStartedAt;

      particles.forEach(particle => {
        const progress = clamp(
          (elapsed - particle.delay) / INTRO_DURATION,
          0,
          1
        );
        const eased = backOut(progress);
        particle.x = particle.startX * (1 - eased);
        particle.y = particle.startY * (1 - eased);
        blitParticle(particle, clamp(progress * 2.2, 0, 1));
      });
      presentFrame();
    };

    const isMoving = (particle: Particle) =>
      Math.abs(particle.x) > 0.04 ||
      Math.abs(particle.y) > 0.04 ||
      Math.abs(particle.velocityX) > 0.04 ||
      Math.abs(particle.velocityY) > 0.04;

    const renderInteractive = () => {
      if (!sourcePixels || !frameImageData) return;
      frameImageData.data.set(sourcePixels);
      activeParticles.forEach(clearParticleHome);
      activeParticles.forEach(particle => blitParticle(particle));
      presentFrame();
    };

    const resetParticles = () => {
      particles.forEach(particle => {
        particle.x = 0;
        particle.y = 0;
        particle.velocityX = 0;
        particle.velocityY = 0;
        particle.energy = 0;
        particle.settleAt = 0;
      });
      activeParticles.clear();
    };

    const setIdle = () => {
      mode = "idle";
      pendingSwipe = null;
      lastFrameAt = 0;
      resetParticles();
      img.style.opacity = "1";
      canvas.style.opacity = "0";
    };

    const buildParticles = () => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return false;

      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      bleed = Math.round(clamp(width * 0.08, 36, 64));
      surfaceWidth = width + bleed * 2;
      surfaceHeight = height + bleed * 2;
      boundarySoftness = Math.round(clamp(bleed * 0.36, 14, 22));

      canvas.width = surfaceWidth;
      canvas.height = surfaceHeight;
      canvas.style.width = `${surfaceWidth}px`;
      canvas.style.height = `${surfaceHeight}px`;
      canvas.style.left = `${-bleed}px`;
      canvas.style.top = `${-bleed}px`;
      context.clearRect(0, 0, surfaceWidth, surfaceHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(img, bleed, bleed, width, height);

      try {
        const sourceImageData = context.getImageData(
          0,
          0,
          surfaceWidth,
          surfaceHeight
        );
        sourcePixels = new Uint8ClampedArray(sourceImageData.data);
        frameImageData = context.createImageData(surfaceWidth, surfaceHeight);
      } catch {
        sourcePixels = null;
        frameImageData = null;
        return false;
      }

      const horizontalSegments = buildSegments(width);
      const verticalSegments = buildSegments(height);
      const nextParticles: Particle[] = [];

      verticalSegments.forEach((vertical, row) => {
        horizontalSegments.forEach((horizontal, column) => {
          const index = row * horizontalSegments.length + column;
          const angle = random(index + 1) * Math.PI * 2;
          const distance = 14 + random(index + 31) * 38;
          nextParticles.push({
            homeX: horizontal.start,
            homeY: vertical.start,
            width: horizontal.size,
            height: vertical.size,
            x: 0,
            y: 0,
            velocityX: 0,
            velocityY: 0,
            startX: Math.cos(angle) * distance,
            startY: Math.sin(angle) * distance,
            delay:
              (horizontal.start / Math.max(1, width)) * INTRO_STAGGER +
              random(index + 97) * 80,
            // Neighbouring fragments share a broad curl direction, while their
            // phase and mobility keep the wake from moving like a rigid brush.
            spin:
              Math.sin(
                horizontal.start * 0.026 +
                  vertical.start * 0.038 +
                  random(row + 127) * 1.8
              ) >= 0
                ? 1
                : -1,
            phase: random(index + 157) * Math.PI * 2,
            mobility: 0.72 + random(index + 181) * 0.58,
            energy: 0,
            settleAt: 0,
          });
        });
      });

      particles = nextParticles;
      return true;
    };

    const applySwipe = (swipe: Swipe) => {
      const segmentX = swipe.x - swipe.fromX;
      const segmentY = swipe.y - swipe.fromY;
      const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
      const segmentLength = Math.sqrt(segmentLengthSquared);
      if (segmentLength < 0.01) return;

      const tangentX = segmentX / segmentLength;
      const tangentY = segmentY / segmentLength;
      const normalX = -tangentY;
      const normalY = tangentX;
      const speed = Math.min(20, Math.hypot(swipe.deltaX, swipe.deltaY));
      const speedRatio = speed / 20;
      const influenceRadius = clamp(width * 0.13, 58, 96);
      const searchPadding = influenceRadius + bleed;
      const minHomeX = Math.max(
        0,
        Math.floor(Math.min(swipe.fromX, swipe.x) - searchPadding)
      );
      const maxHomeX = Math.min(
        width - 1,
        Math.ceil(Math.max(swipe.fromX, swipe.x) + searchPadding)
      );
      const minHomeY = Math.max(
        0,
        Math.floor(Math.min(swipe.fromY, swipe.y) - searchPadding)
      );
      const maxHomeY = Math.min(
        height - 1,
        Math.ceil(Math.max(swipe.fromY, swipe.y) + searchPadding)
      );
      const now = performance.now();

      // With one particle per pixel, scan only the rows around the pointer
      // trail instead of testing the whole image on every pointer event.
      for (let homeY = minHomeY; homeY <= maxHomeY; homeY += 1) {
        const rowOffset = homeY * width;
        for (let homeX = minHomeX; homeX <= maxHomeX; homeX += 1) {
          const particle = particles[rowOffset + homeX];
          const centerX = particle.homeX + 0.5 + particle.x;
          const centerY = particle.homeY + 0.5 + particle.y;
          const projection = clamp(
            ((centerX - swipe.fromX) * segmentX +
              (centerY - swipe.fromY) * segmentY) /
              segmentLengthSquared,
            0,
            1
          );
          const closestX = swipe.fromX + segmentX * projection;
          const closestY = swipe.fromY + segmentY * projection;
          const offsetX = centerX - closestX;
          const offsetY = centerY - closestY;
          const distance = Math.hypot(offsetX, offsetY);
          if (distance >= influenceRadius) continue;

          const proximity = 1 - distance / influenceRadius;
          const influence = proximity * proximity * (3 - 2 * proximity);
          const radialX = distance > 0.001 ? offsetX / distance : normalX;
          const radialY = distance > 0.001 ? offsetY / distance : normalY;
          const signedSide = offsetX * normalX + offsetY * normalY;
          const side = signedSide === 0 ? particle.spin : Math.sign(signedSide);
          const ripple = Math.sin(
            particle.phase + projection * Math.PI * 1.6 + speedRatio * 0.8
          );
          const curl = particle.spin * 0.2 + side * 0.22 + ripple * 0.16;
          const strength =
            (1.22 + speed * 0.46) * influence * particle.mobility;

          particle.velocityX +=
            (tangentX * (0.84 + speedRatio * 0.16) +
              radialX * 0.2 +
              normalX * curl) *
            strength;
          particle.velocityY +=
            (tangentY * (0.84 + speedRatio * 0.16) +
              radialY * 0.2 +
              normalY * curl) *
            strength;
          particle.energy = Math.min(1, particle.energy + influence * 0.72);
          particle.settleAt = Math.max(
            particle.settleAt,
            now +
              35 +
              influence * 70 +
              random(particle.homeX * 3 + particle.homeY + 239) * 55
          );
          activeParticles.add(particle);
        }
      }
    };

    const scheduleFrame = () => {
      if (!frameId) frameId = window.requestAnimationFrame(tick);
    };

    const tick = (now: number) => {
      frameId = 0;

      if (mode === "intro") {
        renderIntro(now);
        if (now - introStartedAt >= INTRO_TOTAL) {
          setIdle();
          return;
        }
        scheduleFrame();
        return;
      }

      if (mode !== "interactive") return;

      const frameScale = clamp((now - (lastFrameAt || now)) / 16.667, 0.5, 2);
      lastFrameAt = now;
      if (pendingSwipe) {
        applySwipe(pendingSwipe);
        pendingSwipe = null;
      }

      let hasMotion = false;
      const flowing = now - lastInteractionAt < 90;
      activeParticles.forEach(particle => {
        const lingering = flowing || now < particle.settleAt;
        const spring = lingering ? 0.012 : 0.055;
        const twist = flowing
          ? particle.spin * particle.energy * 0.01 * frameScale
          : 0;
        const drift = flowing ? particle.energy * 0.008 : 0;
        const cos = Math.cos(twist);
        const sin = Math.sin(twist);
        const velocityX = particle.velocityX;
        const velocityY = particle.velocityY;

        particle.velocityX = velocityX * cos - velocityY * sin;
        particle.velocityY = velocityX * sin + velocityY * cos;
        particle.velocityX +=
          (-particle.x * spring +
            Math.cos(particle.phase + now * 0.0017) * drift) *
          frameScale;
        particle.velocityY +=
          (-particle.y * spring +
            Math.sin(particle.phase * 0.83 + now * 0.0015) * drift) *
          frameScale;

        const drawX = bleed + particle.homeX + particle.x;
        const drawY = bleed + particle.homeY + particle.y;
        const rightGap = surfaceWidth - drawX - particle.width;
        const bottomGap = surfaceHeight - drawY - particle.height;
        const boundaryForce = 0.28 * frameScale;

        // An invisible soft edge starts slowing fragments before they reach the
        // canvas limit, keeping the wake organic instead of making it hit a wall.
        if (drawX < boundarySoftness) {
          particle.velocityX +=
            (1 - clamp(drawX / boundarySoftness, 0, 1)) * boundaryForce;
        } else if (rightGap < boundarySoftness) {
          particle.velocityX -=
            (1 - clamp(rightGap / boundarySoftness, 0, 1)) * boundaryForce;
        }
        if (drawY < boundarySoftness) {
          particle.velocityY +=
            (1 - clamp(drawY / boundarySoftness, 0, 1)) * boundaryForce;
        } else if (bottomGap < boundarySoftness) {
          particle.velocityY -=
            (1 - clamp(bottomGap / boundarySoftness, 0, 1)) * boundaryForce;
        }

        // Near-critical damping during the gesture and overdamping on release
        // preserve the trail while preventing repeated jelly-like oscillation.
        const damping = lingering ? 0.86 : 0.65;
        particle.velocityX *= damping ** frameScale;
        particle.velocityY *= damping ** frameScale;
        particle.x += particle.velocityX * frameScale;
        particle.y += particle.velocityY * frameScale;

        const boundaryPadding = 1;
        const minX = boundaryPadding - bleed - particle.homeX;
        const maxX =
          surfaceWidth -
          boundaryPadding -
          particle.width -
          bleed -
          particle.homeX;
        const minY = boundaryPadding - bleed - particle.homeY;
        const maxY =
          surfaceHeight -
          boundaryPadding -
          particle.height -
          bleed -
          particle.homeY;

        // The final guard is deliberately low-bounce: it prevents disappearing
        // pixels without turning the outer edge into a pinball cushion.
        if (particle.x < minX) {
          particle.x = minX;
          if (particle.velocityX < 0) particle.velocityX *= -0.16;
        } else if (particle.x > maxX) {
          particle.x = maxX;
          if (particle.velocityX > 0) particle.velocityX *= -0.16;
        }
        if (particle.y < minY) {
          particle.y = minY;
          if (particle.velocityY < 0) particle.velocityY *= -0.16;
        } else if (particle.y > maxY) {
          particle.y = maxY;
          if (particle.velocityY > 0) particle.velocityY *= -0.16;
        }

        particle.energy *= (flowing ? 0.93 : 0.82) ** frameScale;

        if (isMoving(particle) || lingering) {
          hasMotion = true;
        } else {
          particle.x = 0;
          particle.y = 0;
          particle.energy = 0;
          activeParticles.delete(particle);
        }
      });

      renderInteractive();
      if (!hasMotion && now - lastInteractionAt > 320) {
        setIdle();
        return;
      }
      scheduleFrame();
    };

    const startIntro = () => {
      if (!buildParticles() || reducedMotion.matches || document.hidden) {
        setIdle();
        return;
      }

      mode = "intro";
      introStartedAt = performance.now();
      renderIntro(introStartedAt);
      canvas.style.opacity = "1";
      img.style.opacity = "0";
      scheduleFrame();
    };

    const wakeInteraction = () => {
      if (mode !== "idle" || !sourcePixels || !frameImageData) return;
      resetParticles();
      renderInteractive();
      canvas.style.opacity = "1";
      img.style.opacity = "0";
      mode = "interactive";
      lastFrameAt = performance.now();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (
        reducedMotion.matches ||
        mode === "intro" ||
        event.pointerType === "touch" ||
        !sourcePixels ||
        !frameImageData
      ) {
        return;
      }

      const bounds = container.getBoundingClientRect();
      const scaleX = width / bounds.width;
      const scaleY = height / bounds.height;
      const x = (event.clientX - bounds.left) * scaleX;
      const y = (event.clientY - bounds.top) * scaleY;
      const deltaX = previousPointer
        ? x - previousPointer.x
        : event.movementX * scaleX;
      const deltaY = previousPointer
        ? y - previousPointer.y
        : event.movementY * scaleY;
      if (deltaX === 0 && deltaY === 0) return;

      pendingSwipe = {
        fromX: pendingSwipe?.fromX ?? x - deltaX,
        fromY: pendingSwipe?.fromY ?? y - deltaY,
        x,
        y,
        deltaX: (pendingSwipe?.deltaX ?? 0) + deltaX,
        deltaY: (pendingSwipe?.deltaY ?? 0) + deltaY,
      };
      previousPointer = { x, y };
      lastInteractionAt = performance.now();
      wakeInteraction();
      scheduleFrame();
    };

    const handlePointerEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = container.getBoundingClientRect();
      previousPointer = {
        x: (event.clientX - bounds.left) * (width / bounds.width),
        y: (event.clientY - bounds.top) * (height / bounds.height),
      };
    };

    const handlePointerLeave = () => {
      previousPointer = null;
    };

    const handleVisibilityChange = () => {
      if (document.hidden && mode !== "idle") {
        if (frameId) window.cancelAnimationFrame(frameId);
        frameId = 0;
        setIdle();
      }
    };

    const handleResize = () => {
      if (resizeFrameId) return;
      resizeFrameId = window.requestAnimationFrame(() => {
        resizeFrameId = 0;
        const bounds = container.getBoundingClientRect();
        if (
          Math.abs(bounds.width - width) < 0.5 &&
          Math.abs(bounds.height - height) < 0.5
        ) {
          return;
        }
        if (frameId) window.cancelAnimationFrame(frameId);
        frameId = 0;
        buildParticles();
        setIdle();
      });
    };

    const resizeObserver = new ResizeObserver(handleResize);
    const handleLoad = () => startIntro();

    container.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    container.addEventListener("pointerenter", handlePointerEnter, {
      passive: true,
    });
    container.addEventListener("pointerleave", handlePointerLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    resizeObserver.observe(container);

    if (img.complete && img.naturalWidth > 0) {
      startIntro();
    } else {
      img.addEventListener("load", handleLoad, { once: true });
    }

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      if (resizeFrameId) window.cancelAnimationFrame(resizeFrameId);
      resizeObserver.disconnect();
      img.removeEventListener("load", handleLoad);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerenter", handlePointerEnter);
      container.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [image.height, image.src, image.width]);

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ aspectRatio: `${image.width}/${image.height}` }}
    >
      <img
        ref={imgRef}
        src={image.src}
        width={image.width}
        height={image.height}
        decoding="async"
        draggable={false}
        className="disintegration-img loaded block h-full w-full"
        alt=""
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute z-[1] block"
        aria-hidden="true"
        style={{ opacity: 0 }}
      />
    </div>
  );
};

export default DisintegrationImg;
