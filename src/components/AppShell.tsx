"use client";

import { usePathname } from "next/navigation";
import Nav from "./Nav";

/**
 * 全站外壳：导航 + 内容区。
 *
 * 导航有两套排布，靠断点切换，**始终只有一套在无障碍树里**（另一套是
 * display:none，会被读屏剔除）：
 * - <1024px：横在顶部的栏（就是改版前那条）
 * - ≥1024px：竖在左侧的栏
 *
 * 拆成 client component 是因为 layout.tsx 是 server component、读不到
 * pathname，而「学习页要不要收起左侧栏」必须知道当前路由。children 由
 * server 传进来，页面本身仍然是服务端渲染的。
 */

// 学习页要沉浸（PRD 1.3「一次只做一件事」）。**只收桌面那侧的栏**——
// 窄屏顶部栏照旧保留，否则手机上就没有任何出口了，而这页底下只有一个
// 「先退出」文字链接。
const IMMERSIVE = ["/study"];

/** 印章方块 + 书名。纯 div 拼的，不需要任何图片资源。 */
function BrandMark() {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="grid h-6 w-6 place-items-center rounded-[var(--radius-chip)] bg-[var(--color-brand)] font-serif text-xs leading-none text-[var(--color-canvas)]"
      >
        真
      </span>
      <span className="font-serif text-base font-semibold tracking-[0.08em]">雅思词汇真经</span>
    </span>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const immersive = IMMERSIVE.some((p) => pathname.startsWith(p));

  return (
    <div className="lg:flex">
      {/* 页头跟页面同色，只靠一条细线和正文分开（原来是 surface/90 +
          backdrop-blur 的玻璃拟态，那是最典型的「App 感」）。 */}
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-canvas)] lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-4 py-3">
          <span className="mr-auto">
            <BrandMark />
          </span>
          <Nav />
        </div>
      </header>

      {!immersive && (
        <aside className="hidden border-r border-[var(--color-line)] px-3 py-5 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[220px] lg:shrink-0 lg:flex-col lg:gap-6">
          <BrandMark />
          <Nav variant="rail" />
        </aside>
      )}

      {/* lg:min-w-0 不是可选的保险：flex 子项的 min-width 默认是 auto，
          长单词（internationalization）会把这一列顶宽、溢出到侧边栏底下。
          这和改版时修的那个卡片撑宽 bug 是同一个成因。 */}
      <div className="lg:min-w-0 lg:flex-1">
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
