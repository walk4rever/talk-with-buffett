type CompanyDisplayNameProps = {
  zhName: string;
  enName: string;
  ticker?: string | null;
  className?: string;
  compact?: boolean;
};

export function CompanyDisplayName({
  zhName,
  enName,
  ticker,
  className,
  compact = false,
}: CompanyDisplayNameProps) {
  const code = ticker?.trim() ? ticker.trim().toUpperCase() : null;
  const classes = [
    "company-display",
    compact ? "company-display--compact" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <span className={classes}>
      <span className="company-display-zh">
        {code ? `${zhName}（${code}）` : zhName}
      </span>
      <span className="company-display-en">{enName}</span>
    </span>
  );
}
