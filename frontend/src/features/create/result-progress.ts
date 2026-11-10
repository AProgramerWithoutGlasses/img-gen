const checkpoints = [
  { seconds: 0, percent: 0, slope: 6 },
  { seconds: 15, percent: 65, slope: 1.5 },
  { seconds: 45, percent: 90, slope: .25 },
  { seconds: 90, percent: 95, slope: 0 },
] as const;

/** Waiting estimate; only a decoded image may complete the final 5%. */
export function estimatedResultProgress(elapsedMs: number): number {
  const seconds = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0);
  if (seconds >= 90) return 95;
  const index = checkpoints.findIndex((point, i) => i > 0 && seconds < point.seconds);
  const start = checkpoints[Math.max(0, index - 1)];
  const end = checkpoints[Math.max(1, index)];
  const duration = end.seconds - start.seconds;
  const t = (seconds - start.seconds) / duration;
  const t2 = t * t;
  const t3 = t2 * t;
  const value = (2 * t3 - 3 * t2 + 1) * start.percent
    + (t3 - 2 * t2 + t) * duration * start.slope
    + (-2 * t3 + 3 * t2) * end.percent
    + (t3 - t2) * duration * end.slope;
  return Math.max(0, Math.min(95, Math.floor(value)));
}

export function resultElapsed(createdAt: string, now = Date.now()): number {
  const start = Date.parse(createdAt);
  return Number.isFinite(start) ? Math.max(0, now - start) : 0;
}
