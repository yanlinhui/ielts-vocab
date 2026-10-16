// 会话队列：决定「今天这一轮该看哪些词、按什么顺序」。
//
// 有两种队列，分岔在 buildSession 的第一行：
//
//   A. 每日队列（`/study`，首页「开始」进来的）——规则来自 PRD 2.1 / 2.2：
//        1. 先复习到期旧词，再学新词。旧词不复习会越积越多，必须优先
//        2. 新词数量受「每日新词上限」约束，且要扣掉今天已经学过的
//        3. 复习数量受「每日复习上限」约束
//
//   B. 章节专项（`/study?unit=N`，从章节词汇点某一章进来的）——整章一次给全，
//      上面那三条**一条都不适用**。原因见 buildUnitSession 的注释。
//
// 队列在进入学习页时算一次。中途刷新页面就重算——已经评过分的词状态变了，
// 不会重复出现（除非它因为答错被排到几分钟后，那本来就应该再出现）。

import { prisma } from "./db";
import type { Rating } from "./rating";
import { emptyCard, previewIntervals, type CardRow } from "./srs";

export interface QueueExample {
  en: string;
  cn: string | null;
}

export interface QueueItem {
  wordId: number;
  headword: string;
  phonetic: string | null;
  pos: string | null;
  meaningCn: string;
  /** 单词在 ECDICT 标签里的雅思标记。词卡上的「雅思」小印靠它 */
  isIelts: boolean;
  /** BNC 语料库词频排位，越小越常用。约 195 个词没有，那种情况词卡不显示刻度 */
  bncRank: number | null;
  /** 书中原话的释义行。属于书籍原创内容，公开分享时整体关闭 */
  bookMeaning: string | null;
  collocation: string | null;
  derived: string | null;
  etymology: string | null;
  cultureNote: string | null;
  examples: QueueExample[];
  unitNo: number;
  unitName: string;
  isNew: boolean;
  /** 四档评分各自的下次到期时间（ISO 串），给按钮下方那行「下次：3 天后」用 */
  previews: Record<Rating, string>;
}

export interface TodayStats {
  /** 今日新词上限（来自用户设置） */
  newLimit: number;
  /** 今天已经学了几个新词 */
  newDone: number;
  /** 今天还剩多少个新词配额 */
  newRemaining: number;
  /** 此刻到期的复习词数（不受上限截断） */
  dueCount: number;
  /** 今日复习上限 */
  reviewLimit: number;
  /** 今天已经复习了多少次 */
  reviewDone: number;
  /** 连续打卡天数 */
  streak: number;
  /** 已掌握（间隔 ≥ 21 天，Anki 对「成熟卡片」的定义） */
  mastered: number;
  /** 词库总词数 */
  totalWords: number;
  /** 已经开始学的词数（有过至少一次作答） */
  started: number;
}

