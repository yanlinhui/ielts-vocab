// 测试专用的数据库连接。
//
// ⚠️ **这个模块必须被每个测试文件第一个 import**，而且要写成静态 import 排在
// 别的 import 前面。ESM 的 import 求值顺序就是声明顺序；写反了的话 `db.ts` 会先
// 求值，那时 `DATABASE_URL` 还是 `.env` 里的 `dev.db`——测试就会往你的真实学习
// 进度里写数据、又删又建。这不是理论风险，是这个文件存在唯一理由。
//
// 为什么覆盖一个环境变量就够：Prisma 运行时解析 datasource 时会读 `process.env`，
// 而它加载 `.env` 走的是 dotenv 语义——**已经存在的变量优先，不会被 `.env` 覆盖**。
// 所以在这里设过之后，`prisma/dev.db` 在整个测试进程里碰都不会被碰。
//
// 路径基准是 `prisma/schema.prisma` 所在目录，所以 `file:./test.db` 指的是
// `prisma/test.db`——和 `.env` 里 `file:./dev.db` → `prisma/dev.db` 同一个规矩。
// `prisma/*.db*` 在 .gitignore 里，测试库不会进版本库。
process.env.DATABASE_URL = "file:./test.db";
