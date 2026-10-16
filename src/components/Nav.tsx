"use client";

import { useEffect, useState } from "react";
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
  // 章节词汇 —— 摊开的书：左右两页在书脊处相接，外侧上角是直角、靠书脊那侧收圆
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
  // 研习统计 —— 三根高低不同的竖柱 + 一条基线。折线在 16px 下会糊成一团，
  // 柱状读得出高低；和设置那两根滑杆也一眼分得开
  stats: (
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
      <path d="M3.6 11.6V8.8M8 11.6V4.4M12.4 11.6V6.6" />
      <path d="M2.6 13.2h10.8" />
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
// （四字 56 + 左右内边距 24），**四项**加项间间隙就是 332px，再放完整的品牌块
// （实测 156.76px）远远超出去。收内边距、降字号补不上这个缺口，只能从品牌块腾。
//
// 所以顶栏这一侧做了三件事：去掉图标；收起品牌文字块只留印章（见 AppShell 的
// `BrandMark compact`）；**2026-10-16 加进第四项之后**，再把项的左右内边距从
// 12px 收到 6px、项间间隙从 4px 收到 2px（都在下面 bar 那支 cls 里）。
//
// 收完的算术：印章 40 + 品牌↔导航间隙 4 + 导航 278（= 68×4 + 2×3）= 322px，
// 375px 下余 21px、360px 下余 6px。320px 由 AppShell 的 `max-[359px]:hidden`
// 兜底（藏掉印章省下 44px）。桌面侧栏 240px 宽、内容宽 208px，四项带图标竖排
// 绰绰有余，一个字都不用动。
//
// ⚠️ 加项前那一版是「三项 + 印章 = 292px」，现在那个数已经不对了。
const NAV = [
  { href: "/", label: "今日功课", icon: ICON.today },
  { href: "/units", label: "章节词汇", icon: ICON.units },
  { href: "/stats", label: "研习统计", icon: ICON.stats },
  { href: "/settings", label: "研习设置", icon: ICON.settings },
];

export default function Nav({ variant = "bar" }: { variant?: "bar" | "rail" }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const unitParam = searchParams.get("unit");
  const weakParam = searchParams.get("weak");
  const rail = variant === "rail";

  // 当前页。学习页自己没有导航项，归属看**是打哪儿进来的**——三个入口：
  // - 首页「开始」按钮 → `/study`（不带参数）  → 算「今日功课」
  //   这一页是首页那条动线的进行状态，不是并列的第四个板块
  // - 章节词汇点某一章 → `/study?unit=N`       → 算「章节词汇」
  // - 统计页点「集中攻克」 → `/study?weak=1`   → 算「研习统计」
  //
  // ⚠️ 必须读 search params，光看 pathname 分不出这三种——query 不在 pathname 里。
  // 一开始只判了 pathname、把整个 `/study` 都算给「今日功课」，于是从章节进来的
  // 学习页也亮「今日功课」，是个实打实的误导（2026-10-16 用户报的）。错词本同理：
  // 从统计页进来却亮「今日功课」，会让人以为刚才点的是首页那个「开始」。
  //
  // ⚠️ 两个参数的优先级要和 `study/page.tsx` 里那条分岔**判得一模一样**：那边是
  // `unit` 压过 `weak`，这里也必须是 `unit` 先判，否则 `?unit=3&weak=1` 时页面按
  // 章节走、高亮却亮「研习统计」。
  //
  // 用 `useSearchParams` 是安全的：五个页面全是 `force-dynamic`，没有静态预渲染，
  // 不会触发 CSR bailout（那才是需要 Suspense 边界的场景）。
  const current = pathname.startsWith("/study")
    ? unitParam
      ? "/units"
      : weakParam
        ? "/stats"
        : "/"
    : pathname;

  // 点击后**立刻**把高亮挪到目标项，不等新页面数据回来。
  //
  // 为什么需要：`current` 跟着 `usePathname()` 走，而 pathname 是等新页面整棵子树
  // commit 之后才变的。五个页面全是 `force-dynamic`，所以这中间隔着一次完整的服务端
  // 往返——本地 dev 热态实测高亮要等 65~185ms 才动，服务端正在编译路由（改完文件
  // 第一次访问）时到 1~2 秒。这段时间高亮还停在旧项上；loading 骨架也要等服务端把
  // 第一段流回来才出现（实测再晚 60~90ms），所以点击后有个上百毫秒的窗口**画面完全
  // 不动**，观感就是「点了没反应」。用本地的 `pending` 先接管，pathname 一变就交还。
  //
  // ⚠️ 这不是 dev 特有的：dev 只是把服务端往返拖长了，正式构建下同样存在这一段，
  // 只是短到几乎看不见。所以这条改动在哪个模式下都成立。
  //
  // 换 unit / weak 参数也算「变了」：从 `/study?unit=3` 到 `/study?unit=7` 走的是
  // 同一段路径，只盯 pathname 的话 pending 永远清不掉。错词本同理——浏览器前进后
  // 退在 `/study?unit=3` 和 `/study?weak=1` 之间来回时，pathname 一次都没变。
  //
  // ⚠️ `pending` 只用来**上色**，不用来写 `aria-current`（见下面 active / lit 两行）。
  // 页面其实还没到，就把新项标成「当前页」，读屏软件会提前念错。
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [pathname, unitParam, weakParam]);

  return (
    <nav className={rail ? "flex flex-col" : "flex items-center gap-0.5"}>
      {NAV.map((item) => {
        // 根路径要全等，否则任何页面都会命中 "/"
        const active =
          item.href === "/" ? current === "/" : current.startsWith(item.href);

        // 上色用的值：正在路上时**只亮目标那一项**，落地后再交还给真实的当前页。
        // 不能写成 `active || item.href === pending`——从点击到 pathname 追上来的这
        // 60~110ms 里，新旧两项会同时亮着。`pending` 里存的只会是 NAV 那四个 href，
        // 所以这里直接比字符串就够。
        const lit = pending ? item.href === pending : active;

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
        // ⚠️ bar 这一支的左右内边距 12px → 6px 是 2026-10-16 加第四项时收的
        // （算术见上面 NAV 那段）。**rail 那支的 px-3 不要跟着动**——侧栏每项
        // 有 208px 可用，收它只会让图标和文字贴到边线上；「两处保持一致」在这里
        // 是错的。仓里另外还有一个 gap-1 在 AppShell 顶栏容器上（品牌↔导航那个），
        // 那个也保留不动，收到 2px 的只有上面 `<nav>` 的项间间隙。
        const cls = rail
          ? `flex items-center gap-2.5 rounded-[var(--radius-control)] border-b border-b-[var(--color-line)] px-3 py-2.5 text-sm transition last:border-b-0 ${
              lit
                ? "bg-[var(--color-rail-seal)] font-medium text-[var(--color-ink)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-rail-seal-soft)] hover:text-[var(--color-ink)]"
            }`
          : `flex items-center border-b-2 px-1.5 py-1.5 text-sm transition ${
              lit
                ? "border-b-[var(--color-seal)] font-medium text-[var(--color-ink)]"
                : "border-b-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setPending(item.href)}
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
