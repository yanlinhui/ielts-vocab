import type { Metadata, Viewport } from "next";
import { Noto_Serif_SC } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

// 构建时由 Next 把字体拉到 .next 里自托管，运行时零网络请求。
// 字体只用在标题性位置（页面 h1 / 卡片 headword / 章节号 / 统计大数字），
// 正文一律保持系统无衬线——宋体在 18px 屏幕上笔画偏细，不适合长时间阅读。
//
// preload 必须关掉：这个家族被切成 101 个 unicode-range 分片，全量 preload
// 等于让浏览器在首帧前并发拉 101 个文件。交给浏览器按需取片（display: swap）。
const serif = Noto_Serif_SC({
  weight: ["400", "600"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-serif-sc",
});

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={serif.variable}>
      <body className="min-h-full">
        {/* 页头跟页面同色，只靠底部一条细线和正文分开。原来这里是
            surface/90 + backdrop-blur 的玻璃拟态——那是最典型的「App 感」，
            和「纸书」是反的。 */}
        <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-canvas)]">
          <nav className="mx-auto flex max-w-3xl items-center gap-1 px-4 py-3">
            <span className="mr-auto flex items-center gap-2">
              {/* 印章方块：纯 div，不需要任何图片资源 */}
              <span
                aria-hidden
                className="grid h-6 w-6 place-items-center rounded-[var(--radius-chip)] bg-[var(--color-brand)] font-serif text-xs leading-none text-[var(--color-canvas)]"
              >
                真
              </span>
              <span className="font-serif text-base font-semibold tracking-[0.08em]">
                雅思词汇真经
              </span>
            </span>
            <Nav />
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
