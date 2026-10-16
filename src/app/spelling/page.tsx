import Link from "next/link";
import StudySession from "@/components/StudySession";
import { prisma } from "@/lib/db";
import { buildSession } from "@/lib/session";
import type { Accent } from "@/lib/tts";
import { getCurrentUser } from "@/lib/user";

// 队列每次进入都重算——进度是实时变的，不能缓存
export const dynamic = "force-dynamic";

/**
 * 拼写练习（PRD 2.7）。**独立一页**，入口是桌面侧栏第五项，外加首页和章节页
 * 那两条快捷链接（窄屏顶栏放不下第五项，见 Nav.tsx 里那笔宽度账）。
 *
 * 队列来源一个字没改——还是 `buildSession({ spell: true })` 那条路，取的是
 * **学过**的词（有进度行的），不看到期、不吃每日配额。这一页自己只多做三件事：
 * 一个 h1、一排范围选择、把范围喂给队列。
 *
 * `StudySession` 原样复用：队列怎么消费、评分怎么提交、答错怎么排回队尾、
 * 进度条、退出——全在它那儿。这一页不碰，也不该碰。
 */
export default async function SpellingPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  // 取参口径照抄 study/page.tsx，不另造一套
  const unitId = params.unit ? Number(params.unit) : undefined;
  const validUnitId = unitId && Number.isInteger(unitId) ? unitId : undefined;

  const [settings, progressRows, queue, units] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId: user.id } }),
    // 范围 chip 要的「每章学过多少个」。只要 unitId 一个字段，比章节页那次查询窄
    prisma.userWordProgress.findMany({
      where: { userId: user.id },
      select: { word: { select: { unitId: true } } },
    }),
    buildSession(user.id, { spell: true, unitId: validUnitId }),
    // 22 行，一次拿全：范围 chip 的章号、下面 `unit` prop 的章名，都从这一份里取
    prisma.unit.findMany({
      select: { id: true, chapterNo: true, name: true },
      orderBy: { chapterNo: "asc" },
    }),
  ]);

  const accent: Accent = settings?.accent === "us" ? "us" : "uk";

  // 每个单元学过的词数。一行的意思就是「这个词开过头了」
  const startedPerUnit = new Map<number, number>();
  for (const row of progressRows) {
    const id = row.word.unitId;
    startedPerUnit.set(id, (startedPerUnit.get(id) ?? 0) + 1);
  }
  const startedTotal = progressRows.length;
  // 只列有学过词的章——一个词都没学过的章点进去必定是空队列，摆出来只是噪音
  const ranges = units.filter((u) => (startedPerUnit.get(u.id) ?? 0) > 0);

  // 章名只有空态用得到：「第 N 章还没有学过的词」得说出是哪一章
  const unit = validUnitId
    ? (units.find((u) => u.id === validUnitId) ?? null)
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">拼写练习</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          从学过的词里抽题默写。拼对记「简单」、拼错记「忘了」，拼错的词本次还会再问一遍。
        </p>
      </div>

      {/* 范围选择。**必须给 StudySession 换个 key**（见下面那处注释）——
          这个页面是唯一会在同一条路径上换 query 的地方，没有 key 的话新队列
          进不去。 */}
      {startedTotal > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] tracking-[0.3em] text-[var(--color-muted)]">
            范围
          </span>
          <RangeChip href="/spelling" active={validUnitId === undefined}>
            全部 {startedTotal}
          </RangeChip>
          {ranges.map((u) => (
            <RangeChip
              key={u.id}
              href={`/spelling?unit=${u.id}`}
              active={validUnitId === u.id}
            >
              第 {u.chapterNo} 章 {startedPerUnit.get(u.id)}
            </RangeChip>
          ))}
        </div>
      )}

      {/* ⚠️ `key` 不是可有可无的。点范围 chip 走的是「同一条路径、只换 query」的
          客户端导航，`StudySession` 这个组件实例**不会被卸载**——而它内部的
          `queue` 是 `useState(initialQueue)`，只在挂载时读一次初值。不换 key 的话
          服务端送来的新队列会被丢掉，页面还显示上一范围剩下的那批词，而且随着
          作答越答越少，看着像「这一章真的只有这么几个词」。
          （`/study` 那边没有这个问题：换章是从 `/units` 进来的，是一次真正的挂载。） */}
      <StudySession
        key={validUnitId ?? "all"}
        initialQueue={queue}
        accent={accent}
        unit={unit}
        spell
      />
    </div>
  );
}

/** 范围的一格。纯 `<Link>`、零 JS——这一页和 `/stats` 一样不需要客户端状态。 */
function RangeChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-9 items-center rounded-[var(--radius-chip)] px-3 text-xs transition ${
        active
          ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]"
          : "border border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
      }`}
    >
      {children}
    </Link>
  );
}
