// FSRS 调度封装。
//
// **这是本项目唯一允许 import ts-fsrs 的地方。** 其他代码只用这里导出的
// `Rating` / `previewIntervals` / `submitRating`，不直接碰 ts-fsrs 的类型和枚举——
// 万一以后要换算法（或者 ts-fsrs 大版本改 API），改动只在这一个文件里。
//
// FSRS 到底在算什么（一句话）：它给每个单词单独维护「稳定度」和「难度」两个数，
// 每答一次就根据「答对没有 + 距上次多久」更新它们，算出**这个特定的词**该在
// 第几天再出现。所以简单词越背越少出现，难词反复出现。传统艾宾浩斯是所有词
// 共用一套间隔（1/2/4/7/15 天），做不到这一点。

import { Prisma } from "@prisma/client";
import {
  Rating as FsrsRating,
  State as FsrsState,
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card,
  type CardInput,
  type Grade,
} from "ts-fsrs";
import { prisma } from "./db";
import type { Rating } from "./rating";

// Rating 的数值和 ts-fsrs 的 Rating 一致，互转就是直接赋值。
export type { Rating };

/** FSRS 参数。tech-spec 5.4 说这些不要一次定死，所以集中放在这里。 */
export const FSRS_PARAMS = {
  // 目标记忆保持率。0.9 = 希望每个词在你复习时还有 90% 的概率记得住。
  // 调高 → 复习更频繁、记得更牢；调低 → 每天要复习的少、但容易忘。
  request_retention: 0.9,
  // 间隔上限（天）。36500 天 ≈ 100 年，实际等于不封顶。
  maximum_interval: 36500,
  // 给间隔加随机扰动。不加的话，同一天学的词以后会永远挤在同一天复习，
  // 某天突然爆出几百个复习词。加了之后它们会自然散开。
  enable_fuzz: true,
  // 启用「学习步长」：新词第一次答完后不直接排到明天，而是十几分钟后再来一遍。
  // 这是形成「今天记住」的关键，关掉的话新词当天只见到一次。
  enable_short_term: true,
  learning_steps: ["1m", "10m"] as const,
  // 已进入复习态的词答「忘了」之后的重新学习步长
  relearning_steps: ["10m"] as const,
};

const scheduler = fsrs(generatorParameters(FSRS_PARAMS));

/** 数据库里的 state 是小写字符串（SQLite 没有 enum），这里做双向映射。 */
const STATE_TO_DB: Record<number, string> = {
  [FsrsState.New]: "new",
  [FsrsState.Learning]: "learning",
  [FsrsState.Review]: "review",
  [FsrsState.Relearning]: "relearning",
};
const DB_TO_STATE: Record<string, FsrsState> = {
  new: FsrsState.New,
  learning: FsrsState.Learning,
  review: FsrsState.Review,
  relearning: FsrsState.Relearning,
};

/** 调度需要的那几个字段。UserWordProgress 和 ts-fsrs 的 Card 都能转成它。 */
export interface CardRow {
  stability: number;
  difficulty: number;
  dueAt: Date;
  state: string;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReviewAt: Date | null;
}

const DAY_MS = 86_400_000;

/** CardRow → ts-fsrs 的输入格式。 */
function toCardInput(row: CardRow, now: Date): CardInput {
  return {
    due: row.dueAt,
    stability: row.stability,
    difficulty: row.difficulty,
    // elapsed_days 在 ts-fsrs 6.0 会删掉，现在它自己按 last_review 算，
    // 但类型上仍必填，就照着补偿一个。
    elapsed_days: row.lastReviewAt
      ? Math.max(0, Math.floor((now.getTime() - row.lastReviewAt.getTime()) / DAY_MS))
      : 0,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: DB_TO_STATE[row.state] ?? FsrsState.New,
    last_review: row.lastReviewAt ?? undefined,
  };
}

/** 反过来：ts-fsrs 算完的新卡片 → 数据库字段。 */
function cardToFields(card: Card): Prisma.UserWordProgressUncheckedUpdateInput {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    dueAt: card.due,
    state: STATE_TO_DB[card.state] ?? "new",
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewAt: card.last_review ?? null,
  };
}

