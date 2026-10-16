import StudySession from "@/components/StudySession";
import { prisma } from "@/lib/db";
import { buildSession, type BuildSessionOptions } from "@/lib/session";
import { FORGETFUL_LIMIT, getForgetfulWords } from "@/lib/stats";
import type { Accent } from "@/lib/tts";
import { getCurrentUser } from "@/lib/user";

// 队列每次进入都重算——进度是实时变的，不能缓存
export const dynamic = "force-dynamic";

/**
 * 学习页。四种进法共用这一个组件，靠 query 参数分：
 *
 * - `/study`              每日动线（配额 + 到期，见 `buildSession`）
 * - `/study?unit=N`       章节专项
 * - `/study?weak=1`       错词本
 * - `/study?spell=1`      拼写（可叠加 `unit`：`?unit=3&spell=1` = 拼第 3 章）
 *
 * 错词本**不把 wordId 列表塞进 URL**：那样地址会长得没法看，而且名单一变地址
 * 就失效。这里拿着 `weak` 现去问统计页那份排序要人（同一个 `getForgetfulWords`、
 * 同一个 `FORGETFUL_LIMIT`），摘出 `wordId` 交给 `buildSession` 的 `wordIds`。
 * 排序口径只此一份，错词本不重新发明。
 *
 * 拼写反过来——它的范围就是「学过的词」，不用外部名单，`buildSession` 自己查得到，
 * 所以 URL 上只需要一个开关和一个可选的 `unit`。
 */
export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; weak?: string; spell?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  const accent: Accent = settings?.accent === "us" ? "us" : "uk";

  const unitId = params.unit ? Number(params.unit) : undefined;
  const validUnitId = unitId && Number.isInteger(unitId) ? unitId : undefined;

  // 优先级 spell > unit > weak，三个同时出现只会发生在手改地址的时候。定死一个
  // 顺序而不是让它摇摆，是因为页面上没有任何东西能提示「现在其实是哪种模式」。
  //
  // ⚠️ `unit` 优先于 `weak` 是上一轮加的（`?unit=3&weak=1` 按章节走）。`spell` 又
  // 排在 `unit` 前面——因为拼写**也用** `unit`，只是含义不同：拼写要的是「这一章
  // 里学过的」，章节专项要的是「这一章里还没学过的」。两者由 `buildSession` 内部
  // 的分岔顺序区分开。
  const spell = Boolean(params.spell);
  const weak = !spell && !validUnitId && Boolean(params.weak);

  // 名单要先拿到才能建队列，这两步是依赖关系、不是能并行的工作
  const weakIds = weak
    ? (await getForgetfulWords(user.id, FORGETFUL_LIMIT)).map((w) => w.wordId)
    : null;

  // 四种进法收成一份 options 再传——直接摊在调用处就是三层嵌套三元，再加一种
  // 就没法读了。
  const opts: BuildSessionOptions = spell
    ? { spell: true, unitId: validUnitId }
    : weakIds
      ? { wordIds: weakIds }
      : validUnitId
        ? { unitId: validUnitId }
        : {};

  // 章节模式下顺便把章名取出来——队列里只有「还没学过的词」，整章学完时队列是
  // 空的，没有词卡可看，那个空状态得靠这里拿到的章名才说得清是「哪一章学完了」。
  // 拼写模式也要它：那一章一个学过的词都没有时，空态得说「第 N 章还没有学过的词」。
  const [queue, unit] = await Promise.all([
    buildSession(user.id, opts),
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
      spell={spell}
    />
  );
}
