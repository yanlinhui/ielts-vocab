// 会话队列的测试。
//
// 前半是纯函数（日期、标签、掌握判据），后半查真库——`buildSession` 的队列规则
// 全是 Prisma 的关系查询（`where: { progress: { none: { userId } } }` 这种），
// mock 掉 prisma 就等于没测，所以打的是 `prisma/test.db`（见 env.ts）。
//
// 挑出来的都是**改坏过或写错过**的地方：`localDayKey` 的本地日、章节专项连着修
// 了两轮的那三条、以及「新词当天反复提问不算复习」那条语义。

import "./env";
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import {
  buildSession,
  getTodayStats,
  hasIeltsTag,
  isMastered,
  localDayKey,
  startOfToday,
} from "../src/lib/session";
import {
  daysAgo,
  ensureTestDb,
  makeLog,
  makeProgress,
  makeSettings,
  makeUnit,
  makeUser,
  makeWord,
  resetDb,
} from "./helpers";

describe("localDayKey", () => {
  it("回的是本地日历日，不是 UTC 日", () => {
    // 用本地时间构造，避免测试跟着跑测机器的时区变
    assert.equal(localDayKey(new Date(2026, 9, 16, 23, 59, 0)), "2026-10-16");
    assert.equal(localDayKey(new Date(2026, 9, 17, 0, 1, 0)), "2026-10-17");
  });

  it("同一天从早到晚都是同一个 key", () => {
    const keys = [
      new Date(2026, 9, 16, 0, 0, 0),
      new Date(2026, 9, 16, 12, 0, 0),
      new Date(2026, 9, 16, 23, 59, 59),
    ].map(localDayKey);
    assert.deepEqual(new Set(keys).size, 1, `同一天给出了多个 key：${keys.join(", ")}`);
  });

  it("月份和日都补零，方便排序和比较", () => {
    assert.equal(localDayKey(new Date(2026, 0, 5, 9, 0, 0)), "2026-01-05");
  });
});

describe("startOfToday", () => {
  it("把一天里的任何时刻压到本地零点", () => {
    const start = startOfToday(new Date(2026, 9, 16, 23, 59, 30, 500));
    assert.equal(start.getFullYear(), 2026);
    assert.equal(start.getMonth(), 9);
    assert.equal(start.getDate(), 16);
    assert.equal(start.getHours(), 0);
    assert.equal(start.getMinutes(), 0);
    assert.equal(start.getSeconds(), 0);
    assert.equal(start.getMilliseconds(), 0);
  });

  it("不晚于传入的时刻", () => {
    const now = new Date(2026, 9, 16, 8, 30, 0);
    assert.ok(startOfToday(now).getTime() <= now.getTime());
  });
});

describe("hasIeltsTag", () => {
  it("认得出雅思标签，认不出别的", () => {
    assert.equal(hasIeltsTag("ielts cet6"), true);
    assert.equal(hasIeltsTag("cet4 cet6"), false);
    assert.equal(hasIeltsTag(null), false);
    assert.equal(hasIeltsTag(undefined), false);
    assert.equal(hasIeltsTag(""), false);
  });

  it("「ielts」不是其它任何标签的子串——子串判断才和精确切分等价", () => {
    // 这条守的是函数注释里那个论断。哪天 ECDICT 加了个含 ielts 的标签
    // （比如 "ieltscore"），子串写法就会误判，这条会红。
    const others = ["gk", "ky", "cet4", "cet6", "toefl", "gre", "zk"];
    for (const tag of others) {
      assert.ok(!tag.includes("ielts"), `标签 ${tag} 里含 ielts，子串判断不再等价`);
    }
  });
});

describe("isMastered", () => {
  it("复习态且间隔 ≥ 21 天才算掌握", () => {
    assert.equal(isMastered({ state: "review", scheduledDays: 21 }), true);
    assert.equal(isMastered({ state: "review", scheduledDays: 365 }), true);
    assert.equal(isMastered({ state: "review", scheduledDays: 20 }), false);
  });

  it("别的状态一律不算，间隔再长也不算", () => {
    assert.equal(isMastered({ state: "learning", scheduledDays: 999 }), false);
    assert.equal(isMastered({ state: "relearning", scheduledDays: 999 }), false);
    assert.equal(isMastered({ state: "new", scheduledDays: 0 }), false);
  });
});

