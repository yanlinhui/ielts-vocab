import { prisma } from "./db";

// 现在没有登录，整个应用只服务一个人。
//
// 但数据模型是按多用户建的（Word 共享、UserWordProgress 按用户分），
// 所以这里只是「当前用户是谁」这一个问题需要一个答案。以后加登录时，
// 把这个函数换成「从 session 里取用户」即可，其余代码不用动。
//
// 取最早创建的那个用户；一个都没有就建一个（数据库清空后也能自愈）。

export async function getCurrentUser() {
  const existing = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      name: "me",
      settings: { create: { dailyNewLimit: 20, dailyReviewLimit: 200 } },
    },
  });
}
