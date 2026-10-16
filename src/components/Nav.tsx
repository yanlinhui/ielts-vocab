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
    <nav className={rail ? "flex flex-col gap-0.5" : "flex items-center gap-1"}>
      {NAV.map((item) => {
        // 根路径要全等，否则任何页面都会命中 "/"
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        // 竖排那张用左侧一道墨绿竖条标当前页——和 WordCard 的 Section 标题
        // 是同一种符号，不为了侧边栏再发明一套视觉语言。
        const cls = rail
          ? `border-l-2 px-3 py-2 text-sm transition ${
              active
                ? "border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_10%,transparent)] font-medium text-[var(--color-brand)]"
                : "border-transparent text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            }`
          : `border-b px-3 py-1.5 text-sm transition ${
              active
                ? "border-[var(--color-brand)] font-medium text-[var(--color-brand)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]"
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
