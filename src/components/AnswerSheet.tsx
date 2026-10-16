import ProgressBar from "./ProgressBar";

/**
 * 雅思答题卡式的进度格：一格一个词，做过一格涂满一格。
 *
 * 只用在**有固定配额**的进度上——目前只有首页的「今日新词」（配额来自设置里的
 * 每日新词数）。固定配额意味着格子只增不减，一格一格被涂满，这正是答题卡的动作。
 *
 * ⚠️ **学习页用不了它。** 那一页的 total 是本轮队列长度，每评一次分就少一个，
 * 格子会一个个往回缩——看着像进度倒退，不是涂卡。「待复习」同理（dueCount 随
 * 时间浮动，没有配额）。那两处继续用 ProgressBar。
 *
 * ⚠️ **格数有上限。** 每日新词数可以设到 200，200 个方块在卡片里排不下，硬排
 * 会挤成一团糊。超过上限直接回落成细进度条——降级发生在组件内部，调用方不用管。
 */
const MAX_CELLS = 24;

export default function AnswerSheet({ done, total }: { done: number; total: number }) {
  // done 可能大于 total：章节专项模式不受配额约束，但它学的新词照样计入当日
  // 配额，于是会拿到「31 / 20」这样的入参。配额进度封顶在满格，别让
  // aria-label 报出一个分子大于分母的数（格子本来就全满，不受影响）。
  const shown = Math.min(done, total);

  if (total < 1 || total > MAX_CELLS) {
    return <ProgressBar done={shown} total={total} tone="seal" />;
  }

  return (
    <div
      role="progressbar"
      aria-label={`今日新词 ${shown} / ${total}`}
      aria-valuenow={shown}
      aria-valuemin={0}
      aria-valuemax={total}
      className="flex flex-wrap gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => {
        const filled = i < shown;
        // 还没做、但就是下一个该做的那格。给个描边而不是填色——
        // 填色是「已完成」，两者不能长得一样，否则「还剩几个」是数不出来的
        const current = i === shown;
        return (
          <span
            key={i}
            aria-hidden
            // 圆角比 --radius-chip（4px）还小：20px 的方块上 4px 已经占了五分之一，
            // 看着是圆钮不是格子
            className={`h-5 w-5 rounded-[2px] ${
              filled
                ? "bg-[var(--color-seal)]"
                : current
                  ? "border-2 border-[var(--color-seal)]"
                  : "border border-[var(--color-line)]"
            }`}
          />
        );
      })}
    </div>
  );
}