function cardToRow(card: Card): CardRow {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    dueAt: card.due,
    state: STATE_TO_DB[card.state] ?? "new",
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewAt: card.last_review ?? null,
  };
}

const RATING_TO_FSRS: Record<Rating, Grade> = {
  1: FsrsRating.Again,
  2: FsrsRating.Hard,
  3: FsrsRating.Good,
  4: FsrsRating.Easy,
};

/** 一个还没学过的新词，初始状态。 */
export function emptyCard(now: Date = new Date()): CardRow {
  return cardToRow(createEmptyCard(now));
}

/**
 * 预览：现在评某一档的话，下次什么时候再见。
 *
 * 一次 `repeat()` 就把四档全算出来了，所以四个按钮的文字是一次调用拿到的，
 * 不是调四次。
 *
 * **这个预览是给用户建立正确评分习惯用的**——不显示的话所有人都会无脑点
 * 「一般」，FSRS 就退化成固定间隔了。
 */
export function previewIntervals(
  row: CardRow,
  now: Date = new Date(),
): Record<Rating, Date> {
  const preview = scheduler.repeat(toCardInput(row, now), now);
  return {
    1: preview[FsrsRating.Again].card.due,
    2: preview[FsrsRating.Hard].card.due,
    3: preview[FsrsRating.Good].card.due,
    4: preview[FsrsRating.Easy].card.due,
  };
}

export interface SubmitResult {
  /** 这个词的下次到期时间 */
  nextDueAt: Date;
  /** 更新之后，四档各自的预览（用于本次会话内再次出现时刷新按钮文字） */
  previews: Record<Rating, Date>;
  /** 距下次到期还有多久（毫秒）。很小的值表示本次会话内马上还要再见 */
  intervalMs: number;
}

/**
 * 提交一次评分：更新 FSRS 状态 + 落一条流水。
 *
 * 两件事必须在同一个事务里。只做一半的话统计数据就错乱了——比如进度更新了
 * 但流水没写，当天的正确率就是错的。
 */
export async function submitRating(
  userId: number,
  wordId: number,
  rating: Rating,
  elapsedMs?: number,
): Promise<SubmitResult> {
  const now = new Date();

  const existing = await prisma.userWordProgress.findUnique({
    where: { userId_wordId: { userId, wordId } },
  });

  // 没学过就是一张空卡
  const current: CardRow = existing
    ? {
        stability: existing.stability,
        difficulty: existing.difficulty,
        dueAt: existing.dueAt,
        state: existing.state,
        scheduledDays: existing.scheduledDays,
        learningSteps: existing.learningSteps,
        reps: existing.reps,
        lapses: existing.lapses,
        lastReviewAt: existing.lastReviewAt,
      }
    : emptyCard(now);

  const { card: next } = scheduler.next(
    toCardInput(current, now),
    now,
    RATING_TO_FSRS[rating],
  );

  await prisma.$transaction(async (tx) => {
    const fields = cardToFields(next);
    await tx.userWordProgress.upsert({
      where: { userId_wordId: { userId, wordId } },
      // createdAt 只在首次创建时写，之后 upsert 的 update 分支不能带它
      create: { userId, wordId, ...(fields as object) },
      update: fields,
    });
    await tx.reviewLog.create({
      data: { userId, wordId, rating, reviewedAt: now, elapsedMs: elapsedMs ?? null },
    });
  });

  const previews = previewIntervals(cardToRow(next), now);
  return {
    nextDueAt: next.due,
    previews,
    intervalMs: next.due.getTime() - now.getTime(),
  };
}

/** 刚刚提交完评分后，这个卡片的新状态（给会话队列判断要不要本次内重排用）。 */
export async function getCardRow(
  userId: number,
  wordId: number,
): Promise<CardRow | null> {
  const row = await prisma.userWordProgress.findUnique({
    where: { userId_wordId: { userId, wordId } },
  });
  return row
    ? {
        stability: row.stability,
        difficulty: row.difficulty,
        dueAt: row.dueAt,
        state: row.state,
        scheduledDays: row.scheduledDays,
        learningSteps: row.learningSteps,
        reps: row.reps,
        lapses: row.lapses,
        lastReviewAt: row.lastReviewAt,
      }
    : null;
}