/** 本地时间的今天零点。数据库里存 UTC，用这个和它比较即可。 */
export function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 本地时间的 YYYY-MM-DD，用来数「哪几天学习过」。热力图也用这个分组 */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getTodayStats(userId: number): Promise<TodayStats> {
  const now = new Date();
  const today = startOfToday(now);

  const [settings, newDone, dueCount, reviewDone, progress, totalWords, logs] =
    await Promise.all([
      prisma.userSettings.findUnique({ where: { userId } }),
      // 今天新学的词 = 今天首次创建的进度行
      prisma.userWordProgress.count({ where: { userId, createdAt: { gte: today } } }),
      prisma.userWordProgress.count({
        where: { userId, state: { not: "new" }, dueAt: { lte: now } },
      }),
      // 今天复习了几个**旧词**。不能简单数今天的全部流水——新词在当天
      // 会话内被反复提问也会写流水，那不算「复习」。判据：这个词的进度行
      // 是今天以前创建的。
      prisma.reviewLog.count({
        where: {
          userId,
          reviewedAt: { gte: today },
          word: { progress: { some: { userId, createdAt: { lt: today } } } },
        },
      }),
      prisma.userWordProgress.findMany({
        where: { userId },
        select: { state: true, scheduledDays: true },
      }),
      prisma.word.count(),
      // 只取近 400 天，足够数连续打卡，也不用扫全表
      prisma.reviewLog.findMany({
        where: { userId, reviewedAt: { gte: new Date(now.getTime() - 400 * 86_400_000) } },
        select: { reviewedAt: true },
      }),
    ]);

  const newLimit = settings?.dailyNewLimit ?? 20;
  const reviewLimit = settings?.dailyReviewLimit ?? 200;

  // 连续打卡：从今天往回数，哪天没有学习记录就停。
  // 今天还没学不算断——所以允许从今天或昨天起算。
  const days = new Set(logs.map((l) => localDayKey(l.reviewedAt)));
  let streak = 0;
  const cursor = new Date(today);
  if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    newLimit,
    newDone,
    newRemaining: Math.max(0, newLimit - newDone),
    dueCount,
    reviewLimit,
    reviewDone,
    streak,
    mastered: progress.filter(isMastered).length,
    totalWords,
    started: progress.length,
  };
}

/**
 * 词条是否属于雅思核心词。词卡上的「雅思」小印靠它。
 *
 * 用子串判断而不是更严谨的 `split().includes()`：ECDICT 的 tags 就是空格分隔的
 * 短标签串（gk/ky/cet4/cet6/toefl/ielts/gre/zk），实测 "ielts" 不是其中任何一个
 * 的子串，两者等价，而子串版本在 SQL 侧能直接写成 LIKE。
 */
export function hasIeltsTag(tags: string | null | undefined): boolean {
  return Boolean(tags && tags.includes("ielts"));
}

/** Anki 对「成熟卡片」的定义：已进入复习态、间隔拉到 21 天以上。全站只有这一处判据 */
function isMastered(p: { state: string; scheduledDays: number }): boolean {
  return p.state === "review" && p.scheduledDays >= 21;
}

export interface BuildSessionOptions {
  /** 只学某个单元（单元专项模式） */
  unitId?: number;
  /** 覆写今日新词上限，用于「额外加练」 */
  newLimit?: number;
}

export async function buildSession(
  userId: number,
  opts: BuildSessionOptions = {},
): Promise<QueueItem[]> {
  // 章节专项走另一条路：整章给全，不碰每日配额
  if (opts.unitId) return buildUnitSession(userId, opts.unitId);

  const now = new Date();
  const settings = await prisma.userSettings.findUnique({ where: { userId } });

  // ---- 1. 到期复习词，先来 ----
  const dueRows = await prisma.userWordProgress.findMany({
    where: { userId, state: { not: "new" }, dueAt: { lte: now } },
    orderBy: { dueAt: "asc" },
    take: settings?.dailyReviewLimit ?? 200,
    include: { word: { include: { unit: true, examples: true } } },
  });

  const items: QueueItem[] = [];
  for (const row of dueRows) {
    items.push(
      toQueueItem(row.word, row, false),
    );
  }

  // ---- 2. 新词，补足配额 ----
  const newLimit = opts.newLimit ?? settings?.dailyNewLimit ?? 20;
  const newDone = await prisma.userWordProgress.count({
    where: { userId, createdAt: { gte: startOfToday(now) } },
  });
  const quota = Math.max(0, newLimit - newDone);

  if (quota > 0) {
    // 「新词」= 这个用户还没有进度行的词。已经在学但今天到期的那些
    // 属于上一类，不会被重复取到。
    const studied = await prisma.userWordProgress.findMany({
      where: { userId },
      select: { wordId: true },
    });

    const newWords = await prisma.word.findMany({
      where: { id: { notIn: studied.map((s) => s.wordId) } },
      orderBy: [{ unitId: "asc" }, { orderInUnit: "asc" }],
      take: quota,
      include: { unit: true, examples: true },
    });

    for (const w of newWords) {
      items.push(toQueueItem(w, emptyCard(), true));
    }
  }

  return items;
}

