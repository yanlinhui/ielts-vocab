"use client";

import { useEffect, useState } from "react";
import { isSupported, speak, type Accent } from "@/lib/tts";

/**
 * 朗读按钮。
 *
 * 点击**不翻面**——翻面由卡片本身响应点击，这两个动作必须分开，
 * 否则想听发音的人会误触发翻面。
 */
export default function SpeakButton({
  text,
  accent = "uk",
  size = "md",
}: {
  text: string;
  accent?: Accent;
  size?: "md" | "lg";
}) {
  // isSupported() 读的是 window，不能在服务端跑，所以首次渲染先当作支持
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(isSupported()), []);

  const dim = size === "lg" ? "h-11 w-11" : "h-9 w-9";

  return (
    <button
      type="button"
      aria-label="朗读"
      title={supported ? "朗读" : "这个浏览器不支持语音合成"}
      disabled={!supported}
      onClick={(e) => {
        e.stopPropagation(); // 别让点击冒泡到卡片触发翻面
        speak(text, { accent });
      }}
      className={`${dim} inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-brand)] transition hover:border-[var(--color-brand)] hover:bg-[color-mix(in_srgb,var(--color-brand)_8%,white)] disabled:cursor-not-allowed disabled:text-[var(--color-muted)] disabled:opacity-50`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={size === "lg" ? "h-5 w-5" : "h-4 w-4"}
      >
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 6a9 9 0 0 1 0 12" />
      </svg>
    </button>
  );
}
