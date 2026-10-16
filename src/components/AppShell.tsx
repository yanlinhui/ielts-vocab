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

/**
 * 印章方块 + 书名。纯 div 拼的，不需要任何图片资源。
 *
 * 印章用朱砂不用墨绿——现实里的印就是朱的，绿色方块会一眼看出「这是个
 * 涂了色的 div」。这也是全站朱砂出现的第一个位置，见 globals.css 的分工注释。
 */
function BrandMark() {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-chip)] bg-[var(--color-seal)] font-serif text-sm leading-none text-[var(--color-canvas)]"
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

      {/* 侧边栏按「书末目录页」做，和 units 页面那套通栏细线 + 发丝线是同一套
          语言——全站只有一种「目录」的样子。

          右缘那对线是书口的双线：外侧 border-r 一条，内侧 4px 处再一条发丝线，
          靠 after 伪元素画。aside 是 sticky，本身就是定位元素，absolute 的伪元素
          以它为参照（绝对的参照是 padding box，所以 right-1 正好落在 border 内 4px）。
          底色比页面底深一档，内容区是「内页」，侧栏是「封皮区」，两个面分开才立得住。 */}
      {!immersive && (
        <aside className="hidden border-r border-[var(--color-line)] px-4 py-6 after:absolute after:inset-y-0 after:right-1 after:w-px after:bg-[var(--color-line)] after:content-[''] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[220px] lg:shrink-0 lg:flex-col lg:bg-[var(--color-rail)]">
          <BrandMark />
          {/* 「目录」是版式标签，不是内容——不含任何进度信息，和「侧栏不放进度
              摘要」那条不冲突。标题下压一条通栏细线，导航项之间也是发丝线。 */}
          <div className="mt-7 flex flex-col">
            <p className="border-b border-[var(--color-line)] pb-2 text-[11px] tracking-[0.3em] text-[var(--color-muted)]">
              目录
            </p>
            <Nav variant="rail" />
          </div>
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
