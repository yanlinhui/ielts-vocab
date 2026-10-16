import type { StateBreakdown } from "@/lib/stats";

/**
 * 词汇状态分布：横向堆叠条。
 *
 * **画两条，不是一条**，因为一条读不出东西：实测 2026-10-16，全书 3580 个词里
 * 只学了 27 个（0.8%）。五段挤在一条上，学过的那四段加起来不到 3px，全糊成一根线。
 * 拆成「全书尺度」和「已学内部构成」两条之后，两条各自都读得出数：
 * 上面那条传达「路还有多长」，下面那条才是「学过的这些现在都在什么状态」。
 *
 * **配色分工**：墨绿系按掌握程度分深浅（已掌握最深、复习中次之、重学中最浅），
 * 「学习中」用朱砂——它是**此刻正在进行的**，正好落在朱砂「标记此刻」的分工里。
 * 「未学」走 `--color-line`，是纸面的底色，不参与染色。
 *
 * **零 JS**：和 ProgressBar 同一种手法，宽度走内联 `width: %`。
 */
const SEGMENTS = [
  { key: "mastered", label: "已掌握", color: "var(--color-brand)" },
  {
    key: "inReview",
    label: "复习中",
    color: "color-mix(in srgb, var(--color-brand) 58%, var(--color-canvas))",
  },
  {
    key: "relearning",
    label: "重学中",
    color: "color-mix(in srgb, var(--color-brand) 32%, var(--color-canvas))",
  },
  { key: "learning", label: "学习中", color: "var(--color-seal)" },
] as const;

const UNTOUCHED_COLOR = "var(--color-line)";

export default function StateBar({ data }: { data: StateBreakdown }) {
  const learned =
    data.learning + data.inReview + data.mastered + data.relearning;

  // 全书尺度那条的百分比。total 为 0（库是空的）时不让它算出 NaN
  const learnedPct =
    data.total > 0 ? ((learned / data.total) * 100).toFixed(1) : "0.0";

  return (
    <section className="border-b border-[var(--color-line)] py-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[0.3em] text-[var(--color-muted)]">
          词汇状态分布
        </h2>
        <span className="text-xs text-[var(--color-muted)]">全书 {data.total} 个词</span>
      </div>

      {data.total === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-muted)]">这本书还没有词。</p>
      ) : (
        <>
          {/* 全书尺度：未学 / 已学 两段。已学那截现在只有 2.6px 宽，看不见也是
              对的——它就该是这么细，这正是这条要传达的东西 */}
          <div className="mt-4">
            <Bar
              total={data.total}
              segments={[
                { label: "已学", value: learned, color: "var(--color-brand)" },
                {
                  label: "未学",
                  value: data.untouched,
                  color: UNTOUCHED_COLOR,
                },
              ]}
            />
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              已学 <span className="tabular-nums text-[var(--color-ink)]">{learned}</span>
               <span className="mx-1.5">·</span>
              <span className="tabular-nums">{learnedPct}%</span>
            </p>
          </div>

          {/* 已学内部构成：这一条才看得清。一条进度都没学过的词不进这条，
              它的分母是「已学」不是「全书」 */}
          <div className="mt-5">
            <Bar
              total={Math.max(learned, 1)}
              segments={SEGMENTS.map((s) => ({
                label: s.label,
                value: data[s.key],
                color: s.color,
              }))}
            />
            <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {SEGMENTS.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-[1px]"
                    style={{ background: s.color }}
                  />
                  <span className="text-[var(--color-muted)]">{s.label}</span>
                  <span className="ml-auto font-serif tabular-nums">{data[s.key]}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

function Bar({
  total,
  segments,
}: {
  total: number;
  segments: { label: string; value: number; color: string }[];
}) {
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-[var(--radius-chip)] bg-[var(--color-surface-2)]"
      aria-hidden
    >
      {segments.map((s) =>
        s.value > 0 ? (
          <span
            key={s.label}
            title={`${s.label} ${s.value}`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ) : null,
      )}
    </div>
  );
}
