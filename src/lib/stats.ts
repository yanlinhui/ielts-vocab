// 首页那几块「雅思向」的小组件背后的查询与换算。
//
// 和 session.ts 的分工：session.ts 管「队列 + 今日该做什么」，这里管
// 「回头看一眼自己走过多远」——热力图、每日一句、统计页的那三块。
// 两者都不写库、不带状态，纯读。

import { prisma } from "./db";
import { isMastered, localDayKey, startOfToday } from "./session";

/* ------------------------------------------------------------------ */
/* 学习热力图                                                          */
/* ------------------------------------------------------------------ */

/** 热力图的一格 */
export interface HeatCell {
  /** YYYY-MM-DD（本地日） */
  date: string;
  /** 这一天复习了多少次 */
  count: number;
  /** 还没到的日期，只用来占位，前端渲染成空白 */
  future: boolean;
}

export interface HeatmapData {
  /** 每列一周，列内固定 7 格（周一 → 周日） */
  weeks: HeatCell[][];
  /** 有学习记录的天数 */
  activeDays: number;
  /** 单日最多复习了多少次，用来定分档 */
  maxCount: number;
  /** 区间内总复习次数 */
  totalReviews: number;
}

/** 热力图的分档阈值。0 单独一档（空格），1 起按下面四档着色 */
export const HEAT_LEVELS = [1, 5, 15, 30] as const;

/** 一格属于第几档：0 = 没学，1..4 对应 HEAT_LEVELS 的四档 */
export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count < HEAT_LEVELS[1]) return 1;
  if (count < HEAT_LEVELS[2]) return 2;
  if (count < HEAT_LEVELS[3]) return 3;
  return 4;
}

/**
 * 近 `weeks` 周的打卡数据。
 *
 * 起点对齐到**本周周一**再往前推 `weeks - 1` 周，这样最后一列永远是本周，
 * 每列从上到下是周一到周日——日期和格子的位置一一对应，不会随打开日期漂移。
 *
 * 按**本地日**分组（`localDayKey`），不是 UTC：`reviewedAt` 存的是 UTC，
 * 直接用 `toISOString().slice(0,10)` 的话，晚上 8 点之后学的词会被算到第二天，
 * 热力图上就会出现「晚上学了两天」这种假象。
 */
export async function getHeatmap(userId: number, weeks = 16): Promise<HeatmapData> {
  const now = new Date();
  const today = startOfToday(now);

  const start = new Date(today);
  // getDay() 里周日是 0，转成「周一 = 0」才方便往回退
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday - (weeks - 1) * 7);

  const logs = await prisma.reviewLog.findMany({
    where: { userId, reviewedAt: { gte: start } },
    select: { reviewedAt: true },
  });

  const counts = new Map<string, number>();
  for (const log of logs) {
    const key = localDayKey(log.reviewedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const grid: HeatCell[][] = [];
  let activeDays = 0;
  let maxCount = 0;
  let totalReviews = 0;

  for (let w = 0; w < weeks; w++) {
    const column: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      const key = localDayKey(day);
      const count = counts.get(key) ?? 0;
      const future = day.getTime() > today.getTime();
      if (!future) {
        if (count > 0) activeDays += 1;
        if (count > maxCount) maxCount = count;
        totalReviews += count;
      }
      column.push({ date: key, count, future });
    }
    grid.push(column);
  }

  return { weeks: grid, activeDays, maxCount, totalReviews };
}

/* ------------------------------------------------------------------ */
/* 每日一句                                                            */
/* ------------------------------------------------------------------ */

export interface DailySentence {
  en: string;
  cn: string;
  headword: string;
  unitNo: number;
  unitName: string;
}

/** 例句的可用长度区间。实测英文长度中位 49、p90 72，超出这个范围的八成是
 *  OCR 残留（粘连在一起的长串）或者被截断的短句，都不适合当引文 */
const SENTENCE_MIN_LEN = 20;
const SENTENCE_MAX_LEN = 90;

/**
 * 按日期挑一句书中例句。同一天多次打开是同一句。
 *
 * 不在数据库里排序随机——「随机」每次刷新都会换，早上看到一句、中午打开又变了，
 * 就不叫「每日一句」了。用日期本身做确定性 hash，同一天恒定。
 *
 * 只取 `cn` 非空的（要给中文翻译），并且拉 20 条候选后在其中挑第一条长度合适的——
 * 单取一条的话有约 13% 的概率撞上 OCR 粘连的句子。候选窗口让这个概率降到很低。
 */
