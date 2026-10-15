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
  const queue = await buildSession(
    user.id,
    unitId && Number.isInteger(unitId) ? { unitId } : {},
  );

  return (
    <StudySession
      initialQueue={queue}
      accent={accent}
      autoSpeak={settings?.autoSpeak ?? false}
    />
  );
}
