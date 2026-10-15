"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import RatingButtons from "./RatingButtons";
import SpeakButton from "./SpeakButton";
import { speak, type Accent } from "@/lib/tts";
import type { QueueItem } from "@/lib/session";
import type { Rating } from "@/lib/rating";

/**
 * 学习卡片。
 *
 * 正面只放「单词 + 喇叭」——翻面前不泄漏任何提示，这是自测能成立的前提。
 * 点击卡片翻面、点喇叭只发音不翻面，这两个动作必须分开。
 *
 * 背面**一次性铺开全部内容**（释义 / 例句 / 搭配 / 词根词源 / 派生 / 文化背景），
 * 不做折叠、不用点开，**也不在卡片里滚**——放不下就整页滚。
 */

/**
 * 正文字号的基准值。正文里的字号、间距全按 em 写，跟着它一起变。
 *
 * 演进：这里曾经是 17px，并会按窗口高度逐档缩到 11px，只为把内容挤进一屏。
 * 2026-10-16 去掉自动缩放并把基准提到 18px——用户反馈那样字太小，宁可
 * 字号大一点、放不下就让整页滚。
 */
const BASE_FONT = 18;

export default function WordCard({
  item,
  accent,
  autoSpeak = false,
  previews,
  onRate,
  busy,
}: {
  item: QueueItem;
  accent: Accent;
  autoSpeak?: boolean;
  previews: Record<Rating, string>;
  onRate: (rating: Rating) => void;
  busy: boolean;
}) {
  // 卡片是否显示背面。翻回正面不在这里做——父组件换 key 会让整个组件重建，
  // 这个 state 自然回到 false。
  const [flipped, setFlipped] = useState(false);

  const sceneRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  // 上一次给外框定下的高度，用来判断这次是变高还是变矮
  const sceneH = useRef(0);

  // 换词时回到页面顶部。
  //
  // 长词翻面后整页会明显变长，用户多半是滚到下半页读完再评分的。不定回顶部的话，
  // 下一个词会从中间开始显示——正面那张卡整个在屏幕上方，看上去就是一片空白。
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [item.wordId]);

  // 把翻转容器的身高锁到「当前露出来的那一面」。
  //
  // 正反两面叠在同一个 grid 单元格里做 3D 翻转（见 globals.css 的 .flip-card），
  // grid 行高取两者的**较大值**。不干预的话，一个例句多的长词会顺手把正面那张
  // 空卡也撑到同样高：单词跑出屏幕、底下的「先退出」被推走，而且还没翻面整页就
  // 已经出现滚动条。锁到当前这一面之后，正面就是一屏内的矮卡，背面随内容长，
  // 页面该滚就滚——这正是要的效果。
  //
  // 能量到各面自己的高度，靠的是两面都加了 self-start：不加的话它们会被拉伸到
  // 行高，量出来是同一个数（也就等于没锁）。外层 .flip-scene 必须配 overflow-hidden，
  // 否则超出锁定高度的另一面照样会撑大 document 的滚动高度，这个锁高就白做了。
  //
  // 必须在 useLayoutEffect 里做：等到 useEffect 才跑，用户会先看到一帧撑开的布局。
  //
  // 只有「变矮」要延后半个翻转再执行。翻回正面时外框瞬间收矮的话，还在往回转的
  // 背面（它比正面高）下半截会被裁掉——亲眼看见内容被切一刀。延后到卡片转到
  // 侧面（90°）那一刻再收，那时画面里的已经换成矮的正面，怎么收都裁不到。
  // 变高则必须立刻执行，否则背面一转出来就被裁。
  useLayoutEffect(() => {
    const apply = () => {
      const scene = sceneRef.current;
      const face = flipped ? backRef.current : frontRef.current;
      if (!scene || !face) return;
      const next = face.offsetHeight;
      scene.style.transitionDelay = next < sceneH.current ? "calc(var(--flip-duration) / 2)" : "0ms";
      scene.style.height = `${next}px`;
      sceneH.current = next;
    };
    apply();
    // 转屏、拉窗口都会让同一面重新折行，高度跟着变
    window.addEventListener("resize", apply);
    // 衬线字体是异步加载的：字体到位前后文字的折行和行高都会变，而外框高度
    // 早就冻结成 fallback 字体量出来的值了——差一点就是背面被裁一截、或者
    // 底部空一截。字体每次加载完都重量一次。这是纯加法，锁高算法本身没动。
    document.fonts?.addEventListener("loadingdone", apply);
    return () => {
      window.removeEventListener("resize", apply);
      document.fonts?.removeEventListener("loadingdone", apply);
    };
  }, [flipped]);

  // 开了「翻面自动朗读」的话，翻到背面时读一次。
  // 首次朗读仍需用户点过一次（浏览器策略），所以这只是省一次点击。
  useEffect(() => {
    if (flipped && autoSpeak) speak(item.headword, { accent });
  }, [flipped, autoSpeak, accent, item.headword]);

  // 键盘：空格翻面，1~4 评分。只在已翻面时接受评分，
  // 免得手快把没看到的词评了。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }
      if (flipped && !busy && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        onRate(Number(e.key) as Rating);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, busy, onRate]);

  const meaning = item.meaningCn || item.bookMeaning || "（无释义）";
  const hasDetail = Boolean(
    item.collocation ||
      item.examples.length > 0 ||
      item.etymology ||
      item.derived ||
      item.cultureNote,
  );

  return (
    <div className="flex flex-col gap-4">
      <div ref={sceneRef} className="flip-scene">
        <div className={`flip-card grid ${flipped ? "is-flipped" : ""}`}>
          {/* ---------- 正面 ---------- */}
          {/* 这里不能用 <button>：里面还有一个喇叭按钮，button 套 button 是
              非法 HTML。键盘操作统一由上面的全局 keydown 处理。
              self-start 是为了不被反面撑出来的行高拉伸——见上面锁高的注释。 */}
          <div
            ref={frontRef}
            role="button"
            tabIndex={0}
            aria-label={`${item.headword}，点击查看释义`}
            onClick={() => setFlipped(true)}
            className="flip-face col-start-1 row-start-1 flex min-h-[20rem] min-w-0 cursor-pointer flex-col items-center justify-center gap-5 self-start rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-8"
          >
            {/* 衬线的 x-height 比无衬线小，同样字号看着会小一圈，所以比原来
                提了一档（4xl/5xl → 5xl/6xl）补回来。
                break-words + min-w-0：像 internationalization 这种长词在窄屏上
                折不动，会把整张卡撑宽出视口，再被 .flip-scene 的 overflow:hidden
                切掉一截——允许断行就不会。 */}
            <span className="max-w-full break-words text-center font-serif text-5xl font-semibold tracking-tight sm:text-6xl">
              {item.headword}
            </span>
            <SpeakButton text={item.headword} accent={accent} size="lg" />
            <span className="text-xs text-[var(--color-muted)]">点击卡片查看释义</span>
          </div>

          {/* ---------- 背面 ---------- */}
          {/* overflow-hidden 保留：底部那块的背景是方的，不裁一下会盖住圆角边框。
              它只裁这一面自己的框，不参与上面那个锁高。 */}
          <div
            ref={backRef}
            className="flip-face flip-face-back col-start-1 row-start-1 flex min-h-[20rem] min-w-0 flex-col self-start overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]"
          >
            {/* 头部：单词 + 音标 + 出处 */}
            <div className="shrink-0 border-b border-[var(--color-line)] px-6 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="font-serif text-3xl font-semibold tracking-tight">
                    {item.headword}
                  </h2>
                  {item.phonetic && (
                    <span className="text-sm text-[var(--color-muted)]">
                      /{item.phonetic}/
                    </span>
                  )}
                </div>
                <SpeakButton text={item.headword} accent={accent} />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                {item.pos && (
                  <span className="rounded-[var(--radius-chip)] bg-[var(--color-surface-2)] px-1.5 py-0.5">
                    {item.pos}
                  </span>
                )}
                <span>
                  Chapter {item.unitNo} · {item.unitName}
                </span>
                {item.isNew && (
                  <span className="rounded-[var(--radius-chip)] bg-[color-mix(in_srgb,var(--color-brand)_12%,var(--color-surface))] px-1.5 py-0.5 text-[var(--color-brand)]">
                    新词
                  </span>
                )}
              </div>
            </div>

            {/* 主体：不滚、不裁——装不下就整页滚（那是外层的事）。
                点空白处翻回正面；评分按钮在下面那一块，不归这里管——
                否则评分请求失败时卡片会莫名其妙翻回去。
                字号走 style 而不是 Tailwind 类：基准值只有 BASE_FONT 一处，
                改它整块跟着变。里面的字号/间距全用 em。 */}
            <div
              onClick={() => !busy && setFlipped(false)}
              style={{ fontSize: `${BASE_FONT}px` }}
              className="cursor-pointer px-[1.4em] py-[1em]"
            >
              {/* 释义主体。空字段直接不渲染，不显示占位符（PRD 2.2 边界情况）。
                  书中释义（bookMeaning）只在 ECDICT 也没数据时兜底，不并排显示——
                  两者绝大多数时候是同一件事，摆两行只是噪音。 */}
              <p className="whitespace-pre-line leading-[1.6]">{meaning}</p>

              {hasDetail && (
                <div className="mt-[1.6em] flex flex-col gap-[1.6em]">
                  {item.examples.length > 0 && (
                    <Section title="例句">
                      <ul className="flex flex-col gap-[0.7em]">
                        {item.examples.map((ex, i) => (
                          <li
                            key={i}
                            className="rounded-[var(--radius-control)] bg-[var(--color-surface-2)] px-[0.8em] py-[0.7em]"
                          >
                            <div className="flex items-start gap-[0.5em]">
                              <p className="flex-1 text-[0.88em] leading-[1.55]">{ex.en}</p>
                              <SpeakButton text={ex.en} accent={accent} />
                            </div>
                            {ex.cn && (
                              <p className="mt-[0.3em] text-[0.82em] leading-[1.55] text-[var(--color-muted)]">
                                {ex.cn}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  {item.collocation && (
                    <Section title="搭配">
                      <Note>{item.collocation}</Note>
                    </Section>
                  )}

                  {item.etymology && (
                    <Section title="词根词源">
                      <Note>{item.etymology}</Note>
                    </Section>
                  )}

                  {item.derived && (
                    <Section title="派生">
                      <Note>{item.derived}</Note>
                    </Section>
                  )}

                  {item.cultureNote && (
                    <Section title="文化背景">
                      <Note>{item.cultureNote}</Note>
                    </Section>
                  )}
                </div>
              )}
            </div>

            {/* 底部：评分按钮 */}
            <div className="shrink-0 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-3">
              <RatingButtons previews={previews} onRate={onRate} disabled={busy} />
            </div>
          </div>
        </div>
      </div>

      {!flipped && (
        <p className="text-center text-xs text-[var(--color-muted)]">
          空格键翻面 · 翻面后按 1~4 评分
        </p>
      )}
    </div>
  );
}

/** 背面各扩展块的标题。左侧那道小竖条是唯一的分隔语言，不用再加边框。 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[0.5em]">
      <h3 className="flex items-center gap-[0.5em] text-[0.7em] font-semibold tracking-[0.2em] text-[var(--color-muted)]">
        <span className="h-[1.1em] w-px bg-[var(--color-brand)]" />
        {title}
      </h3>
      {children}
    </section>
  );
}

/** 灰色底的信息块，给搭配/词源这类整段文字用。 */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="whitespace-pre-line rounded-[var(--radius-control)] bg-[var(--color-surface-2)] px-[0.8em] py-[0.7em] text-[0.88em] leading-[1.6]">
      {children}
    </p>
  );
}
