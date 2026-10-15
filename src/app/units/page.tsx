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
        <h1 className="text-2xl font-semibold tracking-tight">词库</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          按书的章节划分，共 {units.length} 章、{units.reduce((n, u) => n + u._count.words, 0)} 个词。
          点某一章可以只练那一章。
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {units.map((unit) => {
          const stat = perUnit.get(unit.id);
          const started = stat?.started ?? 0;
          const mastered = stat?.mastered ?? 0;
          const total = unit._count.words;

          return (
            <li key={unit.id}>
              <Link
                href={`/study?unit=${unit.id}`}
                className="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-brand)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-[var(--color-muted)] tabular-nums">
                      {String(unit.chapterNo).padStart(2, "0")}
                    </span>
                    <span className="font-medium">{unit.name}</span>
                  </div>
                  <span className="text-xs text-[var(--color-muted)] tabular-nums">
                    {mastered} / {total}
                  </span>
                </div>
                <ProgressBar done={started} total={total} tone={started ? "brand" : "muted"} />
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-[var(--color-muted)]">
        进度条表示「开始学过的词占这一章的比例」，右边的数字是「已掌握 / 总词数」。
        掌握 = 复习间隔已经拉到 21 天以上。
      </p>
    </div>
  );
}
