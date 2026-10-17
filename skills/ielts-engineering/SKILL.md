---
name: ielts-engineering
description: 工程底座，进入仓库先读这一份。涵盖代码地图与硬约束、运行命令、测试体系、登录与 Vercel/Neon 部署、文档同步规则。要跑起来、写或跑测试、排查“单独跑全过一起跑随机红”“测试写进了开发库”、改密码、处理国内访问与域名、审计文档时使用。
---

# 工程底座（导航 / 测试 / 部署 / 文档）

## 一、项目与代码地图

《雅思词汇真经》3580 词的 FSRS 间隔重复背词工具，单人自用、私有部署。

- 线上：`https://www.princesscode666.com`（Vercel 函数 + Neon Postgres）
- 本地：Next.js 15 App Router + TypeScript + Tailwind 4 + Prisma 6 + ts-fsrs
- 功能区：首页、章节、学习/复习、统计、拼写、拓展阅读，外加设置与登录

```
页面 / 客户端组件          src/app/(app)/*, src/components/*
        ↓ 只调下面导出的函数
业务与查询（server-only）  src/lib/session.ts   队列、今日统计、日期口径
                          src/lib/srs.ts       FSRS 调度（唯一 import ts-fsrs）
                          src/lib/stats.ts     热力图、每日一句、统计页聚合
                          src/lib/spelling.ts  拼写比对（纯函数，客户端可 import）
                          src/lib/passages.ts  短文解析（纯函数）
                          src/lib/auth.ts      哈希、签名、cookie（不 import next/headers）
                          src/lib/user.ts      getCurrentUser / getSessionUser
        ↓
数据                      prisma/schema.prisma → Neon / 本地 Postgres
内容源                    content/passages/*.md（在仓库）
                          data/*（不在仓库，含书中原文）
```

**分层不是形式。** 客户端组件 import 一个牵着 Prisma 的文件会让整包构建炸掉；`Rating` 单独放在 `lib/rating.ts` 就是为了这个，见 `ielts-study`。

页面路由在 `src/app/(app)/` 路由组里，共享 `AppShell` 和 `loading.tsx`；`src/app/login/page.tsx` 在组外，所以没有侧栏。`loading.tsx` 必须留在 `(app)/` 内，否则骨架会盖掉整个侧栏。

## 二、硬约束

1. **`next dev` 在 3000 端口运行，与 `next build` 共用 `.next/`。** dev 开着时不要跑 `next build` / `npm run build`，会互相破坏产物。要构建就先停 dev。
2. **`.env` 是红线。** 修改前必须问用户。里面的 `AUTH_PASSWORD_HASH` / `AUTH_SECRET` / 数据库连接串都是真值。
3. **`data/`、`ecdict/`、`*.pdf` 永不入库。** `.gitignore` 已挡；这些是出版社版权内容。
4. **仓库是公开的。** 文档、注释、提交里都不能写线上密码、`AUTH_SECRET`、完整哈希或书中例句原文。
5. **不自动 commit / push。** 用户明确要求才做，提交前先把 commit message 全文打给用户看。
6. **数据库迁移只维护 Postgres 一套。** `prisma/migrations-sqlite/` 是历史存档，不要往里加东西。
7. **文档里的日期记录是历史，不要改写。** 现状陈述过时了要改；带日期的实测记录保留。

## 三、跑起来

```bash
# 1. Postgres（免安装便携版，没有装成服务，每次开机要手动起）
E:/pg/pgsql/bin/pg_ctl.exe -D "E:/pg/data" -l "E:/pg/pg.log" -o "-p 5432" start

# 2. 依赖与表
npm install
npx prisma migrate deploy

# 3. 数据（注意：db:seed 会清空所有学习进度）
npm run db:seed
npm run db:seed:passages

# 4. 开发服务器
npm run dev        # http://localhost:3000，会先跳 /login
```

没有 `data/words.clean.json` 时 `db:seed` 跑不了，只能先灌短文。

### 常用命令

| 命令 | 作用 | 注意 |
|---|---|---|
| `npm run dev` | 开发服务器 | 与 build 互斥 |
| `npx tsc --noEmit` | 类型检查 | 每次改动都跑 |
| `npm test` | 72 条测试 | 跑 `ielts_test`，串行 |
| `npm run check:passages` | 86 篇短文覆盖率 | 缺词会非零退出 |
| `npm run db:seed` | 重建词库 | **清空进度** |
| `npm run db:seed:passages` | 重灌短文 | 幂等 |
| `npm run db:import` | 导入 SQLite 时代进度 | 之后不能再 seed |
| `npm run auth:hash -- "密码"` | 生成密码哈希 | 只在换密码时用 |
| `npm run db:studio` | Prisma Studio | 只读排查优先 |

