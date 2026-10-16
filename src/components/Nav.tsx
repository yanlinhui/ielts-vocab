"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// 导航链接。拆成 client component 是因为 layout.tsx 是 server component，
// 读不到 pathname —— 而「当前在哪一页」必须高亮出来，否则三个链接永远长得一样。
//
// 两个 variant 共用同一份 NAV 和同一套「当前页」判定：
// - bar ：窄屏顶部栏，横排
// - rail：桌面左侧栏，竖排
//
// 两个 variant 的差别现在只剩**排布方向和要不要图标**：颜色全部走语义令牌。
// 侧栏和顶栏都是深色，但这里一行深色判断都没有——父容器就地改写了那几个令牌
// （见 AppShell 的 DARK_SURFACE），深色值自动流进来。每加一个容器就补一处
// 「if 深色」的写法必然漏，所以不走那条路。

// 图标一律 16px、fill="none" + **stroke="currentColor"**：颜色跟着文字走，
// 深浅两套都不用管。三个图标手写比引一个图标库划算，也不增加依赖。
const ICON = {
  // 今日 —— 日历
  today: (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4 shrink-0"
    >
      <rect x="2.2" y="3.4" width="11.6" height="10.8" rx="1.6" />
      <path d="M2.2 6.7h11.6M5.6 2v2.8M10.4 2v2.8" />
    </svg>
  ),
  // 词库 —— 摊开的书：左右两页在书脊处相接，外侧上角是直角、靠书脊那侧收圆
  units: (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4 shrink-0"
    >
      <path d="M2.6 3.4h3.6a1.8 1.8 0 0 1 1.8 1.8v7.4a1.8 1.8 0 0 0-1.8-1.8H2.6z" />
      <path d="M13.4 3.4H9.8a1.8 1.8 0 0 0-1.8 1.8v7.4a1.8 1.8 0 0 1 1.8-1.8h3.6z" />
    </svg>
  ),
  // 设置 —— 两根滑杆。齿轮在 16px 下笔画会糊成一团，滑杆清楚得多
  settings: (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4 shrink-0"
    >
      <path d="M2.6 5.2h10.8M2.6 10.8h10.8" />
      <circle cx="6.2" cy="5.2" r="1.7" />
      <circle cx="9.8" cy="10.8" r="1.7" />
    </svg>
  ),
};

// **图标只上 rail，顶栏那个 `icon` 字段不取用，不是漏了。**
// 窄屏顶栏是横排的，375px 下可用宽度只有 343.3px。四个字的项每项 80px
// （四字 56 + 左右内边距 24），三项加间隙 248px，再放完整的品牌块（实测
// 156.76px）就是 404.76px——**溢出 61.5px**。收内边距（每项省 12px）、降字号
// 到 13px（每项省 4px）最多补 48px，补不上这个缺口。
//
// 所以顶栏这一侧做了两件事：去掉图标，并且收起品牌文字块只留印章
// （见 AppShell 的 `BrandMark compact`）。收完是 印章 40 + 间隙 4 + 248 =
// 292px，余 55px。桌面侧栏 240px 宽放得下图标 + 四字（每项 106px），不受影响。
const NAV = [
  { href: "/", label: "今日功课", icon: ICON.today },
  { href: "/units", label: "章节词汇", icon: ICON.units },
  { href: "/settings", label: "研习设置", icon: ICON.settings },
];

export default function Nav({ variant = "bar" }: { variant?: "bar" | "rail" }) {
  const pathname = usePathname();
  const unitParam = useSearchParams().get("unit");
  const rail = variant === "rail";

  // 当前页。学习页自己没有导航项，归属看**是打哪儿进来的**——两个入口：
  // - 首页「开始」按钮 → `/study`（不带参数）  → 算「今日功课」
  //   这一页是首页那条动线的进行状态，不是并列的第四个板块
  // - 章节词汇点某一章 → `/study?unit=N`       → 算「章节词汇」
  //
  // ⚠️ 必须读 search params，光看 pathname 分不出这两种——query 不在 pathname 里。
  // 一开始只判了 pathname、把整个 `/study` 都算给「今日功课」，于是从章节进来的
  // 学习页也亮「今日功课」，是个实打实的误导（2026-10-16 用户报的）。
  //
  // 用 `useSearchParams` 是安全的：四个页面全是 `force-dynamic`，没有静态预渲染，
  // 不会触发 CSR bailout（那才是需要 Suspense 边界的场景）。
  const current = pathname.startsWith("/study")
    ? unitParam
      ? "/units"
      : "/"
    : pathname;

  return (
    <nav className={rail ? "flex flex-col" : "flex items-center gap-1"}>
      {NAV.map((item) => {
        // 根路径要全等，否则任何页面都会命中 "/"
        const active =
          item.href === "/" ? current === "/" : current.startsWith(item.href);

        // 当前页两套排布都用**朱砂**标出来，但画法不同，因为两个面的高度差很多：
        // - rail：整块朱砂覆盖（选中实色、划过半透明），文字提到 rail-ink
        // - bar ：只画一条下划线。窄屏顶栏只有一行高，再压一块底色会把品牌字挤没
        //
        // ⚠️ 覆盖块用的不是 --color-seal 本身，是侧栏专用的 --color-rail-seal：
        // 纯朱砂压在 rail-ink 上只有 4.09:1，14px 正文差一点点，压暗一档才有
        // 4.65:1（推导见 globals.css 那段）。
        //
        // ⚠️ 边框色一律写成「哪一边」的形式（border-b-*），不用 border-[color]
        // 这种四边简写：简写会把相邻项的目录分隔线一起覆盖掉。
        const cls = rail
          ? `flex items-center gap-2.5 rounded-[var(--radius-control)] border-b border-b-[var(--color-line)] px-3 py-2.5 text-sm transition last:border-b-0 ${
              active
                ? "bg-[var(--color-rail-seal)] font-medium text-[var(--color-ink)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-rail-seal-soft)] hover:text-[var(--color-ink)]"
            }`
          : `flex items-center border-b-2 px-3 py-1.5 text-sm transition ${
              active
                ? "border-b-[var(--color-seal)] font-medium text-[var(--color-ink)]"
                : "border-b-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cls}
          >
            {rail && item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
