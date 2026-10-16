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
    autoSpeak: settings?.autoSpeak ?? true,
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">研习设置</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          当前用户：{user.name}
        </p>
      </div>

      <SettingsForm initial={initial} />

      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-sm">
        <h2 className="font-medium">学习状态</h2>
        {/* 排成账册的样子：一行一项、行间发丝线，数字用衬线右对齐 */}
        <dl className="mt-2 text-[var(--color-muted)]">
          <StatRow label="词库总词数" value={`${stats.totalWords}`} />
          <StatRow label="开始学过的" value={`${stats.started}`} />
          <StatRow label="已掌握（间隔 ≥ 21 天）" value={`${stats.mastered}`} />
          <StatRow label="连续打卡" value={`${stats.streak} 天`} />
        </dl>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] py-2 last:border-b-0">
      <dt>{label}</dt>
      <dd className="font-serif tabular-nums text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
