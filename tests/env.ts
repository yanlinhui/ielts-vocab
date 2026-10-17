// 测试专用的数据库连接。
//
// ⚠️ **这个模块必须被每个测试文件第一个 import**，而且要写成静态 import 排在
// 别的 import 前面。ESM 的 import 求值顺序就是声明顺序；写反了的话 `db.ts` 会先
// 求值，那时 `DATABASE_URL` 还是 `.env` 里的开发库——测试就会往你的真实学习进度
// 里写数据、又删又建。这不是理论风险，是这个文件存在唯一理由。
//
// 为什么覆盖环境变量就够：Prisma 运行时解析 datasource 时会读 `process.env`，
// 而它加载 `.env` 走的是 dotenv 语义——**已经存在的变量优先，不会被 `.env` 覆盖**。
//
// ⚠️ **两个变量都要设**。Prisma Migrate 优先用 `DIRECT_URL`，只覆盖 `DATABASE_URL`
// 的话，`prisma migrate deploy` 会对着 `.env` 里那份跑——本地它就是开发库，线上
// 部署后它就是生产库。删表的是测试的 resetDb，后果不用细说。
const TEST_DB_URL = "postgresql://postgres:ielts_dev@localhost:5432/ielts_test?schema=public";

process.env.DATABASE_URL = TEST_DB_URL;
process.env.DIRECT_URL = TEST_DB_URL;
