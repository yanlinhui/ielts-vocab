import Link from "next/link";
import ProgressBar from "@/components/ProgressBar";
import { prisma } from "@/lib/db";
import { isMastered } from "@/lib/session";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function UnitsPage() {
  const user = await getCurrentUser();

  const [units, progress] = await Promise.all([
    prisma.unit.findMany({
      orderBy: { chapterNo: "asc" },
      include: { _count: { select: { words: true, passages: true } } },
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
    // 判据统一走 session.ts 的 isMastered——这里原先是手抄的一份副本，
    // 改判据时得两处同时改，漏一处数字就对不上
    if (isMastered(p)) slot.mastered += 1;
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
          const hasPassage = unit._count.passages > 0;

          return (
            <li
              key={unit.id}
              className="border-b border-[var(--color-line)] last:border-b-0"
            >
              {/* 桌面（lg+）：这一层是 flex-row——Link 吃满剩余宽度（flex-1 +
                  min-w-0），按钮组靠右，和「已学 · 掌握」那行**基线对齐**
                  （items-baseline，按钮的 py/border 只把盒子撑开，文字压在同一条
                  基线上）。
                  窄屏放不下并排：375px 下这一行光章号 + 章名 + 两个数字就吃掉
                  224px，加点线只剩几十像素——实测塞进按钮后 leader 宽度归 0
                  （目录的点线消失），且「已学」涨到三位数就会挤坏。所以窄屏退回
                  flex-col，按钮组自己占一行、缩进到章名底下（ml-9）。
                  两颗按钮**在窄屏也并排**（gap-2，约 144px，从 36px 处起共 180px，
                  375px 下放得下）：拆成上下两行会把每一章撑高一行，22 章下来
                  这一页会长出一屏。

                  **不能把按钮塞进那个 Link 里**——`<a>` 套 `<a>` 是非法 HTML
                  （词卡那边踩过同一个坑，见 WordCard.tsx 里「不能用 button 套
                  button」那条注释）。 */}
              <div className="flex flex-col lg:flex-row lg:items-baseline lg:gap-3">
                <Link
                  href={`/study?unit=${unit.id}`}
                  className="flex min-w-0 flex-1 flex-col gap-2 px-2 pt-3 pb-1 transition hover:bg-[var(--color-surface-2)]"
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

                {/* 两颗练习入口。文案**不带数字**——左边「已学 27」就是同一个数，
                    挨着放两遍是冗余。
                    **每一章都渲染两颗**，没得做的也留一颗压暗的占位——22 行如果
                    只有几行有按钮，右边缘会参差，那一列就读不出「这是同一类东西」。
                    占位那颗用 `<span>` 而不是 `<Link>`：没学过的章进去必撞空态，
                    给一条通向空页的链接不如不给。尺寸类与可点那颗逐字相同
                    （同样的 border 宽度、padding、字号），所以两行严丝合缝。

                    两颗的「有没有」是两个独立条件：
                    - 拼写看 `started > 0`（这一章学过词没有）
                    - 拓展阅读看 `hasPassage`（这一章写过短文没有）
                    短文是逐章补的，本轮只有第 4、22 章有——所以大部分行的
                    第二颗是灰的，这是如实反映进度，不是坏掉。

                    这两条**保留**、不是重复入口：拼写页和阅读页各自的范围 chip
                    虽然也能选到这一章，但从「正看着的这章」直接进去是条深链，
                    和上面那条 `/study?unit=N` 同类，不是「同一目的地的第二条路」。 */}
                <div className="mb-3 ml-9 mr-2 flex gap-2 self-start lg:mb-0 lg:ml-0 lg:mr-2 lg:shrink-0 lg:self-auto">
                  {started > 0 ? (
                    <Link
                      href={`/spelling?unit=${unit.id}`}
                      className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2.5 py-1 text-xs transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                    >
                      拼写检验
                    </Link>
                  ) : (
                    <span className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-muted)] opacity-45">
                      拼写检验
                    </span>
                  )}

                  {hasPassage ? (
                    <Link
                      href={`/reading?unit=${unit.id}`}
                      className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2.5 py-1 text-xs transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                    >
                      拓展阅读
                    </Link>
                  ) : (
                    <span className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-muted)] opacity-45">
                      拓展阅读
                    </span>
                  )}
                </div>
              </div>
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
