import { PrismaClient } from "@prisma/client";

// Next.js 的 dev 模式会热重载模块。如果每次都 new 一个 PrismaClient，
// 几十次热重载之后就会耗尽 SQLite 的连接。所以挂到 globalThis 上复用，
// 生产环境无所谓（进程只起一次），只在 dev 下这么干。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