### 改动落点

| 想改什么 | 先看这里 |
|---|---|
| 每天给哪些词、什么顺序 | `src/lib/session.ts` + `ielts-study` |
| 间隔、难度、评分后的排期 | `src/lib/srs.ts` + `ielts-study` |
| 发音、自动朗读、音色 | `src/lib/tts.ts`、`WordCard` + `ielts-study` |
| 拼写判对错、听写 | `src/lib/spelling.ts`、`SpellSession` + `ielts-spelling` |
| 短文标记、覆盖率、自测显隐 | `src/lib/passages.ts`、`scripts/lib/passage-files.ts` + `ielts-reading` |
| 热力图、每日一句、统计口径 | `src/lib/stats.ts` + `ielts-stats-ui` |
| 颜色、字体、圆角、对比度 | `src/app/globals.css` + `ielts-stats-ui` |
| 表结构、seed、迁移 | `prisma/` + `ielts-word-data` |
| 词表提取流水线 | `scripts/` + `ielts-word-data` |
| 登录、cookie、部署、域名 | `src/lib/auth.ts`、`src/lib/user.ts` + 本文第四节 |
| PRD / 技术规范 / 计划 | `docs/` + 本文第五节 |

### 服务端读用户的两种入口

- 页面用 `getCurrentUser()`：没会话直接 `redirect("/login")`
- Route Handler 用 `getSessionUser()`：没会话返回 `null`，自己回 401。API 里不要 redirect，否则 `fetch` 会拿到登录页 HTML

## 四、测试

- 3 个文件，72 条用例：`srs.test.ts`（12）、`session.test.ts`（43）、`spelling.test.ts`（17）
- 跑在本地 `ielts_test` 库上
- `npm test` 已带 `--test-concurrency=1`，**必须串行**

### 四条基础设施约束

1. **`import "./env"` 必须是每个测试文件的第一个 import。** ESM 按声明顺序求值；写反了，`lib/db.ts` 会先实例化 PrismaClient，那时 `DATABASE_URL` 还是 `.env` 里的开发库——测试会往真实学习进度里又写又删。
2. **`DATABASE_URL` 和 `DIRECT_URL` 都要覆盖。** Prisma Migrate 优先读 `DIRECT_URL`，只改一个的话 `migrate deploy` 会对着 `.env` 里那份跑。
3. **`helpers.ts` 会 import db，只能在 env 之后。** 它自己也会断言两个变量都指向测试库，顺序错了当场报错，这是有意的。
4. **测试库只允许本机。** `assertLocalTestDb()` 检查 host 是 `localhost` / `127.0.0.1`。`migrate deploy` 和 `resetDb` 都不可逆，这条防呆不要删。

### fixture 的坑

`makeProgress()` 里：

- `difficulty` 默认 **5**，不是 0。ts-fsrs 合法区间 1..10，留 0 会当场抛 `FSRSValidationError`
- `stability` 默认 1
- `createdAt` 可显式给。“今天新学了多少”和“是不是旧词”全靠这一列
- 只给 `state` 不给 `scheduledDays`，`isMastered` 会判错

清库顺序 `resetDb()` 必须子表在前：

```
ReviewLog → UserWordProgress → WordExample → Word → Unit → UserSettings → User
```

### 每个测试怎么写

- 断言**关系**，不写精确日期。`enable_fuzz` 的 seed 跟着时钟变
- 例外：学习步长（分钟级）不过 fuzz，可以精确断言
- 时间相关用 `daysAgo()` 造相对时间，不写死日期
- 测队列时先 `makeUser` + `makeUnit` + `makeWord` + `makeProgress`，再断言 id 数组的顺序
- 测口径时覆盖空数据分支

### 变异检查

测试变绿不等于它在测东西。改完核心逻辑后至少做一次：故意改坏一个条件（比如 `>= 21` 改成 `>= 20`），确认有测试变红，再改回来。

重点覆盖：`isMastered` 的 21 天边界、拼写回溯的 `same` 条件、错词本的 `flatMap` 顺序、章节专项的 `progress: { none: ... }`。