export async function getDailySentence(now: Date = new Date()): Promise<DailySentence | null> {
  const total = await prisma.wordExample.count({ where: { cn: { not: null } } });
  if (total === 0) return null;

  // 留出候选窗口的余量，否则 skip 落在末尾时候选不足 20 条
  const skip = hashDay(now) % Math.max(1, total - 20);

  const candidates = await prisma.wordExample.findMany({
    where: { cn: { not: null } },
    orderBy: { id: "asc" },
    skip,
    take: 20,
    include: { word: { include: { unit: true } } },
  });
  if (candidates.length === 0) return null;

  const pick =
    candidates.find(
      (c) => c.en.length >= SENTENCE_MIN_LEN && c.en.length <= SENTENCE_MAX_LEN,
    ) ?? candidates[0];

  return {
    en: pick.en,
    cn: pick.cn ?? "",
    headword: pick.word.headword,
    unitNo: pick.word.unit.chapterNo,
    unitName: pick.word.unit.name,
  };
}

/**
 * 把日期打散成一个稳定的 32 位整数。
 *
 * 不能直接用 `年月日` 这种连号（20261016、20261017…）：模下来就是相邻的两条，
 * 一句接一句地顺着看，跟「每日一句」想要的那种随机感完全相反。
 * 拿个雪崩 hash 搅一下，相邻日期之间就没有可预测的关系了。
 * 必须用 `Math.imul`：普通乘法在 32 位溢出时会丢精度，结果不稳定。
 */
function hashDay(d: Date): number {
  let h = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/* ------------------------------------------------------------------ */
/* 统计页                                                              */
/* ------------------------------------------------------------------ */

/** 一天的账。没学的日子也在序列里（全 0），这样图上有它的位置 */
export interface DailyStat {
  /** YYYY-MM-DD（本地日） */
  date: string;
  /** 当日新学词数 = 进度行的创建日落在这一天 */
  learned: number;
  /** 当日复习旧词次数 */
  reviewed: number;
  /** 当日作答总数 */
  answers: number;
  /** 当日作答里 rating >= 3（一般 / 简单）的次数 */
  correct: number;
}

/**
 * 近 `days` 天的逐日账，从早到晚。
 *
 * ⚠️ 两处口径上的将就，都源于 `ReviewLog` **没有存当时的 state 快照**
 * （只有 rating / reviewedAt / elapsedMs 三列），所以「这天新学了几个、
 * 复习了几个」读不出来，只能借 `UserWordProgress.createdAt` 反推：
 *
 * - **新学** = 进度行的创建日就是这一天
 * - **复习** = 这天的流水里，词的进度行是**更早**创建的
 *
 * 第二条和 `session.ts` 里 `getTodayStats` 那条复习计数同源——新词当天在会话内
 * 被反复提问也会写流水，那不算复习。两处必须一样，否则首页和统计页会各说各话。
 *
 * 日期一律走 `localDayKey`：`reviewedAt` 存的是 UTC，用 `toISOString().slice(0,10)`
 * 的话晚上 8 点之后学的词会被算到第二天。
 *
 * 全程在 JS 里聚合（进度行最多 3580 行），和 `getHeatmap` 同一路数。
 */
export async function getDailyStats(userId: number, days = 30): Promise<DailyStat[]> {
  const today = startOfToday();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));

  const [progress, logs] = await Promise.all([
    prisma.userWordProgress.findMany({
      where: { userId },
      select: { wordId: true, createdAt: true },
    }),
    prisma.reviewLog.findMany({
      where: { userId, reviewedAt: { gte: start } },
      select: { wordId: true, rating: true, reviewedAt: true },
    }),
  ]);

  const bornDay = new Map<number, string>();
  for (const p of progress) bornDay.set(p.wordId, localDayKey(p.createdAt));

  // 先把空格子铺满整个窗口：没有推入过数据的日子也得在序列里占位，
  // 否则图上「没学的那几天」会被挤掉、日期轴对不上
  const buckets = new Map<string, DailyStat>();
  for (let i = 0; i < days; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = localDayKey(day);
    buckets.set(key, { date: key, learned: 0, reviewed: 0, answers: 0, correct: 0 });
  }

  for (const p of progress) {
    const bucket = buckets.get(localDayKey(p.createdAt));
    if (bucket) bucket.learned += 1;
  }

  for (const log of logs) {
    const key = localDayKey(log.reviewedAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.answers += 1;
    if (log.rating >= 3) bucket.correct += 1;
    // 进度行不是这天建的 → 这是个旧词，算复习。查不到进度行（理论上不会）
    // 也按复习算，宁可多算一次也不要漏
    if (bornDay.get(log.wordId) !== key) bucket.reviewed += 1;
  }

  return [...buckets.values()];
}

