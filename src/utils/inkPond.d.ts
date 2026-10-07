export interface WatercolorSettings {
  spread: number;
  colorSize: number;
  sigma: number;
  animate: boolean;
}
export interface InkPondScene {
  destroy(): void;
  getFrameVersion(): number;
  subscribeFrame(listener: (now: number) => void): () => void;
  setWatercolorSettings(settings: Partial<WatercolorSettings>): void;
  getState(): {
    watercolor?: WatercolorSettings & {
      positions: Array<{ x: number; y: number }>;
      mode: "fluid";
      pigmentCount: number;
      gridWidth: number;
      gridHeight: number;
      steps: number;
      mass: number[];
      cacheCount: number;
    };
    time: number;
    paused: boolean;
    width?: number;
    height?: number;
    fishCount?: number;
    fishMotion?: Array<{
      id: number;
      x: number;
      y: number;
      active: boolean;
      reaction: {
        kind: "none" | "follow" | "dodge" | "scatter";
        phase: "idle" | "follow" | "wait" | "turn" | "swim" | "coast";
        active: boolean;
        drive: number;
        mix: number;
        elapsed: number;
        delay: number;
        duration: number;
      };
      speed: number;
      base: number;
      tailDrive: number;
      steeringEffort: number;
      turn: number;
      heading: number;
      tailPhase: number;
      tailAmplitude: number;
      tailSweep: number;
      tailRate: number;
      burstKind: string;
      burstCount: number;
      burstDuration: number;
      burstBeats: number;
      turnBursts: number;
    }>;
    overflow?: number;
    roamingFish?: Array<{ x: number; y: number }>;
    theme?: string;
    plantRoots?: Array<{ x: number; y: number }>;
    plantClusters?: number;
    plantCachePixels?: number;
  };
}
export function createInkPond(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  viewportMask?: HTMLElement | null
): InkPondScene;
