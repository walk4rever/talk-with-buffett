const TICKER_ALIASES: Record<string, string> = {
  "BRK.B": "BRK-B",
  "BRK.A": "BRK-A",
  "BRK/B": "BRK-B",
  "BRK/A": "BRK-A",
  LLIVE: "LLYVK",
  YY: "JOYY",
};

export function normalizeTicker(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  const raw = ticker.trim().toUpperCase();
  if (!raw) return null;
  return TICKER_ALIASES[raw] ?? raw;
}
