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

interface IntroUniforms {
  image: WebGLUniformLocation;
  imageSize: WebGLUniformLocation;
  cornerRadii: WebGLUniformLocation;
  surfaceSize: WebGLUniformLocation;
  bleed: WebGLUniformLocation;
  introTime: WebGLUniformLocation;
  introOrigin: WebGLUniformLocation;
}

interface RippleUniforms {
  image: WebGLUniformLocation;
  imageSize: WebGLUniformLocation;
  cornerRadii: WebGLUniformLocation;
  surfaceSize: WebGLUniformLocation;
  bleed: WebGLUniformLocation;
  time: WebGLUniformLocation;
  radius: WebGLUniformLocation;
  trailCount: WebGLUniformLocation;
  trails: WebGLUniformLocation;
  trailMotion: WebGLUniformLocation;
}

type AnimationMode = "idle" | "intro" | "interactive";

const MAX_TRAILS = 18;
const INTRO_TOTAL = 1600;
const TRAIL_LIFETIME = 1800;
const TRAIL_SAMPLE_INTERVAL = 38;
const TRAIL_FORCE_DISTANCE = 18;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;

uniform vec2 uImageSize;
uniform vec2 uSurfaceSize;
uniform float uBleed;

out vec2 vUv;

void main() {
  vec2 quadPosition;
  if (gl_VertexID == 0) quadPosition = vec2(0.0, 0.0);
  else if (gl_VertexID == 1) quadPosition = vec2(1.0, 0.0);
  else if (gl_VertexID == 2) quadPosition = vec2(0.0, 1.0);
  else if (gl_VertexID == 3) quadPosition = vec2(0.0, 1.0);
  else if (gl_VertexID == 4) quadPosition = vec2(1.0, 0.0);
  else quadPosition = vec2(1.0, 1.0);

  vec2 canvasPosition = quadPosition * uSurfaceSize;
  vec2 clipPosition = vec2(
    canvasPosition.x / uSurfaceSize.x * 2.0 - 1.0,
    1.0 - canvasPosition.y / uSurfaceSize.y * 2.0
  );

  gl_Position = vec4(clipPosition, 0.0, 1.0);
  vUv = (canvasPosition - vec2(uBleed)) / uImageSize;
}
`;

const INTRO_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uImage;
uniform vec2 uImageSize;
uniform vec4 uCornerRadii;
uniform float uIntroTime;
uniform vec2 uIntroOrigin;

in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 imagePosition = vUv * uImageSize;
  vec2 origin = uImageSize * uIntroOrigin;
  vec2 fromOrigin = imagePosition - origin;
  float distanceFromOrigin = length(fromOrigin);
  float furthestDistance = length(
    vec2(
      max(origin.x, uImageSize.x - origin.x),
      max(origin.y, uImageSize.y - origin.y)
    )
  );
  const float travelDuration = 1.00;
  float waveTravelDistance = furthestDistance + 130.0;
  float frontRadius = uIntroTime / travelDuration * waveTravelDistance;
  float frontOffset = distanceFromOrigin - frontRadius;
  float frontProgress = clamp(
    frontRadius / max(furthestDistance, 0.001),
    0.0,
    1.0
  );
  float waveGrowth = smoothstep(0.0, 1.0, frontProgress);
  float packetWidth = mix(42.0, 120.0, waveGrowth);
  float reveal = 1.0 - smoothstep(
    -packetWidth * 0.55,
    packetWidth * 0.26,
    frontOffset
  );
  float distanceRatio = clamp(
    distanceFromOrigin / max(furthestDistance, 0.001),
    0.0,
    1.0
  );
  float distanceGain = mix(0.24, 1.16, smoothstep(0.0, 1.0, distanceRatio));
  float organic =
    sin(imagePosition.x * 0.031 + imagePosition.y * 0.047) * 0.52 +
    sin(imagePosition.x * 0.014 - imagePosition.y * 0.039) * 0.30;
  float middleOffset = distanceFromOrigin - frontRadius * 0.84;
  float innerOffset = distanceFromOrigin - frontRadius * 0.58;
  float outerWidth = packetWidth * 0.55;
  float middleWidth = packetWidth * 0.39;
  float innerWidth = packetWidth * 0.27;
  float outerEnvelope = exp(-pow(frontOffset / outerWidth, 2.0));
  float middleEnvelope = exp(-pow(middleOffset / middleWidth, 2.0));
  float innerEnvelope = exp(-pow(innerOffset / innerWidth, 2.0));
  float outerWave = cos(frontOffset / outerWidth * 2.20 + organic * 0.12) *
    outerEnvelope;
  float middleWave = cos(middleOffset / middleWidth * 2.35 - organic * 0.10) *
    middleEnvelope * 0.50;
  float innerWave = cos(innerOffset / innerWidth * 2.50 + organic * 0.08) *
    innerEnvelope * 0.25;
  float ripple = outerWave + middleWave + innerWave;
  float packetEnvelope = outerEnvelope + middleEnvelope * 0.45 +
    innerEnvelope * 0.20;
  vec2 radial = normalize(fromOrigin + vec2(0.001));
  vec2 tangent = vec2(-radial.y, radial.x);
  vec2 distortion = radial * ripple * 11.0 * distanceGain +
    tangent * sin(frontOffset / outerWidth * 1.55 + organic) * 1.0 *
      packetEnvelope * distanceGain;
  float edgeDistance = min(
    min(imagePosition.x, uImageSize.x - imagePosition.x),
    min(imagePosition.y, uImageSize.y - imagePosition.y)
  );
  float edgeBoost = mix(2.45, 1.0, smoothstep(0.0, 68.0, edgeDistance));
  distortion *= edgeBoost;
  vec2 samplePosition = imagePosition - distortion;
  if (
    any(lessThan(samplePosition, vec2(0.0))) ||
    any(greaterThan(samplePosition, uImageSize))
  ) discard;

  vec2 sampleRatio = samplePosition / uImageSize;
  float radius = sampleRatio.y < 0.5
    ? (sampleRatio.x < 0.5 ? uCornerRadii.x : uCornerRadii.y)
    : (sampleRatio.x < 0.5 ? uCornerRadii.w : uCornerRadii.z);
  radius = clamp(radius, 0.0, min(uImageSize.x, uImageSize.y) * 0.5);
  if (radius > 0.01) {
    vec2 halfSize = uImageSize * 0.5;
    vec2 roundedOffset = abs(samplePosition - halfSize) -
      (halfSize - vec2(radius));
    float roundedDistance = length(max(roundedOffset, 0.0)) +
      min(max(roundedOffset.x, roundedOffset.y), 0.0) - radius;
    if (roundedDistance > 0.0) discard;
  }

  vec2 sampleUv = clamp(
    sampleRatio,
    vec2(0.001),
    vec2(0.999)
  );

  vec4 color = texture(uImage, sampleUv);
  float opacity = reveal;
  if (color.a <= 0.001 || opacity <= 0.001) discard;
  outColor = vec4(color.rgb, color.a * opacity);
}
`;

const RIPPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

const int MAX_TRAILS = ${MAX_TRAILS};

uniform sampler2D uImage;
uniform vec2 uImageSize;
uniform vec4 uCornerRadii;
uniform float uTime;
uniform float uRadius;
uniform int uTrailCount;
uniform vec4 uTrails[MAX_TRAILS];
uniform vec4 uTrailMotion[MAX_TRAILS];

in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 imagePosition = vUv * uImageSize;
  vec2 distortion = vec2(0.0);

  for (int index = 0; index < MAX_TRAILS; index += 1) {
      if (index >= uTrailCount) break;

      vec4 trail = uTrails[index];
      vec4 motion = uTrailMotion[index];
      vec2 segment = trail.zw - trail.xy;
      float segmentLengthSquared = dot(segment, segment);
      if (segmentLengthSquared < 0.0001) continue;

      float age = max(0.0, uTime - motion.z);
      if (age > ${TRAIL_LIFETIME / 1000}) continue;

      float speedRatio = clamp(motion.w / 20.0, 0.0, 1.0);
      float segmentLength = sqrt(segmentLengthSquared);
      vec2 tangent = segment / segmentLength;
      vec2 relative = imagePosition - trail.xy;
      float projection = clamp(
        dot(relative, segment) / segmentLengthSquared,
        0.0,
        1.0
      );
      vec2 closestPoint = trail.xy + segment * projection;
      vec2 fromPath = imagePosition - closestPoint;
      float pathDistance = length(fromPath);
      vec2 pathDirection = fromPath / max(pathDistance, 0.001);
      float growth = clamp(
        age / ${TRAIL_LIFETIME / 1000},
        0.0,
        1.0
      );
      float waveRadius = 5.0 + age * uRadius * 0.95;
      float waveThickness = mix(
        8.0,
        19.0,
        smoothstep(0.0, 1.0, growth)
      );
      float waveOffset = pathDistance - waveRadius;
      float recency = float(index + 1) / max(float(uTrailCount), 1.0);
      float trailWeight = mix(0.56, 1.0, recency);
      float life = exp(-age * 2.15) *
        (1.0 - smoothstep(1.35, ${TRAIL_LIFETIME / 1000}, age));
      float organic =
        sin(imagePosition.x * 0.041 + imagePosition.y * 0.057) * 0.55 +
        sin(imagePosition.x * 0.019 - imagePosition.y * 0.033) * 0.35;
      float waveEnvelope = exp(-pow(
        waveOffset / (waveThickness * 1.75),
        2.0
      ));
      float wave = (
        cos(waveOffset * 0.21 + organic * 0.22) +
        cos(waveOffset * 0.105 - organic * 0.15) * 0.22
      ) * waveEnvelope;
      float wakeAmplitude = mix(1.4, 7.2, speedRatio) *
        trailWeight * life;
      distortion += pathDirection * wave * wakeAmplitude;

      if (index == uTrailCount - 1) {
        vec2 fromHead = imagePosition - trail.zw;
        float headDistance = length(fromHead);
        vec2 headDirection = fromHead / max(headDistance, 0.001);
        float contactRadius = mix(10.0, 19.0, speedRatio);
        float pressure = 1.0 - smoothstep(
          contactRadius * 0.18,
          contactRadius,
          headDistance
        );
        float rim = exp(-pow(
          (headDistance - contactRadius) / (contactRadius * 0.42),
          2.0
        ));
        float forward = dot(fromHead, tangent);
        float bowBias = mix(
          0.72,
          1.22,
          smoothstep(-contactRadius, contactRadius, forward)
        );
        float headAmplitude = mix(3.2, 10.5, speedRatio) *
          exp(-age * 12.0);
        distortion += headDirection * (rim - pressure * 0.42) *
          headAmplitude * bowBias;
        distortion += tangent * pressure * headAmplitude * 0.24;
      }
  }

  float distortionLength = length(distortion);
  if (distortionLength > 0.001) {
    const float distortionLimit = 12.0;
    distortion *= distortionLimit *
      tanh(distortionLength / distortionLimit) / distortionLength;
  }
  float edgeDistance = min(
    min(imagePosition.x, uImageSize.x - imagePosition.x),
    min(imagePosition.y, uImageSize.y - imagePosition.y)
  );
  float edgeBoost = mix(2.65, 1.0, smoothstep(0.0, 72.0, edgeDistance));
  distortion *= edgeBoost;
  vec2 samplePosition = imagePosition - distortion;
  if (
    any(lessThan(samplePosition, vec2(0.0))) ||
    any(greaterThan(samplePosition, uImageSize))
  ) discard;

  vec2 sampleRatio = samplePosition / uImageSize;
  float radius = sampleRatio.y < 0.5
    ? (sampleRatio.x < 0.5 ? uCornerRadii.x : uCornerRadii.y)
    : (sampleRatio.x < 0.5 ? uCornerRadii.w : uCornerRadii.z);
  radius = clamp(radius, 0.0, min(uImageSize.x, uImageSize.y) * 0.5);
  if (radius > 0.01) {
    vec2 halfSize = uImageSize * 0.5;
    vec2 roundedOffset = abs(samplePosition - halfSize) -
      (halfSize - vec2(radius));
    float roundedDistance = length(max(roundedOffset, 0.0)) +
      min(max(roundedOffset.x, roundedOffset.y), 0.0) - radius;
    if (roundedDistance > 0.0) discard;
  }

  vec2 sampleUv = clamp(
    sampleRatio,
    vec2(0.001),
    vec2(0.999)
  );

  vec4 color = texture(uImage, sampleUv);
  if (color.a <= 0.001) discard;
  outColor = color;
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

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
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
    if (!gl) {
      img.style.opacity = "1";
      return;
    }

    let introProgram: WebGLProgram | null = null;
    let rippleProgram: WebGLProgram | null = null;
    let texture: WebGLTexture | null = null;
    let vertexArray: WebGLVertexArrayObject | null = null;
    let introUniforms: IntroUniforms | null = null;
    let rippleUniforms: RippleUniforms | null = null;
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
    const cornerRadii = new Float32Array(4);
    const introOrigin = new Float32Array([Math.random(), Math.random()]);

    const hideCanvas = () => {
      canvasVisible = false;
      canvas.style.opacity = "0";
      img.style.opacity = "1";
    };

    const showCanvas = () => {
      canvasVisible = true;
      canvas.style.display = "block";
      canvas.style.opacity = "1";
      // The animated canvas replaces the image only during the intro. During
      // pointer interaction the intact image remains as a safe underlay.
      img.style.opacity = mode === "intro" ? "0" : "1";
    };

    const prepareIntro = () => {
      canvasVisible = false;
      canvas.style.display = "block";
      canvas.style.opacity = "0";
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
      if (introProgram) gl.deleteProgram(introProgram);
      if (rippleProgram) gl.deleteProgram(rippleProgram);
      texture = null;
      vertexArray = null;
      introProgram = null;
      rippleProgram = null;
      introUniforms = null;
      rippleUniforms = null;
      resourcesReady = false;
    };

    const createResources = () => {
      destroyResources();
      const nextIntroProgram = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        INTRO_FRAGMENT_SHADER
      );
      const nextTexture = gl.createTexture();
      const nextVertexArray = gl.createVertexArray();
      if (!nextTexture || !nextVertexArray) {
        gl.deleteProgram(nextIntroProgram);
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

      introProgram = nextIntroProgram;
      texture = nextTexture;
      vertexArray = nextVertexArray;
      introUniforms = {
        image: getUniform(nextIntroProgram, "uImage"),
        imageSize: getUniform(nextIntroProgram, "uImageSize"),
        cornerRadii: getUniform(nextIntroProgram, "uCornerRadii"),
        surfaceSize: getUniform(nextIntroProgram, "uSurfaceSize"),
        bleed: getUniform(nextIntroProgram, "uBleed"),
        introTime: getUniform(nextIntroProgram, "uIntroTime"),
        introOrigin: getUniform(nextIntroProgram, "uIntroOrigin"),
      };

      try {
        const nextRippleProgram = createProgram(
          gl,
          FULLSCREEN_VERTEX_SHADER,
          RIPPLE_FRAGMENT_SHADER
        );
        rippleProgram = nextRippleProgram;
        rippleUniforms = {
          image: getUniform(nextRippleProgram, "uImage"),
          imageSize: getUniform(nextRippleProgram, "uImageSize"),
          cornerRadii: getUniform(nextRippleProgram, "uCornerRadii"),
          surfaceSize: getUniform(nextRippleProgram, "uSurfaceSize"),
          bleed: getUniform(nextRippleProgram, "uBleed"),
          time: getUniform(nextRippleProgram, "uTime"),
          radius: getUniform(nextRippleProgram, "uRadius"),
          trailCount: getUniform(nextRippleProgram, "uTrailCount"),
          trails: getUniform(nextRippleProgram, "uTrails[0]"),
          trailMotion: getUniform(nextRippleProgram, "uTrailMotion[0]"),
        };
      } catch (error) {
        if (rippleProgram) gl.deleteProgram(rippleProgram);
        rippleProgram = null;
        rippleUniforms = null;
        if (import.meta.env.DEV) {
          console.warn(
            "[DisintegrationImg] Ripple shader initialization failed",
            error
          );
        }
      }
      resourcesReady = true;
    };

    const updateSurface = () => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return false;

      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      const imageStyle = window.getComputedStyle(img);
      cornerRadii[0] = Number.parseFloat(imageStyle.borderTopLeftRadius) || 0;
      cornerRadii[1] = Number.parseFloat(imageStyle.borderTopRightRadius) || 0;
      cornerRadii[2] =
        Number.parseFloat(imageStyle.borderBottomRightRadius) || 0;
      cornerRadii[3] =
        Number.parseFloat(imageStyle.borderBottomLeftRadius) || 0;
      bleed = clamp(Math.round(Math.min(width, height) * 0.2), 40, 80);
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
      if (!resourcesReady || !texture || !vertexArray || gl.isContextLost()) {
        return false;
      }

      gl.viewport(0, 0, surfaceWidth, surfaceHeight);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(vertexArray);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      if (mode === "intro") {
        if (!introProgram || !introUniforms) return false;
        gl.useProgram(introProgram);
        gl.uniform1i(introUniforms.image, 0);
        gl.uniform2f(introUniforms.imageSize, width, height);
        gl.uniform4fv(introUniforms.cornerRadii, cornerRadii);
        gl.uniform2f(introUniforms.surfaceSize, surfaceWidth, surfaceHeight);
        gl.uniform1f(introUniforms.bleed, bleed);
        gl.uniform1f(introUniforms.introTime, (now - introStartedAt) / 1000);
        gl.uniform2fv(introUniforms.introOrigin, introOrigin);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } else {
        if (!rippleProgram || !rippleUniforms) return false;
        uploadTrails();
        gl.useProgram(rippleProgram);
        gl.uniform1i(rippleUniforms.image, 0);
        gl.uniform2f(rippleUniforms.imageSize, width, height);
        gl.uniform4fv(rippleUniforms.cornerRadii, cornerRadii);
        gl.uniform2f(rippleUniforms.surfaceSize, surfaceWidth, surfaceHeight);
        gl.uniform1f(rippleUniforms.bleed, bleed);
        gl.uniform1f(rippleUniforms.time, (now - clockStartedAt) / 1000);
        gl.uniform1f(rippleUniforms.radius, clamp(width * 0.13, 58, 96));
        gl.uniform1i(rippleUniforms.trailCount, trails.length);
        gl.uniform4fv(rippleUniforms.trails, trailCoordinates);
        gl.uniform4fv(rippleUniforms.trailMotion, trailMotion);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
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
      prepareIntro();
      scheduleFrame();
    };

    const wakeInteraction = () => {
      if (
        !resourcesReady ||
        !rippleProgram ||
        !rippleUniforms ||
        mode === "intro"
      ) {
        return;
      }
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
        event.pointerType === "touch"
      ) {
        return;
      }

      // Interaction must be able to recover independently if the intro was
      // skipped, interrupted, or mounted after the image had already loaded.
      if (!resourcesReady && !initialize()) return;
      if (!rippleProgram || !rippleUniforms) return;

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
      if (distance < 0.8) return;

      const sampleDuration = now - previousPointer.time;
      if (
        sampleDuration < TRAIL_SAMPLE_INTERVAL &&
        distance < TRAIL_FORCE_DISTANCE
      ) {
        return;
      }

      const frameDuration = Math.max(4, sampleDuration);
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
      introProgram = null;
      rippleProgram = null;
      texture = null;
      vertexArray = null;
      introUniforms = null;
      rippleUniforms = null;
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
        className="disintegration-img block h-full w-full"
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
