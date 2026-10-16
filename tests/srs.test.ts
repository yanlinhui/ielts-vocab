// FSRS 调度封装的测试。
//
// 分两段：
//   1. **纯函数**——`emptyCard` / `previewIntervals` 不查库，断言调度的「形状」：
//      学习步长是分钟级、四档间隔严格递增、步长走完才进复习态
//   2. **落库**——`submitRating` + `getCardRow`，断言写库之后的 state / lapses /
//      scheduledDays，以及「进度和流水一起落」这件事
//
// ⚠️ 断言只写**关系**，不写精确日期。`FSRS_PARAMS.enable_fuzz: true`，而 ts-fsrs 的
// fuzz seed 是 `${时间}_${reps}_${difficulty*stability}`（dist/index.cjs 的
// DefaultInitSeedStrategy）——**跟着时钟变**，同一个输入两次跑能得到不同的 due。
// 唯一的例外是学习步长：scheduled_minutes < 1440 时走的是「现在 + N 分钟」这条
// 路径，不过 fuzz，那部分可以断言到毫秒。

import "./env";
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import {
  emptyCard,
  getCardRow,
  previewIntervals,
  submitRating,
  type CardRow,
} from "../src/lib/srs";
import {
  ensureTestDb,
  makeProgress,
  makeUnit,
  makeUser,
  makeWord,
  prisma,
  resetDb,
} from "./helpers";

const NOW = new Date("2026-10-16T10:00:00.000");

const MINUTE = 60_000;
const DAY = 86_400_000;

/** 一张刚进入复习态的卡：稳定度 3 天、间隔 3 天、3 天前复习过。 */
function reviewCard(): CardRow {
  return {
    ...emptyCard(NOW),
    state: "review",
    stability: 3,
    difficulty: 5,
    scheduledDays: 3,
    reps: 2,
    lapses: 0,
    lastReviewAt: new Date(NOW.getTime() - 3 * DAY),
  };
}

describe("emptyCard", () => {
  it("没有时间、没有稳定度、没有计数——所有统计的零点", () => {
    const card = emptyCard(NOW);
    assert.equal(card.state, "new");
    assert.equal(card.reps, 0);
    assert.equal(card.lapses, 0);
    assert.equal(card.stability, 0);
    assert.equal(card.difficulty, 0);
    assert.equal(card.scheduledDays, 0);
    assert.equal(card.learningSteps, 0);
    assert.equal(card.lastReviewAt, null);
    assert.equal(card.dueAt.getTime(), NOW.getTime());
  });
});

describe("previewIntervals —— 学习步长", () => {
  it("新卡答「忘了」排到 1 分钟后", () => {
    const p = previewIntervals(emptyCard(NOW), NOW);
    assert.equal(p[1].getTime() - NOW.getTime(), MINUTE);
  });

  it("新卡答「一般」排到 10 分钟后", () => {
    const p = previewIntervals(emptyCard(NOW), NOW);
    assert.equal(p[3].getTime() - NOW.getTime(), 10 * MINUTE);
  });

  it("走完第二步再答「一般」，离开分钟级——那说明卡进了复习态", () => {
    // learningSteps: 1 = 已经走完 "1m"、正卡在 "10m" 这一档。这一档再答 Good,
    // 后面没有第三步了，就转而交给 FSRS 算天级间隔。
    const midStep: CardRow = {
      ...emptyCard(NOW),
      state: "learning",
      learningSteps: 1,
    };
    const p = previewIntervals(midStep, NOW);
    assert.ok(
      p[3].getTime() - NOW.getTime() >= DAY,
      `第二步答「一般」应该排到至少一天后，实际 ${(p[3].getTime() - NOW.getTime()) / MINUTE} 分钟`,
    );
  });
});

describe("previewIntervals —— 四档间隔", () => {
  it("忘了 < 困难 < 一般 < 简单，严格递增", () => {
    for (const [label, card] of [
      ["新卡", emptyCard(NOW)],
      ["复习态卡", reviewCard()],
    ] as const) {
      const p = previewIntervals(card, NOW);
      const ms = [p[1], p[2], p[3], p[4]].map((d) => d.getTime());
      assert.ok(
        ms[0] < ms[1] && ms[1] < ms[2] && ms[2] < ms[3],
        `${label}的四档间隔没有递增：${ms.map((m) => (m - NOW.getTime()) / MINUTE).join(", ")} 分钟`,
      );
    }
  });

  it("恰好返回 1/2/3/4 四个键，各是一个合法时间", () => {
    const p = previewIntervals(emptyCard(NOW), NOW);
    assert.deepEqual(Object.keys(p).sort(), ["1", "2", "3", "4"]);
    for (const rating of [1, 2, 3, 4] as const) {
      assert.ok(
        Number.isFinite(p[rating].getTime()),
        `第 ${rating} 档不是合法时间——评分按钮下面那行「下次：X 天后」会空`,
      );
    }
  });
});

