/**
 * 短文覆盖率校验。
 *
 * 拓展阅读的硬要求是「这一章的词都覆盖到」，84 篇靠眼睛查漏不可能，
 * 所以把判据落成脚本：从 content/passages/*.md 里抽出 {{word}} 标记，
 * 和数据库里这一章的词表比对，报缺词和越界词。
 *
 * 判据落在**章**上，不落在篇上：一章可能拆成好几篇，分篇之间怎么分配词是
 * 写作的自由，但这一章的词必须被某篇标到。所以「第 4 章」两篇合起来覆盖
 * 73 词即算通过。
 *
 * 有不覆盖就非零退出——将来接进 CI 或提交前检查都靠这个退出码。
 */
import { PrismaClient } from "@prisma/client";
import { readPassageFiles, plainText } from "./lib/passage-files";

const prisma = new PrismaClient();

/**
 * 明确不覆盖的词（按章号）。
 *
 * PRD 2.8 写的是「允许缺 2~3 个生僻词，脚本会把缺的词列出来，接不接受由人
 * 判断」——这张表就是那个「人判断」的落点，判断的结果得写在代码里、有据可查，
 * 不能靠每次跑脚本时临时决定。词表里少数条目是 OCR 或词典带进来的脏数据
 * （第 3 章的 `the Beast` 释义是「阿特拉斯火箭」、`Coul` 是 `cowl` 的错拼），
 * 为它们硬造一个句子比少标一个词更亏。每一条都必须写明理由。
 */
const KNOWN_MISSING: Record<number, string[]> = {
  3: ["the Beast", "Coul"],
  12: ["MLK"],
  17: ["ine"],
  18: ["BOOMIE"],
  21: ["Harvey", "uss"],
};

async function main() {
  const files = readPassageFiles();
  if (files.length === 0) {
    console.error(`content/passages 下没有 chapter-NN.md`);
    process.exit(1);
  }

  const units = await prisma.unit.findMany({
    select: { chapterNo: true, name: true, words: { select: { headword: true } } },
  });
  const byChapter = new Map(units.map((u) => [u.chapterNo, u]));

  let failed = 0;

  for (const f of files) {
    const unit = byChapter.get(f.chapterNo);
    if (!unit) {
      console.error(`✗ ${f.file}: 数据库里没有第 ${f.chapterNo} 章`);
      failed++;
      continue;
    }
    if (f.passages.length === 0) {
      console.error(`✗ ${f.file}: 没解析出任何一篇（检查 "# 标题" 与 "---" 分隔）`);
      failed++;
      continue;
    }

    // 比对走小写：正文里把 `GAS STATION` 写成 `gas station`、把 `June` 写成
    // `june` 都是自然的写法，卡大小写只会逼出难看的正文。报缺词时给回原样。
    const known = new Map(unit.words.map((w) => [w.headword.toLowerCase(), w.headword]));
    const allowed = new Set(
      (KNOWN_MISSING[f.chapterNo] ?? []).map((w) => w.toLowerCase()),
    );
    const marked = new Set<string>();
    const outside = new Set<string>();

    console.log(`\n第 ${f.chapterNo} 章 ${unit.name} —— ${f.passages.length} 篇`);
    for (const [i, p] of f.passages.entries()) {
      const distinct = new Set(p.tags);
      for (const t of distinct) {
        const k = t.toLowerCase();
        if (known.has(k)) marked.add(k);
        else outside.add(t);
      }
      const chars = plainText(p.body).replace(/\s/g, "").length;
      console.log(
        `  ${i + 1}. ${p.title}，标记 ${p.tags.length} 处 / ${distinct.size} 词，正文 ${chars} 字`,
      );
    }

    const missing = [...known]
      .filter(([k]) => !marked.has(k) && !allowed.has(k))
      .map(([, v]) => v);
    const skipped = [...known]
      .filter(([k]) => !marked.has(k) && allowed.has(k))
      .map(([, v]) => v);
    const covered = known.size - missing.length - skipped.length;
    console.log(
      `  合计覆盖 ${covered}/${known.size}（${((covered / known.size) * 100).toFixed(1)}%）`,
    );
    if (skipped.length) {
      console.log(`  · 白名单跳过 ${skipped.length} 个: ${skipped.join(", ")}`);
    }

    if (missing.length) {
      console.error(`  ✗ 没覆盖: ${missing.join(", ")}`);
      failed++;
    }
    if (outside.size) {
      console.error(`  ✗ 标记了不属于本章的词: ${[...outside].join(", ")}`);
      failed++;
    }
    if (!missing.length && !outside.size) console.log(`  ✓`);
  }

  console.log(failed ? `\n${failed} 个文件未通过` : `\n全部通过`);
  process.exit(failed ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