### 不要做的事

- 不要把测试指向 Neon 或 `ielts` 开发库
- 不要为了并发提速去掉 `--test-concurrency=1`
- 不要在测试里 mock Prisma；这些测试的价值就在于真的落库
- 不要用 `db push` 建测试库，统一 `migrate deploy`
- Windows 上 `execFileSync` 调 `npx.cmd` 必须带 `shell: true`，原因写在 `helpers.ts` 里，不要“优化”掉

## 五、登录与部署

### 认证怎么做的

不建 Session 表、不引认证库。只有一个人用：

- 密码：Node 内置 `scryptSync`，存环境变量 `AUTH_PASSWORD_HASH`
- 会话：HMAC-SHA256 签名的 cookie `ielts_session`，30 天
- 没有注册和找回密码

**哈希格式用冒号，不用美元符：**

```
scrypt:<saltB64url>:<hashB64url>
```

`.env` 里的 `$` 会被 dotenv-expand 当变量引用展开，`scrypt$...$...` 会被切成两段空串。base64url 不含 `:`，所以冒号无歧义。

登录 `/api/auth/login`：校验密码 → 设 cookie → `303` 回 `/`。登出同理回 `/login`。用 303 不用 307，防止浏览器重放 POST。

限速：同一 IP 10 分钟内失败 5 次后回 `/login?error=locked`，失败响应额外延迟 300ms。计数在内存里，serverless 下不跨实例，只是一层减速带；真正的防线是密码本身足够长、不可猜。

登录成功取 `prisma.user.findFirst({ orderBy: { id: "asc" } })`——单用户假设。将来真要多账号，这里和 `getSessionUser` 一起改。

### 改密码

```bash
npm run auth:hash -- "新密码"
```

1. 把输出贴进 **Vercel 项目的同名环境变量** `AUTH_PASSWORD_HASH`
2. **必须 Redeploy。** 环境变量只对之后的新部署生效，改完不重部署，旧密码照样能登
3. 本地同时改 `.env`，然后重启 `npm run dev`

注意：

- `AUTH_SECRET` 不变，已登录设备**不会**被踢下线
- 想强制所有设备下线，换 `AUTH_SECRET`
- 线上密码、哈希、`AUTH_SECRET` 不写进任何文档、注释或提交

### Vercel 配置

| 项 | 值 | 原因 |
|---|---|---|
| Function Region | `sin1` | 与 Neon `ap-southeast-1` 同区；跨区每次查询多几十到几百毫秒 |
| Build Command | `prisma generate && next build` | 客户端类型要先生成 |
| 迁移 / seed | **不进 build**，本地手动对 Neon 跑 | build 里跑迁移会并发执行、且拿不到直连串 |
| Deployment Protection | 关掉 Vercel Authentication | 否则所有地址 302 到 Vercel 登录页 |

验证区域：响应头 `x-vercel-id` 形如 `hnd1::sin1::...`，第二段是执行区域。

环境变量四个：

```
DATABASE_URL      <pooled，带 -pooler，附 sslmode=require&pgbouncer=true&connect_timeout=15&connection_limit=1>
DIRECT_URL        <direct，不带 -pooler>
AUTH_PASSWORD_HASH
AUTH_SECRET
```

### 国内访问

`*.vercel.app` 在国内 TCP 能连，TLS 握手会被按 SNI 掐断。绑自己的域名即可。

- 裸域 A 记录 `76.76.21.21`。Vercel 向导默认给的 `216.198.79.1` 在国内连不上
- `www` CNAME 指向 `cname.vercel-dns.com`，并且要在 Vercel Domains 里也加过，否则签不出证书
- Neon 在境外，不受影响，可直连

完整排查记录见 `docs/tech-spec.md` 16.9。

### 从本机 push

本机直连 GitHub 会被重置。经本地代理可以：

```bash
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push
```

**push 是红线。** 用户明确要求才做。

### 上线 smoke test

1. `/login` 错密码 → 停在登录页
2. 对密码 → 进首页
3. 学一个词 → 刷新 → 进度还在
4. `/settings` 登出 → 所有页回 `/login`
5. 直接请求 `/api/settings` 不带 cookie → 401
6. 手机用同一个网址走一遍

不要只看 Vercel 状态徽标。用登录 cookie 抓目标页，grep 新文案或新行为，比状态更可靠。

