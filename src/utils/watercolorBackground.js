import { createPigmentFluid } from "./inkFluid.js";

export const watercolorDefaults = {
  spread: 300,
  colorSize: 100,
  sigma: 1.1,
  animate: true,
};

// The host controls time, visibility, reduced motion and disposal. The fluid has
// no independent animation loop, pointer handlers, controls or DOM diagnostics.
export function createWatercolorBackground() {
  const settings = { ...watercolorDefaults };
  const fluid = createPigmentFluid();
  const canvas = document.createElement("canvas");
  const painter = canvas.getContext("2d");
  let width = 0,
    height = 0,
    dark = false,
    image = null,
    dirty = true,
    needsReset = true,
    disposed = false;
  let lastDrawnTime = 0,
    motionOffset = 0,
    frozenTime = 0;
  const clock = time => (settings.animate ? time - motionOffset : frozenTime);
  function rebuild(w, h, isDark) {
    if (disposed) return;
    dark = isDark;
    if (width !== w || height !== h || needsReset) {
      width = w;
      height = h;
      needsReset = false;
      fluid.reset(w, h, settings);
      const grid = fluid.getState();
      canvas.width = grid.gridWidth;
      canvas.height = grid.gridHeight;
      image = painter?.createImageData(canvas.width, canvas.height) ?? null;
    }
    // A theme switch recolours the same live pigment, without restarting flow.
    dirty = true;
  }
  function draw(context, time) {
    if (disposed) return;
    lastDrawnTime = time;
    if (fluid.advance(clock(time))) dirty = true;
    if (dirty && image && painter) {
      fluid.paint(image.data, dark);
      painter.putImageData(image, 0, 0);
      dirty = false;
    }
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    if (image) {
      context.imageSmoothingEnabled = true;
      context.drawImage(canvas, 0, 0, width, height);
    } else {
      context.fillStyle = dark ? "#142c34" : "#eaf5f8";
      context.fillRect(0, 0, width, height);
    }
    context.restore();
  }
  return {
    rebuild,
    draw,
    setSettings(next) {
      if (disposed) return;
      for (const [key, lo, hi] of [
        ["spread", 0, 1000],
        ["colorSize", 20, 400],
        ["sigma", 0.5, 3],
      ]) {
        if (Number.isFinite(next[key])) {
          const value = Math.max(lo, Math.min(hi, next[key]));
          if (settings[key] !== value) {
            settings[key] = value;
            needsReset = true;
          }
        }
      }
      if (
        typeof next.animate === "boolean" &&
        next.animate !== settings.animate
      ) {
        if (next.animate) motionOffset = lastDrawnTime - frozenTime;
        else frozenTime = clock(lastDrawnTime);
        settings.animate = next.animate;
      }
    },
    getState: () => ({
      ...settings,
      ...fluid.getState(),
      mode: "fluid",
      cacheCount: disposed ? 0 : 1,
    }),
    destroy() {
      if (disposed) return;
      disposed = true;
      fluid.destroy();
      image = null;
      canvas.width = canvas.height = 0;
    },
  };
}
