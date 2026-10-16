import type { DailyStat } from "@/lib/stats";

/**
 * 近 30 天的每日正确率：一天一根小竖柱，**柱高就是那天的正确率**，满格 100%。
 *
 * ⚠️ 这里画柱列、**不画 PRD 2.5 原先写的折线**，是有意的偏离，理由两条：
 *
 * 1. **折线表达不了「这天没学」。** 一条 `<polyline>` 是一条连续路径，窗口里
 *    没有日志的那几天，折线会直接把它们连起来——视觉上等于宣称那几天的正确率
 *    是插值出来的。**那是撒谎。** 一律画柱之后，「没数据」天然表现为没有柱子。
 * 2. 更实际的一条：现在库里只有 2 天有作答，折线会退化成孤零零的一段。
 *
 * 柱高走**绝对刻度**（100% = 满格），不用 DailyBars 那种归一化——正确率本身就
 * 是 0~100 的百分比，读「这根柱到顶没到顶」比读相对高低直观得多。顶边那条虚线
 * 就是 100% 的位置。
 *
 * **零 JS**：和 Heatmap / FrequencyRuler 拼格子的手法同源，没有 SVG。
 *
 * 「正确率」口径：该日流水里 `rating >= 3`（一般 / 简单）的占比，沿用
 * `StudySession.tsx` 里判断「记住了」的那个条件，不另造一套。
 */
export default function AccuracyBars({ days }: { days: DailyStat[] }) {
  const scored = days.filter((d) => d.answers > 0);
  const totalAnswers = days.reduce((n, d) => n + d.answers, 0);
  const totalCorrect = days.reduce((n, d) => n + d.correct, 0);
  const rate = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0;

  return (
    <section className="border-b border-[var(--color-line)] py-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[0.3em] text-[var(--color-muted)]">正确率</h2>
        <span className="text-xs text-[var(--color-muted)]">近 {days.length} 天</span>
      </div>

      {/* 有效数据点不足两天就不画图：一根柱子孤零零立着读不出任何东西，
          不如直接把那个数说出来。Heatmap 里 `maxCount > 0 &&` 是同一种兜底。 */}
      {scored.length < 2 ? (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          {totalAnswers === 0
            ? `这 ${days.length} 天还没有作答记录。`
            : `只在 ${scored.length} 天有作答（${totalCorrect} 对 ${totalAnswers} 次），凑不出趋势。`}
        </p>
      ) : (
        <>
          <div
            aria-hidden
            className="mt-4 flex h-24 items-end gap-[3px] border-t border-dashed border-[var(--color-line)]"
          >
            {days.map((d) => {
              const pct = d.answers > 0 ? Math.round((d.correct / d.answers) * 100) : 0;
              return (
                <div
                  key={d.date}
                  className="flex h-full flex-1 items-end"
                  title={
                    d.answers > 0
                      ? `${d.date} · ${pct}%（${d.correct} / ${d.answers}）`
                      : `${d.date} · 没有作答`
                  }
                >
                  {/* 没有作答的日子**不画柱**（不是画一根到底的矮柱——画成 0% 是撒谎）。
                      有作答但全错的日子是真的 0%，给 3% 的最小高度让它可见，
                      否则它会和「没学」长得一模一样 */}
                  {d.answers > 0 && (
                    <span
                      className="w-full rounded-t-[2px]"
                      style={{
                        height: `${Math.max(pct, 3)}%`,
                        background: "var(--color-brand)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div
            aria-hidden
            className="mt-1.5 flex justify-between text-[10px] tabular-nums text-[var(--color-muted)]"
          >
            <span>{days[0].date.slice(5)}</span>
            <span>{days[Math.floor(days.length / 2)].date.slice(5)}</span>
            <span>今天</span>
          </div>
        </>
      )}

      {totalAnswers > 0 && (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          近 {days.length} 天作答 {totalAnswers} 次，对 {totalCorrect} 次，正确率 {rate}%。
        </p>
      )}
    </section>
  );
}
