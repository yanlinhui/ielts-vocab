import type { DailyStat } from "@/lib/stats";

/**
 * 近 30 天的每日学习量：一天一列，柱子里下段是复习、上段是新学。
 *
 * 配色分工沿用 ProgressBar / AnswerSheet 那套：**墨绿是「已经在册的」（复习），
 * 朱砂是「此刻刚盖上的印」（新学）**。两段叠在同一根柱子里，所以柱子的总高读作
 * 「这天一共过了多少个词」，顶上那截朱砂读作「其中今天新开了多少」。
 *
 * **零 JS**：纯服务端渲染，柱高走内联 `flexGrow`，不引图表库、不加客户端代码。
 * 和 Heatmap 一样，柱组对读屏隐藏，另给一句文字摘要——这一块本来就是「扫一眼
 * 看形状」，精确数值读下面那行说明。
 *
 * 柱高按**窗口内的最大值**归一：总量会随每天配额和复习堆积而变，用绝对刻度的话
 * 一个休假的周末会把其余的日子全压成一根线。归一之后读的是「相对形状」，
 * 绝对数交给下面的摘要。
 */
const REVIEW_COLOR = "var(--color-brand)";
const LEARN_COLOR = "var(--color-seal)";

/** "2026-10-15" → "10-15"。date 一律由 localDayKey 生成，格式固定 */
function shortDate(date: string): string {
  return date.slice(5);
}

export default function DailyBars({ days }: { days: DailyStat[] }) {
  // Math.max(1, ...) 兼作除零守卫：窗口里一个词都没学时也不会算出 NaN
  const max = Math.max(1, ...days.map((d) => d.learned + d.reviewed));
  const totalLearned = days.reduce((n, d) => n + d.learned, 0);
  const totalReviewed = days.reduce((n, d) => n + d.reviewed, 0);
  const activeDays = days.filter((d) => d.learned + d.reviewed > 0).length;

  return (
    <section className="border-y border-[var(--color-line)] py-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[0.3em] text-[var(--color-muted)]">每日学习量</h2>
        <span className="text-xs text-[var(--color-muted)]">近 {days.length} 天</span>
      </div>

      {activeDays === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          这 {days.length} 天还没有学习记录。
        </p>
      ) : (
        <>
          <div aria-hidden className="mt-4 flex h-24 items-end gap-[3px]">
            {days.map((d) => {
              const total = d.learned + d.reviewed;
              return (
                <div
                  key={d.date}
                  className="flex h-full flex-1 items-end"
                  title={`${d.date} · 新学 ${d.learned} · 复习 ${d.reviewed}`}
                >
                  {/* 两段按次数分配容器的全高。flexGrow 取 0 的那段自然高度为 0，
                      不用额外判空；total 为 0 时容器本身高度是 0，什么都不画 */}
                  <div
                    className="flex w-full flex-col justify-end overflow-hidden rounded-[2px]"
                    style={{ height: `${(total / max) * 100}%` }}
                  >
                    {d.reviewed > 0 && (
                      <div style={{ flexGrow: d.reviewed, background: REVIEW_COLOR }} />
                    )}
                    {d.learned > 0 && (
                      <div style={{ flexGrow: d.learned, background: LEARN_COLOR }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 只标首、中、尾三个刻度：30 列在 375px 下每列约 8px，逐个标会糊成一团 */}
          <div
            aria-hidden
            className="mt-1.5 flex justify-between text-[10px] tabular-nums text-[var(--color-muted)]"
          >
            <span>{shortDate(days[0].date)}</span>
            <span>{shortDate(days[Math.floor(days.length / 2)].date)}</span>
            <span>今天</span>
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
        <Legend color={LEARN_COLOR} label={`新学 ${totalLearned}`} />
        <Legend color={REVIEW_COLOR} label={`复习 ${totalReviewed}`} />
        {activeDays > 0 && <span>最多的一天 {max} 个</span>}
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-2.5 rounded-[1px]"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
