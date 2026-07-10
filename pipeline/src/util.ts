export function nowKstIso(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace('Z', '+09:00');
}

export function exceedsFailureThreshold(
  failedCount: number,
  total: number,
  ratio = 1 / 3,
): boolean {
  if (total === 0) return false;
  return failedCount / total > ratio;
}
