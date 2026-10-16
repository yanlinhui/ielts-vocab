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
 * 深色面（左侧栏 + 窄屏顶栏）共用的一套令牌重定义。
 *
 * 把整个子树翻深，最省事也最不易漏的做法不是在 Nav 里写深色分支，而是在容器上
 * 就地改写语义令牌：丢进深色面的任何组件——现在的 Nav、以后放进去的任何东西——
 * 自动获得深色适配，组件代码一个颜色分支都不用写。
 *
 * ⚠️ 末尾那个 text-[var(--color-rail-ink)] 不是可有可无的搭档，是必须的一条。
 * CSS 变量在**声明它的那个元素上**就解析成计算值了：body 上的
 * `color: var(--color-ink)` 在 body 上早已算完，子元素继承到的是算好的近黑色，
 * 而不是变量本身。所以只重定义 --color-ink **管不到**那些没写颜色类的元素——
 * 品牌文字「雅思词汇真经」正是这种情况，它会继承 body 的近黑，落在 #202626 上
 * 只有 0.85:1，等于看不见。必须在容器上把继承链的起点定下来。
 *
 * ⚠️ 另一条约束：这个子树里不能再出现 --color-brand。墨绿对 #202626 只有
 * 1.54:1，等于瞎掉（globals.css 里也记了这条）。焦点环同理，所以 --color-focus
 * 也一并改写成 rail-ink——侧栏里的链接是键盘 Tab 必经的位置，焦点环看不见
 * 就是一个实打实的无障碍缺口。
 */
const DARK_SURFACE =
  "text-[var(--color-rail-ink)] [--color-ink:var(--color-rail-ink)] [--color-muted:var(--color-rail-muted)] [--color-line:var(--color-rail-line)] [--color-surface-2:var(--color-rail-hover)] [--color-focus:var(--color-rail-ink)]";

/**
 * 印章方块 + 书名。纯 div 拼的，不需要任何图片资源。
 *
 * 印章用朱砂不用墨绿——现实里的印就是朱的，绿色方块会一眼看出「这是个
 * 涂了色的 div」。这也是全站朱砂出现的第一个位置，见 globals.css 的分工注释。
 *
 * 印面刻「词」不刻「真」：那一个字要同时是**书名里的一个字**和**这本书在讲
 * 什么**，「词」比「真」直白得多；「真经」那层意思交给完整的书名去承担。
 *
 * 印面那个字用的是 --color-on-brand（「彩色面上的文字」那个令牌），**不是继承**：
 * 印章底永远是朱砂，前景就该跟着印章走。靠继承的话，以后把 BrandMark 放进一个
 * 浅色容器，就会得到近黑字压在朱砂上。
 *
 * 书名下面那行英文是**版式补充，不承载信息**：书脊上总要有一行拉丁字母压住
 * 版面。全大写 + 拉开字距、10px、走 rail-muted（深底 5.51:1）。它比中文行短，
 * 不会把品牌撑宽；两行合起来 32px 仍矮于 40px 的印章，所以顶栏高度也不变。
 *
 * `compact`（窄屏顶栏用）只留印章、收起文字块。导航项改成四字之后，375px 下
 * 品牌块的 156.76px 和三项的 248px 加起来溢出 61.5px，而能腾的位置只有这里——
 * 印章本身就是品牌标识，收掉书名不损失可识别性，只是手机上不再逐字念出书名。
 * 桌面侧栏不受影响（240px 宽，四字带图标每项 106px，余 100px 出头）。
 */
function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-mark)] bg-[var(--color-seal)] font-serif text-base leading-none text-[var(--color-on-brand)]"
      >
        词
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-col">
          <span className="font-serif text-base font-semibold leading-tight tracking-[0.08em]">
            雅思词汇真经
          </span>
          <span className="text-[10px] leading-tight tracking-[0.14em] text-[var(--color-muted)]">
            IELTS VOCABULARY
          </span>
        </span>
      )}
    </span>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const immersive = IMMERSIVE.some((p) => pathname.startsWith(p));

  return (
    <div className="lg:flex">
      {/* 窄屏顶栏和左侧栏是同一个深色面，只是换了个方向——两处共用 DARK_SURFACE，
          于是「品牌面深、内容面浅」这个对比在两种尺寸下都成立。下边那条线走
          --color-line（在深色面上已被重定向到 rail-line）。 */}
      <header
        className={`sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-rail)] lg:hidden ${DARK_SURFACE}`}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-4 py-3">
          <span className="mr-auto">
            <BrandMark compact />
          </span>
          <Nav />
        </div>
      </header>

      {/* 侧边栏按「书末目录页」做，和 units 页面那套通栏细线 + 发丝线是同一套
          语言——全站只有一种「目录」的样子。目录式那套（小标题 + 发丝线）原样
          保留，颜色交给令牌。

          上一版右缘还有一对「书口双线」（border-r + after 伪元素），这一版去掉了：
          深色面与暖白面之间本来就是一道硬边界，参考图也是干净的直切，再叠两条
          线只会显脏。 */}
      {!immersive && (
        <aside
          className={`hidden px-4 py-6 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[240px] lg:shrink-0 lg:flex-col lg:bg-[var(--color-rail)] ${DARK_SURFACE}`}
        >
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
