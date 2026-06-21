const DEFAULT_BACKGROUND_DIM = 0.25;
const MAX_BACKGROUND_BLUR = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function backgroundTransparencyPercent(value?: number): number {
  const dim = Number.isFinite(value) ? (value as number) : DEFAULT_BACKGROUND_DIM;
  return Math.round(clamp(dim, 0, 1) * 100);
}

export function backgroundDimFromTransparency(value: number): number {
  return clamp(value, 0, 100) / 100;
}

export function normalizeBackgroundBlur(value?: number): number {
  const blur = Number.isFinite(value) ? (value as number) : 0;
  return clamp(blur, 0, MAX_BACKGROUND_BLUR);
}
