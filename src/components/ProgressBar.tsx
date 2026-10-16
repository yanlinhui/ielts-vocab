// 三种语气各对应一个语义色令牌。seal 是朱砂，只用在「今天新引入的」那条上——
// 新词是「此刻刚盖上的印」，复习是「已经在册的」，所以一个朱一个墨。
const TONE = {
  brand: "var(--color-brand)",
  seal: "var(--color-seal)",
  muted: "var(--color-muted)",
} as const;

export default function ProgressBar({
  done,
  total,
  tone = "brand",
}: {
  done: number;
  total: number;
  tone?: "brand" | "seal" | "muted";
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const color = TONE[tone];

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
