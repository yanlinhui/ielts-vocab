// 把 fix_spacing.py 算出的粘连修复结果原地写回数据库。
//
// 为什么不重灌库：prisma/seed.ts 会先清空 UserWordProgress / ReviewLog / Word /
// Unit / User，重灌会连学习进度一起冲掉。这里只做字符串原地替换，
// 进度、流水、用户全部保留。
//
// 用法：npx tsx scripts/update_spacing_db.ts
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const CHANGES = path.join(process.cwd(), "data", "spacing-changes.json");
const TEXT_FIELDS = ["collocation", "derived", "etymology"] as const;
const BATCH = 500;

type Change = { old: string; new: string };

async function main() {
  const table = new Map(
    (JSON.parse(readFileSync(CHANGES, "utf-8")) as Change[]).map((c) => [c.old, c.new])
  );
  console.log(`替换表：${table.size} 条`);

  const words = await prisma.word.findMany({
    select: { id: true, collocation: true, derived: true, etymology: true },
  });
  const wordOps = [];
  for (const w of words) {
    const data: Record<string, string> = {};
    for (const f of TEXT_FIELDS) {
      const v = w[f];
      const nv = v ? table.get(v) : undefined;
      if (nv !== undefined) data[f] = nv;
    }
    if (Object.keys(data).length) {
      wordOps.push(prisma.word.update({ where: { id: w.id }, data }));
    }
  }

  const exs = await prisma.wordExample.findMany({ select: { id: true, en: true } });
  const exOps = [];
  for (const e of exs) {
    const nv = table.get(e.en);
    if (nv !== undefined) {
      exOps.push(prisma.wordExample.update({ where: { id: e.id }, data: { en: nv } }));
    }
  }

  console.log(`待更新：Word ${wordOps.length} 条，WordExample ${exOps.length} 条`);

  const all = [...wordOps, ...exOps];
  for (let i = 0; i < all.length; i += BATCH) {
    await prisma.$transaction(all.slice(i, i + BATCH));
  }

  console.log(`完成：共更新 ${all.length} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
