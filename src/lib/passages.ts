/**
 * 拓展阅读正文的解析。
 *
 * 正文存在 `Passage.body` 里，该章的词用 `{{headword}}` 包住。渲染时把它切成
 * 一段段 token：普通文字原样输出，标记的部分变成能点、能藏中文的词块。
 *
 * **解析放在服务端**（这里是 server-only 的纯函数），客户端组件只拿现成的结构
 * 做交互——`{{}}` 的语法只在这一个文件里认，将来改语法不用动组件。
 */

/** 词块上一格：普通文字，或者一个标记过的词 */
export type Token =
  | { t: "text"; v: string }
  | { t: "word"; v: string; cn: string };

/** 成段的 token。正文按空行分段，段落之间才有 `<p>` 的间距 */
export type Block = Token[];

/** 标记里的词。允许连字符（up-to-date 这种） */
const TAG = /\{\{([a-zA-Z][a-zA-Z-]*)\}\}/g;

/**
 * 词块上要显示的中文。
 *
 * 取 ECDICT 的 `meaningCn` 而**不是** `bookMeaning`：后者是书中原话、受版权
 * 保护，而这一页是要给人读的（甚至可能给朋友看），用词典释义不新增暴露面。
 *
 * 原始值形如 `n. 银河, 星系, 一群(显赫的人物)\n[电] 银河系`——只取第一行，
 * 去掉开头的词性（词性在别处另有位置，这里再写一遍是重复）。
 */
export function shortMeaning(meaningCn: string): string {
  return meaningCn.split("\n")[0].trim().replace(/^[a-z]+\.\s*/, "");
}

/**
 * 把正文拆成段落 × token。
 *
 * `meaningOf` 由调用方给：它负责把 headword 查成中文，查不到就给空串——
 * 词块照常渲染，只是点开没东西，不报错（同学习页「字段缺了不显示占位符」）。
 */
export function toParagraphs(
  body: string,
  meaningOf: (headword: string) => string,
): Block[] {
  return body
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .map((para) => {
      const tokens: Block = [];
      let last = 0;
      // 每个段落重新起一个正则：TAG 带 g 标志，exec 会在 lastIndex 上记状态
      const re = new RegExp(TAG.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(para)) !== null) {
        if (m.index > last) tokens.push({ t: "text", v: para.slice(last, m.index) });
        tokens.push({ t: "word", v: m[1], cn: meaningOf(m[1]) });
        last = m.index + m[0].length;
      }
      if (last < para.length) tokens.push({ t: "text", v: para.slice(last) });
      return tokens;
    });
}
