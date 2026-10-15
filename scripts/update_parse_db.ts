// 把「解析层改进」带来的字段修复写回数据库。
//
// 配套：`scripts/apply_parse_changes.py` 修词表，这里修库。
//
// **目标值取自 `data/words.clean.json`，不是 `data/parse-changes.json` 里的 new。**
// 因为 clean.json 是 parse-changes 应用之后、又跑过 fix_spacing.py 的产物：那四个
// 英文内容字段（examples / collocation / derived / etymology）在 clean 里已经补过
// 词间空格，而 parse-changes 记的 new 还是 raw 状态（`betrayasecret`）。直接写 raw
// new 会把库里的例句、搭配从「已修好」退回「粘连」。parse-changes 这里只用来确定
// 「哪些词条、哪些字段需要更新」。
//
// 为什么不重灌库：seed.ts 会先清空 UserWordProgress / ReviewLog / Word / Unit /
// User，重灌会连学习进度一起冲掉。这里只更新词条自身的字段，进度一行不动。
//
// 字段映射（与 seed.ts 一致）：
//     JSON meaning      → Word.bookMeaning + Word.pos（经 extractPos）
//     JSON note         → Word.cultureNote
//     JSON collocation  → Word.collocation
//     JSON derived      → Word.derived
//     JSON etymology    → Word.etymology
//     JSON examples     → WordExample 表（en / cn / orderIndex）
//
// 幂等：库值已等于 clean 里的目标值就跳过，重复跑无副作用。
// 本次 examples 只会「变多」或「同数量改文本」，不会变少，所以不删行；真遇到
// 库里的例句比目标多（理论上不该发生），只报告不动手。
//
// 用法：npx tsx scripts/update_parse_db.ts          （干跑，只看不动）
//       npx tsx scripts/update_parse_db.ts --write  （真写）
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const CHANGES = path.join(process.cwd(), "data", "parse-changes.json");
const CLEAN = path.join(process.cwd(), "data", "words.clean.json");

type Change = { chapterNo: number; headword: string; field: string };
type Ex = { en: string; cn: string };
type CleanWord = Record<string, unknown> & { headword: string };
type CleanChapter = { chapterNo: number; words: CleanWord[] };

// JSON 字段名 → 库字段名（meaning 落到 bookMeaning，note 落到 cultureNote）
const FIELD_MAP: Record<string, string> = {
  meaning: "bookMeaning",
  note: "cultureNote",
  collocation: "collocation",
  derived: "derived",
  etymology: "etymology",
};

// 与 prisma/seed.ts 保持一致的词性提取
const POS_RE =
  /^\s*((?:(?:nn|n|vt|vi|v|adj|adv|a|ad|prep|conj|pron|num|art|int|aux|abbr|pl)\s*[.、,，/|]?\s*)+)/i;

function extractPos(bookMeaning?: string): string | null {
  if (!bookMeaning) return null;
  const m = POS_RE.exec(bookMeaning);
  if (!m) return null;
  return m[1].replace(/[、,，/|]/g, " ").replace(/\s+/g, " ").trim() || null;
}

/** 空字符串统一转成 null，和 seed.ts 的约定一致。 */
function orNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

/** 把 examples 归一化：丢掉空 en，cn 缺失当空串。 */
function normEx(v: unknown): Ex[] {
  if (!Array.isArray(v)) return [];
  return (v as { en?: string; cn?: string }[])
    .filter((ex) => ex?.en?.trim())
    .map((ex) => ({ en: ex.en!.trim(), cn: (ex.cn ?? "").trim() }));
}

