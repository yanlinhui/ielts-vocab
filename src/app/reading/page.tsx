import Link from "next/link";
import PassageReader from "@/components/PassageReader";
import { prisma } from "@/lib/db";
import { shortMeaning, toParagraphs } from "@/lib/passages";

export const dynamic = "force-dynamic";

/**
 * 拓展阅读（PRD 2.8）：按章读一篇短文，把这一章的词放回句子里。
 *
 * 这一页是**唯一一个和进度无关的学习页**——不读 `UserWordProgress`、不写库、
 * 不吃配额，谁都能看，什么时候看都一样。所以它是 server component 里最单纯的
 * 一个：查短文、查词义、切 token，交给客户端组件管「中文藏不藏」。
 *
 * 入口是桌面侧栏第六项（窄屏顶栏放不下，见 Nav.tsx 那笔宽度账），外加章节页
 * 每行那颗按钮。
 */
export default async function ReadingPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const params = await searchParams;

  // 取参口径照抄 study/page.tsx 与 spelling/page.tsx，不另造一套
  const unitId = params.unit ? Number(params.unit) : undefined;
  const validUnitId = unitId && Number.isInteger(unitId) ? unitId : undefined;

  const units = await prisma.unit.findMany({
    orderBy: { chapterNo: "asc" },
    select: {
      id: true,
      chapterNo: true,
      name: true,
      _count: { select: { passages: true } },
    },
  });
  // 只列有短文的章。短文是一章一章补的，没写的章点进去只能撞上空态
  const withPassages = units.filter((u) => u._count.passages > 0);

  // 不带 unit 时落在第一个有短文的章——从导航进来直接有东西读，
  // 不用先在一片空章里挑
  const target = validUnitId
    ? (units.find((u) => u.id === validUnitId) ?? null)
    : (withPassages[0] ?? null);

  const raw = target
    ? await prisma.passage.findMany({
        where: { unitId: target.id },
        orderBy: { orderInUnit: "asc" },
      })
    : [];

  // 这一章所有词的词典释义。用 meaningCn（ECDICT）而不是 bookMeaning（书中原话）
  // ——后者受版权保护，而这一页是要给人读的，见 PassageReader 顶上的说明
  const words = target
    ? await prisma.word.findMany({
        where: { unitId: target.id },
        select: { headword: true, meaningCn: true },
      })
    : [];
  const meaning = new Map(words.map((w) => [w.headword, shortMeaning(w.meaningCn)]));

  const passages = raw.map((p) => ({
    id: p.id,
    title: p.title,
    blocks: toParagraphs(p.body, (h) => meaning.get(h) ?? ""),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          拓展阅读
        </h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          一篇短文，把这一章的词放回句子里。中文是藏着的——先自己猜，猜不准的点一下。
        </p>
      </div>

      {withPassages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] tracking-[0.3em] text-[var(--color-muted)]">
            章节
          </span>
          {withPassages.map((u) => (
            <ChapterChip
              key={u.id}
              href={`/reading?unit=${u.id}`}
              active={target?.id === u.id}
            >
              第 {u.chapterNo} 章 {u._count.passages} 篇
            </ChapterChip>
          ))}
        </div>
      )}

      {passages.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <h2 className="font-serif text-lg font-semibold">
            {target ? `第 ${target.chapterNo} 章还没有短文` : "还没有短文"}
          </h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            短文是逐章写的，目前只补了一部分。上面的章节里挑一个有的看。
          </p>
        </div>
      ) : (
        <>
          <p className="font-serif text-xs tracking-[0.2em] text-[var(--color-muted)]">
            CHAPTER {target!.chapterNo} · {target!.name}
          </p>
          <PassageReader passages={passages} />
          <p className="border-t border-[var(--color-line)] pt-4 text-xs leading-relaxed text-[var(--color-muted)]">
            短文是为这本书自己写的，不是书中原文；词的中文取 ECDICT 词典释义。
          </p>
        </>
      )}
    </div>
  );
}

/** 章节的一格。纯 `<Link>`、零 JS——和拼写页的范围 chip 同一套写法 */
function ChapterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-9 items-center rounded-[var(--radius-chip)] px-3 text-xs transition ${
        active
          ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]"
          : "border border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
      }`}
    >
      {children}
    </Link>
  );
}
