import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/user";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "1": "密码不对。",
  locked: "试得太多了，十分钟后再来。",
  nouser: "数据库里还没有用户，先跑一次 npm run db:seed。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // 已经登录的人不该再看到这一页
  if (await getSessionUser()) redirect("/");

  const { error } = await searchParams;
  const message = error ? ERRORS[error] ?? "登录失败。" : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-canvas)] px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-mark)] bg-[var(--color-seal)] font-serif text-lg leading-none text-[var(--color-on-brand)]"
          >
            词
          </span>
          <span className="flex flex-col">
            <span className="font-serif text-xl font-semibold leading-tight tracking-[0.08em]">
              雅思词汇真经
            </span>
            <span className="text-[10px] tracking-[0.14em] text-[var(--color-muted)]">
              IELTS VOCABULARY
            </span>
          </span>
        </div>

        <form
          method="post"
          action="/api/auth/login"
          className="mt-8 flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
        >
          <label htmlFor="password" className="text-sm text-[var(--color-muted)]">
            密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2.5 text-base text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
          />
          <button
            type="submit"
            className="mt-1 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2.5 text-base text-[var(--color-on-brand)] transition-opacity hover:opacity-90"
          >
            进入
          </button>
          {message && (
            <p role="alert" className="text-sm text-[var(--color-rate-again)]">
              {message}
            </p>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
          私有部署，只给一个人用。
        </p>
      </div>
    </main>
  );
}