describe("buildSession —— 每日队列", () => {
  before(() => {
    ensureTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  /** 一章 N 个词，可选地改设置。返回 id 方便后续塞进度。 */
  async function seed(
    opts: { words?: number; newLimit?: number; reviewLimit?: number } = {},
  ) {
    const userId = await makeUser();
    const unitId = await makeUnit(1);
    if (opts.newLimit !== undefined || opts.reviewLimit !== undefined) {
      await makeSettings(userId, opts.newLimit ?? 20, opts.reviewLimit ?? 200);
    }
    const wordIds: number[] = [];
    for (let i = 1; i <= (opts.words ?? 0); i++) {
      wordIds.push(await makeWord(unitId, i));
    }
    return { userId, unitId, wordIds };
  }

  /** 一张已进入复习态、且此刻到期的卡。 */
  async function makeDue(userId: number, wordId: number, over = {}) {
    await makeProgress(userId, wordId, {
      state: "review",
      scheduledDays: 30,
      stability: 30,
      difficulty: 5,
      reps: 5,
      dueAt: daysAgo(1),
      lastReviewAt: daysAgo(31),
      ...over,
    });
  }

  it("到期的旧词排在没学过的新词前面", async () => {
    const { userId, wordIds } = await seed({ words: 5 });
    await makeDue(userId, wordIds[0]);
    await makeDue(userId, wordIds[1]);

    const queue = await buildSession(userId);

    assert.equal(queue.length, 5, "2 个复习 + 3 个新词");
    assert.deepEqual(
      queue.map((q) => q.isNew),
      [false, false, true, true, true],
      "旧词没排在前面",
    );
  });

  it("新词数量受每日新词上限约束", async () => {
    const { userId } = await seed({ words: 10, newLimit: 3 });

    const queue = await buildSession(userId);

    assert.equal(queue.filter((q) => q.isNew).length, 3);
    assert.equal(queue.length, 3);
  });

  it("配额要扣掉今天已经学过的", async () => {
    const { userId, wordIds } = await seed({ words: 10, newLimit: 5 });
    // 今天学的两个，到期时间在明天——所以不会混进复习队列
    await makeProgress(userId, wordIds[0], { dueAt: daysAgo(-1), createdAt: new Date() });
    await makeProgress(userId, wordIds[1], { dueAt: daysAgo(-1), createdAt: new Date() });

    const queue = await buildSession(userId);

    assert.equal(
      queue.filter((q) => q.isNew).length,
      3,
      "上限 5、今天已学 2，只该再给 3 个",
    );
  });

  it("到期复习数受每日复习上限截断", async () => {
    const { userId, wordIds } = await seed({ words: 5, newLimit: 0, reviewLimit: 2 });
    for (const id of wordIds) await makeDue(userId, id);

    const queue = await buildSession(userId);

    assert.equal(queue.length, 2, "5 个到期词该被上限截到 2 个");
    assert.ok(queue.every((q) => !q.isNew));
  });

  it("还没到期的词不进队列", async () => {
    const { userId, wordIds } = await seed({ words: 3, newLimit: 0 });
    await makeDue(userId, wordIds[0], { dueAt: daysAgo(-2) });

    assert.equal((await buildSession(userId)).length, 0);
  });

  it("newLimit 参数能覆写设置里的上限", async () => {
    const { userId } = await seed({ words: 10, newLimit: 2 });

    assert.equal((await buildSession(userId)).length, 2);
    assert.equal(
      (await buildSession(userId, { newLimit: 7 })).filter((q) => q.isNew).length,
      7,
      "「额外加练」靠这个覆写",
    );
  });

  it("队列项带上词自己的字段：雅思标记、章节号、例句", async () => {
    const userId = await makeUser();
    const unitId = await makeUnit(3, "科技");
    await makeWord(unitId, 1, "algorithm", { tags: "ielts cet6", meaningCn: "算法" });
    await makeWord(unitId, 2, "gizmo", { tags: "cet4", meaningCn: "小玩意儿" });

    const queue = await buildSession(userId);
    const algo = queue.find((q) => q.headword === "algorithm");
    const gizmo = queue.find((q) => q.headword === "gizmo");

    assert.ok(algo && gizmo);
    assert.equal(algo.isIelts, true);
    assert.equal(gizmo.isIelts, false);
    assert.equal(algo.unitNo, 3);
    assert.equal(algo.unitName, "科技");
    assert.equal(algo.meaningCn, "算法");
    assert.equal(algo.isNew, true);
    assert.equal(Object.keys(algo.previews).sort().join(""), "1234");
  });
});

describe("buildSession —— 章节专项", () => {
  before(() => {
    ensureTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  /** 两个单元：A 有 3 个词、B 有 2 个。 */
  async function seedTwoUnits() {
    const userId = await makeUser();
    const unitA = await makeUnit(1);
    const unitB = await makeUnit(2);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 1; i <= 3; i++) a.push(await makeWord(unitA, i, `a${i}`));
    for (let i = 1; i <= 2; i++) b.push(await makeWord(unitB, i, `b${i}`));
    return { userId, unitA, unitB, a, b };
  }

  it("只给这一章的词，别的章一个都不出现", async () => {
    const { userId, unitA, a } = await seedTwoUnits();

    const queue = await buildSession(userId, { unitId: unitA });

    assert.deepEqual(
      queue.map((q) => q.wordId).sort((x, y) => x - y),
      [...a].sort((x, y) => x - y),
    );
  });

  it("学过的词不再出现——再进来是接着上次学", async () => {
    const { userId, unitA, a } = await seedTwoUnits();
    await makeProgress(userId, a[0], { dueAt: daysAgo(-1) });

    const queue = await buildSession(userId, { unitId: unitA });

    assert.equal(queue.length, 2);
    assert.ok(
      !queue.some((q) => q.wordId === a[0]),
      "学过第一个词之后，第一个词不该又排在队首",
    );
  });

  it("不套每日新词上限——整章给全", async () => {
    const { userId, unitA } = await seedTwoUnits();
    await makeSettings(userId, 1, 200);

    const queue = await buildSession(userId, { unitId: unitA });

    assert.equal(queue.length, 3, "dailyNewLimit 是 1，但章节专项不该被它拦住");
  });

  it("按书里的顺序给", async () => {
    const { userId, unitA, a } = await seedTwoUnits();

    const queue = await buildSession(userId, { unitId: unitA });

    assert.deepEqual(
      queue.map((q) => q.wordId),
      a,
      "应该按 orderInUnit 升序，也就是建的时候那个顺序",
    );
  });

  it("整章学完给空队列——学习页靠它显示「这一章已经学完」", async () => {
    const { userId, unitA, a } = await seedTwoUnits();
    for (const id of a) await makeProgress(userId, id, { dueAt: daysAgo(-1) });

    assert.equal((await buildSession(userId, { unitId: unitA })).length, 0);
  });
});

describe("buildSession —— 错词本", () => {
  before(() => {
    ensureTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  /**
   * 一章 N 个词，每个都塞一张进度行。
   *
   * 这里**不写 `ReviewLog`**：`buildSession({ wordIds })` 不读日志，名单是调用方
   * （学习页，问 `getForgetfulWords` 要的）算好传进来的。日志口径归 `stats.ts` 管。
   *
   * `withProgress: false` 是给需要自己捏一张特定形状的卡的用例留的——`(userId, wordId)`
   * 上有唯一约束，建两次会炸。
   */
  async function seed(
    words: number,
    opts: { newLimit?: number; withProgress?: boolean } = {},
  ) {
    const userId = await makeUser();
    const unitId = await makeUnit(1);
    await makeSettings(userId, opts.newLimit ?? 20, 200);
    const wordIds: number[] = [];
    for (let i = 1; i <= words; i++) wordIds.push(await makeWord(unitId, i));
    if (opts.withProgress !== false) {
      for (const id of wordIds) await makeProgress(userId, id);
    }
    return { userId, unitId, wordIds };
  }

  it("只给名单里的词，名单外的一个都不出现", async () => {
    const { userId, wordIds } = await seed(5);
    const picked = [wordIds[1], wordIds[3]];

    const queue = await buildSession(userId, { wordIds: picked });

    assert.deepEqual(
      queue.map((q) => q.wordId).sort((a, b) => a - b),
      [...picked].sort((a, b) => a - b),
      "过滤没接上的话，另外三个没点名的词也会混进来",
    );
  });

  it("按传入顺序出队，不是按书里的 orderInUnit", async () => {
    const { userId, wordIds } = await seed(3);
    // 故意传一个和书序相反的名单：书序是 [0,1,2]，这里要 [2,0,1]
    const picked = [wordIds[2], wordIds[0], wordIds[1]];

    const queue = await buildSession(userId, { wordIds: picked });

    assert.deepEqual(
      queue.map((q) => q.wordId),
      picked,
      "名单顺序带着「忘得最多的排最前」，不能被 orderInUnit 覆盖掉",
    );
  });

  it("发的是真实进度行的卡，不是空卡——全部 isNew:false", async () => {
    const { userId, wordIds } = await seed(2, { withProgress: false });
    // 一张已经进复习态、稳定度 60 天的卡：空卡和它的预览间隔差着好几个数量级。
    // ⚠️ `dueAt` 故意设在**过去**——这条测的是「发的是不是真卡」，别让它顺带
    // 也去测到期筛选（那是下面那条的活），否则两条会一起红，分不清是哪儿坏的。
    await makeProgress(userId, wordIds[0], {
      state: "review",
      scheduledDays: 60,
      stability: 60,
      difficulty: 5,
      reps: 9,
      dueAt: daysAgo(1),
      lastReviewAt: daysAgo(2),
    });

    const queue = await buildSession(userId, { wordIds: [wordIds[0]] });
    const card = queue[0];

    assert.equal(card.isNew, false);
    // 空卡评「一般」落在学习步长里（10 分钟）；稳定度 60 天的复习卡不可能还在分钟级。
    // 这条红了就说明发的是 emptyCard()，FSRS 会把一个在复习态的词从头排。
    const good = new Date(card.previews[3]).getTime();
    assert.ok(
      good - Date.now() > 3 * 86_400_000,
      `评「一般」的间隔只有 ${Math.round((good - Date.now()) / 60_000)} 分钟，是空卡的形状`,
    );
  });

  it("到期时间在未来的词也照给——错词本不看到期", async () => {
    const { userId, wordIds } = await seed(2, { withProgress: false });
    await makeProgress(userId, wordIds[0], { dueAt: daysAgo(-10) });

    const queue = await buildSession(userId, { wordIds: [wordIds[0]] });

    assert.deepEqual(
      queue.map((q) => q.wordId),
      [wordIds[0]],
      "加了 dueAt 筛选的话，恰恰会把「还不到期但老忘」的词筛掉",
    );
  });

  it("不套每日配额：上限 1 也照样给全名单", async () => {
    const { userId, wordIds } = await seed(3, { newLimit: 1 });

    const queue = await buildSession(userId, { wordIds });

    assert.equal(queue.length, 3, "错词本和章节专项一样，不受每日新词上限约束");
  });

  it("名单里混进没有进度行的 id：跳过它、其余照给，不抛", async () => {
    const { userId, wordIds } = await seed(2);
    const ghost = 999_999;

    const queue = await buildSession(userId, { wordIds: [wordIds[0], ghost, wordIds[1]] });

    assert.deepEqual(queue.map((q) => q.wordId), [wordIds[0], wordIds[1]]);
  });

  it("空名单给空队列——错词本页面靠它显示「错词本现在是空的」", async () => {
    const { userId } = await seed(2);

    // `[]` 是 truthy，所以走的是错词本分支、而不是掉回每日动线
    assert.equal((await buildSession(userId, { wordIds: [] })).length, 0);
  });
});

describe("buildSession —— 拼写", () => {
  before(() => {
    ensureTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  /** 一章 N 个词。进度行由各用例自己按需塞——拼写队列全靠它筛。 */
  async function seed(words: number, opts: { newLimit?: number } = {}) {
    const userId = await makeUser();
    const unitId = await makeUnit(1);
    await makeSettings(userId, opts.newLimit ?? 20, 200);
    const wordIds: number[] = [];
    for (let i = 1; i <= words; i++) wordIds.push(await makeWord(unitId, i));
    return { userId, unitId, wordIds };
  }

  it("只给学过的词，没学过的一个都不出现", async () => {
    const { userId, wordIds } = await seed(5);
    await makeProgress(userId, wordIds[0]);
    await makeProgress(userId, wordIds[1]);

    const queue = await buildSession(userId, { spell: true });

    assert.deepEqual(
      queue.map((q) => q.wordId).sort((a, b) => a - b),
      [wordIds[0], wordIds[1]].sort((a, b) => a - b),
      "拼写是检验不是初学——没进度行的词混进来，用户第一题就写不出",
    );
  });

  it("到期时间在未来的词照给——拼写不看到期", async () => {
    const { userId, wordIds } = await seed(2);
    await makeProgress(userId, wordIds[0], { dueAt: daysAgo(-10) });

    const queue = await buildSession(userId, { spell: true });

    assert.deepEqual(
      queue.map((q) => q.wordId),
      [wordIds[0]],
      "加了 dueAt 筛选的话，刚学完（dueAt 在几分钟后）的词恰恰会被筛掉",
    );
  });

  it("不套每日配额：上限 1 也照样给全", async () => {
    const { userId, wordIds } = await seed(3, { newLimit: 1 });
    for (const id of wordIds) await makeProgress(userId, id);

    const queue = await buildSession(userId, { spell: true });

    assert.equal(queue.length, 3, "拼写和章节专项、错词本一样，不受每日新词上限约束");
  });

  it("发的是真实进度行的卡，不是空卡——全部 isNew:false", async () => {
    const { userId, wordIds } = await seed(1);
    await makeProgress(userId, wordIds[0], {
      state: "review",
      scheduledDays: 60,
      stability: 60,
      difficulty: 5,
      reps: 9,
      dueAt: daysAgo(1),
      lastReviewAt: daysAgo(2),
    });

    const queue = await buildSession(userId, { spell: true });
    const card = queue[0];

    assert.equal(card.isNew, false);
    // 空卡评「一般」落在学习步长里（10 分钟）；稳定度 60 天的复习卡不可能还在分钟级
    const good = new Date(card.previews[3]).getTime();
    assert.ok(
      good - Date.now() > 3 * 86_400_000,
      `评「一般」的间隔只有 ${Math.round((good - Date.now()) / 60_000)} 分钟，是空卡的形状`,
    );
  });

  it("给定 unitId 时只给这一章学过的词", async () => {
    const userId = await makeUser();
    const unitA = await makeUnit(1);
    const unitB = await makeUnit(2);
    const a = await makeWord(unitA, 1, "a1");
    const b = await makeWord(unitB, 1, "b1");
    await makeProgress(userId, a);
    await makeProgress(userId, b);

    const queue = await buildSession(userId, { spell: true, unitId: unitA });

    // 这条同时守着 buildSession 里那个分岔顺序：spell 若排在 unitId 后面，
    // 这个调用会被章节专项接走，结果是「第 1 章还没学过的词」——空队列。
    assert.deepEqual(queue.map((q) => q.wordId), [a], "b1 是第 2 章的，不该出现");
  });

  it("按 dueAt 升序——刚学完的词因此排在队首", async () => {
    const { userId, wordIds } = await seed(3);
    // 故意让 id 序和到期序相反
    await makeProgress(userId, wordIds[0], { dueAt: daysAgo(-5) });
    await makeProgress(userId, wordIds[1], { dueAt: daysAgo(-3) });
    await makeProgress(userId, wordIds[2], { dueAt: daysAgo(-1) });

    const queue = await buildSession(userId, { spell: true });

    assert.deepEqual(
      queue.map((q) => q.wordId),
      [wordIds[2], wordIds[1], wordIds[0]],
      "越早到期的越靠前。学习步长是 1m/10m，所以刚学完那批的 dueAt 最近，自然排在最前",
    );
  });

  it("一个词都没学过就给空队列——学习页靠它显示「还没有学过的词」", async () => {
    const { userId } = await seed(3);

    assert.equal((await buildSession(userId, { spell: true })).length, 0);
  });
});

describe("getTodayStats", () => {
  before(() => {
    ensureTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  async function seed(words: number, newLimit = 20) {
    const userId = await makeUser();
    const unitId = await makeUnit(1);
    await makeSettings(userId, newLimit, 200);
    const wordIds: number[] = [];
    for (let i = 1; i <= words; i++) wordIds.push(await makeWord(unitId, i));
    return { userId, wordIds };
  }

  it("newDone 只数今天首次创建的进度行", async () => {
    const { userId, wordIds } = await seed(5, 3);
    await makeProgress(userId, wordIds[0], { createdAt: new Date() });
    await makeProgress(userId, wordIds[1], { createdAt: new Date() });
    await makeProgress(userId, wordIds[2], { createdAt: daysAgo(1) });

    const stats = await getTodayStats(userId);

    assert.equal(stats.newDone, 2);
    assert.equal(stats.newLimit, 3);
    assert.equal(stats.newRemaining, 1);
  });

  it("学超了配额，剩余数也不会变成负的", async () => {
    const { userId, wordIds } = await seed(5, 2);
    for (const id of wordIds.slice(0, 4)) {
      await makeProgress(userId, id, { createdAt: new Date() });
    }

    const stats = await getTodayStats(userId);

    assert.equal(stats.newDone, 4);
    assert.equal(stats.newRemaining, 0);
  });

  it("今天学的词在当天被反复提问，不算复习", async () => {
    const { userId, wordIds } = await seed(3);
    await makeProgress(userId, wordIds[0], {
      state: "learning",
      dueAt: daysAgo(-1),
      createdAt: new Date(),
    });
    await makeLog(userId, wordIds[0], 3, new Date());
    await makeLog(userId, wordIds[0], 1, new Date());

    const stats = await getTodayStats(userId);

    assert.equal(stats.reviewDone, 0, "新词当天的重复提问是学习过程，不是复习");
  });

  it("昨天学的词今天再答，算复习", async () => {
    const { userId, wordIds } = await seed(3);
    await makeProgress(userId, wordIds[0], {
      state: "learning",
      dueAt: daysAgo(-1),
      createdAt: daysAgo(1),
    });
    await makeLog(userId, wordIds[0], 3, new Date());

    const stats = await getTodayStats(userId);

    assert.equal(stats.reviewDone, 1);
  });

  it("今天学过就从今天起算连续天数", async () => {
    const { userId, wordIds } = await seed(3);
    await makeLog(userId, wordIds[0], 3, new Date());
    await makeLog(userId, wordIds[0], 3, daysAgo(1));

    assert.equal((await getTodayStats(userId)).streak, 2);
  });

  it("今天还没学、但昨天学过——不算断", async () => {
    const { userId, wordIds } = await seed(3);
    await makeLog(userId, wordIds[0], 3, daysAgo(1));
    await makeLog(userId, wordIds[0], 3, daysAgo(2));

    assert.equal((await getTodayStats(userId)).streak, 2);
  });

  it("昨天也没学就断了", async () => {
    const { userId, wordIds } = await seed(3);
    await makeLog(userId, wordIds[0], 3, daysAgo(2));
    await makeLog(userId, wordIds[0], 3, daysAgo(3));

    assert.equal((await getTodayStats(userId)).streak, 0);
  });

  it("started / mastered / totalWords 三个数对得上", async () => {
    const { userId, wordIds } = await seed(5);
    await makeProgress(userId, wordIds[0], {
      state: "review",
      scheduledDays: 21,
      stability: 21,
      difficulty: 5,
      dueAt: daysAgo(-1),
    });
    await makeProgress(userId, wordIds[1], {
      state: "review",
      scheduledDays: 20,
      stability: 20,
      difficulty: 5,
      dueAt: daysAgo(-1),
    });
    await makeProgress(userId, wordIds[2], { dueAt: daysAgo(-1) });

    const stats = await getTodayStats(userId);

    assert.equal(stats.started, 3);
    assert.equal(stats.mastered, 1, "间隔 20 天那行不该算进已掌握");
    assert.equal(stats.totalWords, 5);
  });
});