/**
 * 章节专项：这一章的**全部**词，一次给全，按书里的顺序（`orderInUnit`）。
 *
 * ⚠️ **这里不套「每日新词上限 / 复习上限」，也不只取「今天到期的」。**
 * 之前章节模式是把 `unitId` 塞进上面那条每日动线当过滤条件用的，于是「点某一章
 * 只练那一章」实际变成了「今天原本要背的那几个词，恰好限定在这一章里」：实测
 * 2026-10-16，第 1 章 233 个词，当天新词已学 18、每日上限 20，点进去只拿到
 * 1 个到期词 + 2 个新词 = 3 个；配额用光的日子点进去更是**一个词都没有**，
 * 直接弹「今天没有待学的词了」。用户报的就是这个（「学习的模式仍然是今日功课
 * 的模式，应该为对应章节的所有词」）。
 *
 * 配额、到期、先复习后学新这三条，都是**首页那条动线**的规则——它的目的是
 * 「每天固定喂一点、不让复习堆积」。章节专项是另一件事：用户主动挑了一章，
 * 想要的就是把这一章走完，遇到哪些词已经学过、哪些今天到期，都不该拦着他。
 *
 * 代价是队列可能很长（第 21 章 408 个词是最长的一章），但进度是每评一次分就
 * 实时落库的，中途退出不丢东西——这也正是学习页要写「进度已实时保存」的原因。
 *
 * 顺序上让已学过的词和没学过的词**按书序混在一起**，而不是把到期的提到前面：
 * 章节的词本身是一个主题序列，跳到第 80 个再跳回第 3 个没有意义。
 */
async function buildUnitSession(userId: number, unitId: number): Promise<QueueItem[]> {
  const [words, cards] = await Promise.all([
    prisma.word.findMany({
      where: { unitId },
      orderBy: { orderInUnit: "asc" },
      include: { unit: true, examples: true },
    }),
    prisma.userWordProgress.findMany({ where: { userId, word: { unitId } } }),
  ]);

  // 有进度行的走真实卡片状态（预览间隔、是否算「新词」都跟着它），
  // 没有的就是一张空卡——和每日动线里对「新词」的处理一致。
  const byWord = new Map(cards.map((c) => [c.wordId, c]));
  return words.map((w) => {
    const row = byWord.get(w.id);
    return toQueueItem(w, row ?? emptyCard(), !row);
  });
}

type WordWithRelations = {
  id: number;
  headword: string;
  phonetic: string | null;
  pos: string | null;
  meaningCn: string;
  tags: string | null;
  bncRank: number | null;
  bookMeaning: string | null;
  collocation: string | null;
  derived: string | null;
  etymology: string | null;
  cultureNote: string | null;
  unit: { chapterNo: number; name: string };
  examples: { en: string; cn: string | null; orderIndex: number }[];
};

function toQueueItem(
  word: WordWithRelations,
  card: CardRow,
  isNew: boolean,
): QueueItem {
  const previews = previewIntervals(card);
  return {
    wordId: word.id,
    headword: word.headword,
    phonetic: word.phonetic,
    pos: word.pos,
    meaningCn: word.meaningCn,
    isIelts: hasIeltsTag(word.tags),
    bncRank: word.bncRank,
    bookMeaning: word.bookMeaning,
    collocation: word.collocation,
    derived: word.derived,
    etymology: word.etymology,
    cultureNote: word.cultureNote,
    examples: [...word.examples]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((e) => ({ en: e.en, cn: e.cn })),
    unitNo: word.unit.chapterNo,
    unitName: word.unit.name,
    isNew,
    previews: {
      1: previews[1].toISOString(),
      2: previews[2].toISOString(),
      3: previews[3].toISOString(),
      4: previews[4].toISOString(),
    },
  };
}
