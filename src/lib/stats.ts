// 首页那几块「雅思向」的小组件背后的查询与换算。
//
// 和 session.ts 的分工：session.ts 管「队列 + 今日该做什么」，这里管
// 「回头看一眼自己走过多远」——热力图、每日一句。
// 两者都不写库、不带状态，纯读。

import { prisma } from "./db";
import { localDayKey, startOfToday } from "./session";

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
