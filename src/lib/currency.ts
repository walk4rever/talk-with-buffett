export function formatUsdInYi(value: string | number | bigint | null): string {
  if (value == null) return "—";
  const amount = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(amount)) return "—";

  const yi = amount / 1e8;
  const absYi = Math.abs(yi);

  if (absYi >= 1000) return `${yi.toLocaleString("en-US", { maximumFractionDigits: 1 })}亿`;
  if (absYi >= 10) return `${yi.toFixed(1)}亿`;
  return `${yi.toFixed(2)}亿`;
}
