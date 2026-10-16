// 拼写比对的测试。
//
// 全是纯函数——不碰数据库、不开浏览器，所以这个文件跑得飞快。比对算法特意从
// 组件里拆出来（见 src/lib/spelling.ts 顶部注释），为的就是能有这么一份测试：
// 拼写模式别的地方都得靠肉眼看，只有这里能锁住。

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffSpelling, normalizeSpelling } from "../src/lib/spelling";

describe("normalizeSpelling", () => {
  it("去首尾空白、转小写", () => {
    assert.equal(normalizeSpelling("  Environment "), "environment");
    assert.equal(normalizeSpelling("ABC"), "abc");
  });

  it("内部空格和连字符不动——它们是要记住的一部分", () => {
    assert.equal(normalizeSpelling("In Spite Of"), "in spite of");
    assert.equal(normalizeSpelling("well-known"), "well-known");
  });
});

describe("diffSpelling —— 判对", () => {
  it("完全一致就是对了，全程 keep", () => {
    const d = diffSpelling("environment", "environment");
    assert.equal(d.ok, true);
    assert.equal(d.message, "拼对了");
    assert.equal(d.missing + d.extra + d.wrong, 0);
    assert.ok(d.ops.every((o) => o.type === "keep"));
    assert.equal(d.ops.length, 11, "每个字符一个槽位");
  });

  it("大小写和首尾空格不算错——那是打字失误，不是没记住", () => {
    assert.equal(diffSpelling("environment", " Environment ").ok, true);
    assert.equal(diffSpelling("Environment", "environment").ok, true);
  });
});

describe("diffSpelling —— 判错：漏字", () => {
  it("PRD 2.7 那个例子：漏一个字母，位置要说得准", () => {
    // environment(11) → enviroment(10)，答案里第 7 个字母 n 被漏了。
    // ⚠️ PRD 2.7 写的是「第 8 个字母漏了」，但它标红的位置（enviro**n**ment）
    // 正是第 7 个——那句数字是笔误，以这里为准。
    const d = diffSpelling("environment", "enviroment");
    assert.equal(d.ok, false);
    assert.equal(d.missing, 1);
    assert.equal(d.extra, 0);
    assert.equal(d.wrong, 0);
    assert.equal(d.message, "第 7 个字母漏了");

    const missed = d.ops.filter((o) => o.type === "missing");
    assert.equal(missed[0].expected, "n", "标出来的必须正是被漏的那个 n");
  });

  it("整个词都没写：全是漏", () => {
    const d = diffSpelling("cat", "");
    assert.equal(d.ok, false);
    assert.equal(d.missing, 3);
    assert.equal(d.message, "漏了 3 个字母");
  });
});

describe("diffSpelling —— 判错：多敲", () => {
  it("末尾多一个字母", () => {
    const d = diffSpelling("environment", "environmentt");
    assert.equal(d.extra, 1);
    assert.equal(d.message, "第 12 个位置多敲了「t」");
  });

  it("开头多一个字母", () => {
    const d = diffSpelling("cat", "xcat");
    assert.equal(d.extra, 1);
    assert.equal(d.message, "第 1 个位置多敲了「x」");
  });

  it("多敲的字母不进 ops —— 它在正确答案里没有位置", () => {
    const d = diffSpelling("cat", "cxat");
    assert.equal(d.extra, 1);
    assert.equal(
      d.ops.filter((o) => o.type === "extra").length,
      1,
      "extra 在 ops 里占位（顺序信息），但 UI 不会把它渲染进正确答案那行",
    );
    assert.equal(d.ops.filter((o) => o.type !== "extra").length, 3);
  });
});

describe("diffSpelling —— 判错：写错", () => {
  it("替换一个字母要和「一漏一多」分开算", () => {
    // 这条守的正是「为什么不用 LCS」：LCS 会把这个判成「多了 u、漏了 e」，
    // 而用户实际只是第 9 个字母敲错了。
    const d = diffSpelling("environment", "environmunt");
    assert.equal(d.wrong, 1);
    assert.equal(d.missing, 0, "能算成一次替换，就不该拆成一漏一多");
    assert.equal(d.extra, 0);
    assert.equal(d.message, "第 9 个字母写成了「u」，应该是「e」");
  });

  it("整个词都写错：全是替换", () => {
    const d = diffSpelling("cat", "dog");
    assert.equal(d.wrong, 3);
    assert.equal(d.message, "写错 3 个字母");
  });

  it("长度相同但内容不同，不会退化成漏+多", () => {
    const d = diffSpelling("abandon", "abandom");
    assert.equal(d.wrong, 1);
    assert.equal(d.missing + d.extra, 0);
  });

  it("两个字母写反了：是两处写错，不是「漏一个、多一个」", () => {
    // 这条守着回溯里「extra 只在同字对角平局时才优先」那个 `same` 条件。
    // 少了它，ab/ba 会被拆成 extra+missing，报「漏 1 个、多 1 个」——
    // 而用户实际是把两个字母顺序记反了。
    const d = diffSpelling("ab", "ba");
    assert.equal(d.wrong, 2);
    assert.equal(d.missing, 0);
    assert.equal(d.extra, 0);
  });

  it("多敲的字母判在靠后的位置", () => {
    // environment(11) → environmentt(12)：多出来的 t 在末尾，该报第 12 位。
    // 若回溯先匹配了末尾那个 t，就会把它挤到第 11 位——而第 11 位本来就是 t。
    const d = diffSpelling("environment", "environmentt");
    assert.equal(d.extra, 1);
    assert.equal(d.message, "第 12 个位置多敲了「t」");
  });
});

describe("diffSpelling —— 多处差异", () => {
  it("差异多于一处就给汇总，不再报精确位置", () => {
    // 「第 3、7 个字母都错了」这种句子读起来比错本身还费劲
    const d = diffSpelling("environment", "enviro");
    assert.ok(d.missing + d.extra + d.wrong > 1);
    assert.match(d.message, /字母$/);
    assert.ok(!d.message.includes("第"), "多处差异不该报单个位置");
  });

  it("汇总只列非零的那几项", () => {
    const d = diffSpelling("cat", "cutx");
    // c/a/t → c/u/t/x：第 2 个字母写错 + 末尾多一个
    assert.equal(d.wrong, 1);
    assert.equal(d.extra, 1);
    assert.equal(d.message, "多了 1 个、写错 1 个字母");
  });
});

describe("diffSpelling —— 形状", () => {
  it("ops 里除 extra 外的槽位数永远等于正确词的长度", () => {
    const cases: [string, string][] = [
      ["environment", "environment"],
      ["environment", "enviroment"],
      ["cat", "xcat"],
      ["cat", ""],
      ["abandon", "abandom"],
      ["a", "abcdef"],
    ];
    for (const [expected, typed] of cases) {
      const d = diffSpelling(expected, typed);
      const slots = d.ops.filter((o) => o.type !== "extra").length;
      assert.equal(
        slots,
        expected.length,
        `${expected} vs ${typed}：槽位数对不上正确词长度`,
      );
    }
  });
});
