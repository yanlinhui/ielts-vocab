// 把「词条尾部粘页码」的修复写回数据库。
//
// 配套：`scripts/fix_notes.py` 修词表，这里修库，共用同一份差异清单
// `data/notes-changes.json`（由新旧两次 build_vocab.py 产物对比得出）。
//
// 为什么不重灌库：seed.ts 会清空 UserWordProgress / ReviewLog，重灌会连学习
// 进度一起冲掉。这里只更新 cultureNote 一个字段。
//
// 幂等：只在当前值恰好等于清单里的 old 时才写。
//
// 用法：npx tsx scripts/update_notes_db.ts          （干跑，只看不动）
//       npx tsx scripts/update_notes_db.ts --write  （真写）
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const CHANGES = path.join(process.cwd(), "data", "notes-changes.json");

type Change = { chapterNo: number; headword: string; old: string; new: string };

async function main() {
  const write = process.argv.includes("--write");
  const changes = JSON.parse(readFileSync(CHANGES, "utf-8")) as Change[];

  // 同章重名词（`papaya` 正文排一次、插图再排一次）会有多条，不能压成单值
  const byKey = new Map<string, Change[]>();
  for (const c of changes) {
    const k = `${c.chapterNo}|${c.headword.toLowerCase()}`;
    const arr = byKey.get(k);
    if (arr) arr.push(c);
    else byKey.set(k, [c]);
  }
  console.log(`差异清单：${changes.length} 条，涉及 ${byKey.size} 个词`);

  const rows = await prisma.word.findMany({
    select: { id: true, headword: true, cultureNote: true, unit: { select: { chapterNo: true } } },
  });
  console.log(`库中词条：${rows.length}`);

  let updated = 0;
  const skipped: string[] = [];
  for (const r of rows) {
    const cs = byKey.get(`${r.unit.chapterNo}|${r.headword.toLowerCase()}`);
    if (!cs) continue;

    const cur = r.cultureNote ?? "";
    if (cs.some((c) => c.new === cur)) continue; // 已经是修好的值
    const hit = cs.find((c) => c.old === cur);
    // 库值既不是旧值也不是新值 → 被别的流程改过，别硬覆盖
    if (!hit) {
      skipped.push(`${r.headword}：库值 …${JSON.stringify(cur.slice(-20))}`);
      continue;
    }

    if (write) {
      await prisma.word.update({
        where: { id: r.id },
        data: { cultureNote: hit.new || null }, // 空串按 seed 的约定存 NULL
      });
    }
    updated++;
  }

  console.log(`${write ? "" : "[干跑] "}更新 ${updated} 行，跳过 ${skipped.length} 行`);
  skipped.forEach((s) => console.log("   跳过：", s));
  if (!write) console.log("\n加 --write 真写。");
}

main().finally(() => prisma.$disconnect());
