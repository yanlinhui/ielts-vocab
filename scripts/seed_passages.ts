/**
 * 把 content/passages/*.md 灌进 Passage 表。
 *
 * 幂等：每章先删光再按顺序重插——这样一章从 3 篇改成 2 篇时，多出来的那篇
 * 会跟着消失，不会留下孤儿。
 *
 * 单独跑：npm run db:seed:passages
 * 也由 prisma/seed.ts 调用，所以 migrate reset 之后一次灌全。
 */
import { PrismaClient } from "@prisma/client";
import { readPassageFiles } from "../scripts/lib/passage-files";

export async function seedPassages(prisma: PrismaClient) {
  const files = readPassageFiles();
  const units = await prisma.unit.findMany({
    select: { id: true, chapterNo: true, name: true },
  });
  const byChapter = new Map(units.map((u) => [u.chapterNo, u]));

  let total = 0;
  for (const f of files) {
    const unit = byChapter.get(f.chapterNo);
    if (!unit) {
      console.warn(`  ! ${f.file}: 数据库里没有第 ${f.chapterNo} 章，跳过`);
      continue;
    }
    if (f.passages.length === 0) {
      console.warn(`  ! ${f.file}: 没解析出任何一篇，跳过`);
      continue;
    }

    await prisma.$transaction([
      prisma.passage.deleteMany({ where: { unitId: unit.id } }),
      prisma.passage.createMany({
        data: f.passages.map((p, i) => ({
          unitId: unit.id,
          orderInUnit: i + 1,
          title: p.title,
          body: p.body,
          wordCount: new Set(p.tags).size,
        })),
      }),
    ]);

    total += f.passages.length;
    console.log(`  第 ${f.chapterNo} 章 ${unit.name}：${f.passages.length} 篇`);
  }

  console.log(`短文灌入完成，共 ${total} 篇`);
}

const invokedDirectly = process.argv[1]
  ?.replace(/\\/g, "/")
  .endsWith("scripts/seed_passages.ts");

if (invokedDirectly) {
  const prisma = new PrismaClient();
  seedPassages(prisma)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
