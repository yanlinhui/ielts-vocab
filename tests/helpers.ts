// 测试公共设施：建库、清库、造 fixture。
//
// ⚠️ 本模块 **import 了 `../src/lib/db`**，也就是会实例化 PrismaClient。所以测试
// 文件必须先 `import "./env"` 再 import 这里，否则连的是 `dev.db`（见 env.ts 的说明）。
//
// ⚠️ **所有测试文件共用同一个 `ielts_test` 库，因此必须串行跑**（package.json 的
// test script 里挂着 `--test-concurrency=1`）。Node 的 test runner 默认并发跑测试
// 文件，两个文件同时 `resetDb()` 会互相把对方刚塞的 fixture 删掉——症状是「单独跑
// 全过、一起跑随机红一条」，很难查。

import { execFileSync } from "node:child_process";
import { prisma } from "../src/lib/db";

// 和 env.ts 里那个字面量必须一致。分开写是有意的：env.ts 不能 import 这里
// （那会把它拖进 db 的依赖图、破坏「必须第一个求值」这条约束），所以两边各留一份。
const TEST_DB_URL = "postgresql://postgres:ielts_dev@localhost:5432/ielts_test?schema=public";

// 防呆：测试库只允许在本机。哪怕哪天有人把 TEST_DB_URL 改成 Neon 的分支地址，
// 这里也会当场拦住——migrate deploy 和 resetDb 都是不可逆的。
function assertLocalTestDb(): void {
  const host = new URL(TEST_DB_URL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`测试库必须在本机，当前指向 ${host}`);
  }
  if (process.env.DATABASE_URL !== TEST_DB_URL || process.env.DIRECT_URL !== TEST_DB_URL) {
    throw new Error("env.ts 没有先于 helpers.ts 求值，测试会连错库");
  }
}

// Windows 上没有 `npx` 这个可执行文件，只有 `npx.cmd`；execFileSync 不做 PATHEXT
// 补全，写 "npx" 会直接 ENOENT。而写成 "npx.cmd" 也不行——Node 从 20.12 起
// （CVE-2024-27980）禁止不经 shell 直接 spawn `.bat` / `.cmd`，会当场 EINVAL。
// 所以下面必须带 `shell: true`，让 cmd.exe 去解析。参数全是写死的常量，没有注入面。
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

/**
 * 把 `ielts_test` 建成本仓库 schema 的样子。幂等：已经建过、migration 也都
 * 应用过时，Prisma 检查完 `_prisma_migrations` 就退出。
 *
 * 用 `migrate deploy` 不用 `db push`：仓库已经有 `prisma/migrations/`，deploy 的
 * 结果是确定的（就是那几份 migration 依次应用），也不会做 drift 检查。
 *
 * ⚠️ 库本身要先存在（`createdb -U postgres ielts_test`），见 README。
 * 两个连接变量都要显式覆盖：Prisma Migrate 优先读 `DIRECT_URL`。
 */
export function ensureTestDb(): void {
  assertLocalTestDb();
  execFileSync(NPX, ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, DIRECT_URL: TEST_DB_URL },
    // stdout 静音，stderr 留着——失败时 execFileSync 会把内容挂在 error 上
    stdio: ["ignore", "ignore", "pipe"],
    shell: true,
  });
}

/**
 * 每个用例之前清空所有表。
 *
 * 顺序按外键依赖来，子表在前：ReviewLog / UserWordProgress / WordExample 都挂着
 * 外键，先删父表会被外键约束挡下来。
 */
export async function resetDb(): Promise<void> {
  await prisma.reviewLog.deleteMany();
  await prisma.userWordProgress.deleteMany();
  await prisma.wordExample.deleteMany();
  await prisma.word.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.userSettings.deleteMany();
  await prisma.user.deleteMany();
}

export { prisma };

export async function makeUser(name = "tester"): Promise<number> {
  const user = await prisma.user.create({ data: { name } });
  return user.id;
}

export async function makeUnit(chapterNo: number, name = `章节 ${chapterNo}`): Promise<number> {
  const unit = await prisma.unit.create({ data: { chapterNo, name } });
  return unit.id;
}

export async function makeWord(
  unitId: number,
  orderInUnit: number,
  headword = `word${orderInUnit}`,
  over: { tags?: string | null; meaningCn?: string } = {},
): Promise<number> {
  const word = await prisma.word.create({
    data: {
      headword,
      meaningCn: over.meaningCn ?? "释义",
      tags: over.tags ?? null,
      unitId,
      orderInUnit,
    },
  });
  return word.id;
}

export interface ProgressOverrides {
  state?: string;
  dueAt?: Date;
  scheduledDays?: number;
  createdAt?: Date;
  reps?: number;
  lapses?: number;
  stability?: number;
  difficulty?: number;
  lastReviewAt?: Date | null;
}

export async function makeProgress(
  userId: number,
  wordId: number,
  over: ProgressOverrides = {},
): Promise<void> {
  await prisma.userWordProgress.create({
    data: {
      userId,
      wordId,
      state: over.state ?? "learning",
      dueAt: over.dueAt ?? new Date(),
      scheduledDays: over.scheduledDays ?? 0,
      // createdAt 在 schema 里有 @default(now())，但可以显式给——「今天新学了多少」
      // 和「是不是旧词」全靠这一列，测试必须能摆布它
      createdAt: over.createdAt ?? new Date(),
      reps: over.reps ?? 1,
      lapses: over.lapses ?? 0,
      // stability / difficulty 只在 state 是 review 时才有意义，但 FSRS 会拿它们
      // 算下个间隔，而且**difficulty 有 [1,10] 的合法区间**——留成 schema 默认的 0
      // 会让 ts-fsrs 直接抛 FSRSValidationError（不是静默算错，是当场炸）
      stability: over.stability ?? 1,
      difficulty: over.difficulty ?? 5,
      lastReviewAt: over.lastReviewAt ?? null,
    },
  });
}

export async function makeLog(
  userId: number,
  wordId: number,
  rating: number,
  reviewedAt = new Date(),
): Promise<void> {
  await prisma.reviewLog.create({ data: { userId, wordId, rating, reviewedAt } });
}

export async function makeSettings(
  userId: number,
  dailyNewLimit = 20,
  dailyReviewLimit = 200,
): Promise<void> {
  await prisma.userSettings.create({
    data: { userId, dailyNewLimit, dailyReviewLimit },
  });
}

/** 相对今天的某个时刻。负数 = 过去。 */
export function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 86_400_000);
}
