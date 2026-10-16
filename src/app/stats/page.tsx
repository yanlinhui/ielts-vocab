import AccuracyBars from "@/components/AccuracyBars";
import DailyBars from "@/components/DailyBars";
import Stat from "@/components/Stat";
import StateBar from "@/components/StateBar";
import {
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
/** 「老忘的词」列多少个 */
const FORGETFUL_LIMIT = 20;

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
 * 老忘的词。**只读，不给跳转**——把一批老忘的词集中攻克需要一个「单词级队列」，
 * 而 `buildSession` 现在只有「每日动线」和「整章专项」两种，加这一种正是阶段三里
 * 「错词本」那一项的核心。现在做会和它重复，做两遍还要改两次。等做错词本时给
 * `buildSession` 加一次 `wordIds` 过滤，两处共用。
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
      )}

      <p className="mt-3 text-xs text-[var(--color-muted)]">
        「忘」是答「忘了」的次数，「共」是这个词一共答过几次。这一栏现在只列出来，
        还不能点进去集中练——那是「错词本」的活，还没做。
      </p>
    </section>
  );
}
