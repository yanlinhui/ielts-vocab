"use client";

import { formatInterval } from "@/lib/format";
import { RATINGS, type Rating } from "@/lib/rating";

/**
 * 四个评分按钮。
 *
 * 按钮下方那行「下次：3 天后」不是装饰——没有它，用户不知道评分会影响
 * 什么，就会一律点「一般」，FSRS 也就退化成固定间隔了。
 */
export default function RatingButtons({
  previews,
  onRate,
  disabled = false,
}: {
  previews: Record<Rating, string>;
  onRate: (rating: Rating) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {RATINGS.map((meta) => (
        <button
          key={meta.value}
          type="button"
          disabled={disabled}
          onClick={() => onRate(meta.value)}
          title={`${meta.hint}（键盘 ${meta.key}）`}
          className="group flex flex-col items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-3 transition hover:border-[var(--color-brand)] disabled:opacity-50"
          style={{ borderTopWidth: 3, borderTopColor: meta.color }}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {meta.label}
            <kbd className="hidden rounded border border-[var(--color-line)] px-1 text-[10px] leading-4 text-[var(--color-muted)] sm:inline">
              {meta.key}
            </kbd>
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">
            {formatInterval(previews[meta.value])}
          </span>
        </button>
      ))}
    </div>
  );
}
