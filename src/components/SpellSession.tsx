"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SpeakButton from "./SpeakButton";
import { diffSpelling, type SpellDiff } from "@/lib/spelling";
import { isSupported, speak, type Accent } from "@/lib/tts";
import type { QueueItem } from "@/lib/session";
import type { Rating } from "@/lib/rating";

/**
 * 拼写题面（PRD 2.7）。
 *
 * **这里只管出题、收答案、比对，不碰网络也不碰队列。** 评分由一个 `onRate` 出口
 * 交回给 `StudySession`——那边已经有一套「提交 → 还在本次会话内就排回队尾」的
 * 逻辑，拼写没有理由再造一份。所以这个组件是受控的：题目从 `item` 来，结果从
 * `onRate` 走。
 *
 * 两个子模式：
 * - `meaning`：给中文释义，默写英文（默认。不依赖浏览器 TTS，哪儿都能用）
 * - `listen`：只出声、不给任何文字线索
 *
 * **答对答错的档位是定死的**，不给用户选：拼对 → 4「简单」（能默写出来说明掌握
 * 得牢，间隔该拉长）；拼错 → 1「忘了」。中间两档在拼写里无处体现——没有「拼得
 * 很费劲」这种中间态，要么写出来要么没写出来。
 */
type Mode = "meaning" | "listen";

