import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "雅思词汇真经 · 背单词",
  description: "间隔重复 + 拼写听写的雅思词汇训练工具",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 手机上也想让卡片铺满，不要被浏览器 UI 挤扁
  maximumScale: 1,
};

const NAV = [
  { href: "/", label: "今日" },
  { href: "/units", label: "词库" },
  { href: "/settings", label: "设置" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full">
        <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-surface)]/90 backdrop-blur">
          <nav className="mx-auto flex max-w-3xl items-center gap-1 px-4 py-3">
            <span className="mr-auto text-sm font-semibold tracking-tight">
              雅思词汇真经
            </span>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted)] transition hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