## 六、文档维护

### 四份文档的分工

| 文件 | 回答什么 | 不该写什么 |
|---|---|---|
| `docs/PRD.md` | 用户看到什么、怎么交互、口径是什么 | 实现细节、代码路径 |
| `docs/tech-spec.md` | 怎么实现、为什么这样选、踩过什么坑 | 产品决策的反复讨论 |
| `docs/plan.md` | 分几个阶段、做到哪了、风险与版权判断 | 具体函数实现 |
| `README.md` | 怎么跑、命令、环境变量、部署 | 长篇设计论证 |

三份 docs 是项目的长期记忆。改动功能却只改代码、不改文档，下一轮就会基于过期描述做判断。

### 历史不改写

文档里有两类句子：

1. **带日期的实测记录**：“2026-10-16 实测，23 个词里……”
2. **现状陈述**：“数据库是 SQLite”“MVP 不做登录”

第二类过时了必须改。第一类**保留原样**，它是当时的证据。

现状变了又想保留来龙去脉时，加引用块：

```markdown
> 2026-10-17 更新：已换成 Postgres，本节描述的 SQLite 机制仅作历史记录。
```

### “明确不做”表冻结

`docs/plan.md` 第 2 节的“明确不做”冻结了立项时的判断，**不要因为它和现在不一致就改**。

例子：当时写“不做多用户登录”，后来加了单密码门锁。正确做法是在阶段四和进度里记“多用户登录改为单密码门锁”，而不是回去改那张表。关掉或放弃一项功能时，要写清依据，不要静默删除。

### 公开仓库的脱敏

绝不能出现：线上密码、`AUTH_PASSWORD_HASH`、`AUTH_SECRET`、书中原文的例句/搭配/词源、完整的数据库连接串。可以写变量名、格式、生成命令，不能写值。示例标明“结构示意，非书中原文”。

### 改功能后的同步清单

| 改动类型 | 要更新 |
|---|---|
| 新增/修改页面交互 | PRD 对应 2.x + tech-spec 对应实现小节 |
| 改队列/统计口径 | PRD 口径 + tech-spec 对应章节 + 测试说明 |
| 改 schema/迁移 | tech-spec 4.1/4.2 + README 环境变量表（如涉及） |
| 改部署/认证 | tech-spec 第 16 节 + README 部署一节 |
| 改视觉 | tech-spec 第 11 节 |
| 完成一个阶段/一项功能 | plan.md 的勾选与进度追踪 |
| 改命令/脚本 | README 常用命令表 + tech-spec 第 10 节 |

每轮改动在 `plan.md` 第 7 节加一条带日期的进度，写清改了什么、为什么、文档同步到哪。

### 文档审计流程

用户说“检查文档是否为最新”时：

1. **以代码为准，不以记忆为准。** 读 `src/` 树、`prisma/schema.prisma`、`package.json`、`.env.example`
2. grep 过期关键词：`SQLite` / `dev.db` / `test.db`、`纯本地` / `无网络`、`Recharts`、旧密码/端口/域名、“MVP 不做登录”
3. 逐个确认是“历史记录”还是“现状陈述”：历史保留，现状改写
4. 检查三份文档之间的数字是否一致（测试数、短文数、词数、章节数）
5. 检查 README 的命令和脚本是否与 `package.json` 一致
6. 输出改动摘要：哪些是过时修正、哪些是有意保留的历史

### 常用准确数字

- 3580 词 / 22 章 / 3645 例句
- 86 篇短文（22 个文件、86 篇）
- 72 条测试（12 + 43 + 17）

不确定就现查。

### 提交

1. 先展示变更摘要（文件、增删行数、关键修正）
2. 打印完整 commit message 给用户看
3. 结尾附 `Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>`
4. push 是红线，单独确认

## 收尾验证

1. `npx tsc --noEmit` — 类型先过
2. `npm test` — 72 条必须全绿
3. 碰到短文内容时 `npm run check:passages`
4. 碰到 UI 时启动 dev，用浏览器实际点一遍（键盘 Tab 也要走一遍）
5. 碰到数据口径时，拿库里真实数字对一遍

**测试只证明代码形状对，不证明功能对。** 没在浏览器里点过，就不能说“做完了”。

## 相关 skill

`ielts-study` · `ielts-spelling` · `ielts-reading` · `ielts-word-data` · `ielts-stats-ui`
