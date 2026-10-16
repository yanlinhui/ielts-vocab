/**
 * 词频刻度：这个词在英语里有多常用。
 *
 * 用途是**决定值不值得花力气**——雅思阅读里高频词值得背到滚瓜烂熟，一个排位
 * 三万开外的生僻词，认得就行。这是词卡上唯一一个「和学习者决策相关」的元信息。
 *
 * 用 BNC 不用 FRQ：两个字段库里都有（都来自 ECDICT），BNC 是英式国家语料库，
 * 雅思偏英式，用它更贴。
 *
 * 排位是对数尺度的：第 500 位和第 1500 位的实际差距，远大于第 20000 位和第
 * 21000 位。线性映射会把绝大多数词挤在刻度最左端，看不出差别。
 */
const LOG_MIN = Math.log10(100);
const LOG_MAX = Math.log10(50000);
const SEGMENTS = 10;

function filledSegments(rank: number): number {
  const t = (Math.log10(Math.max(rank, 1)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  const score = 1 - Math.min(1, Math.max(0, t));
  // 最低频的词也至少留一格。全灭的刻度会被读成「这个词没有词频数据」，
  // 而不是「这词很生僻」——那是两个完全不同的意思。
  return Math.max(1, Math.round(score * SEGMENTS));
}

function tierLabel(rank: number): string {
  if (rank <= 3000) return "高频";
  if (rank <= 10000) return "中频";
  return "低频";
}

export default function FrequencyRuler({ rank }: { rank: number }) {
  const filled = filledSegments(rank);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)]">
      <span className="tracking-[0.15em]">常用度</span>
      <span aria-hidden className="flex gap-[2px]">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`h-[10px] w-[6px] rounded-[1px] ${
              i < filled ? "bg-[var(--color-brand)]" : "bg-[var(--color-line)]"
            }`}
          />
        ))}
      </span>
      <span>
        {tierLabel(rank)} · 英式语料库第 {rank} 位
      </span>
    </div>
  );
}
