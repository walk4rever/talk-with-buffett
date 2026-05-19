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
  const code = ticker?.trim() ? ticker.trim().toUpperCase() : "—";
  const classes = [
    "company-display",
    compact ? "company-display--compact" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <span className={classes}>
      <span className="company-display-zh">
        {zhName}（{code}）
      </span>
      <span className="company-display-en">{enName}</span>
    </span>
  );
}
