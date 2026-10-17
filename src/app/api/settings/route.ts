import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/user";

function clampInt(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const data: {
    dailyNewLimit?: number;
    dailyReviewLimit?: number;
    accent?: string;
    autoSpeak?: boolean;
  } = {};

  const newLimit = clampInt(body.dailyNewLimit, 1, 200);
  if (newLimit !== undefined) data.dailyNewLimit = newLimit;

  const reviewLimit = clampInt(body.dailyReviewLimit, 1, 999);
  if (reviewLimit !== undefined) data.dailyReviewLimit = reviewLimit;

  if (body.accent === "uk" || body.accent === "us") data.accent = body.accent;
  if (typeof body.autoSpeak === "boolean") data.autoSpeak = body.autoSpeak;

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true });
}
