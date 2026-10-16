// 拼写比对：把用户敲进去的和正确答案逐字符对齐，指出差在哪。
//
// 这是拼写模式里唯一有算法的地方，也是唯一能脱离浏览器验证的部分——所以单独成
// 文件，配 tests/spelling.test.ts。UI 只消费 diffSpelling 的返回值，不自己判对错。
//
// **为什么用编辑距离、不用最长公共子序列（LCS）**：LCS 只说得清「哪些字符两边
// 都有」，分不出「写错了一个」和「漏一个、多一个」。environment 打成 environmunt，
// LCS 会判成「多了 u、漏了 e」；可用户实际是**第 9 个字母写错了**——PRD 2.7 要的
// 正是「标出哪个位置没记牢」。带替换的 Levenshtein 才对得上这个诉求。
//
// 零依赖手写：词最长二十来个字符，O(n·m) 的 DP 绰绰有余。

/**
 * 判等与比对的统一口径：去首尾空白 + 转小写。
 *
 * 只做这两下——大小写和首尾空格是打字失误，不是「没记住」。**不**动内部空格与
 * 连字符：短语（in spite of）和带连字符的词里，那个空格/连字符本身就是要记住的
 * 一部分，抹掉等于放水。
 */
export function normalizeSpelling(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 对齐后的一个槽位，按**正确词**的顺序排列。
 *
 * `expected` / `typed` 都是小写归一化之后的字符——UI 若要按原大小写展示正确词，
 * 那是它自己的事（队列里那个 headword 才是原形）。
 */
export type CharOp =
  | { type: "keep"; expected: string }
  /** 正确词这个位置被写成了别的字母 */
  | { type: "sub"; expected: string; typed: string }
  /** 正确词有、用户漏了 */
  | { type: "missing"; expected: string }
  /** 用户多敲的字母，挂在它插入的位置上 */
  | { type: "extra"; typed: string };

export interface SpellDiff {
  /** 归一化后完全一致。有一个字符不同就是 false */
  ok: boolean;
  /** 逐字符对齐结果，UI 照着渲染高亮 */
  ops: CharOp[];
  missing: number;
  extra: number;
  /** 写错的字母数（替换） */
  wrong: number;
  /** 一句话诊断，给「第 8 个字母漏了」那种提示用 */
  message: string;
}

export function diffSpelling(expectedRaw: string, typedRaw: string): SpellDiff {
  const expected = normalizeSpelling(expectedRaw);
  const typed = normalizeSpelling(typedRaw);
  const m = expected.length;
  const n = typed.length;

  // dp[i][j] = expected 的前 i 个字符 与 typed 的前 j 个字符 的最少编辑步数
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i; // 全漏
  for (let j = 0; j <= n; j++) dp[0][j] = j; // 全多

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const same = expected[i - 1] === typed[j - 1];
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + (same ? 0 : 1), // 保留 / 替换
        dp[i - 1][j] + 1, // 漏掉这个字母
        dp[i][j - 1] + 1, // 多敲了这个字母
      );
    }
  }

  // 从右下角回溯。三条偏好，顺序就是下面三个分支的顺序：
  //
  // 1. **多敲的字母尽量判在靠后**（`same && extra` 这条）。`environmentt`
  //    该报「第 12 个位置多敲了 t」，而不是「第 11 个」——第 11 位本来就是
  //    t，用户没在那儿出错。只在「与同字对角平局」时才这么走。
  // 2. 否则**对角优先**——能算成一次替换，就不要拆成「一漏一多」，提示才说
  //    得准（「第 9 个字母写错了」而不是「多了 u、漏了 e」）。
  // 3. 剩下才是「漏」。
  //
  // 第 1 条**必须带 `same` 这个条件**：和替换平局时（`ab` vs `ba`）替换更贴切，
  // 那是两个字母写反了，不该报成「漏一个、多一个」。
  const ops: CharOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && expected[i - 1] === typed[j - 1];

    if (same && dp[i][j] === dp[i][j - 1] + 1) {
      ops.push({ type: "extra", typed: typed[j - 1] });
      j -= 1;
      continue;
    }

    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (same ? 0 : 1)) {
      ops.push(
        same
          ? { type: "keep", expected: expected[i - 1] }
          : { type: "sub", expected: expected[i - 1], typed: typed[j - 1] },
      );
      i -= 1;
      j -= 1;
      continue;
    }
    // 走到这儿只剩「漏」和「多」两种可能，dp 必定取其中之一
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: "missing", expected: expected[i - 1] });
      i -= 1;
    } else {
      ops.push({ type: "extra", typed: typed[j - 1] });
      j -= 1;
    }
  }
  ops.reverse();

  const missing = ops.filter((o) => o.type === "missing").length;
  const extra = ops.filter((o) => o.type === "extra").length;
  const wrong = ops.filter((o) => o.type === "sub").length;

  return {
    ok: expected === typed,
    ops,
    missing,
    extra,
    wrong,
    message: buildMessage(ops, missing + extra + wrong),
  };
}

/**
 * 一句话诊断。
 *
 * **只有一处差异时给精确位置**——PRD 2.7 要的就是「第 8 个字母漏了」这种说法；
 * 多处差异退回汇总，因为「第 3、7、11 个字母都错了」读起来比错本身还费劲。
 */
function buildMessage(ops: CharOp[], total: number): string {
  if (total === 0) return "拼对了";

  if (total === 1) {
    const idx = ops.findIndex((o) => o.type !== "keep");
    // total > 0 保证了这里一定找得到，断言只是把这个事实告诉类型系统
    const op = ops[idx] as Exclude<CharOp, { type: "keep" }>;
    const pos = positionInExpected(ops, idx);
    if (op.type === "missing") return `第 ${pos} 个字母漏了`;
    if (op.type === "sub") {
      return `第 ${pos} 个字母写成了「${op.typed}」，应该是「${op.expected}」`;
    }
    return `第 ${pos} 个位置多敲了「${op.typed}」`;
  }

  const missing = ops.filter((o) => o.type === "missing").length;
  const extra = ops.filter((o) => o.type === "extra").length;
  const wrong = ops.filter((o) => o.type === "sub").length;
  const parts: string[] = [];
  if (missing) parts.push(`漏了 ${missing} 个`);
  if (extra) parts.push(`多了 ${extra} 个`);
  if (wrong) parts.push(`写错 ${wrong} 个`);
  return `${parts.join("、")}字母`;
}

/**
 * 某个槽位在**正确词**里的位次（1-based）。
 *
 * 对 `extra` 来说没有对应的正确字符，它拿到的是「插在第几个位置」。
 */
function positionInExpected(ops: CharOp[], idx: number): number {
  let before = 0;
  for (let k = 0; k < idx; k++) {
    if (ops[k].type !== "extra") before += 1;
  }
  return before + 1;
}
