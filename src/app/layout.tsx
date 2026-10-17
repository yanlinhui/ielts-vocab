import type { Metadata, Viewport } from "next";
import { Noto_Serif_SC } from "next/font/google";
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
        {/* 带导航的页面在 (app) 路由组里，由那一层的 layout 挂 AppShell；
            登录页在组外，所以不带侧栏。 */}
        {children}
      </body>
    </html>
  );
}
