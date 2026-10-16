import { heatLevel, type HeatmapData } from "@/lib/stats";

/**
 * 学习热力图：近 16 周的打卡方块。
 *
 * 每列一周、列内自上而下周一到周日——和日历的读法一致，日期和格子的位置一一
 * 对应，不会随打开日期漂移（起点对齐逻辑在 stats.ts 的 getHeatmap 里）。
 *
 * **零 JS**：纯服务端渲染 + 原生 title tooltip。为了一格 hover 提示去挂
 * 十几行客户端代码不划算，而且这一块本来就是「扫一眼看趋势」，不是要精确查询
 * 的地方。格子对读屏隐藏，另给一句文字摘要。
 *
 * 配色走墨绿不用朱砂：朱砂的分工是「标记此刻」（新词、当前页），打卡是
 * 「已经在册的」，归墨绿那侧。五档用 color-mix 按比例兑浅，不新增令牌。
 *
 * 比例 10/38/62/84/100 不是随手取的：按各档实测亮度的**等比**铺开算出来的，
 * 相邻两档的对比度都落在 1.6~1.7:1，五档看着才是一把均匀的尺子。
 * 原先写的 25/45/70/100 会让「没学」和「学了一天」只差 1.1:1，几乎分不出来——
 * 而这一对恰恰是整张图最要紧的区分。既然是浅色系五档，相邻档做不到 WCAG 的
 * 3:1（那需要中间几档暗到互相糊在一起），所以更该保证的是档距均匀；
 * 精确数值另有底下那句文字摘要兜底，格子组对读屏也是隐藏的。
 */
const FILL = [
  "color-mix(in srgb, var(--color-brand) 10%, var(--color-canvas))",
  "color-mix(in srgb, var(--color-brand) 38%, var(--color-canvas))",
  "color-mix(in srgb, var(--color-brand) 62%, var(--color-canvas))",
  "color-mix(in srgb, var(--color-brand) 84%, var(--color-canvas))",
  "var(--color-brand)",
] as const;

/** 周一、周三、周五、周日给标签，其余留空——七行全标会挤成一团 */
const DAY_LABELS = ["一", "", "三", "", "五", "", "日"];

const CELL = "h-[11px] w-[11px] rounded-[2px]";

export default function Heatmap({ data }: { data: HeatmapData }) {
  const weeks = data.weeks.length;

  return (
    <section className="border-y border-[var(--color-line)] py-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[0.3em] text-[var(--color-muted)]">学习记录</h2>
        <span className="text-xs text-[var(--color-muted)]">近 {weeks} 周</span>
      </div>

      <div className="mt-3 flex gap-2">
        <div
          aria-hidden
          className="flex flex-col gap-[3px] text-[10px] leading-[11px] text-[var(--color-muted)]"
        >
          {DAY_LABELS.map((label, i) => (
            <span key={i} className="h-[11px]">
              {label}
            </span>
          ))}
        </div>

        {/* 未来的格子和没学过的格子都渲染，只是背景透明/浅色——位置必须占住，
            否则最后几列的星期对不齐 */}
        <div aria-hidden className="flex gap-[3px]">
          {data.weeks.map((column, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {column.map((cell) => (
                <span
                  key={cell.date}
                  title={cell.future ? undefined : `${cell.date} · 复习 ${cell.count} 次`}
                  className={CELL}
                  style={{
                    background: cell.future ? "transparent" : FILL[heatLevel(cell.count)],
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">
        近 {weeks} 周学过 {data.activeDays} 天，累计复习 {data.totalReviews} 次
        {data.maxCount > 0 && `；最多的一天 ${data.maxCount} 次`}。
      </p>
    </section>
  );
}
