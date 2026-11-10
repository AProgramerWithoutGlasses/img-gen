/** Only a known per-image start time may produce a running-time display. */
export function resultElapsed(startedAt?: string, now = Date.now()): number | undefined {
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  return Number.isFinite(start) && Number.isFinite(now) ? Math.max(0, now - start) : undefined;
}
