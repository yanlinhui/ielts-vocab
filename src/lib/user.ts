import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "./auth";
import { prisma } from "./db";

// 数据模型按多用户建（Word 共享、UserWordProgress 按用户分），但这一版是
// 私有部署、只有一个用户。登录只回答「来的是不是作者」这一个问题。
//
// 两个入口：
// - `getCurrentUser()` 给页面用。没会话就跳登录页——6 个页面都调它，
//   所以加登录时页面一行不用改。
// - `getSessionUser()` 给 Route Handler 用。没会话返回 null，路由自己回 401；
//   在 API 里 redirect 会让 fetch 跟到登录页的 HTML，是错误的答案。

export async function getSessionUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = verifySession(token);
  if (!session) return null;

  return prisma.user.findUnique({ where: { id: session.userId } });
}

export async function getCurrentUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
