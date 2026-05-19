export type HoldingActivity = "New" | "Added" | "Reduced" | "Unchanged";

export function computeShareDeltaPct(
  prevShares: bigint | null | undefined,
  nowShares: bigint | null | undefined,
): number | null {
  const prev = prevShares != null ? Number(prevShares) : null;
  const now = nowShares != null ? Number(nowShares) : null;
  if (prev == null || now == null || !Number.isFinite(prev) || !Number.isFinite(now) || prev <= 0) return null;
  return ((now - prev) / prev) * 100;
}

export function computeHoldingActivity(
  hasPrev: boolean,
  shareDeltaPct: number | null,
  unchangedThresholdPct = 1,
): HoldingActivity {
  if (!hasPrev) return "New";
  if (shareDeltaPct == null || Math.abs(shareDeltaPct) < unchangedThresholdPct) return "Unchanged";
  return shareDeltaPct > 0 ? "Added" : "Reduced";
}
