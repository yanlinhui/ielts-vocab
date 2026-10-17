import { NextResponse } from "next/server";
import { submitRating, type Rating } from "@/lib/srs";
import { getSessionUser } from "@/lib/user";

// 提交一次评分。浏览器这边只需要知道「下次什么时候再见」，
// 所有 FSRS 的计算都在服务端。
export async function POST(request: Request) {
  // 先认人再看请求体：没登录就不该拿到「你的参数哪里不对」这种反馈。
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { wordId?: unknown; rating?: unknown; elapsedMs?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const wordId = Number(body.wordId);
  const rating = Number(body.rating);
  if (!Number.isInteger(wordId) || wordId <= 0) {
    return NextResponse.json({ error: "wordId 不合法" }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(rating)) {
    return NextResponse.json({ error: "rating 必须是 1~4" }, { status: 400 });
  }

  const elapsedMs =
    typeof body.elapsedMs === "number" && body.elapsedMs >= 0
      ? Math.round(body.elapsedMs)
      : undefined;

  const result = await submitRating(user.id, wordId, rating as Rating, elapsedMs);

  return NextResponse.json({
    nextDueAt: result.nextDueAt.toISOString(),
    intervalMs: result.intervalMs,
    previews: {
      1: result.previews[1].toISOString(),
      2: result.previews[2].toISOString(),
      3: result.previews[3].toISOString(),
      4: result.previews[4].toISOString(),
    },
  });
}
