"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 导航链接。拆成 client component 是因为 layout.tsx 是 server component，
// 读不到 pathname —— 而「当前在哪一页」必须高亮出来，否则三个链接永远长得一样。
const NAV = [
  { href: "/", label: "今日" },
  { href: "/units", label: "词库" },
  { href: "/settings", label: "设置" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <>
      {NAV.map((item) => {
        // 根路径要全等，否则任何页面都会命中 "/"
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`border-b px-3 py-1.5 text-sm transition ${
              active
                ? "border-[var(--color-brand)] font-medium text-[var(--color-brand)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
