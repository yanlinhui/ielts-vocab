"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import WordCard from "./WordCard";
import SpellSession from "./SpellSession";
import ProgressBar from "./ProgressBar";
import { isWithinSession } from "@/lib/format";
import type { QueueItem } from "@/lib/session";
import type { Rating } from "@/lib/rating";
import { isSupported, type Accent } from "@/lib/tts";

interface ReviewResponse {
  nextDueAt: string;
  intervalMs: number;
  previews: Record<Rating, string>;
}

/**
 * 学习会话。整个学习页就这一个有状态的组件，其余都是展示。
 *
 * **会话内重复**（PRD 2.2）：答「忘了」的词，FSRS 会把它排到 1~10 分钟后。
 * 这里就在它到期时间落在本次会话范围内时，把它重新塞回队尾——当天就能再过
 * 一遍，而不是等到明天。已进入复习态的老词答错了也一样处理。
 */
export default function StudySession({
  initialQueue,
  accent,
  initialAutoSpeak = false,
  unit = null,
  weak = false,
  spell = false,
}: {
  initialQueue: QueueItem[];
  accent: Accent;
  initialAutoSpeak?: boolean;
  /**
   * 章节专项进来时带上这一章。**只给「整章已经学完」那个空状态用**——那种情况
   * 队列里一个词都没有，没有词卡可以读出章名，只能靠这里传。每日动线传 null。
   */
  unit?: { chapterNo: number; name: string } | null;
  /**
   * 错词本（`/study?weak=1`）进来时置真。**只影响文字，不影响队列怎么消费**——
   * 队列由 `buildSession({ wordIds })` 建好，这里只管把「现在是错词本」这件事
   * 在第一行说出来，以及进门就空时给对诊断。
   */
  weak?: boolean;
  /**
   * 拼写模式（`/study?spell=1`，可叠加 `unit`）。置真时把词卡换成拼写题面，
   * 队列怎么消费、评分怎么提交**一律不变**——`SpellSession` 只借 `onRate` 出去，
   * 会话内重排那套逻辑这里原样复用。
   */
  spell?: boolean;
}) {
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [rated, setRated] = useState(0);
  const [remembered, setRemembered] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 自动朗读。初值来自库里那行设置，改动会写回库——下次进门就是上次的选择。
  // 由这里持有而不是下沉进 WordCard：开关住在卡片外面，两者得共用同一份状态。
  const [autoSpeak, setAutoSpeak] = useState(initialAutoSpeak);

  // 这张卡显示了多久，作为 elapsedMs 上报，用于以后分析
  const shownAt = useRef<number>(Date.now());
  const total = rated + queue.length;

  const handleRate = useCallback(
    async (rating: Rating) => {
      const current = queue[0];
      if (!current || busy) return;

      setBusy(true);
      setError(null);
      const elapsedMs = Date.now() - shownAt.current;

      try {
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: current.wordId, rating, elapsedMs }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `服务端返回 ${res.status}`);
        }
        const data = (await res.json()) as ReviewResponse;

        setQueue((q) => {
          const [head, ...rest] = q;
          // 到期时间还在本次会话范围内 → 排回队尾，稍后再见
          if (head && isWithinSession(data.nextDueAt)) {
            return [...rest, { ...head, isNew: false, previews: data.previews }];
          }
          return rest;
        });
        setRated((n) => n + 1);
        if (rating >= 3) setRemembered((n) => n + 1);
        shownAt.current = Date.now();
      } catch (e) {
        // 评分没落库就绝不能把卡片移走——否则这次作答白做了
        setError(e instanceof Error ? e.message : "提交失败，再试一次");
      } finally {
        setBusy(false);
      }
    },
    [busy, queue],
  );

  // 开关：先改本地状态（PRD 3 要求瞬时，不等网络），再后台落库；失败就弹回去。
  // 只发 autoSpeak 一个字段——/api/settings 是逐字段处理的，不用把其余三项一起回写。
  const toggleAutoSpeak = useCallback(async () => {
    const next = !autoSpeak;
    setAutoSpeak(next);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSpeak: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setAutoSpeak(!next);
      setError("发音设置没保存上，已切换回去");
    }
  }, [autoSpeak]);

  if (queue.length === 0) {
    // 五种空法要分清，别混成一句：
    //   1. 拼写进门就空 —— 想默写的词一个都还没学过（或这一章还没学过词）
    //   2. 错词本进门就空 —— 一个「忘了」都还没答过
    //   3. 章节专项进门就空 —— 这一章的词都已经学过了（一次都还没答）
    //   4. 答过若干之后抽干 —— 本轮做完（四种进法共用这一支）
    //   5. 每日动线进门就空 —— 今天没有待办的词
    //
    // ⚠️ 判定顺序不能反：`spellDone` 必须排在最前，`weakDone` 排在它后面、
    // 最后那支前面。`?unit=3&spell=1` 这种地址下 `unit` 不为空、又还没答过，
    // 顺序反了就会先命中 `chapterDone` 说出「第 3 章已经学完」——可用户是来默写
    // 的，那一章恰恰有学过的词，那是句错的诊断。错词本那边同理：反了会读到
    // 「今天没有待学的词了」，让人以为今天配额用光了。
    const spellDone = rated === 0 && spell;
    const chapterDone = rated === 0 && unit !== null;
    const weakDone = rated === 0 && weak;
    const rate = rated > 0 ? Math.round((remembered / rated) * 100) : 0;

    // 五支的差别只有「说什么」和「下一步去哪」，所以先算成一份数据再渲染——
    // 照原来的写法再嵌一层三元，这段就没法读了。
    let title: string;
    let body: string;
    let primary: { href: string; label: string };
    let secondary: { href: string; label: string };

    if (spellDone) {
      title = unit ? `第 ${unit.chapterNo} 章还没有学过的词` : "还没有学过的词";
      body = "拼写练的是学过的词——先去「今日功课」背几个，回头再来默写。";
      primary = { href: "/", label: "回首页" };
      secondary = { href: "/units", label: "浏览章节词汇" };
    } else if (weakDone) {
      title = "错词本现在是空的";
      body = "还没有答过「忘了」的词。等攒够了再来集中攻克。";
      primary = { href: "/stats", label: "看研习统计" };
      secondary = { href: "/", label: "回首页" };
    } else if (chapterDone) {
      title = `第 ${unit?.chapterNo} 章 ${unit?.name} 已经学完`;
      body = "这一章的词都学过了。想回顾的话回首页——这一章的复习按到期时间在「今日功课」里走。";
      primary = { href: "/units", label: "浏览章节词汇" };
      secondary = { href: "/", label: "回首页" };
    } else if (rated > 0) {
      title = "这一轮完成了";
      body = `本次作答 ${rated} 次，其中 ${remembered} 次记住了（${rate}%）`;
      primary = { href: "/", label: "回首页" };
      secondary = { href: "/units", label: "浏览章节词汇" };
    } else {
      title = "这一轮完成了";
      body = "今天没有待学的词了。去「章节词汇」挑一个章节加练，或明天再来。";
      primary = { href: "/", label: "回首页" };
      secondary = { href: "/units", label: "浏览章节词汇" };
    }

    return (
      <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
        <h1 className="font-serif text-xl font-semibold">{title}</h1>
        <p className="text-sm text-[var(--color-muted)]">{body}</p>
        <div className="mt-2 flex gap-3">
          {/* 学完一章的人下一步是挑下一章，所以那一态的主动作是去章节列表；
              另外几态是「收工」，主动作回首页。 */}
          <Link
            href={primary.href}
            className="rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-[var(--color-on-brand)] transition hover:opacity-90"
          >
            {primary.label}
          </Link>
          <Link
            href={secondary.href}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-4 py-2.5 text-sm transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
          >
            {secondary.label}
          </Link>
        </div>

        {/* 只有「今天没有待学的词」这一支才给错词本出口——另外三支各自有更该走的
            路（学完一章 → 挑下一章；做完一轮 → 收工；错词本空 → 回统计页）。
            `!spell`：拼写进门就空时那支说的是「还没学过可默写的词」，把人往错词本
            引是另一回事，别叠在一起。
            ⚠️ 写成按钮行下面的文字链接、不塞进上面那排按钮：上面两个按钮各约 116px，
            375px 下可用 343px，硬塞第三个会换行。 */}
        {rated === 0 && !chapterDone && !weak && !spell && (
          <Link
            href="/study?weak=1"
            className="text-sm text-[var(--color-brand)] underline underline-offset-4"
          >
            去错词本攻克老忘的词
          </Link>
        )}
      </div>
    );
  }

  const current = queue[0];

  // 这一轮是什么模式，写进头部那一行。拼写和错词本都得让人一眼看出换了模式，
  // 否则和「今日功课」长得一模一样。优先级和 study/page.tsx 里那份保持一致。
  const modeLabel = spell ? "拼写" : weak ? "错词本" : current.isNew ? "新词" : "复习";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>
            {modeLabel} · 第 {current.unitNo} 章 {current.unitName}
          </span>
          <span>
            还剩 {queue.length} 个 · 已完成 {rated}
          </span>
        </div>
        <ProgressBar done={rated} total={Math.max(total, 1)} />
      </div>

      {error && (
        <div className="rounded-[var(--radius-control)] border border-[var(--color-rate-again)] bg-[color-mix(in_srgb,var(--color-rate-again)_8%,var(--color-surface))] px-3 py-2 text-sm text-[var(--color-rate-again)]">
          {error}
        </div>
      )}

      {spell ? (
        <SpellSession
          // key 里带上已作答数，理由同下面那张词卡：同一个词被排回队尾再出现时
          // （答错 → 1 分钟后重来）wordId 没变，只有换个 key 才能让输入框和比对
          // 结果整个清干净。
          key={`${current.wordId}-${rated}`}
          item={current}
          accent={accent}
          busy={busy}
          onRate={handleRate}
        />
      ) : (
        <WordCard
          // key 里带上已作答数：同一个词被排回队尾再出现时（答「忘了」→ 1 分钟后
          // 重来），wordId 没变，只有换个 key 才能让卡片整个重建、翻回正面。
          key={`${current.wordId}-${rated}`}
          item={current}
          accent={accent}
          autoSpeak={autoSpeak}
          previews={current.previews}
          onRate={handleRate}
          busy={busy}
        />
      )}

      {/* 开关放在卡片外、放这一行：紧挨「退出」这个边角动作，不占卡片正面
          （PRD 1.3 一次只做一件事），也不用翻面就能切。
          拼写模式下不渲染它——这个开关管的是「卡片转到正面时朗读」，而拼写里
          根本没有正面/背面那回事；听写模式自己会在出题时念。摆着只会让人以为
          它也能控制听写。空 span 是占位，好让右边那组仍然贴在行尾。 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {spell ? <span /> : <AutoSpeakToggle on={autoSpeak} onToggle={toggleAutoSpeak} />}
        <div className="flex items-center gap-2.5">
          {/* 「进度已实时保存」得留在明面上、不能只塞进 title：它回答的是
              「我这一走进度会不会丢」——手机上悬停不出 tooltip，恰恰是手机用户
              最需要这句话。 */}
          <span className="text-xs text-[var(--color-muted)]">进度已实时保存</span>
          <Link
            href="/"
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-chip)] border border-[var(--color-line)] px-2.5 py-1.5 text-xs text-[var(--color-muted)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            退出
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * 自动朗读开关。
 *
 * 用 role="switch" 而不是 button + aria-pressed：它是个开关，读屏该念「开 / 关」，
 * 而不是「按下 / 未按下」。状态除了颜色还写了「开 / 关」两个字——只靠颜色区分的话，
 * 色觉障碍的人看不出当前是哪一档。
 */
function AutoSpeakToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  // isSupported() 读的是 window，服务端渲染时不能调，首帧先当作支持（同 SpeakButton）
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(isSupported()), []);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="新词自动发音"
      disabled={!supported}
      title={supported ? "转到单词面时自动朗读" : "这个浏览器不支持语音合成"}
      onClick={onToggle}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-chip)] border px-2.5 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
        on
          ? "border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_8%,var(--color-surface))] text-[var(--color-brand)]"
          : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 6a9 9 0 0 1 0 12" />
      </svg>
      自动发音
      <span className="font-medium">{on ? "开" : "关"}</span>
    </button>
  );
}
