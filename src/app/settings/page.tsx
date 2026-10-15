import SettingsForm, { type SettingsValues } from "@/components/SettingsForm";
import { prisma } from "@/lib/db";
import { getTodayStats } from "@/lib/session";
import type { Accent } from "@/lib/tts";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const [settings, stats] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId: user.id } }),
    getTodayStats(user.id),
  ]);

  const initial: SettingsValues = {
    dailyNewLimit: settings?.dailyNewLimit ?? 20,
    dailyReviewLimit: settings?.dailyReviewLimit ?? 200,
    accent: (settings?.accent === "us" ? "us" : "uk") as Accent,
    autoSpeak: settings?.autoSpeak ?? false,
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          当前用户：{user.name}
        </p>
      </div>

      <SettingsForm initial={initial} />

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-sm">
        <h2 className="font-medium">学习状态</h2>
        <dl className="mt-3 grid grid-cols-2 gap-y-2 text-[var(--color-muted)]">
          <dt>词库总词数</dt>
          <dd className="text-right tabular-nums">{stats.totalWords}</dd>
          <dt>开始学过的</dt>
          <dd className="text-right tabular-nums">{stats.started}</dd>
          <dt>已掌握（间隔 ≥ 21 天）</dt>
          <dd className="text-right tabular-nums">{stats.mastered}</dd>
          <dt>连续打卡</dt>
          <dd className="text-right tabular-nums">{stats.streak} 天</dd>
        </dl>
      </div>
    </div>
  );
}
