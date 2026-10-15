export default function ProgressBar({
  done,
  total,
  tone = "brand",
}: {
  done: number;
  total: number;
  tone?: "brand" | "muted";
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const color = tone === "brand" ? "var(--color-brand)" : "var(--color-muted)";

  return (
    <div
      className="h-1 w-full overflow-hidden rounded-[var(--radius-chip)] bg-[var(--color-line)]"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div
        className="h-full rounded-[var(--radius-chip)] transition-[width] duration-300"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
