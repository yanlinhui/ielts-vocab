import Link from "next/link";
import ProgressBar from "@/components/ProgressBar";
import { formatDate } from "@/lib/format";
import { getTodayStats } from "@/lib/session";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  const stats = await getTodayStats(user.id);

  // 词库还没灌进来。这不是用户操作失误，是环境没初始化好，直接告诉他怎么办。
  if (stats.totalWords === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <h1 className="font-serif text-lg font-semibold">词库是空的</h1>
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
          <ProgressBar done={stats.newDone} total={stats.newLimit} />
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
              ? "bg-[var(--color-brand)] text-[var(--color-canvas)] hover:opacity-90"
              : "border border-[var(--color-line)] hover:border-[var(--color-brand)]"
          }`}
        >
          {hasTodo ? `开始学习（${todo} 个）` : "额外加练"}
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="连续打卡" value={stats.streak > 0 ? `${stats.streak} 天` : "—"} />
        <Stat label="已掌握" value={`${stats.mastered}`} />
        <Stat label="总词数" value={`${stats.totalWords}`} />
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/units"
          className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
        >
          浏览词库
        </Link>
        <Link
          href="/settings"
          className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
        >
          设置
        </Link>
      </div>

      {stats.started === 0 && (
        <p className="text-xs text-[var(--color-muted)]">
          还没有开始。点上面的按钮，从第 1 章开始背第一个词。
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-center">
      <div className="font-serif text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] tracking-[0.12em] text-[var(--color-muted)]">{label}</div>
    </div>
  );
}
