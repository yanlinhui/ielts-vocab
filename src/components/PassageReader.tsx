"use client";

import { useState } from "react";
import type { Block } from "@/lib/passages";

export type ReaderPassage = { id: number; title: string; blocks: Block[] };

/**
 * 拓展阅读的正文。**只有一处需要客户端状态**：中文是「藏着」还是「露着」。
 *
 * 两种模式共用同一份正文，不做两份内容：
 * - 自测（默认）：中文全部藏起来，点哪个词才出哪个词
 * - 对照阅读：中文直接跟在词后面
 *
 * 默认走自测，理由就是这一页存在的理由——如果一进来什么都摊开，那和直接看
 * 学习卡背面没有区别，读者会顺着中文眼睛滑过去，不会先自己猜一次。
 *
 * `blocks` 是服务端切好的（见 `src/lib/passages.ts`），这里不认 `{{}}` 语法，
 * 只渲染。将来改标记语法不用动这个文件。
 */
export default function PassageReader({
  passages,
}: {
  passages: ReaderPassage[];
}) {
  // 默认自测
  const [quiz, setQuiz] = useState(true);
  // 已点开的词。按**词面**存，不按位置——同一个词在一篇里出现几次，
  // 点开一处就全露出来，不然要把整篇每一处都点一遍
  const [opened, setOpened] = useState<Set<string>>(() => new Set());

  function reveal(word: string) {
    setOpened((prev) => {
      if (prev.has(word)) return prev;
      const next = new Set(prev);
      next.add(word);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <ModeButton active={quiz} onClick={() => setQuiz(true)}>
          自测
        </ModeButton>
        <ModeButton active={!quiz} onClick={() => setQuiz(false)}>
          对照阅读
        </ModeButton>
        <span className="text-xs text-[var(--color-muted)]">
          {quiz ? "猜不准的点一下词，中文就出来" : "中文直接跟在词后面"}
        </span>
      </div>

      {passages.map((p, pi) => (
        <article
          key={p.id}
          className={
            pi > 0 ? "border-t border-[var(--color-line)] pt-7" : undefined
          }
        >
          <h2 className="font-serif text-2xl font-semibold tracking-tight">
            {p.title}
          </h2>
          <div className="mt-4 flex flex-col gap-3.5">
            {p.blocks.map((block, bi) => (
              <p key={bi} className="text-[17px] leading-[1.9]">
                {block.map((tok, ti) =>
                  tok.t === "text" ? (
                    <span key={ti}>{tok.v}</span>
                  ) : (
                    // 用 <button> 而不是 <span onClick>：键盘也要能走到（Tab 停在
                    // 词上、回车看中文），这是 PRD 第 3 节那条无障碍承诺的一部分。
                    <button
                      key={ti}
                      type="button"
                      onClick={() => reveal(tok.v)}
                      className="cursor-pointer align-baseline"
                    >
                      <span className="border-b border-b-[var(--color-seal)] font-serif font-semibold text-[var(--color-seal)]">
                        {tok.v}
                      </span>
                      {(!quiz || opened.has(tok.v)) && (
                        <span className="ml-1 text-[13px] text-[var(--color-brand)]">
                          {tok.cn || "—"}
                        </span>
                      )}
                    </button>
                  ),
                )}
              </p>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

/** 模式的一格。和拼写页的范围 chip 同一档尺寸，读起来才像同一种控件 */
function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-9 items-center rounded-[var(--radius-chip)] px-3 text-xs transition ${
        active
          ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]"
          : "border border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
      }`}
    >
      {children}
    </button>
  );
}
