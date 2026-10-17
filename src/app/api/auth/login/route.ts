import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/db";

// 登录失败限速。serverless 下计数不跨实例，所以它只是一层减速带——
// 真正的防线是一个足够长的随机密码（见 README）。
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

function exhausted(key: string): boolean {
  const record = attempts.get(key);
  return Boolean(record && record.resetAt > Date.now() && record.count >= MAX_ATTEMPTS);
}

function recordFailure(key: string) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    record.count += 1;
  }
}

function to(path: string, request: Request) {
  // 303：表单 POST 之后必须让浏览器改用 GET，否则刷新会重放这次 POST。
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request) {
  const key = clientKey(request);
  if (exhausted(key)) return to("/login?error=locked", request);

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const stored = process.env.AUTH_PASSWORD_HASH ?? "";

  if (!stored || !verifyPassword(password, stored)) {
    recordFailure(key);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return to("/login?error=1", request);
  }

  const user = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  if (!user) return to("/login?error=nouser", request);

  attempts.delete(key);
  const response = to("/", request);
  response.cookies.set(SESSION_COOKIE, signSession(user.id), sessionCookieOptions());
  return response;
}