describe("submitRating —— 落库", () => {
  before(() => {
    ensureTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  async function seedWord(): Promise<{ userId: number; wordId: number }> {
    const userId = await makeUser();
    const unitId = await makeUnit(1);
    const wordId = await makeWord(unitId, 1, "lithosphere");
    return { userId, wordId };
  }

  it("进度行和流水在同一个事务里一起落", async () => {
    const { userId, wordId } = await seedWord();

    const result = await submitRating(userId, wordId, 3);

    const row = await getCardRow(userId, wordId);
    assert.ok(row);
    assert.equal(row.state, "learning");
    assert.equal(row.learningSteps, 1);
    assert.equal(row.reps, 1);
    assert.equal(
      row.dueAt.getTime(),
      result.nextDueAt.getTime(),
      "返回的 nextDueAt 应该就是库里那个",
    );
    // 10 分钟那一档，容一点点时钟误差
    assert.ok(
      Math.abs(result.intervalMs - 10 * MINUTE) < MINUTE,
      `新卡答「一般」应该排到 10 分钟后，实际 ${result.intervalMs / MINUTE} 分钟`,
    );

    const logs = await prisma.reviewLog.findMany({ where: { userId } });
    assert.equal(logs.length, 1, "只该有一条流水");
    assert.equal(logs[0].rating, 3);
    assert.equal(logs[0].wordId, wordId);
  });

  it("两次「一般」走完学习步长，卡进入复习态", async () => {
    const { userId, wordId } = await seedWord();

    await submitRating(userId, wordId, 3);
    let row = await getCardRow(userId, wordId);
    assert.ok(row);
    assert.equal(row.state, "learning", "第一步之后还该在学习态");

    await submitRating(userId, wordId, 3);
    row = await getCardRow(userId, wordId);
    assert.ok(row);
    assert.equal(row.state, "review", "步长走完该离开学习态");
    assert.equal(row.reps, 2);
    assert.ok(row.scheduledDays >= 1, `复习态间隔至少 1 天，实际 ${row.scheduledDays}`);
  });

  it("复习态答「简单」把间隔拉长", async () => {
    const { userId, wordId } = await seedWord();
    await makeProgress(userId, wordId, {
      state: "review",
      stability: 3,
      difficulty: 5,
      scheduledDays: 3,
      reps: 2,
      dueAt: new Date(),
      lastReviewAt: new Date(Date.now() - 3 * DAY),
    });

    await submitRating(userId, wordId, 4);

    const row = await getCardRow(userId, wordId);
    assert.ok(row);
    assert.equal(row.state, "review", "「简单」不该把人踢回学习态");
    assert.ok(
      row.scheduledDays > 3,
      `间隔该比原来的 3 天长，实际 ${row.scheduledDays} 天`,
    );
  });

  it("复习态答「忘了」进重学态，并累加 lapses", async () => {
    const { userId, wordId } = await seedWord();
    await makeProgress(userId, wordId, {
      state: "review",
      stability: 3,
      difficulty: 5,
      scheduledDays: 3,
      reps: 2,
      lapses: 0,
      dueAt: new Date(),
      lastReviewAt: new Date(Date.now() - 3 * DAY),
    });

    await submitRating(userId, wordId, 1);

    const row = await getCardRow(userId, wordId);
    assert.ok(row);
    assert.equal(row.state, "relearning");
    assert.equal(row.lapses, 1, "「忘了」是 lapses 唯一会动的地方");
  });

  it("同一张卡评两次只留一行进度，但留两条流水", async () => {
    const { userId, wordId } = await seedWord();

    await submitRating(userId, wordId, 3);
    await submitRating(userId, wordId, 2);

    assert.equal(await prisma.userWordProgress.count({ where: { userId, wordId } }), 1);
    assert.equal(await prisma.reviewLog.count({ where: { userId, wordId } }), 2);
  });

  it("没学过的词也能评——自动当新卡处理", async () => {
    const { userId, wordId } = await seedWord();

    // 库里没有这张卡的进度行，直接评
    await submitRating(userId, wordId, 3);

    const row = await getCardRow(userId, wordId);
    assert.ok(row);
    assert.equal(row.reps, 1);
    assert.equal(row.state, "learning", "新卡直接评，走的是和第一次评分一样的路径");
  });
});
