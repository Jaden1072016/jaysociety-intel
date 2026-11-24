/**
 * Freshness 0..1. Exponential decay with a half-life (hours). A trend seen repeatedly
 * across refreshes is still active, so recent sightings keep it fresh.
 */
export function freshness(firstSeen: Date, lastSeen: Date, now = new Date(), halfLifeHours = 24): number {
  const ageH = Math.max(0, (now.getTime() - firstSeen.getTime()) / 3_600_000);
  const sinceLastH = Math.max(0, (now.getTime() - lastSeen.getTime()) / 3_600_000);
  const decay = Math.pow(0.5, ageH / halfLifeHours);
  const stillActive = sinceLastH < 2 ? 0.25 : sinceLastH < 12 ? 0.1 : 0;
  return Math.min(1, Math.round((decay + stillActive) * 100) / 100);
}

export function freshnessLabel(f: number): string {
  if (f >= 0.75) return "Breaking";
  if (f >= 0.45) return "Fresh";
  if (f >= 0.2) return "Cooling";
  return "Stale";
}
