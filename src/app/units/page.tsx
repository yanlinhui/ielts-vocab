import Link from "next/link";
import ProgressBar from "@/components/ProgressBar";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function UnitsPage() {
  const user = await getCurrentUser();

  const [units, progress] = await Promise.all([
    prisma.unit.findMany({
      orderBy: { chapterNo: "asc" },
      include: { _count: { select: { words: true } } },
    }),
    prisma.userWordProgress.findMany({
      where: { userId: user.id },
      select: { state: true, scheduledDays: true, word: { select: { unitId: true } } },
    }),
  ]);

  // 每个单元的「已学 / 已掌握」两个数
  const perUnit = new Map<number, { started: number; mastered: number }>();
  for (const p of progress) {
    const slot = perUnit.get(p.word.unitId) ?? { started: 0, mastered: 0 };
    slot.started += 1;
    if (p.state === "review" && p.scheduledDays >= 21) slot.mastered += 1;
    perUnit.set(p.word.unitId, slot);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">章节词汇</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          按书的章节划分，共 {units.length} 章、{units.reduce((n, u) => n + u._count.words, 0)} 个词。
          点某一章可以只练那一章。
        </p>
      </div>

      {/* 排成书末目录的样子：一行一章，上下各一道通栏细线、行间发丝线，
          章名和数字之间用点线连起来。原来每章一张独立卡片，22 张堆下来
          像看板而不像书——书里的目录本来就没有一圈框。 */}
      <ul className="border-y border-[var(--color-line)]">
        {units.map((unit) => {
          const stat = perUnit.get(unit.id);
          const started = stat?.started ?? 0;
          const mastered = stat?.mastered ?? 0;
          const total = unit._count.words;

          return (
            <li
              key={unit.id}
              className="border-b border-[var(--color-line)] last:border-b-0"
            >
              <Link
                href={`/study?unit=${unit.id}`}
                className="flex flex-col gap-2 px-2 py-3 transition hover:bg-[var(--color-surface-2)]"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-serif text-sm tabular-nums text-[var(--color-brand)]">
                    {String(unit.chapterNo).padStart(2, "0")}
                  </span>
                  <span className="font-medium">{unit.name}</span>
                  <span
                    aria-hidden
                    className="mx-1 flex-1 -translate-y-[0.35em] border-b border-dotted border-[var(--color-line)]"
                  />
                  {/* 「已学」是随时在动的那个数，所以给它正文色；「掌握」要 21 天间隔
                      才动一次，压成次要色，免得刚学完的人盯着它以为进度没存上。 */}
                  <span className="shrink-0 whitespace-nowrap text-xs tabular-nums">
                    <span className="text-[var(--color-ink)]">已学 {started}</span>
                    <span className="mx-1.5 text-[var(--color-muted)]">·</span>
                    <span className="text-[var(--color-muted)]">
                      掌握 {mastered} / {total}
                    </span>
                  </span>
                </div>
                <ProgressBar done={started} total={total} tone={started ? "brand" : "muted"} />
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-[var(--color-muted)]">
        「已学」是这一章里已经开过头的词，下面那条进度条和它同指一个数，学一个就涨一个。
        「掌握」要严得多——复习间隔得拉到 21 天以上才算，所以它涨得慢，刚学完的词一天两天内不会让它动。
      </p>
    </div>
  );
}
