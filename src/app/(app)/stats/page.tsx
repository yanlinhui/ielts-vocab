import Link from "next/link";
import AccuracyBars from "@/components/AccuracyBars";
import DailyBars from "@/components/DailyBars";
import Stat from "@/components/Stat";
import StateBar from "@/components/StateBar";
import {
  FORGETFUL_LIMIT,
  getDailyStats,
  getForgetfulWords,
  getStateBreakdown,
  type ForgetfulWord,
} from "@/lib/stats";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/**
 * 图表的窗口天数。用 30 不用热力图那 16 周：16 周 = 112 列，375px 下每列不足 3px，
 * 会糊成一片；30 列约 11px/列，和热力图的方格同档，也放得下首中尾三个日期刻度。
 */
const WINDOW_DAYS = 30;

/**
 * 研习统计。四页里唯一一个**纯回头看**的页面——不产生任何待办，也不写库。
 *
 * 直接查 Prisma，**不建 API 路由**：其余四页都没有，这一页更是纯服务端渲染、
 * 一个交互都没有，走接口只是白加一层。
 */
export default async function StatsPage() {
  const user = await getCurrentUser();
  const [daily, state, forgetful] = await Promise.all([
    getDailyStats(user.id, WINDOW_DAYS),
    getStateBreakdown(user.id),
    getForgetfulWords(user.id, FORGETFUL_LIMIT),
  ]);

  const totalAnswers = daily.reduce((n, d) => n + d.answers, 0);
  const totalCorrect = daily.reduce((n, d) => n + d.correct, 0);
  const rate =
    totalAnswers > 0 ? `${Math.round((totalCorrect / totalAnswers) * 100)}` : "—";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">研习统计</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          回头看一眼自己走过多远。下面三格和两张图都是近 {WINDOW_DAYS} 天。
        </p>
      </div>

      {/* label 走「作答 / 正确率 / 已掌握」这种短词，不写「近 30 天作答」——
          10px 加 0.12em 字距下 7 个字要 78px，而 375px 下格子内容宽只有 72px，
          会被 nowrap 逼着溢到内边距里。窗口写在上面那句副标题里，不重复占格 */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="作答" value={`${totalAnswers}`} unit="次" />
        <Stat label="正确率" value={rate} unit={rate === "—" ? undefined : "%"} />
        <Stat label="已掌握" value={`${state.mastered}`} />
      </div>

      <DailyBars days={daily} />
      <AccuracyBars days={daily} />
      <StateBar data={state} />
      <ForgetfulList words={forgetful} />
    </div>
  );
}

/**
 * 老忘的词。**这一栏只负责「看」，练的入口是底下那条链接**——点进去是
 * `/study?weak=1`，学习页把这里的同一份名单（`getForgetfulWords`，同一个
 * `FORGETFUL_LIMIT`）摘成 `wordId` 列表交给 `buildSession({ wordIds })`。
 *
 * 排序口径只此一份，**别在这里另写一套「只列还没掌握的」之类的过滤**：错词本
 * 照搬的就是这一栏的顺序，两处一旦不一样，页面上显示的和点进去练的就对不上。
 */
function ForgetfulList({ words }: { words: ForgetfulWord[] }) {
  return (
    <section className="border-b border-[var(--color-line)] py-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[0.3em] text-[var(--color-muted)]">
          老忘的词
        </h2>
        <span className="text-xs text-[var(--color-muted)]">
          按「忘了」次数 前 {FORGETFUL_LIMIT}
        </span>
      </div>

      {words.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          还没有答「忘了」的词，这一栏是空的。
        </p>
      ) : (
        <>
          <ul className="mt-3 border-t border-[var(--color-line)]">
            {words.map((w) => (
              <li key={w.wordId} className="border-b border-[var(--color-line)] py-2.5 last:border-b-0">
                <div className="flex items-baseline gap-3">
                  <span className="shrink-0 font-serif font-medium">{w.headword}</span>
                  {/* 释义长短差得很多，让它独自伸缩、截断了也不会挤到右边的数字 */}
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-muted)]">
                    {w.meaningCn}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-[var(--color-muted)]">
                    <span className="text-[var(--color-seal)]">忘 {w.forgets}</span>
                    <span className="mx-1.5">·</span>
                    共 {w.answers}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] tracking-[0.06em] text-[var(--color-muted)]">
                  Chapter {w.unitNo} {w.unitName}
                </p>
              </li>
            ))}
          </ul>

          {/* 整批练，不做单行跳转：这一栏要解决的是「攒了一批想一起过一遍」 */}
          <Link
            href="/study?weak=1"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--color-brand)] transition hover:underline"
          >
            集中攻克这 {words.length} 个
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-3.5 w-3.5 shrink-0"
            >
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </Link>
        </>
      )}

      <p className="mt-3 text-xs text-[var(--color-muted)]">
        「忘」是答「忘了」的次数，「共」是这个词一共答过几次。
        {words.length > 0 && (
          <>
            上面那条链接会把这 {words.length} 个词单独拎出来练一轮，不占今天的「今日功课」
            配额。已经掌握的词也在里面——这一栏看的是历史上忘过多少次，不看现在还记不记得。
          </>
        )}
      </p>
    </section>
  );
}
