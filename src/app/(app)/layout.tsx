import AppShell from "@/components/AppShell";

// 需要导航壳的页面都放在这个路由组里。登录页在组外——它不该带侧栏，
// 也不该在未登录时让人看见一个点不动的目录。
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
