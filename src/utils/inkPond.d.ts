export interface WatercolorSettings {
  spread: number;
  colorSize: number;
  sigma: number;
  animate: boolean;
}
export interface InkPondScene {
  destroy(): void;
  setWatercolorSettings(settings: Partial<WatercolorSettings>): void;
  getState(): {
    watercolor?: WatercolorSettings & {
      positions: Array<{ x: number; y: number }>;
      spriteCount: number;
      cacheCount: number;
      appearance: Array<{ colorSize: number; mix: number; rotation: number }>;
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
      speed: number;
      base: number;
      tailDrive: number;
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
  };
}
export function createInkPond(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  viewportMask?: HTMLElement | null
): InkPondScene;
