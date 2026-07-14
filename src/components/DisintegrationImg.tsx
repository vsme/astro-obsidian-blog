import React, { useEffect, useRef } from "react";

interface Props {
  image: {
    src: string;
    width: number;
    height: number;
    format: string;
  };
}

interface Trail {
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  createdAt: number;
  speed: number;
}

interface PointerPosition {
  x: number;
  y: number;
  time: number;
}

interface Uniforms {
  image: WebGLUniformLocation;
  imageSize: WebGLUniformLocation;
  surfaceSize: WebGLUniformLocation;
  bleed: WebGLUniformLocation;
  time: WebGLUniformLocation;
  introTime: WebGLUniformLocation;
  radius: WebGLUniformLocation;
  mode: WebGLUniformLocation;
  trailCount: WebGLUniformLocation;
  trails: WebGLUniformLocation;
  trailMotion: WebGLUniformLocation;
}

type AnimationMode = "idle" | "intro" | "interactive";

const MAX_TRAILS = 18;
const INTRO_DURATION = 900;
const INTRO_STAGGER = 520;
const INTRO_TOTAL = INTRO_DURATION + INTRO_STAGGER + 80;
const TRAIL_LIFETIME = 860;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const VERTEX_SHADER = `#version 300 es
precision highp float;

const int MAX_TRAILS = ${MAX_TRAILS};

uniform vec2 uImageSize;
uniform vec2 uSurfaceSize;
uniform float uBleed;
uniform float uTime;
uniform float uIntroTime;
uniform float uRadius;
uniform int uMode;
uniform int uTrailCount;
uniform vec4 uTrails[MAX_TRAILS];
uniform vec4 uTrailMotion[MAX_TRAILS];

out vec2 vUv;
out float vOpacity;

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

float backOut(float progress) {
  const float overshoot = 1.45;
  float shifted = progress - 1.0;
  return 1.0 + (overshoot + 1.0) * shifted * shifted * shifted +
    overshoot * shifted * shifted;
}

float softBound(float value, float negativeLimit, float positiveLimit) {
  if (value < 0.0) {
    return -negativeLimit * tanh((-value) / max(negativeLimit, 1.0));
  }
  return positiveLimit * tanh(value / max(positiveLimit, 1.0));
}

void main() {
  int imageWidth = int(uImageSize.x);
  float homeX = float(gl_VertexID % imageWidth);
  float homeY = float(gl_VertexID / imageWidth);
  vec2 home = vec2(homeX, homeY);
  vec2 displacement = vec2(0.0);
  vOpacity = 1.0;

  float seed = hash(home + vec2(0.37, 0.73));
  float phase = hash(home + vec2(19.17, 7.31)) * 6.28318530718;
  float mobility = mix(0.72, 1.30, hash(home + vec2(37.0, 53.0)));
  float spinField = sin(home.x * 0.026 + home.y * 0.038 +
    hash(floor(home.y / 10.0) + vec2(127.0)) * 1.8);
  float spin = spinField >= 0.0 ? 1.0 : -1.0;

  if (uMode == 0) {
    float angle = seed * 6.28318530718;
    float distanceFromHome = 14.0 + hash(home + vec2(31.0)) * 38.0;
    vec2 startOffset = vec2(cos(angle), sin(angle)) * distanceFromHome;
    float delay = (home.x / max(uImageSize.x - 1.0, 1.0)) * 0.52 +
      hash(home + vec2(97.0)) * 0.08;
    float progress = clamp((uIntroTime - delay) / 0.9, 0.0, 1.0);
    displacement = startOffset * (1.0 - backOut(progress));
    vOpacity = clamp(progress * 2.2, 0.0, 1.0);
  } else {
    for (int index = 0; index < MAX_TRAILS; index += 1) {
      if (index >= uTrailCount) break;

      vec4 trail = uTrails[index];
      vec4 motion = uTrailMotion[index];
      vec2 segment = trail.zw - trail.xy;
      float segmentLengthSquared = dot(segment, segment);
      if (segmentLengthSquared < 0.0001) continue;

      float projection = clamp(
        dot(home - trail.xy, segment) / segmentLengthSquared,
        0.0,
        1.0
      );
      vec2 closest = trail.xy + segment * projection;
      vec2 offset = home - closest;
      float distanceToTrail = length(offset);
      float localRadius = uRadius * mix(0.90, 1.08, seed);
      if (distanceToTrail >= localRadius) continue;

      float age = max(0.0, uTime - motion.z);
      if (age > ${TRAIL_LIFETIME / 1000}) continue;

      float proximity = 1.0 - distanceToTrail / localRadius;
      float influence = proximity * proximity * (3.0 - 2.0 * proximity);
      float life = exp(-age * 4.8);
      float speed = motion.w;
      float speedRatio = clamp(speed / 20.0, 0.0, 1.0);
      vec2 tangent = normalize(segment);
      vec2 normal = vec2(-tangent.y, tangent.x);
      vec2 radial = distanceToTrail > 0.001
        ? offset / distanceToTrail
        : normal * spin;
      float signedSide = dot(offset, normal);
      float side = abs(signedSide) < 0.001 ? spin : sign(signedSide);
      float ripple = sin(phase + projection * 5.0 + speedRatio * 0.8);
      float curl = spin * 0.30 + side * 0.32 + ripple * 0.22;
      float strength = (4.20 + speed * 1.25) * influence * mobility * life;

      displacement += (
        tangent * (0.72 + speedRatio * 0.22) +
        radial * 0.32 +
        normal * curl
      ) * strength;
    }
  }

  vec2 basePosition = vec2(uBleed) + home;
  float leftLimit = max(basePosition.x - 1.0, 1.0);
  float rightLimit = max(uSurfaceSize.x - basePosition.x - 2.0, 1.0);
  float topLimit = max(basePosition.y - 1.0, 1.0);
  float bottomLimit = max(uSurfaceSize.y - basePosition.y - 2.0, 1.0);
  displacement.x = softBound(displacement.x, leftLimit, rightLimit);
  displacement.y = softBound(displacement.y, topLimit, bottomLimit);

  vec2 canvasPosition = basePosition + displacement + vec2(0.5);
  vec2 clipPosition = vec2(
    canvasPosition.x / uSurfaceSize.x * 2.0 - 1.0,
    1.0 - canvasPosition.y / uSurfaceSize.y * 2.0
  );

  gl_Position = vec4(clipPosition, 0.0, 1.0);
  gl_PointSize = 1.0;
  vUv = (home + vec2(0.5)) / uImageSize;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uImage;

in vec2 vUv;
in float vOpacity;
out vec4 outColor;

void main() {
  vec4 color = texture(uImage, vUv);
  if (color.a <= 0.001 || vOpacity <= 0.001) discard;
  outColor = vec4(color.rgb, color.a * vOpacity);
}
`;

const createShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string
) => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
};

const createProgram = (gl: WebGL2RenderingContext) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create WebGL program");

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
};

const DisintegrationImg: React.FC<Props> = ({ image }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!img || !canvas || !container) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    let program: WebGLProgram | null = null;
    let texture: WebGLTexture | null = null;
    let vertexArray: WebGLVertexArrayObject | null = null;
    let uniforms: Uniforms | null = null;
    let mode: AnimationMode = "idle";
    let frameId = 0;
    let resizeFrameId = 0;
    let introStartedAt = 0;
    let lastInteractionAt = 0;
    let previousPointer: PointerPosition | null = null;
    let width = 0;
    let height = 0;
    let bleed = 0;
    let surfaceWidth = 0;
    let surfaceHeight = 0;
    let canvasVisible = false;
    let resourcesReady = false;
    let disposed = false;
    const clockStartedAt = performance.now();
    const trails: Trail[] = [];
    const trailCoordinates = new Float32Array(MAX_TRAILS * 4);
    const trailMotion = new Float32Array(MAX_TRAILS * 4);

    const hideCanvas = () => {
      canvasVisible = false;
      canvas.style.opacity = "0";
      img.style.opacity = "1";
    };

    const showCanvas = () => {
      canvasVisible = true;
      canvas.style.opacity = "1";
      img.style.opacity = "0";
    };

    const setIdle = () => {
      mode = "idle";
      trails.length = 0;
      previousPointer = null;
      hideCanvas();
    };

    const failSafe = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
      resourcesReady = false;
      setIdle();
    };

    const getUniform = (nextProgram: WebGLProgram, name: string) => {
      const location = gl.getUniformLocation(nextProgram, name);
      if (location === null) throw new Error(`Missing WebGL uniform: ${name}`);
      return location;
    };

    const destroyResources = () => {
      if (gl.isContextLost()) return;
      if (texture) gl.deleteTexture(texture);
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      if (program) gl.deleteProgram(program);
      texture = null;
      vertexArray = null;
      program = null;
      uniforms = null;
      resourcesReady = false;
    };

    const createResources = () => {
      destroyResources();
      const nextProgram = createProgram(gl);
      const nextTexture = gl.createTexture();
      const nextVertexArray = gl.createVertexArray();
      if (!nextTexture || !nextVertexArray) {
        gl.deleteProgram(nextProgram);
        throw new Error("Unable to allocate WebGL resources");
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, nextTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

      program = nextProgram;
      texture = nextTexture;
      vertexArray = nextVertexArray;
      uniforms = {
        image: getUniform(nextProgram, "uImage"),
        imageSize: getUniform(nextProgram, "uImageSize"),
        surfaceSize: getUniform(nextProgram, "uSurfaceSize"),
        bleed: getUniform(nextProgram, "uBleed"),
        time: getUniform(nextProgram, "uTime"),
        introTime: getUniform(nextProgram, "uIntroTime"),
        radius: getUniform(nextProgram, "uRadius"),
        mode: getUniform(nextProgram, "uMode"),
        trailCount: getUniform(nextProgram, "uTrailCount"),
        trails: getUniform(nextProgram, "uTrails[0]"),
        trailMotion: getUniform(nextProgram, "uTrailMotion[0]"),
      };
      resourcesReady = true;
    };

    const updateSurface = () => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return false;

      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      bleed = Math.round(clamp(width * 0.08, 36, 64));
      surfaceWidth = width + bleed * 2;
      surfaceHeight = height + bleed * 2;

      canvas.width = surfaceWidth;
      canvas.height = surfaceHeight;
      canvas.style.width = `${surfaceWidth}px`;
      canvas.style.height = `${surfaceHeight}px`;
      canvas.style.left = `${-bleed}px`;
      canvas.style.top = `${-bleed}px`;
      gl.viewport(0, 0, surfaceWidth, surfaceHeight);
      return true;
    };

    const uploadTrails = () => {
      trailCoordinates.fill(0);
      trailMotion.fill(0);

      trails.forEach((trail, index) => {
        const offset = index * 4;
        trailCoordinates[offset] = trail.fromX;
        trailCoordinates[offset + 1] = trail.fromY;
        trailCoordinates[offset + 2] = trail.x;
        trailCoordinates[offset + 3] = trail.y;
        trailMotion[offset] = trail.deltaX;
        trailMotion[offset + 1] = trail.deltaY;
        trailMotion[offset + 2] = (trail.createdAt - clockStartedAt) / 1000;
        trailMotion[offset + 3] = trail.speed;
      });
    };

    const renderFrame = (now: number) => {
      if (
        !resourcesReady ||
        !program ||
        !texture ||
        !vertexArray ||
        !uniforms ||
        gl.isContextLost()
      ) {
        return false;
      }

      gl.viewport(0, 0, surfaceWidth, surfaceHeight);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vertexArray);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      gl.uniform1i(uniforms.image, 0);
      gl.uniform2f(uniforms.imageSize, width, height);
      gl.uniform2f(uniforms.surfaceSize, surfaceWidth, surfaceHeight);
      gl.uniform1f(uniforms.bleed, bleed);
      gl.uniform1f(uniforms.time, (now - clockStartedAt) / 1000);
      gl.uniform1f(uniforms.radius, clamp(width * 0.13, 58, 96));

      if (mode === "intro") {
        gl.uniform1i(uniforms.mode, 0);
        gl.uniform1f(uniforms.introTime, (now - introStartedAt) / 1000);
        gl.uniform1i(uniforms.trailCount, 0);
      } else {
        uploadTrails();
        gl.uniform1i(uniforms.mode, 1);
        gl.uniform1f(uniforms.introTime, 0);
        gl.uniform1i(uniforms.trailCount, trails.length);
        gl.uniform4fv(uniforms.trails, trailCoordinates);
        gl.uniform4fv(uniforms.trailMotion, trailMotion);
      }

      gl.drawArrays(gl.POINTS, 0, width * height);
      gl.bindVertexArray(null);
      return !gl.isContextLost();
    };

    const scheduleFrame = () => {
      if (!frameId) frameId = window.requestAnimationFrame(tick);
    };

    const tick = (now: number) => {
      frameId = 0;
      if (disposed || document.hidden || mode === "idle") return;

      if (mode === "interactive") {
        while (trails.length && now - trails[0].createdAt > TRAIL_LIFETIME) {
          trails.shift();
        }
        if (!trails.length && now - lastInteractionAt > TRAIL_LIFETIME) {
          setIdle();
          return;
        }
      }

      try {
        if (!renderFrame(now)) {
          failSafe();
          return;
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("[DisintegrationImg] WebGL render failed", error);
        }
        failSafe();
        return;
      }

      if (!canvasVisible && (mode !== "intro" || now - introStartedAt > 32)) {
        showCanvas();
      }

      if (mode === "intro" && now - introStartedAt >= INTRO_TOTAL) {
        setIdle();
        return;
      }
      scheduleFrame();
    };

    const initialize = () => {
      if (reducedMotion.matches || document.hidden) {
        setIdle();
        return false;
      }

      try {
        createResources();
        return updateSurface();
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(
            "[DisintegrationImg] WebGL initialization failed",
            error
          );
        }
        failSafe();
        return false;
      }
    };

    const startIntro = () => {
      if (!initialize()) return;
      mode = "intro";
      introStartedAt = performance.now();
      hideCanvas();
      scheduleFrame();
    };

    const wakeInteraction = () => {
      if (!resourcesReady || mode === "intro") return;
      if (mode === "idle") {
        mode = "interactive";
        hideCanvas();
      }
      scheduleFrame();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (
        reducedMotion.matches ||
        mode === "intro" ||
        event.pointerType === "touch" ||
        !resourcesReady
      ) {
        return;
      }

      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const scaleX = width / bounds.width;
      const scaleY = height / bounds.height;
      const x = (event.clientX - bounds.left) * scaleX;
      const y = (event.clientY - bounds.top) * scaleY;
      const now = performance.now();

      if (!previousPointer) {
        previousPointer = { x, y, time: now };
        return;
      }

      const deltaX = x - previousPointer.x;
      const deltaY = y - previousPointer.y;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < 0.15) return;

      const frameDuration = Math.max(4, now - previousPointer.time);
      const speed = clamp(distance / (frameDuration / 16.667), 0, 20);
      trails.push({
        fromX: previousPointer.x,
        fromY: previousPointer.y,
        x,
        y,
        deltaX,
        deltaY,
        createdAt: now,
        speed,
      });
      if (trails.length > MAX_TRAILS) trails.shift();

      previousPointer = { x, y, time: now };
      lastInteractionAt = now;
      wakeInteraction();
    };

    const handlePointerEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !width || !height) return;
      const bounds = container.getBoundingClientRect();
      previousPointer = {
        x: (event.clientX - bounds.left) * (width / bounds.width),
        y: (event.clientY - bounds.top) * (height / bounds.height),
        time: performance.now(),
      };
    };

    const handlePointerLeave = () => {
      previousPointer = null;
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (frameId) window.cancelAnimationFrame(frameId);
        frameId = 0;
        setIdle();
        return;
      }

      if (
        !resourcesReady &&
        !reducedMotion.matches &&
        img.complete &&
        img.naturalWidth > 0
      ) {
        startIntro();
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
        if (!updateSurface()) failSafe();
        setIdle();
      });
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      program = null;
      texture = null;
      vertexArray = null;
      uniforms = null;
      failSafe();
    };

    const handleContextRestored = () => {
      if (disposed || !img.complete || !img.naturalWidth) return;
      try {
        createResources();
        updateSurface();
        setIdle();
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("[DisintegrationImg] WebGL restore failed", error);
        }
        failSafe();
      }
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
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    resizeObserver.observe(container);

    if (img.complete && img.naturalWidth > 0) {
      startIntro();
    } else {
      img.addEventListener("load", handleLoad, { once: true });
    }

    return () => {
      disposed = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      if (resizeFrameId) window.cancelAnimationFrame(resizeFrameId);
      resizeObserver.disconnect();
      destroyResources();
      img.removeEventListener("load", handleLoad);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerenter", handlePointerEnter);
      container.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
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