export default function SpellSession({
  item,
  accent,
  busy,
  onRate,
}: {
  item: QueueItem;
  accent: Accent;
  /** 上一题的评分还在提交中——期间不许再交一次 */
  busy: boolean;
  onRate: (rating: Rating) => void;
}) {
  const [mode, setMode] = useState<Mode>("meaning");
  const [typed, setTyped] = useState("");
  // 答错之后先停在这上面：看清错在哪，点「下一个」才真的落库。
  // 答对不进这个状态，直接过——拼对了没什么好看的。
  const [result, setResult] = useState<SpellDiff | null>(null);

  // isSupported() 读的是 window，服务端渲染时不能调，首帧先当作支持（同 SpeakButton）
  const [supported, setSupported] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setSupported(isSupported()), []);

  // 答错进结果态时，把焦点交给「下一个」。
  //
  // **不能指望浏览器自己把焦点放对地方**：原来聚焦的那个输入框连同整个 `<form>`
  // 在这一刻被卸载，焦点会掉到 `<body>`——而焦点在 body 上按回车**什么都不会发生**
  // （规范如此）。用户报过「答错后按回车能过」，那是浏览器自发的焦点处理，各浏览器
  // 不一致，所以这里显式接管：焦点落在按钮上，回车就等于点它（**按钮获得焦点时回车
  // 激活它，是规范保证的行为**），跨浏览器一致。
  //
  // 顺带补掉一个可访问性缺口：此前焦点掉到 body，键盘用户按 Tab 会从页面开头重来。
  useEffect(() => {
    if (result) nextRef.current?.focus();
  }, [result]);

  // 听写题一进来就念一遍。
  //
  // ⚠️ iOS Safari 要求朗读由用户手势触发，这一句可能被直接忽略——所以题面里那个
  // 喇叭按钮是**兜底**，不是装饰，不能省。桌面 Chrome 不需要手势，这里能正常出声。
  //
  // 依赖里放着 `item.headword`：换了题就重念。实际上 StudySession 拿
  // `wordId + 已作答数` 当 key，换题等于整个组件重建，所以这个 effect 每题只跑一次。
  useEffect(() => {
    if (mode === "listen") speak(item.headword, { accent });
  }, [mode, item.headword, accent]);

  // 换题（含答错后重排回来的那一次）就把光标放进输入框，省一次点击。
  // 靠的还是上面那个 key——组件重建，这个 effect 重跑。
  useEffect(() => {
    inputRef.current?.focus();
  }, [item.wordId]);

  const submit = useCallback(() => {
    if (busy || result || !typed.trim()) return;
    const diff = diffSpelling(item.headword, typed);
    if (diff.ok) {
      // 拼对了直接过。不先进结果态，是因为「拼对了」没什么可看的——和翻面对了
      // 立刻评分是同一个节奏。
      onRate(4);
      return;
    }
    setResult(diff);
  }, [busy, result, typed, item.headword, onRate]);

  // 换子模式要把上一题的输入和比对结果清干净，否则切过去就是上一种模式的残留。
  function switchMode(next: Mode) {
    if (next === mode || (next === "listen" && !supported)) return;
    setMode(next);
    setTyped("");
    setResult(null);
    inputRef.current?.focus();
  }

  const meaning = item.meaningCn || item.bookMeaning || "（无释义）";

  return (
    <div className="flex flex-col gap-4">
      {/* 子模式切换 + 出处。出处写出来比藏起来有用——这些词跨章节，默写时
          知道「这是第几章的」对回想有帮助。 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="拼写模式"
          className="flex gap-0.5 rounded-[var(--radius-control)] border border-[var(--color-line)] p-0.5"
        >
          <ModeTab
            active={mode === "meaning"}
            onClick={() => switchMode("meaning")}
          >
            看中文写英文
          </ModeTab>
          <ModeTab
            active={mode === "listen"}
            disabled={!supported}
            title={supported ? undefined : "这个浏览器不支持语音合成"}
            onClick={() => switchMode("listen")}
          >
            听写
          </ModeTab>
        </div>
        <span className="text-xs text-[var(--color-muted)]">
          第 {item.unitNo} 章 {item.unitName}
        </span>
      </div>

      {/* ---- 题面 ---- */}
      <div className="flex min-h-[12rem] min-w-0 flex-col items-center justify-center gap-5 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-8">
        {mode === "meaning" ? (
          <p className="max-w-full whitespace-pre-line break-words text-center font-serif text-3xl font-semibold leading-snug tracking-tight">
            {meaning}
          </p>
        ) : (
          <>
            <SpeakButton text={item.headword} accent={accent} size="lg" />
            {/* 输入框占着键盘，`S` 会被当成字母打进去，所以这里不提快捷键 */}
            <span className="text-xs text-[var(--color-muted)]">点喇叭再听一遍</span>
          </>
        )}
      </div>

      {/* ---- 答题区 / 结果区 ---- */}
      {result ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <p className="text-[11px] tracking-[0.3em] text-[var(--color-muted)]">正确答案</p>

          {/* 逐字符铺开，让「错在哪个位置」一眼可见（PRD 2.7 的关键设计——
              不是笼统说一句「错了」）。红色只标两种：用户漏掉的字母、写错的位置。
              多敲的字母不进这一行，它没有对应的正确字符，只在下面那句里点名。 */}
          <p className="min-w-0 break-all font-serif text-3xl font-semibold tracking-wide">
            {result.ops.map((op, i) =>
              op.type === "extra" ? null : (
                <span
                  key={i}
                  className={
                    op.type === "keep"
                      ? undefined
                      : "text-[var(--color-rate-again)] underline decoration-2 underline-offset-4"
                  }
                >
                  {op.expected}
                </span>
              ),
            )}
          </p>

          <p className="text-sm text-[var(--color-rate-again)]">{result.message}</p>

          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--color-muted)]">
              你写的是「{typed.trim()}」
            </span>
            {/* 结果态唯一的出口。焦点由上面那个 effect 送过来，所以回车和点它等价——
                `disabled` 期间 `focus()` 不生效，但进入结果态时 `busy` 必为 false，
                这道口子只会出现在「已经点过一次、正在提交」的那一小段。 */}
            <button
              ref={nextRef}
              type="button"
              disabled={busy}
              onClick={() => onRate(1)}
              className="min-h-11 shrink-0 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-5 text-sm font-medium text-[var(--color-on-brand)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一个
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex gap-2"
        >
          {/* 居中大字：默写时盯着自己敲的字母看，字号大一点才看得清拼错没有。
              autoCapitalize / autoCorrect / spellCheck 全关——手机键盘的自动首字母
              大写和「智能纠错」会替用户改答案，那这个练习就白做了。 */}
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="拼写答案"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-12 min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 text-center font-serif text-2xl tracking-wide outline-none transition focus:border-[var(--color-brand)]"
          />
          <button
            type="submit"
            disabled={busy || !typed.trim()}
            className="min-h-12 shrink-0 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-5 text-sm font-medium text-[var(--color-on-brand)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            检查
          </button>
        </form>
      )}
    </div>
  );
}

/** 子模式的一格。选中的那格走填充底，和侧栏选中态是同一种「这里是当前位置」的语言。 */
function ModeTab({
  active,
  disabled = false,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 rounded-[var(--radius-chip)] px-3 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-brand)]"
      }`}
    >
      {children}
    </button>
  );
}
