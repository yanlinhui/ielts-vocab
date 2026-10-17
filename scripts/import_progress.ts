/**
 * 把 `scripts/export_sqlite.py` 导出的学习进度写进当前库（Postgres）。
 *
 *   npm run db:import -- [--force]
 *
 * ⚠️ **必须先跑过 `npm run db:seed` 和 `npm run db:seed:passages`**：这个脚本只
 * 补进度，不灌词表；词找不到就直接报错。
 *
 * ⚠️ **导入后不要再跑 `npm run db:seed`**：`prisma/seed.ts` 第一步就是删光所有
 * 用户数据，你刚导进来的进度会一起没。
 *
 * 词是用 (chapterNo, orderInUnit) 定位的，不用旧库的 word id——id 是否复用不该
 * 成为正确性的前提。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";

interface ProgressRow {
  chapterNo: number;
  orderInUnit: number;
  state: string;
  stability: number;
  difficulty: number;
  dueAt: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReviewAt: number | null;
  createdAt: number;
}

interface LogRow {
  chapterNo: number;
  orderInUnit: number;
  rating: number;
  reviewedAt: number;
  elapsedMs: number | null;
}

interface Export {
  user: { name: string };
  settings: {
    dailyNewLimit: number;
    dailyReviewLimit: number;
    accent: string;
    // SQLite 把 Boolean 存成 0/1，导出的 JSON 里也是数字
    autoSpeak: number | boolean;
  } | null;
  progress: ProgressRow[];
  logs: LogRow[];
}

const EXPORT_PATH = join(process.cwd(), "data", "progress-export.json");
const force = process.argv.includes("--force");

function assertTargetDb(): void {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const dbName = url.pathname.replace(/^\//, "");
  if (dbName !== "ielts" && !force) {
    throw new Error(
      `当前库是「${dbName}」，不是 ielts。确有需要请加 --force。`,
    );
  }
  console.log(`目标库：${url.host}${url.pathname}`);
}

async function main(): Promise<void> {
  assertTargetDb();

  const data = JSON.parse(readFileSync(EXPORT_PATH, "utf8")) as Export;
  console.log(
    `导出文件：${data.progress.length} 条进度 / ${data.logs.length} 条作答`,
  );

  const user =
    (await prisma.user.findUnique({ where: { name: data.user.name } })) ??
    (await prisma.user.findFirst({ orderBy: { id: "asc" } }));
  if (!user) {
    throw new Error("库里没有用户，先跑 npm run db:seed");
  }
  console.log(`用户：${user.name}（id=${user.id}）`);

  // 词表映射。一次取全量，比逐条查快得多。
  const words = await prisma.word.findMany({
    select: { id: true, orderInUnit: true, unit: { select: { chapterNo: true } } },
  });
  const key = (chapterNo: number, orderInUnit: number) => `${chapterNo}:${orderInUnit}`;
  const wordId = new Map<string, number>();
  for (const w of words) wordId.set(key(w.unit.chapterNo, w.orderInUnit), w.id);

  const missing = new Set<string>();
  const findWordId = (chapterNo: number, orderInUnit: number): number | undefined => {
    const id = wordId.get(key(chapterNo, orderInUnit));
    if (id === undefined) missing.add(key(chapterNo, orderInUnit));
    return id;
  };

  // ReviewLog 没有唯一键，重跑会翻倍，所以一律先清空。
  await prisma.reviewLog.deleteMany({ where: { userId: user.id } });
  await prisma.userWordProgress.deleteMany({ where: { userId: user.id } });

  let wroteProgress = 0;
  for (const p of data.progress) {
    const wid = findWordId(p.chapterNo, p.orderInUnit);
    if (wid === undefined) continue;
    await prisma.userWordProgress.create({
      data: {
        userId: user.id,
        wordId: wid,
        state: p.state,
        stability: p.stability,
        difficulty: p.difficulty,
        dueAt: new Date(p.dueAt),
        scheduledDays: p.scheduledDays,
        learningSteps: p.learningSteps,
        reps: p.reps,
        lapses: p.lapses,
        lastReviewAt: p.lastReviewAt === null ? null : new Date(p.lastReviewAt),
        createdAt: new Date(p.createdAt),
      },
    });
    wroteProgress += 1;
  }

  let wroteLogs = 0;
  for (const l of data.logs) {
    const wid = findWordId(l.chapterNo, l.orderInUnit);
    if (wid === undefined) continue;
    await prisma.reviewLog.create({
      data: {
        userId: user.id,
        wordId: wid,
        rating: l.rating,
        reviewedAt: new Date(l.reviewedAt),
        elapsedMs: l.elapsedMs,
      },
    });
    wroteLogs += 1;
  }

  if (data.settings) {
    const settings = { ...data.settings, autoSpeak: Boolean(data.settings.autoSpeak) };
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...settings },
      update: settings,
    });
  }

  console.log(`写入：${wroteProgress} 条进度 / ${wroteLogs} 条作答`);
  if (missing.size > 0) {
    console.log(`⚠️ ${missing.size} 个词在新库里找不到，已跳过：${[...missing].join(", ")}`);
  }
  console.log("\n完成。⚠️ 不要再跑 npm run db:seed——它会删光这些进度。");
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
