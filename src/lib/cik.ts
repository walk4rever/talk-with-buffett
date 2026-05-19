export function normalizeCikDigits(input: string | number | null | undefined): string | null {
  if (input == null) return null;
  const digits = String(input).replace(/\D/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n);
}

export function formatCik10(input: string | number | null | undefined): string | null {
  const normalized = normalizeCikDigits(input);
  if (!normalized) return null;
  return normalized.padStart(10, "0");
}

export function formatCompanyPathFromCik(input: string | number | null | undefined): string | null {
  const cik10 = formatCik10(input);
  if (!cik10) return null;
  return `/company/CIK${cik10}`;
}
