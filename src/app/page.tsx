import Link from "next/link";
import AnswerSheet from "@/components/AnswerSheet";
import Heatmap from "@/components/Heatmap";
import ProgressBar from "@/components/ProgressBar";
import Stat from "@/components/Stat";
import { formatDate } from "@/lib/format";
import { getTodayStats } from "@/lib/session";
import { getDailySentence, getHeatmap, type DailySentence } from "@/lib/stats";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/** 热力图铺多少周。16 周约四个月，一行 16 列在 375px 视口下也放得开 */
const HEATMAP_WEEKS = 16;

export default async function HomePage() {
  const user = await getCurrentUser();
  const [stats, heatmap, sentence] = await Promise.all([
    getTodayStats(user.id),
    getHeatmap(user.id, HEATMAP_WEEKS),
    // 和用户无关，纯按日期挑，所以不用传 userId
    getDailySentence(),
  ]);

  // 词表还没灌进来。这不是用户操作失误，是环境没初始化好，直接告诉他怎么办。
  if (stats.totalWords === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <h1 className="font-serif text-lg font-semibold">这本书还没有词</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          数据库里还没有单词。在项目目录下跑一次灌库脚本：
        </p>
        <pre className="mt-3 overflow-x-auto rounded-[var(--radius-control)] bg-[var(--color-surface-2)] p-3 text-xs">
          npm run db:seed
        </pre>
      </div>
    );
  }

  const todo = stats.dueCount + stats.newRemaining;
  const hasTodo = todo > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        {/* 书眉：像书页顶端那行小字，字距拉开 */}
        <p className="font-serif text-xs tracking-[0.2em] text-[var(--color-muted)]">
          {formatDate()}
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
          {hasTodo ? "今天要背的在这儿" : "今日任务已完成"}
        </h1>
      </div>

      <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span>今日新词</span>
            <span className="text-[var(--color-muted)]">
              {stats.newDone} / {stats.newLimit}
            </span>
          </div>
          {/* 新词这条走答题卡式的方格，不走进度条：它的配额是固定的（设置里的
              每日新词数），格子只增不减，一格一个词地涂过去。涂色走朱砂——
              这是今天刚盖上去的印。复习那条仍是墨绿进度条，理由见 AnswerSheet 注释。 */}
          <AnswerSheet done={stats.newDone} total={stats.newLimit} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span>待复习</span>
            <span className="text-[var(--color-muted)]">
              {stats.reviewDone} / {stats.reviewDone + stats.dueCount}
            </span>
          </div>
          <ProgressBar
            done={stats.reviewDone}
            total={Math.max(stats.reviewDone + stats.dueCount, 1)}
          />
        </div>

        <Link
          href="/study"
          className={`mt-1 rounded-[var(--radius-control)] px-4 py-2.5 text-center text-sm font-medium transition ${
            hasTodo
              ? "bg-[var(--color-brand)] text-[var(--color-on-brand)] hover:opacity-90"
              : "border border-[var(--color-line)] hover:border-[var(--color-brand)]"
          }`}
        >
          {hasTodo ? `开始学习（${todo} 个）` : "额外加练"}
        </Link>

        {/* 拼写练习排在主按钮**下面**、做成文字链接而不是第二个按钮：主按钮是
            「今天该干的事」，拼写是回头检验学过的东西，主次得分得清（同 PRD 2.1
            删掉那两个快捷入口的理由）。
            一个词都没学过就不渲染——那种时候点进去只会撞上一句空态。
            ⚠️ 窄屏顶栏放不下拼写那第五项（见 Nav.tsx 的宽度账），所以这一条
            在手机上不是「顺带也有」，而是主要入口之一，别顺手删掉。 */}
        {stats.started > 0 && (
          <Link
            href="/spelling"
            className="text-center text-sm text-[var(--color-brand)] underline underline-offset-4"
          >
            拼写练习（{stats.started} 个学过的词）
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* 三格是同一套排版、同一个颜色。连续打卡曾经是朱砂的——它是全站唯一
            一处「朱砂数字」。去掉的理由不是规则变了，是三格并排时一格染色会让
            它们看起来不是一组：同一行里的同伴，要么都染要么都不染。

            第一格的「天」走 unit 那一档：比数字小一半还多、去掉粗体、换成次要色。
            上一版失败的那次是把「天」按正文字号排在数字旁边，两个字形差不多的
            字并排，看着像「两个字的词」而不是「一个数加一个单位」。单位要比数字
            明显弱一档，才读得出主从。 */}
        <Stat
          label="连续打卡天数"
          value={stats.streak > 0 ? String(stats.streak) : "—"}
          unit={stats.streak > 0 ? "天" : undefined}
        />
        <Stat label="已掌握" value={`${stats.mastered}`} />
        <Stat label="总词数" value={`${stats.totalWords}`} />
      </div>

      {/* 排在热力图前面：热力图是「回头看一眼」，每日一句是当下读到的一句，
          先读句、再回望，读起来顺一些。没取到例句（词表为空）就不渲染 */}
      {sentence && <DailyQuote sentence={sentence} />}

      {stats.started === 0 && (
        <p className="text-xs text-[var(--color-muted)]">
          还没有开始。点上面的按钮，从第 1 章开始背第一个词。
        </p>
      )}

      <Heatmap data={heatmap} />
    </div>
  );
}

/** 每日一句。按日期确定性选，同一天不变（见 stats.ts 的 getDailySentence）。 */
function DailyQuote({ sentence }: { sentence: DailySentence }) {
  return (
    <section className="border-t border-[var(--color-line)] pt-5">
      <p className="text-[11px] tracking-[0.3em] text-[var(--color-muted)]">每日一句</p>
      {/* 左侧一道墨绿竖线：和词卡背面各区块的标题是同一种语言 */}
      <div className="mt-3 border-l-2 border-[var(--color-brand)] pl-4">
        <p className="font-serif text-base leading-relaxed">{sentence.en}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{sentence.cn}</p>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Chapter {sentence.unitNo} {sentence.unitName} · {sentence.headword}
        </p>
      </div>
    </section>
  );
}