const sameEx = (a: Ex[], b: Ex[]) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const write = process.argv.includes("--write");
  const changes = JSON.parse(readFileSync(CHANGES, "utf-8")) as Change[];
  const clean = JSON.parse(readFileSync(CLEAN, "utf-8")) as { chapters: CleanChapter[] };

  // 要改的 (chapterNo|headword) → 字段集合
  const want = new Map<string, Set<string>>();
  for (const c of changes) {
    const k = `${c.chapterNo}|${c.headword.toLowerCase()}`;
    const s = want.get(k);
    if (s) s.add(c.field);
    else want.set(k, new Set([c.field]));
  }
  console.log(`差异清单：${changes.length} 条，涉及 ${want.size} 个词`);

  // clean.json 索引（同章重名词会有多个，取第一个——变更清单本身按 headword 聚合）
  const cleanIdx = new Map<string, CleanWord[]>();
  for (const ch of clean.chapters) {
    for (const w of ch.words) {
      const k = `${ch.chapterNo}|${w.headword.toLowerCase()}`;
      const arr = cleanIdx.get(k);
      if (arr) arr.push(w);
      else cleanIdx.set(k, [w]);
    }
  }

  const rows = await prisma.word.findMany({
    select: {
      id: true,
      headword: true,
      bookMeaning: true,
      pos: true,
      cultureNote: true,
      collocation: true,
      derived: true,
      etymology: true,
      unit: { select: { chapterNo: true } },
    },
  });
  // 例句表单独查：嵌套 select 里带 orderBy 会让 Prisma 6.19 的查询引擎 panic
  // （`no entry found for key`，record.rs:69），拆开就没事。
  const exRows = await prisma.wordExample.findMany({
    select: { id: true, wordId: true, en: true, cn: true, orderIndex: true },
    orderBy: { orderIndex: "asc" },
  });
  const exByWord = new Map<number, typeof exRows>();
  for (const e of exRows) {
    const arr = exByWord.get(e.wordId);
    if (arr) arr.push(e);
    else exByWord.set(e.wordId, [e]);
  }
  console.log(`库中词条：${rows.length}，例句：${exRows.length}`);

  let wordsUpdated = 0;
  let fieldsChanged = 0;
  const skipped: string[] = [];

  for (const r of rows) {
    const key = `${r.unit.chapterNo}|${r.headword.toLowerCase()}`;
    const fields = want.get(key);
    if (!fields) continue;
    const cw = cleanIdx.get(key)?.[0];
    if (!cw) {
      skipped.push(`${r.headword}：clean.json 里找不到对应词条`);
      continue;
    }

    const data: Record<string, string | null> = {};
    const exOps: { kind: "update" | "create"; id?: number; index: number; ex: Ex }[] = [];
    const dbEx = exByWord.get(r.id) ?? [];

    for (const f of fields) {
      if (f === "examples") {
        const target = normEx(cw.examples);
        const cur = dbEx.map((e) => ({ en: e.en.trim(), cn: (e.cn ?? "").trim() }));
        if (sameEx(cur, target)) continue;
        fieldsChanged++;
        target.forEach((ex, i) => {
          if (i < dbEx.length) exOps.push({ kind: "update", id: dbEx[i].id, index: i, ex });
          else exOps.push({ kind: "create", index: i, ex });
        });
        if (dbEx.length > target.length) {
          skipped.push(`${r.headword}：库中例句 ${dbEx.length} 条 > 目标 ${target.length} 条，多出的不动`);
        }
        continue;
      }

      const dbField = FIELD_MAP[f];
      const target = String(cw[f] ?? "");
      const cur = String((r as unknown as Record<string, unknown>)[dbField] ?? "");

      if (f === "meaning") {
        // meaning 同时决定 bookMeaning 和 pos，两个都对上才算已是新值
        if (cur.trim() === target.trim() && (r.pos ?? "") === (extractPos(target) ?? "")) continue;
        data.bookMeaning = orNull(target);
        data.pos = extractPos(target);
      } else if (f === "note") {
        if (cur.trim() === target.trim()) continue;
        data.cultureNote = orNull(target);
      } else {
        if (cur.trim() === target.trim()) continue;
        data[dbField] = orNull(target);
      }
      fieldsChanged++;
    }

    if (Object.keys(data).length || exOps.length) {
      if (write) {
        if (Object.keys(data).length) {
          await prisma.word.update({ where: { id: r.id }, data });
        }
        for (const op of exOps) {
          if (op.kind === "update" && op.id != null) {
            await prisma.wordExample.update({
              where: { id: op.id },
              data: { en: op.ex.en, cn: orNull(op.ex.cn) },
            });
          } else {
            await prisma.wordExample.create({
              data: { wordId: r.id, en: op.ex.en, cn: orNull(op.ex.cn), orderIndex: op.index },
            });
          }
        }
      }
      wordsUpdated++;
    }
  }

  console.log(
    `${write ? "" : "[干跑] "}更新 ${wordsUpdated} 个词 / ${fieldsChanged} 处字段，跳过 ${skipped.length} 处`
  );
  skipped.forEach((s) => console.log("   跳过：", s));
  if (!write) console.log("\n加 --write 真写。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
