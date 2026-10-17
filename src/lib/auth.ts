import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// 认证的最小实现。只服务一个用户，所以不建 Session 表、不引 auth 库：
// 密码用 scrypt 哈希存在环境变量里，会话用一个 HMAC 签名的 cookie。
//
// **这个文件不 import next/headers**——`scripts/hash_password.ts` 要能直接用它。
// 读 cookie 的部分在 `lib/user.ts`。

export const SESSION_COOKIE = "ielts_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET 未设置或短于 32 个字符");
  }
  return value;
}

// 用冒号不用美元符：`$` 在 .env 里会被 dotenv-expand 当成变量引用展开，
// Next 的加载器正是这么做的——写成 `scrypt$...$...` 存进去会被切成两段空串。
// base64url 里不含 `:`，所以这个分隔符没有歧义。
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split(":");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, "base64url");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signSession(userId: number, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, e: now + SESSION_TTL_MS }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySession(token: string, now = Date.now()): { userId: number } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: unknown;
      e?: unknown;
    };
    if (typeof data.u !== "number" || typeof data.e !== "number") return null;
    if (data.e < now) return null;
    return { userId: data.u };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
