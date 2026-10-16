"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 导航链接。拆成 client component 是因为 layout.tsx 是 server component，
// 读不到 pathname —— 而「当前在哪一页」必须高亮出来，否则三个链接永远长得一样。
//
// 两个 variant 共用同一份 NAV 和同一套「当前页」判定：
// - bar ：窄屏顶部栏，横排
// - rail：桌面左侧栏，竖排
const NAV = [
  { href: "/", label: "今日" },
  { href: "/units", label: "词库" },
  { href: "/settings", label: "设置" },
];

export default function Nav({ variant = "bar" }: { variant?: "bar" | "rail" }) {
  const pathname = usePathname();
  const rail = variant === "rail";

  return (
    <nav className={rail ? "flex flex-col" : "flex items-center gap-1"}>
      {NAV.map((item) => {
        // 根路径要全等，否则任何页面都会命中 "/"
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        // 当前页两套排布都只用**一条朱砂短线**标出来（竖排是左侧竖条、横排是下划线），
        // 文字本身走墨色。朱砂对纸面只有 3.78:1，够画线，不够 14px 正文——
        // 这也是两套 variant 唯一能共用的画法。竖排那套还去掉了原来的整块淡绿底，
        // 印刷品用线和字重区分，不用底色。
        //
        // ⚠️ 边框色一律写成「哪一边」的形式（border-l-* / border-b-*），不用
        // border-[color] / border-transparent 这种四边简写。竖排的项同时有一条
        // 目录分隔线（下边）和一条当前页标记（左边），简写会把分隔线的颜色一起
        // 覆盖掉：实测当前页下面那条线变成朱砂、非当前页之间那条线变成全透明。
        const cls = rail
          ? `border-b border-l-2 px-3 py-2.5 text-sm transition last:border-b-0 ${
              active
                ? "border-b-[var(--color-line)] border-l-[var(--color-seal)] font-medium text-[var(--color-ink)]"
                : "border-b-[var(--color-line)] border-l-transparent text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            }`
          : `border-b-2 px-3 py-1.5 text-sm transition ${
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
