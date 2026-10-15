/**
 * 把提取出来的词表灌进数据库。
 *
 * 输入：data/words.clean.json（提取流水线的最终产物，见 docs/tech-spec.md 7.x）
 *
 * **必须过滤 verified == false 的词。** 那批是「词典和索引都查不到、也不像
 * 被并成一行」的可疑词（实测 14 条），多半是 OCR 认错了几个字母。它们没有
 * 可信的释义和音标，灌进去只会让用户在卡片上看到乱码。宁可少几个词。
 *
 * 用法：
 *   npx prisma db seed        （package.json 里的 npm run db:seed 等价）
 *   npx prisma db seed -- --user 小明     指定用户名，默认 "me"
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

const ROOT = resolve(__dirname, "..");
const SOURCE = resolve(ROOT, "data/words.clean.json");

/** 词表 JSON 里一条词的形状 */
interface RawWord {
  headword: string;
  phonetic?: string;
  meaning?: string; // 书中原话的释义行，如 "n.大气层，大气圈"
  meaningCn: string; // ECDICT 的中文释义
  tags?: string;
  bnc?: number | null;
  frq?: number | null;
  page?: number;
  orderInUnit: number;
  collocation?: string;
  derived?: string;
  etymology?: string;
  note?: string;
  examples?: { en: string; cn?: string }[];
  verified?: boolean;
}

interface RawChapter {
  chapterNo: number;
  name: string;
  startPage?: number;
  words: RawWord[];
}

/** 从「n.大气层，大气圈」这样的释义行里把词性抠出来。
 *
 * 这行的开头是构建流水线规范化过的（见 build_vocab.POS_PREFIX_RE），
 * 所以只需匹配开头的词性串，遇到中文就停。
 */
const POS_RE =
  /^\s*((?:(?:nn|n|vt|vi|v|adj|adv|a|ad|prep|conj|pron|num|art|int|aux|abbr|pl)\s*[.、,，/|]?\s*)+)/i;

function extractPos(bookMeaning?: string): string | null {
  if (!bookMeaning) return null;
  const m = POS_RE.exec(bookMeaning);
  if (!m) return null;
  // 把 "n./v." 这种连写规整成 "n. v."，读起来清楚些
  const pos = m[1]
    .replace(/[、,，/|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return pos || null;
}

/** 空字符串统一转成 null，免得数据库里混着 "" 和 null 两种「没有值」。 */
function orNull(s?: string): string | null {
  const t = (s ?? "").trim();
  return t ? t : null;
}

async function main() {
  const userName = process.argv[2] ?? "me";

  const raw = JSON.parse(readFileSync(SOURCE, "utf-8")) as {
    chapters: RawChapter[];
  };

  const totalRaw = raw.chapters.reduce((n, c) => n + c.words.length, 0);
  const kept = raw.chapters.flatMap((c) =>
    c.words.filter((w) => w.verified !== false),
  ).length;
  console.log(`读入 ${totalRaw} 条词，过滤未校验的 ${totalRaw - kept} 条，灌入 ${kept} 条`);

  // 重灌前清空——保证这个脚本可以反复跑，结果一致。
  // Word / Unit / UserWordProgress 之间有级联删除，删 User 会带走进度和流水。
  await prisma.wordExample.deleteMany();
  await prisma.reviewLog.deleteMany();
  await prisma.userWordProgress.deleteMany();
  await prisma.word.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.user.deleteMany();

  let wordCount = 0;
  let exampleCount = 0;

  for (const ch of raw.chapters) {
    const words = ch.words.filter((w) => w.verified !== false);
    if (!words.length) continue;

    const unit = await prisma.unit.create({
      data: {
        chapterNo: ch.chapterNo,
        name: ch.name,
        startPage: ch.startPage ?? null,
      },
    });

    // 先整批插词（一条 INSERT），再回查 id 建例句——
    // 用嵌套 create 的话会变成几千条单行 insert，慢很多。
    const rows: Prisma.WordCreateManyInput[] = words.map((w, i) => ({
      headword: w.headword,
      phonetic: orNull(w.phonetic),
      pos: extractPos(w.meaning),
      meaningCn: w.meaningCn ?? "",
      tags: orNull(w.tags),
      bncRank: w.bnc ?? null,
      frqRank: w.frq ?? null,
      unitId: unit.id,
      orderInUnit: i + 1, // 重新编号，避免源数据里的空洞
      page: w.page ?? null,
      bookMeaning: orNull(w.meaning),
      collocation: orNull(w.collocation),
      derived: orNull(w.derived),
      etymology: orNull(w.etymology),
      cultureNote: orNull(w.note),
    }));
    await prisma.word.createMany({ data: rows });
    wordCount += rows.length;

    // 例句要 wordId，按 orderInUnit 回查一次
    const created = await prisma.word.findMany({
      where: { unitId: unit.id },
      select: { id: true, orderInUnit: true },
    });
    const idByOrder = new Map(created.map((w) => [w.orderInUnit, w.id]));

    const examples: Prisma.WordExampleCreateManyInput[] = [];
    words.forEach((w, i) => {
      const wordId = idByOrder.get(i + 1);
      if (!wordId) return;
      (w.examples ?? []).forEach((ex, k) => {
        if (!ex.en?.trim()) return;
        examples.push({
          wordId,
          en: ex.en.trim(),
          cn: orNull(ex.cn),
          orderIndex: k,
        });
      });
    });
    if (examples.length) {
      await prisma.wordExample.createMany({ data: examples });
      exampleCount += examples.length;
    }
  }

  const unitCount = await prisma.unit.count();

  // 默认用户 + 默认设置。多用户就多建几个 User，词库共用。
  await prisma.user.create({
    data: {
      name: userName,
      settings: { create: { dailyNewLimit: 20, dailyReviewLimit: 200 } },
    },
  });

  console.log(`灌入 ${unitCount} 个单元、${wordCount} 条词、${exampleCount} 条例句`);
  console.log(`默认用户：「${userName}」`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
