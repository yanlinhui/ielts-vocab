# 雅思词汇真经 · 背单词

把《雅思词汇真经》的 3580 个词做成一个按 FSRS 间隔重复的背词工具：每日配额、错词重学、拼写听写、数据看板，外加 86 篇配套拓展阅读。

单人自用，私有部署。电脑和手机用同一个网址。

---

## 技术栈

Next.js 15（App Router）· TypeScript · Tailwind 4 · Prisma 6 + PostgreSQL · ts-fsrs

认证是零依赖的：密码用 Node 内置 `scrypt` 哈希存在环境变量里，会话是一个 HMAC 签名的 cookie。没有用户表、没有注册、没有第三方认证库。

---

## 本地跑起来

### 1. 依赖

- Node 20+（开发时用 22）
- PostgreSQL 16

### 2. 数据库

本项目不用 Docker——开发机上 Docker 拉不到镜像，改用免安装的便携版：

```bash
# 一次性：下载并解压
# https://get.enterprisedb.com/postgresql/postgresql-16.10-1-windows-x64-binaries.zip
# 解压到 E:\pg，得到 E:\pg\pgsql\bin

# 一次性：初始化数据目录（密码用 ielts_dev）
printf 'ielts_dev' > /tmp/pw.txt
E:/pg/pgsql/bin/initdb.exe -D "E:/pg/data" -U postgres --pwfile=/tmp/pw.txt -E UTF8 --locale=C

# 每次开机后：启动（没有装成服务，所以不会自启）
E:/pg/pgsql/bin/pg_ctl.exe -D "E:/pg/data" -l "E:/pg/pg.log" -o "-p 5432" start

# 一次性：建两个库
E:/pg/pgsql/bin/createdb.exe -U postgres ielts
E:/pg/pgsql/bin/createdb.exe -U postgres ielts_test
```

装了原生 PostgreSQL 或换成 Neon 的话，跳过上面这一段，只把连接串写进 `.env` 即可。

### 3. 环境变量

复制 `.env.example` 为 `.env`，然后：

```bash
# 生成密码哈希（输出贴进 AUTH_PASSWORD_HASH）
npm run auth:hash -- "你的密码"

# 生成签名密钥（输出贴进 AUTH_SECRET）
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

> `AUTH_PASSWORD_HASH` 用冒号分隔，不用美元符——`.env` 里的 `$` 会被 dotenv-expand 当变量展开，把哈希切碎。

### 4. 建表 + 灌词

```bash
npm install
npx prisma migrate deploy
npm run db:seed           # 22 章 / 3580 词 / 3645 条例句
npm run db:seed:passages  # 86 篇拓展阅读
npm run dev
```

> `db:seed` 读 `data/words.clean.json`，而 `data/` 不在仓库里（见最后一节）。没有原书的话，这一步跑不起来，只能先 `npm run db:seed:passages` 灌短文（`content/passages/` 是自写内容，在仓库里）。

打开 http://localhost:3000，会先跳到 `/login`。

> ⚠️ **`db:seed` 会删光所有学习进度**。它第一步就是清空 `User`、`UserWordProgress`、`ReviewLog`。日常更新词表以外，别在已有进度的库上跑。

---

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（3000 端口） |
| `npm test` | 72 条测试，跑在 `ielts_test` 库上，串行 |
| `npx tsc --noEmit` | 类型检查 |
| `npm run check:passages` | 校验 86 篇短文的标记与释义覆盖 |
| `npm run db:seed` | 重建词库（**会清空进度**） |
| `npm run db:seed:passages` | 重灌短文 |
| `npm run db:studio` | Prisma Studio |
| `npm run auth:hash -- "密码"` | 打印 `AUTH_PASSWORD_HASH` 的值 |
| `npm run db:import` | 从 `data/progress-export.json` 导入进度（见下） |

---

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 运行时连接串。线上用 Neon 的 pooled 串 |
| `DIRECT_URL` | 迁移和 seed 用的直连串（不带 `-pooler`） |
| `AUTH_PASSWORD_HASH` | `npm run auth:hash` 的输出 |
| `AUTH_SECRET` | 32 字节 hex。改掉它 = 所有设备立刻下线 |

Neon 上运行时串要带参数：

```
postgresql://...@ep-xxx-pooler.region.aws.neon.tech/ielts?sslmode=require&pgbouncer=true&connect_timeout=15&connection_limit=1
```

---

## 从 SQLite 迁移进度

这个项目最初用 SQLite，2026-10 换成 Postgres。如果你手上还有旧的 `prisma/dev.db`：

```bash
python scripts/export_sqlite.py   # -> data/progress-export.json
npm run db:seed && npm run db:seed:passages
npm run db:import
```

导入脚本按 `(章节号, 章内序号)` 找词，不依赖旧 id；导入前会清空目标库里的进度和流水。**导入之后不要再跑 `db:seed`**——那会把刚导进来的进度删掉。

---

## 部署

Vercel + Neon，免费额度够用。

1. Neon 建项目，拿 pooled 与 direct 两个连接串
2. Vercel 导入本仓库，填上表里四个环境变量
3. 本地对 Neon 跑一次迁移和 seed（**不进 build**）：
   ```bash
   DATABASE_URL=<direct> DIRECT_URL=<direct> npx prisma migrate deploy
   DATABASE_URL=<direct> DIRECT_URL=<direct> npm run db:seed
   DATABASE_URL=<direct> DIRECT_URL=<direct> npm run db:seed:passages
   ```
4. 部署后走一遍：登录 → 学习一个词 → 刷新看进度还在 → 登出

仓库可以保持私有——Vercel 免费版支持私有仓库。

---

## 关于词库数据

**这个仓库里没有词表。** `data/` 整个目录被 gitignore 掉了——里面是《雅思词汇真经》的例句、搭配、词根词源，逐字来自刘洪波与外研社的出版物，属于版权内容。

所以 clone 下来直接跑，数据库是空的。要跑起来得自备原书，用 `scripts/` 里的流水线（抠图 → OCR → 解析 → 校对）自己生成 `data/words.clean.json`。

代码本身是公开的，欢迎看；词表不提供下载。详见 `docs/plan.md` 第 6 节。

---

## 文档

| 文件 | 内容 |
|---|---|
| `docs/plan.md` | 分阶段计划、风险、版权判断 |
| `docs/PRD.md` | 功能口径与交互约定 |
| `docs/tech-spec.md` | 数据模型、算法、部署细节 |
