import StudySession from "@/components/StudySession";
import { prisma } from "@/lib/db";
import { buildSession } from "@/lib/session";
import type { Accent } from "@/lib/tts";
import { getCurrentUser } from "@/lib/user";

// 队列每次进入都重算——进度是实时变的，不能缓存
export const dynamic = "force-dynamic";

export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  const accent: Accent = settings?.accent === "us" ? "us" : "uk";

  const unitId = params.unit ? Number(params.unit) : undefined;
  const validUnitId = unitId && Number.isInteger(unitId) ? unitId : undefined;

  // 章节模式下顺便把章名取出来——队列里只有「还没学过的词」，整章学完时队列是
  // 空的，没有词卡可看，那个空状态得靠这里拿到的章名才说得清是「哪一章学完了」。
  const [queue, unit] = await Promise.all([
    buildSession(user.id, validUnitId ? { unitId: validUnitId } : {}),
    validUnitId
      ? prisma.unit.findUnique({
          where: { id: validUnitId },
          select: { chapterNo: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <StudySession
      initialQueue={queue}
      accent={accent}
      initialAutoSpeak={settings?.autoSpeak ?? true}
      unit={unit}
    />
  );
}
