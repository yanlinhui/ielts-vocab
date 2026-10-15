// 校验 update_spacing_db.ts 的落库结果：进度数据是否完好、旧文本是否清干净。
// 只读，不改任何数据。用法：npx tsx scripts/verify_spacing_db.ts
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const CHANGES = path.join(process.cwd(), "data", "spacing-changes.json");

async function main() {
  const [users, progress, logs, units, words, examples] = await Promise.all([
    prisma.user.count(),
    prisma.userWordProgress.count(),
    prisma.reviewLog.count(),
    prisma.unit.count(),
    prisma.word.count(),
    prisma.wordExample.count(),
  ]);
  console.log("表行数", { users, progress, logs, units, words, examples });

  const me = await prisma.user.findFirst({ select: { name: true, createdAt: true } });
  console.log("用户", me);

  const rows = await prisma.userWordProgress.findMany({
    select: { word: { select: { headword: true } }, state: true, reps: true, dueAt: true },
    orderBy: { id: "asc" },
  });
  console.log("进度行", rows.map((r) => `${r.word.headword}/${r.state}/reps=${r.reps}`).join("  "));

  const changes = JSON.parse(readFileSync(CHANGES, "utf-8")) as { old: string; new: string }[];
  const oldSet = new Set(changes.map((c) => c.old));

  const w = await prisma.word.findMany({
    select: { headword: true, collocation: true, derived: true, etymology: true },
  });
  const leftWords = w.filter(
    (x) => oldSet.has(x.collocation ?? "") || oldSet.has(x.derived ?? "") || oldSet.has(x.etymology ?? "")
  );
  const ex = await prisma.wordExample.findMany({ select: { en: true } });
  const leftEx = ex.filter((x) => oldSet.has(x.en));

  console.log(`旧文本残留：Word ${leftWords.length} 条，WordExample ${leftEx.length} 条`);
  for (const s of [...leftWords.map((x) => x.headword), ...leftEx.map((x) => x.en)].slice(0, 5)) {
    console.log("  残留样例：", s);
  }

  console.log("--- 修复后抽样 ---");
  for (const kw of ["examination created", "of spring", "was not", "in spite of"]) {
    const hit = await prisma.wordExample.findFirst({
      where: { en: { contains: kw } },
      select: { en: true },
    });
    console.log(`  [${kw}] ${hit ? hit.en : "(无命中)"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
