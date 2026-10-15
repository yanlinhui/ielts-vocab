"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import WordCard from "./WordCard";
import ProgressBar from "./ProgressBar";
import { isWithinSession } from "@/lib/format";
import type { QueueItem } from "@/lib/session";
import type { Rating } from "@/lib/rating";
import type { Accent } from "@/lib/tts";

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
  autoSpeak = false,
}: {
  initialQueue: QueueItem[];
  accent: Accent;
  autoSpeak?: boolean;
}) {
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [rated, setRated] = useState(0);
  const [remembered, setRemembered] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (queue.length === 0) {
    const rate = rated > 0 ? Math.round((remembered / rated) * 100) : 0;
    return (
      <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
        <h1 className="font-serif text-xl font-semibold">这一轮完成了</h1>
        {rated > 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            本次作答 {rated} 次，其中 {remembered} 次记住了（{rate}%）
          </p>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">
            今天没有待学的词了。去「词库」挑一个章节加练，或明天再来。
          </p>
        )}
        <div className="mt-2 flex gap-3">
          <Link
            href="/"
            className="rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-[var(--color-canvas)] transition hover:opacity-90"
          >
            回首页
          </Link>
          <Link
            href="/units"
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-4 py-2.5 text-sm transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
          >
            浏览词库
          </Link>
        </div>
      </div>
    );
  }

  const current = queue[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>
            {current.isNew ? "新词" : "复习"} · 第 {current.unitNo} 章 {current.unitName}
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

      <div className="text-center">
        <Link
          href="/"
          className="text-xs text-[var(--color-muted)] underline-offset-2 hover:underline"
        >
          先退出（进度已实时保存）
        </Link>
      </div>
    </div>
  );
}