/** 全书词汇的状态分布。五段互斥、加起来正好是总词数 */
export interface StateBreakdown {
  /** 全书词数 */
  total: number;
  /** 一行进度都没有的词 */
  untouched: number;
  /** 学习中 */
  learning: number;
  /** 复习态里**还没**到 21 天的——不算已掌握 */
  inReview: number;
  /** 已掌握（`isMastered`） */
  mastered: number;
  /** 重学中 */
  relearning: number;
}

/**
 * 词汇状态分布。
 *
 * ⚠️ 别把 `state === "review"` 整个当成「已掌握」：实测 2026-10-16，22 行 review
 * 里只有 1 行 `scheduledDays >= 21`。刚学完的词稳定度只有几天，全归进 review 态，
 * 拿它当已掌握会把「掌握」这个数虚报 20 倍。
 *
 * 五段必须互斥，判断顺序有讲究：先问 `isMastered`（它本身是 review 的子集），
 * 再问剩下的 `review`。反过来会把已掌握的那几个从「复习中」里丢出去。
 */
export async function getStateBreakdown(userId: number): Promise<StateBreakdown> {
  const [total, progress] = await Promise.all([
    prisma.word.count(),
    prisma.userWordProgress.findMany({
      where: { userId },
      select: { state: true, scheduledDays: true },
    }),
  ]);

  let learning = 0;
  let inReview = 0;
  let mastered = 0;
  let relearning = 0;

  for (const p of progress) {
    if (isMastered(p)) mastered += 1;
    else if (p.state === "learning") learning += 1;
    else if (p.state === "review") inReview += 1;
    else if (p.state === "relearning") relearning += 1;
  }

  return {
    total,
    untouched: Math.max(0, total - progress.length),
    learning,
    inReview,
    mastered,
    relearning,
  };
}

/** 一个老忘的词 */
export interface ForgetfulWord {
  wordId: number;
  headword: string;
  meaningCn: string;
  unitId: number;
  unitNo: number;
  unitName: string;
  /** 答「忘了」的次数（rating === 1） */
  forgets: number;
  /** 一共作答过多少次 */
  answers: number;
}

/**
 * 「老忘的词」：答「忘了」次数最多的前 `limit` 个。
 *
 * **口径是 `ReviewLog` 里 `rating === 1` 的次数，不是 `UserWordProgress.lapses`。**
 * 后者要卡片**进入复习态之后**再答「忘了」才累加（映射的是 ts-fsrs 的 `card.lapses`），
 * 而现在绝大多数「忘了」都发生在初次学习步长里，不算 lapse——实测 2026-10-16，
 * 27 行进度里 `lapses` **全为 0**，按原口径这张表是空的。
 * 以后卡片进入长间隔，`lapses` 会自然长起来，届时再考虑合并两个信号。
 *
 * 聚合走 SQL 侧的 `groupBy`，不把流水全拉回来：流水随时间线性增长，一年后
 * 大约 8 万行。**一次按 `(wordId, rating)` 分组**就能同时拿到「忘了多少次」和
 * 「一共答过多少次」，不用查两遍。
 */
export async function getForgetfulWords(
  userId: number,
  limit = 20,
): Promise<ForgetfulWord[]> {
  const groups = await prisma.reviewLog.groupBy({
    by: ["wordId", "rating"],
    where: { userId },
    _count: { _all: true },
  });

  const agg = new Map<number, { forgets: number; answers: number }>();
  for (const g of groups) {
    const slot = agg.get(g.wordId) ?? { forgets: 0, answers: 0 };
    slot.answers += g._count._all;
    if (g.rating === 1) slot.forgets += g._count._all;
    agg.set(g.wordId, slot);
  }

  // 排除一次都没忘过的词——「老忘的词」里不该出现只答对过的词。
  // 并列时以 `wordId` 升序兜底，保证同一天多次渲染顺序稳定
  const ranked = [...agg.entries()]
    .filter(([, s]) => s.forgets > 0)
    .sort(
      (a, b) =>
        b[1].forgets - a[1].forgets || b[1].answers - a[1].answers || a[0] - b[0],
    )
    .slice(0, limit);

  if (ranked.length === 0) return [];

  const words = await prisma.word.findMany({
    where: { id: { in: ranked.map(([id]) => id) } },
    select: {
      id: true,
      headword: true,
      meaningCn: true,
      unitId: true,
      unit: { select: { chapterNo: true, name: true } },
    },
  });
  const byId = new Map(words.map((w) => [w.id, w]));

  return ranked.flatMap(([wordId, stat]) => {
    const w = byId.get(wordId);
    if (!w) return [];
    return [
      {
        wordId,
        headword: w.headword,
        meaningCn: w.meaningCn,
        unitId: w.unitId,
        unitNo: w.unit.chapterNo,
        unitName: w.unit.name,
        forgets: stat.forgets,
        answers: stat.answers,
      },
    ];
  });
}
