import StudySession from "@/components/StudySession";
import { prisma } from "@/lib/db";
import { buildSession } from "@/lib/session";
import { FORGETFUL_LIMIT, getForgetfulWords } from "@/lib/stats";
import type { Accent } from "@/lib/tts";
import { getCurrentUser } from "@/lib/user";

// 队列每次进入都重算——进度是实时变的，不能缓存
export const dynamic = "force-dynamic";

/**
 * 学习页。三种进法共用这一个组件，靠 query 参数分：
 *
 * - `/study`           每日动线（配额 + 到期，见 `buildSession`）
 * - `/study?unit=N`    章节专项
 * - `/study?weak=1`    错词本
 *
 * 错词本**不把 wordId 列表塞进 URL**：那样地址会长得没法看，而且名单一变地址
 * 就失效。这里拿着 `weak` 现去问统计页那份排序要人（同一个 `getForgetfulWords`、
 * 同一个 `FORGETFUL_LIMIT`），摘出 `wordId` 交给 `buildSession` 的 `wordIds`。
 * 排序口径只此一份，错词本不重新发明。
 */
export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; weak?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  const accent: Accent = settings?.accent === "us" ? "us" : "uk";

  const unitId = params.unit ? Number(params.unit) : undefined;
  const validUnitId = unitId && Number.isInteger(unitId) ? unitId : undefined;

  // ⚠️ `unit` 优先：两个参数同时出现时（`?unit=3&weak=1`）按章节走。不然一条被
  // 手改过的地址会在两种模式间摇摆，而页面上没有任何东西能提示用户现在是哪种。
  const weak = !validUnitId && Boolean(params.weak);

  // 名单要先拿到才能建队列，这两步是依赖关系、不是能并行的工作
  const weakIds = weak
    ? (await getForgetfulWords(user.id, FORGETFUL_LIMIT)).map((w) => w.wordId)
    : null;

  // 章节模式下顺便把章名取出来——队列里只有「还没学过的词」，整章学完时队列是
  // 空的，没有词卡可看，那个空状态得靠这里拿到的章名才说得清是「哪一章学完了」。
  const [queue, unit] = await Promise.all([
    weakIds
      ? buildSession(user.id, { wordIds: weakIds })
      : buildSession(user.id, validUnitId ? { unitId: validUnitId } : {}),
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
      weak={weak}
    />
  );
}
