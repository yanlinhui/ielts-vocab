# 雅思词汇真经 · 技术规范

> 最后更新：2026-10-16
> 配套文档：[计划文档](./plan.md) · [PRD](./PRD.md)

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│  离线提取流水线（Python，跑一次）                              │
│                                                              │
│  PDF(扫描件) → [抠图] → 页面JPEG → [OCR] → 每页文本 → [解析]   │
│                                                  ↓ 词表       │
│                                    [ECDICT 校验/补音标释义]    │
│                                          ↓                   │
│                              data/words.clean.json           │
│                              data/extraction-report.md       │
└──────────────────────────┬──────────────────────────────────┘
                           │ 一次性导入
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  应用运行时（Next.js + SQLite，本地）                          │
│                                                              │
│  seed.ts → SQLite (Word/Unit)                                │
│                    ↓                                         │
│  React 页面 ←→ Server Actions / Route Handlers               │
│                    ↓                                         │
│              lib/srs.ts (ts-fsrs)                            │
│                    ↓                                         │
│         SQLite (UserWordProgress / ReviewLog)                │
└─────────────────────────────────────────────────────────────┘
```

**关键架构决策：提取和应用完全解耦。**

Python 提取脚本只产出 `words.clean.json` 这一个文件。前端**完全不知道**这些词是从 PDF 来的、怎么提取的。好处：
- 提取流程怎么改都不影响前端
- 以后换数据源（比如换成开源词库）只需要产出同样格式的 JSON
- 提取脚本可以反复重跑，不碰应用代码

---

## 2. 技术栈与理由

| 层 | 选择 | 版本 | 理由 |
|---|---|---|---|
| 框架 | Next.js（App Router） | 15.5.28 | 前后端一体。以后部署 Vercel 不用改架构 |
| UI 框架 | React | 19.3.1 | 随 Next 15 一起装的 |
| 语言 | TypeScript | **6.0.3** | 数据模型复杂（FSRS 状态 + 用户进度），类型能挡掉大量低级错误 |
| 样式 | Tailwind CSS | 4.3.3 | 主流，无运行时开销 |
| 数据库 | SQLite | — | 本地单文件，零配置 |
| ORM | Prisma | **6.19.3**（client 与 CLI 同版本） | 用代码操作数据库。**换 Postgres 只改 datasource 一行** |
| 复习算法 | ts-fsrs | 5.4.2 | FSRS 官方 JS 实现，纯本地 |
| 发音 | Web Speech API | — | 浏览器内置，零成本 |
| 字体 | Noto Serif SC（`next/font/google`） | — | 构建时拉到 `.next` 自托管，运行时零网络。**只用于标题**，正文保持系统无衬线。选型见 11.2 |
| 图表（阶段三） | Recharts | — | React 生态主流 |
| 抠图脚本 | Python | 3.13 | **零第三方依赖**（手写 PDF 对象解析） |
| OCR | rapidocr + onnxruntime | 3.10 / 1.31 | 本地 CPU 推理，模型随包自带、**不联网**；见 7.2 |

### 两个版本坑（都踩过，记下来免得重来）

**Prisma 必须钉在 6.x，且 client 和 CLI 版本一致。**

`npm install -D prisma` 会装到 **8.0.0-rc.22**——镜像把预发布版打上了 `latest` tag。两个问题：① 个人工具不该压预发布版；② Prisma 7 起 CLI 整个重做（`migrate` 命令没了，改成 `migration` / `orm` / `db`），还改成 ESM-first、要求 `prisma.config.ts`、不再自动读 `.env`，跟 `@prisma/client@6.x` 也对不上。所以显式装：`npm i -D prisma@6.19.3 && npm i @prisma/client@6.19.3`。

**TypeScript 6.0.3 需要 `src/global.d.ts`。**

同样是被镜像 `latest` 顶到了新大版本。TS 6 开始检查**副作用导入**（TS2882），而 Next 自动生成的 `next-env.d.ts` 只声明了 `*.module.css`，没有纯 CSS：

```ts
// src/global.d.ts
declare module "*.css";
```

`next-env.d.ts` 是自动生成的、不能手改，所以单独放一个文件。**不要因为这两条去降级依赖**——钉住版本就够了，降级会在别处引入新的不兼容。

### 为什么不引入的东西

| 不用 | 为什么 |
|---|---|
| Zustand / Redux | 状态简单（当前卡片 + 队列），React `useState` 足够。加状态库是过度设计 |
| 云端数据库 | 单人本地用，SQLite 够了 |
| 认证库 | MVP 无登录 |
| 后端框架（Express 等） | Next.js 自带 Server Actions / Route Handlers |

---

## 3. 目录结构

```
IELTS Learning Tools/
├── 《雅思词汇真经(刘洪波)》.pdf       # 数据源
├── docs/                              # 项目文档
│   ├── plan.md
│   ├── PRD.md
│   └── tech-spec.md
├── scripts/                           # 提取流水线（Python）
│   ├── lib/passage-files.ts           # 短文 md 的解析（抽标记 + 按 --- 分篇，见 15.2）
│   ├── extract_images.py              # PDF → data/pages/*.jpg（零依赖）
│   ├── read_outline.py                # 读 PDF 书签（排查用，非必需）
│   ├── ocr_pages.py                   # 页面图 → data/ocr/（依赖 rapidocr，见下）
│   ├── build_vocab.py                 # OCR 文本 → 结构化词表
│   ├── parse_index.py                 # 书末全书索引 → 权威词表（交叉校验基准）
│   ├── check_with_ecdict.py           # ECDICT 校验 + 补音标释义
│   ├── reconcile_index.py             # 用索引给词表补漏/纠拼/去伪/去重
│   ├── verify_vocab.py                # 旁证：拿每页页脚索引条独立复核
│   ├── fix_spacing.py                 # 修 OCR 单词粘连（ECDICT 当白名单重切，见 7.8）
│   ├── update_spacing_db.ts           # 把修复结果原位写回库（不重灌，进度不丢）
│   ├── verify_spacing_db.ts           # 复核落库：进度完好 + 旧文本已清零
│   ├── check_passages.ts              # 短文覆盖率校验：{{标记}} vs 该章词表（见 15.2）
│   ├── seed_passages.ts               # content/passages/*.md → Passage 表（幂等）
│   └── lib/passage-files.ts           # 短文 md 的解析（抽标记 + 按 --- 分篇）
├── content/                           # 拓展阅读短文。**原创内容，进仓库**
│   └── passages/
│       ├── chapter-04.md              # 第 4 章太空探索，2 篇
│       └── chapter-22.md              # 第 22 章时间日期，1 篇
├── data/                              # 提取产物（gitignore，体积大）
│   ├── pages/                         # 334 张页面图
│   ├── ocr/                           # 每页 OCR 的 .txt + .json（含坐标）
│   ├── words.raw.json                 # 解析出的原始词表
│   ├── words.clean.json               # 最终词库 ← 应用的唯一输入
│   ├── book-index.json                # 书末索引解析结果
│   ├── ecdict-report.md               # ECDICT 单步报告
│   ├── spacing-changes.json           # 粘连修复替换表（旧文本 → 新文本）
│   ├── spacing-report.md              # 粘连修复报告（改动清单 + 抽样 + 依据统计）
│   └── extraction-report.md           # 最终质量报告
├── ecdict/                            # ECDICT 数据（gitignore）
│   └── ecdict.csv 或 stardict.db
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                    # 3 个：init + add_progress_created_at + add_passage
│   ├── dev.db                         # SQLite 数据文件（gitignore）
│   └── seed.ts                        # 读 words.clean.json 灌库
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # 全局布局 + 字体导入，壳层交给 AppShell
│   │   ├── icon.svg                   # favicon（Next 约定文件名）
│   │   ├── globals.css                # Tailwind 入口 + 设计令牌 + .flip-*，见第 11 节
│   │   ├── page.tsx                   # 首页：今日进度 + 开始按钮 + 每日一句 / 热力图（见 12.1、12.2、12.4）
│   │   ├── units/page.tsx             # 单元列表（排成书末目录的样子）
│   │   ├── study/page.tsx             # 学习/复习（核心）
│   │   ├── spelling/page.tsx          # 拼写练习（独立页，2026-10-16 从 /study?spell=1 拆出）
│   │   ├── reading/page.tsx           # 拓展阅读（按章读短文，见第 15 节）
│   │   ├── stats/page.tsx             # 统计（阶段三）
│   │   ├── settings/page.tsx          # 设置
│   │   └── api/
│   │       ├── review/route.ts        # POST 评分
│   │       └── settings/route.ts      # POST 保存设置
│   ├── components/
│   │   ├── AppShell.tsx               # ★ 壳层：顶部栏 / 左侧栏 / 内容区，见 11.7
│   │   ├── Nav.tsx                    # 导航链接（client，bar / rail 两种排布）
│   │   ├── WordCard.tsx               # 翻面卡片（正面单词 / 背面全展开，见 5.5）
│   │   ├── StudySession.tsx           # 会话状态机（队列 + 评分 + 重入队）
│   │   ├── SpellSession.tsx           # 拼写题面（受控，见 14.2）
│   │   ├── PassageReader.tsx          # 短文正文 + 自测/对照两种模式（见 15.3）
│   │   ├── RatingButtons.tsx          # 四档按钮 + 各自的下次间隔
│   │   ├── SpeakButton.tsx            # 喇叭按钮
│   │   ├── ProgressBar.tsx
│   │   ├── AnswerSheet.tsx            # 答题卡式方格进度（纯展示，见 12.1）
│   │   ├── Heatmap.tsx                # 学习打卡热力图（纯展示，零 JS，见 12.3）
│   │   ├── FrequencyRuler.tsx         # 词频刻度（纯展示，见 12.4）
│   │   └── SettingsForm.tsx
│   ├── lib/
│   │   ├── db.ts                      # Prisma 客户端单例（挂 globalThis）
│   │   ├── srs.ts                     # ★ FSRS 封装，唯一 import ts-fsrs 处
│   │   ├── session.ts                 # 会话队列 + 今日统计
│   │   ├── stats.ts                   # 热力图 / 每日一句，见第 12 节
│   │   ├── spelling.ts                # ★ 拼写比对（编辑距离 DP + 回溯，零依赖，见 14.1）
│   │   ├── passages.ts                # ★ 短文解析：{{}} 切 token + 词典释义（见 15.3）
│   │   ├── rating.ts                  # Rating 类型 + 四档文案（不碰数据库）
│   │   ├── tts.ts                     # Web Speech API 封装
│   │   ├── user.ts                    # getCurrentUser()（多用户预留位）
│   │   ├── format.ts                  # 时间格式化（"3 天后"/"明天"）
│   └── global.d.ts                    # `declare module "*.css"`，见第 2 节
├── tests/                             # 单元测试（node:test + tsx，零新依赖，见第 8 节）
│   ├── env.ts                         # ★ 把 DATABASE_URL 指向 test.db，必须第一个 import
│   ├── helpers.ts                     # 建测试库 + 清表 + 造 fixture
│   ├── srs.test.ts                    # FSRS 调度的形状（12 条）
│   ├── spelling.test.ts               # 比对算法（17 条，纯函数、不碰数据库，见 8.8）
│   └── session.test.ts                # 队列规则与日期口径（43 条）
├── .env                               # DATABASE_URL（gitignore）
├── .claude/launch.json                # 本地 dev server 配置
└── package.json
```

> **接口一律走 Route Handlers（`src/app/api/`），没走 Server Actions。** 最初设计里写的是 `app/actions/*.ts`。改的原因：评分是客户端组件在交互中调用的，用 `fetch` 打 `/api/review` 比 Server Action 更好调试（浏览器 Network 面板直接看到请求和响应），也方便以后加「离线排队重试」这类逻辑。

---

## 4. 数据模型

### 4.1 Prisma Schema

> **注意**：SQLite 下 Prisma **不支持 `enum`**，所以状态字段用 `String` + 应用层校验。
> 时间统一存 **UTC**，展示时转本地时区。

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")   // file:./dev.db
}

generator client {
  provider = "prisma-client-js"
}

/// 书的单元划分 = 一个主题 Chapter。结构已在步骤 0 确认（见 plan.md 3.3）
model Unit {
  id         Int    @id @default(autoincrement())
  chapterNo  Int    @unique              // 1..22
  name       String                      // 如 "自然地理"
  startPage  Int?                        // 书页码，便于和原书对照
  words      Word[]
  passages   Passage[]
}

/// 拓展阅读：自己写的短文，把某一章的词嵌进中文叙事里（见第 15 节）。
/// **内容原创，不是书中原文**——所以不受下面那笔版权风险的约束
model Passage {
  id          Int    @id @default(autoincrement())
  unitId      Int
  unit        Unit   @relation(fields: [unitId], references: [id], onDelete: Cascade)
  orderInUnit Int                        // 这一章的第几篇，1 起；章内按这个排序即阅读顺序
  title       String
  /// 正文。该章的词用 {{headword}} 包住——渲染成可点词块、自测时藏中文，
  /// 校验脚本也靠这个标记比对覆盖率（见 scripts/check_passages.ts）
  body        String
  /// 覆盖了几个词。生成时算好写进来，列表页直接显示，不用每次重算
  wordCount   Int

  @@unique([unitId, orderInUnit])
  @@index([unitId])
}

/// 单词本身。与用户无关，所有用户共享
model Word {
  id          Int     @id @default(autoincrement())
  headword    String                     // 单词原形
  phonetic    String?                    // 音标。来自 ECDICT，不用 OCR 结果
  pos         String?                    // 词性，如 "n. v."
  meaningCn   String                     // 中文释义（来自 ECDICT）
  tags        String?                    // 考试标签，如 "ielts cet6"（ECDICT 的 tag）
  bncRank     Int?                       // BNC 词频排名
  frqRank     Int?                       // 当代语料库词频排名
  unitId      Int
  unit        Unit    @relation(fields: [unitId], references: [id])
  orderInUnit Int                        // 在单元内的顺序，保留书的编排

  // ---- 以下为「书中原创内容」，受版权保护 ----
  // 公开分享时应整体关闭（置空或不上线），基础词条不受影响
  collocation String?                    // [搭] 搭配，书中原文
  etymology   String?                    // 词根词源，书中原文
  cultureNote String?                    // 无标签的中文文化背景段落，书中原文
  examples    WordExample[]

  progress    UserWordProgress[]
  logs        ReviewLog[]

  @@unique([unitId, orderInUnit])
  @@index([headword])
}

/// 书中的例句。同样属于书籍原创内容
model WordExample {
  id         Int    @id @default(autoincrement())
  wordId     Int
  word       Word   @relation(fields: [wordId], references: [id], onDelete: Cascade)
  en         String                      // 英文例句
  cn         String?                     // 中文翻译
  orderIndex Int    @default(0)

  @@index([wordId])
}

model User {
  id        Int            @id @default(autoincrement())
  name      String         @unique
  createdAt DateTime       @default(now())
  progress  UserWordProgress[]
  logs      ReviewLog[]
  settings  UserSettings?
}

/// ★ 核心表：每个用户 × 每个单词 一行
model UserWordProgress {
  id     Int  @id @default(autoincrement())
  userId Int
  wordId Int
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  word   Word @relation(fields: [wordId], references: [id], onDelete: Cascade)

  // ---- FSRS 状态，直接映射 ts-fsrs 的 Card ----
  // SQLite 没有 enum，state 用字符串 + 应用层校验（见 lib/srs.ts）
  stability     Float    @default(0)
  difficulty    Float    @default(0)
  dueAt         DateTime @default(now())   // 下次到期时间
  state         String   @default("new")   // new | learning | review | relearning
  scheduledDays Int      @default(0)       // 当前这次排到的间隔（天）
  learningSteps Int      @default(0)       // 处在第几个学习步长
  reps          Int      @default(0)
  lapses        Int      @default(0)
  lastReviewAt  DateTime?
  createdAt     DateTime @default(now())   // 首次作答时间，用于算「今日新学」和「今日复习」

  @@unique([userId, wordId])
  @@index([userId, dueAt])       // ★ 取到期队列的主查询
  @@index([userId, createdAt])   // 今日新学计数
}

/// 每次作答流水。用于统计，不可变
model ReviewLog {
  id         Int      @id @default(autoincrement())
  userId     Int
  wordId     Int
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  word       Word     @relation(fields: [wordId], references: [id], onDelete: Cascade)
  rating     Int                              // 1=忘了 2=困难 3=一般 4=简单
  reviewedAt DateTime @default(now())
  elapsedMs  Int?                             // 停留时长，用于分析

  @@index([userId, reviewedAt])
  @@index([wordId])
}

model UserSettings {
  userId           Int     @id
  user             User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  dailyNewLimit    Int     @default(20)
  dailyReviewLimit Int     @default(200)
  accent           String  @default("uk")     // uk | us
  autoSpeak        Boolean @default(false)
}
```

### 4.2 设计要点

**为什么 `Word` 和 `UserWordProgress` 分开？**

`Word` 是共享的不变数据。`UserWordProgress` 是「用户 × 单词」的交叉表。分开之后：
- 多用户天然支持：加一个用户 = 建一套 progress 记录，词库不动
- 词库更新（比如修正释义）不会影响任何学习进度
- 统计查询只扫 progress 表，不用碰词表

**为什么存 `orderInUnit`？**

这是这本书的价值所在——「逻辑词群记忆法」把相关的词编在一组。顺序丢了，这本书就退化成普通词表了。

**`@@index([userId, dueAt])` 是性能关键**：首页和取队列每次都要查「该用户所有 `dueAt <= now` 的词」，没有这个复合索引会全表扫。

**为什么只存一份音标？**

原设计里是 `phoneticUk` / `phoneticUs` 两个字段。下载 ECDICT 实测后发现它**只有一份音标**（实测 `atmosphere` → `'ætmәsfiә`、`oxygen` → `'ɒksәdʒәn`），分不出英式美式。与其编造第二个字段，不如老实存一个 `phonetic`，UI 上就显示「音标」，不标英/美。以后真拿到美式音标（比如接另一个数据源）再加字段也不难。

**音标一律来自 ECDICT，不用 OCR 的结果**——OCR 的音标完全不可靠（实测 `hydrogen` 被认成 `/'pksıdzən/`）。另外 ECDICT 用西里尔字母 `ә`(U+04D9) 当中央元音，导入时统一换成 IPA 的 `ə`(U+0259)。

**为什么例句单独建表？**

有两个原因，第二个更重要：

1. 一个词可能有多条例句，一对多是自然结构
2. **版权隔离**。`collocation` / `etymology` / `WordExample` 这三样都是**书中原创内容**，受版权保护；`headword` / `phonetic` / `meaningCn` 来自 ECDICT，不受影响。以后若要公开分享，只需把这三样置空或不上线，**基础词条不动、数据库不改**。如果在提取阶段就把例句拼进 `meaningCn`，将来就得重建整个词库。

---

## 5. FSRS 集成（核心模块 `lib/srs.ts`）

### 5.1 概念映射

ts-fsrs 的 `Card` 对象 ↔ 数据库字段：

| ts-fsrs Card 字段 | 数据库字段 | 说明 |
|---|---|---|
| `due` | `dueAt` | 下次到期时间 |
| `stability` | `stability` | 记忆稳定度（天） |
| `difficulty` | `difficulty` | 单词难度 1–10 |
| `state` | `state` | New/Learning/Review/Relearning |
| `reps` | `reps` | 复习次数 |
| `lapses` | `lapses` | 遗忘次数 |
| `last_review` | `lastReviewAt` | 上次复习时间 |

### 5.2 对外接口

**`lib/srs.ts` 是唯一允许 `import ts-fsrs` 的文件。** 其他模块要用 FSRS，只能走这里的函数。

实际的职责划分和最初设计有两处不同，都是实现时才看清的：

**一、`Rating` 类型挪到了 `lib/rating.ts`。** 本来它是 srs.ts 的一部分，但 `RatingButtons.tsx` 这类**客户端组件**也要用它——而 srs.ts 顶部 import 了 Prisma。客户端组件引一下 srs.ts，打包器就会去解析 Prisma 的 Node 专用代码，编译直接炸。所以类型和四档文案单独放一个不碰数据库的文件，两边都从它引。

**二、`getDueQueue` 拆成了 `buildSession`（在 `lib/session.ts`）。** 取队列要联查 Word / Unit / WordExample 三张表，还要算今日配额，塞在 srs.ts 里会让「排程算法」和「业务查询」糊成一坨。现在 srs.ts 只管 FSRS 怎么算，session.ts 管「今天该看哪些词」。

```ts
// lib/srs.ts —— 只管 FSRS 排程
export const FSRS_PARAMS = {
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
}

/** 提交一次评分：事务内 upsert 进度行 + 插入流水 */
export async function submitRating(
  userId: number, wordId: number, rating: Rating, elapsedMs?: number
): Promise<{ nextDueAt: Date; intervalMs: number; previews: Record<Rating, Date> }>

/** 预览四档到期时间。内部只调一次 repeat()，四档共用结果 */
export function previewIntervals(row: CardRow | null, now?: Date): Record<Rating, Date>

/** 新词的起始卡片状态 */
export function emptyCard(now?: Date): CardRow
/** 进度行 ↔ ts-fsrs Card 的双向转换 */
export function toCardInput(row: CardRow, now: Date): CardInput
export function cardToFields(card: Card): {...}   // 写库用
export function cardToRow(card: Card): CardRow    // 喂给 previewIntervals
```

```ts
// lib/session.ts —— 管「今天该看哪些词」
export async function buildSession(
  userId: number,
  opts?: { unitId?: number; newLimit?: number; wordIds?: number[] }
): Promise<QueueItem[]>

export async function getTodayStats(userId: number): Promise<TodayStats>
```

`QueueItem` 里除了词条内容，还带 `isNew` 和 `previews`（四档到期时间的 ISO 串）——**到期时间在服务端算好一次性下发**，客户端点翻面时不必再问一次接口。

⚠️ `opts.unitId` **不只是个过滤条件**：带上它，整个取数逻辑就换成「章节专项」那条路（该章里**还没学过**的词、不套每日配额），见 6.1。

⚠️ `opts.wordIds` 同理，换上「错词本」那条路（只练点名的这些词、按名单顺序、不套配额也不看到期），见 6.2。两个参数同时给时 **`unitId` 先判、`weak` 让位**——`/study?unit=3&weak=1` 走章节。`wordIds: []` 是 truthy，会正常走进错词本分支并返回空队列，正是「错词本是空的」那个空态，不需要特判。

### 5.3 内部实现要点

```ts
import { fsrs, generatorParameters } from 'ts-fsrs'

const scheduler = fsrs(generatorParameters(FSRS_PARAMS))
```

`FSRS_PARAMS` 是常量对象，模块加载时构造一次 scheduler 复用到进程结束。（ts-fsrs 5.4 的 `generatorParameters` 已经内置了 `w` 权重数组的默认值，不用自己传。）

**新词初始化**：用 `createEmptyCard(now)`，`state = New`。

**评分**：
```ts
const { card: next, log } = scheduler.next(card, now, grade)
```

**预览**用 `scheduler.repeat(card, now)`——它一次算出四档各自的结果，正好拿来显示按钮下方的「下次：3 天后」。两者分工明确：`repeat` 只读不写、用来预览；`next` 出确定的一档、用来落库。

**必须持久化的字段**：除了稳定度/难度/到期时间，还有 `scheduled_days` 和 `learning_steps`。前者是「当前这次排到的间隔」，后者是「处在第几个学习步长」。**不存这两个，每次复习都会从第 0 步重算**，学习步长会反复回到第一步，调度就错了。这是 FSRS 落地最容易踩的坑。

**`elapsed_days` 是 deprecated 字段**：ts-fsrs 5.x 从 `card` 里删了它，但类型定义里还留着（标 deprecated）而 `CardInput` 要求存在。所以 `toCardInput()` 里显式补一个 `elapsed_days: 0`，否则 TS 报缺字段。

**事务性**：`submitRating` 在一个 `prisma.$transaction` 里完成两件事——upsert `UserWordProgress` + 插入 `ReviewLog`。只做一半会导致统计数据错乱。

**时区**：FSRS 内部按 UTC 计算天数差。所有 `dueAt` 存 UTC，UI 展示时转本地。

### 5.4 FSRS 参数（阶段二已定）

| 参数 | 取值 | 说明 |
|---|---|---|
| `learning_steps` | `["1m", "10m"]` | 新词的学习步长。答「忘了」→ 1 分钟后；答「一般」→ 10 分钟后 |
| `relearning_steps` | `["10m"]` | 复习态的旧词答错后，10 分钟再来一次 |
| `request_retention` | `0.9` | 目标记忆保持率。FSRS 按「90% 概率还记得」来安排间隔 |
| `maximum_interval` | `36500`（天） | 上限，等于不设上限（100 年），避免长间隔被截断 |
| `enable_fuzz` | `true` | 加随机扰动，避免所有词挤在同一天复习 |
| `enable_short_term` | `true` | 启用学习步长，新词才能在同一次会话里重复出现 |

阶段二实测（见 `docs/plan.md` 验收记录）：新词评「简单」→ 9 天；复习态评「简单」→ 把 3 天的间隔拉到 10 天。**参数直接决定「每天要复习多少词」，改它们前先想清楚**，改完要连背几天才看得出影响。

### 5.5 学习卡片的版面约束（`WordCard.tsx`）

卡片是「正面只有单词 + 喇叭，点击翻面」的自测结构，**翻面本身不能去掉**——去掉就等于把回忆测试降级成阅读理解。背面**内容一次性全展开，没有折叠、不用点开**。

**卡片内部不滚，字号不缩；装不下就让整页滚。**

这是 2026-10-16 的方向反转。此前两轮都在追「一屏全显」：先给卡片限高让正文自己滚，再改成正文字号逐档自适应（17px→11.22px）把内容压进一屏，实测矮窗口下字被压到 **11.22px**。用户实机用了几天后反馈**字太小**，明确要「字号大一点、放不下就整页滚」。于是那套自适应整套拆了。

代价是长词的页面会滚——**这是接受的，不是缺陷**。实测 `disaster`（背面 732px）在 1280×800 下整页溢出 121px、375×812 下 215px。

背面由三块竖向 flex 组成：

| 块 | 类 | 行为 |
|---|---|---|
| 头部 | `shrink-0` | 单词 + 音标 + 词性 + 章节。常驻 |
| 正文 | 无特殊类 | 释义 + 例句 + 搭配 + 词源 + 派生 + 文化背景。**自然撑开，不滚不裁** |
| 底部 | `shrink-0` | 四个评分按钮 |

正文字号只有一个来源：

```tsx
const BASE_FONT = 18;
```

挂在内层容器的 inline `style` 上，正文里所有字号和间距全按 `em` 写（例句 0.88em、中文翻译 0.82em、区块间距 1.6em）。改这一个数，整块跟着变。这里曾经是 17px 并会按窗口高度逐档缩到 11px，2026-10-16 删掉缩放、提到 18px。

**矮窗口那套紧凑尺寸（`max-height: 44rem`）也一并删了**：单词 `text-3xl→xl`、音标 `sm→xs`、卡片内左右内边距 `6→4`、评分按钮 `py-3→py-2`、正文区块间距 `1.6em→0.65em`、释义行高 `1.6→1.45`、隐藏卡片下方的键盘提示（`WordCard.tsx` 和 `RatingButtons.tsx` 两处）。它们和字号缩放是同一件事的两半——都是为了把内容塞进一屏。

**翻面容器的高度要锁**（`sceneRef`）。这是删掉 `max-height` 之后必须补上的一环。

正反两面叠在同一个 grid 单元格里做 3D 翻转（`col-start-1 row-start-1`，见 `globals.css` 的 `.flip-card`），grid 行高取两者的**较大值**。不干预的话，一个例句多的长词会顺手把正面那张空卡也撑到同样高：单词跑出屏幕、「退出」按钮被推走，而且**还没翻面整页就已经出现滚动条**。锁到当前露出来的那一面之后，正面恒为一屏内的矮卡（实测恒 320px），背面随内容长。

三处缺一不可：

1. **两面都要 `self-start`。** 不加的话它们会被拉伸到行高，`offsetHeight` 量出来是同一个数，等于没锁。
2. **外层 `.flip-scene` 必须 `overflow: hidden`。** 超出锁定高度的另一面照样会撑大 document 的滚动高度——实测把一个面设成 `position: absolute` + `visibility: hidden` 并去掉裁剪，`documentElement.scrollHeight` 仍是 855（基线 800，**多 55px**）。**绝对定位不能替代裁剪**，这个直觉是错的。
3. **裁剪不能加在 `.flip-card` 上。** 按规范，非 `visible` 的 `overflow` 会把 `transform-style` 强制成 `flat`，翻转当场失效。裁剪必须待在父元素 `.flip-scene` 上。

用 `useLayoutEffect` 而不是 `useEffect`，否则用户会先看到一帧被撑开的布局再跳到正确高度。窗口 `resize` 要重测——转屏、拉窗口都会让同一面重新折行。

**翻转过程本身有两处会被裁，都已处理：**

- **不加 `perspective`。** 有透视时近端半张卡会被放大，转起来之后包围盒会超出静止时的外框——实测 1280 宽下**最大超出 9.96px（在 15° 附近）**，卡片的边会在翻转中途被削掉一截。去掉透视走正交投影后，0–180° 全程包围盒不超出静止外框（实测宽度 736 → 0 → 736），既不裁边，也不用留任何"大概多少像素"的余量。代价是少了点纵深，420ms 里看不出来。
- **变矮要延后半个翻转。** 翻回正面时外框瞬间收矮的话，**还在往回转的背面（它比正面高）下半截会被裁掉**。把高度过渡设为 `calc(var(--flip-duration) / 2)`，并在「这次比上次矮」时把 `transitionDelay` 也设成同一个值——延后到卡片转到 90°（侧面）那一刻再收，那时画面里的已经换成矮的正面，怎么收都裁不到。**变高必须立刻执行**，否则背面一转出来就被裁。实测（读 Web Animations API 的关键帧）：变高 `320 → 732`、delay **0**；变矮 `732 → 320`、delay **210ms**。

`--flip-duration: 420ms` 定义在 `.flip-scene` 上，`.flip-card` 的 `transform` 和 `.flip-scene` 的 `height` 都读它，免得两处对不上。

视口实测（**都停在 18px**）：

| 视口 | 词 | 正面高 | 背面高 | 整页溢出 |
|---|---|---|---|---|
| 1280×800 未翻 | disaster | 320 | 732 | 0 |
| 1280×800 已翻 | disaster | 320 | 732 | 121px |
| 375×812 已翻 | disaster | 320 | 838 | 215px |
| 613×586 已翻 | horizon | 320 | 603 | 206px |
| 注入 2000px 长内容 | — | **320** | 2017 | 1406px |

上一版 613×586 被压到 11.22px，现在满档 18px。正面高在任何情况下都是 320——注入两千多像素内容也不变。上一节那个「271px 极窄屏例外」也随之消失：正文不再需要挤进任何高度。

换词时会把页面滚回顶部（`window.scrollTo(0, 0)`，跟 `item.wordId` 走）。长词翻面后整页变长，用户多半滚到下半页读完再评分；不定回顶部的话下一个词会从中间开始显示——正面那张卡整个在屏幕上方，看上去就是一片空白。

**六个坑：**

1. **别把裁剪加到 `.flip-card` 上**，`preserve-3d` 会被强制成 `flat`，翻转失效。
2. **别用绝对定位代替裁剪**，实测不管用（多 55px），见上。
3. **别给 `.flip-scene` 加 `perspective`**，实测量到翻转中途超出静止外框约 10px。
4. **`self-start` 不能省**，省了锁高就锁了个寂寞——两面量出来一样高。
5. **延迟收矮的判据是「这次比上次矮」**，用一个 `useRef` 记住上一次的高度；无条件设 delay 会让变高也等 210ms，背面一转出来就被裁。
6. **`prefers-reduced-motion` 下两个元素的 transition 都要关。** 只关 `.flip-card` 的话卡片瞬间转过去、外框还在慢慢收放，比完全不动效更怪。

> **未验到的部分**：高度的收放动画本身没能观察到运行过程——浏览器预览面板隐藏时 CSS transition 是冻结的（`style.height` 已是目标值，`getBoundingClientRect` 停在起点）。验的是机制（关键帧、210ms 时长、0ms / 210ms 延迟）和静止后的布局，**不是动画过程**。

正文区绑了「点击翻回正面」。**这个 onClick 只挂在正文块上，不挂整张背面**——否则评分失败时（请求已被 `catch`，卡片留在原地）点击会冒泡触发翻面，把用户刚看的词翻走。同理 `SpeakButton` 内部有 `e.stopPropagation()`。

---

### 5.6 学习页底部：发音与「退出」（2026-10-16）

三种发音入口对应三种场景：**自动读**（换到新词、翻回正面时不用动手）、**`S` 键**（想重听时不用摸鼠标）、**开关**（不想被声音打扰时随手关掉）。卡片上原有的三个喇叭按钮（正面大号、背面头部、每条例句）一个没动。

#### 时机：每逢卡片转到正面（单词那面）就读

`autoSpeak` 最初管的是「翻面时读一次」，一度改成「卡片出现即读一次」，**现在是「正面显示中就读」**——这三个时点都算：这张卡第一次出现（换词后必然经过）、从背面翻回正面、以及在学习页点开那个开关。

判据是**「此刻正面在不在显示」**，不是「这张卡读过没有」。后一种写法会让翻回正面的那一次静默掉——而翻回正面恰恰是最该出声的时刻：刚看完中文释义，重听一遍用来印证记下的音形。翻到背面则不读，那时眼睛在中文上，再念一遍英文只是噪音。

```ts
useEffect(() => {
  // 关掉开关、或卡片正停在背面 —— 都清空记录，等正面再显示时补读
  if (!autoSpeak || flipped) { spokenRef.current = null; return; }
  if (spokenRef.current === item.headword) return;
  spokenRef.current = item.headword;
  speak(item.headword, { accent });
}, [autoSpeak, accent, item.headword, flipped]);
```

**依赖里留着 `autoSpeak` 是设计的一部分**：学习页那个开关一翻，effect 就重跑，正面时当前词立刻发音。否则还得在开关的 handler 里另写一次 `speak`，两处一叠加就会出现「开关读一遍、卡片再读一遍」。（开关在背面那面被点开时不立即读，翻回正面才读——同一套判据，不必特判。）

换词之所以必然读到：`StudySession` 拿 `${wordId}-${rated}` 当 key，换词等于重建组件，effect 必跑一次。同一个词被排回队尾再出现（答「忘了」，`rated` 变了）算新的一次，会重读——符合预期。

> ⚠️ **`spokenRef` 那道守卫是被实测逼出来的。** 第一版没有它，实测读了两遍。根因是 **Next 15 默认开 React StrictMode**（`next.config.ts` 里没有 `reactStrictMode: false`），dev 模式下 effect 会 mount → cleanup → mount 跑两遍。生产构建没有这个问题，但**这个项目本地跑的一直是 `next dev`**，所以这不是保险，是必须的。守卫记的是「**这一个正面**读过没有」——翻到背面时清空，翻回正面就是新的一轮，重读；同一轮里 StrictMode 跑两次，第二次被挡住。

**实测**（`speechSynthesis.speak` 打桩记录读到的文本）：正面出现 → 读 1 次；翻到背面 → 不读（仍是 1 条）；翻回正面 → 再读一次（2 条）。

#### `S` 键发音

键盘原来只有空格翻面、1~4 评分。新增 `S`——正反两面都能按，不判断 `flipped`，想重听时不该要求先翻回正面。

同时**在 keydown 最前面加了修饰键守卫**：

```ts
if (e.ctrlKey || e.metaKey || e.altKey) return;
```

它保护的不只是 `S`，空格和 1~4 一并在内。没有它，`Ctrl+S`（保存网页）、`Cmd+数字`（切标签）会被 `preventDefault` 吃掉。`Shift+S` 不拦，那是正常输入大写。

#### 学习页的开关（`AutoSpeakToggle`）

设置在卡片**外面**、和「退出」按钮同一行（两端对齐）。三个候选位置的取舍：

| 候选 | 否掉的原因 |
|---|---|
| 会话状态行（「新词 · 第 1 章 XX」那行） | 375px 下左右两段文字已吃掉约 264px，可用只有 343px，再塞一个 chip 必然折行或溢出 |
| 卡片正面 | PRD 1.3「一次只做一件事」，正面只留单词和喇叭；开关是会话级设置，不属于卡面内容 |
| 卡片内部 | 翻到背面就会被内容推下去，看不见 |

行为要点：

- **乐观更新**：先改本地 state（PRD 3 要求「瞬时」，不等网络），再后台落库。失败则回滚状态并复用页面顶部的错误条提示
- **只发一个字段**：`POST /api/settings` 的 body 是 `{ autoSpeak }`。`api/settings/route.ts` 本来就逐字段处理（每个字段一个独立的 `if`），所以不必把每日新词数那三项一起回写
- `role="switch"` + `aria-checked`，而不是 `button` + `aria-pressed`——读屏该念「开 / 关」。状态除颜色外还写了「开 / 关」两个字：只靠颜色区分的话，色觉障碍的人看不出当前是哪一档
- 复用 `isSupported()`（`lib/tts.ts`），浏览器不支持语音合成时 `disabled`，与 `SpeakButton` 的处理一致

尺寸 108×36。第一版是 26px（`px-2 py-1`），刚过 WCAG AA 的 24px 底线但手机上点着偏小，提到和 `SpeakButton` 中号（`h-9`）同档。右边的「退出」按钮取同一个 `min-h-9`，两个控件才有齐平的上下沿。

#### 「退出」按钮

原来是一条 12px 次要色文字链「先退出（进度已实时保存）」，带下划线、看着像正文。改成按钮，顺带把文案拆成两件：**「进度已实时保存」移到按钮外面当普通文字，按钮本体只写「退出」**。

拆开是因为那句话的位置比它的字数要紧。它回答的是「我这一走，进度会不会丢」——用户点之前唯一的顾虑，所以必须在明面上。塞进 `title` 的话手机上永远看不到，而手机没有侧栏、这页底下就这一个出口，恰恰最需要这句。整句留在按钮里也不行：12 字在 375px 上和左边的开关挤不出余量。

**形状和左侧开关共用一套**：`--radius-chip`（4px）+ `min-h-9`（36px）+ 发丝线描边，同一行两端对齐。两个都是会话级控件，长得像同一类是刻意的。

**图标是出门箭头**（门框 + 右向箭头），14px、`viewBox="0 0 24 24"`、`strokeWidth 1.8`、`stroke="currentColor"`——和同一行开关的喇叭图标同参数。（导航栏那三个图标是 `viewBox="0 0 16 16"` / 1.6，但它们在深色书脊上，离得远；这里跟近邻对齐更要紧。）

**配色绕开了朱砂**。`globals.css` 定死了朱砂只做填充、印章和大号数字，因为它对卡片面只有 4.31:1，承载不了 12px 正文。静置是发丝线 + `--color-muted`（对纸底 **5.54:1**），划过时描边和字一起转 `--color-brand`，和全站（评分按钮、开关关闭态）同一套 hover 语言。

**一个明知故犯的地方**：按钮描边用的就是 `--color-line`，对纸底只有 **1.34:1**，远低于 WCAG 对控件边界建议的 3:1。没单独加重，因为全站所有控件（四个评分按钮、开关关闭态、输入框）都是这条线；单独给退出按钮一条更重的边，这一行里就会冒出一个比卡片轮廓还重的东西，把评分按钮的注意力抢走。识别性交给「退出」两个字（5.54:1）加图标。

元素本身仍是 `<a href="/">` 而不是 `<button>`：它做的是导航，读屏该念「链接」。全站 `:focus-visible` 规则覆盖 `a`，键盘 Tab 过来有 2px 墨绿外框，不用另外补。那一行还加了 `flex-wrap`——320px 那种更窄的屏折行，而不是溢出。

#### 验证

| 项 | 结果 |
|---|---|
| 自动朗读触发次数（客户端导航进出学习页一圈） | **1 次**（加守卫前是 2 次） |
| `S` 键 | 读 |
| `Ctrl+S` | **不读**（修饰键守卫生效） |
| 翻面 | **不读**（时机已移走） |
| 开关打开 | 立刻重读当前词 |
| 开关落库 | `POST /api/settings` 200，库内 `autoSpeak` 随切换变化 |
| 开关两态对比度（`getComputedStyle` 取色实测） | 开：`#1f4a3d` 对 8% 墨绿底 **8.68:1**；关：`--color-muted` 对纸底 **5.54:1** |
| 375×812 / 1280×800 | 横向溢出 **0**；开关 108×36 与退出按钮 66×36 同排不折行 |
| 退出按钮（375×812） | 66×36，右缘 359 = 375−16；与开关之间余 **75px** |
| 锁高回归 | 正面卡仍 **320px**，翻面无裁切；底部那一行改前改后都是 36px，整页零位移 |

> **验不到的**：自动朗读在真实手机上「点进来就出声」的先后观感、连读多个词之间会不会嫌吵。这两条只有用户亲耳听才算数。

#### 音色只挑本地的：修「每个词都慢半拍」（2026-10-16）

用户报「发音不能及时」，追问后症状是**每个词都慢半拍**，环境是 **Windows + Edge**。改动全在 `lib/tts.ts`，`WordCard` / `StudySession` / 三个喇叭按钮一个字没动。

**先排除的假设。** 怀疑过三件事，都用**受控交替重测**（A/B/A/B 而不是 A 测完再测 B）推翻了：

| 假设 | 测法 | 结果 |
|---|---|---|
| `cancel()` 紧跟 `speak()` 有代价 | 有 cancel / 无 cancel 交替 | 134ms vs 141ms，无差 |
| `utter.lang` 与 `utter.voice` 打架 | 一致 / 不一致交替 | 130~142ms，无差 |
| 设不设 `voice` 有代价 | 设 / 不设交替 | 123~140ms，无差 |

第一轮我按「A 测完再测 B」量出过 E=744ms vs F=126ms 的差距，**那是顺序假象**——每次测的第一个总是冷的。交替重测就把差距抹平了。这条记在这里是因为它容易再骗一次人：**测时延必须交替，不能分段测**。

**唯一的稳定结论**：引擎空闲后的**第一次**朗读 400~750ms，热身后 ~130ms。这是 Chromium 冷启动的固有代价，与参数无关。

**最可能的真因**：Edge 在 Windows 上带一批 `localService === false` 的「在线自然语音」，**每读一次都要把文本发到服务商服务器、再把音频流收回来**——表现正是「每个词都慢半拍」。⚠️ **这台开发机上 6 个音色全是本地的，复现不出来**；所以这是推断，不是实测。

**修法是防御性的：无论真因是不是它，这样改都不会更坏。**

```ts
english.find((v) => langOf(v) === want && v.localService) ??  // 本地 + 口音精确
english.find((v) => v.localService) ??                        // 本地任意英文
english.find((v) => langOf(v) === want) ??                    // 在线 + 口音精确
english[0]                                                     // 在线任意英文
```

同口音里**本地优先**，实在没有本地英文音色才退到在线。

另外两处配套：

- **`cancel()` 改成条件式**（`if (synth.speaking || synth.pending)`）。原先无条件 cancel 是 Chromium 系的老雷：cancel 紧跟 speak 时新的一次朗读可能被延后甚至吞掉。没得取消时跳过这一步，就没这个交互。
- **`utter.lang` 跟着实际选中的音色走**，不再写死口音值。挑不到本地英式而回退到美式时，还声明 `en-GB` 只是自欺——引擎照样按音色合成。只有连一个英文音色都没有时才按口音值兜底。

**已知代价（明知的取舍，不是缺陷）**：中文版 Windows 常常根本没装本地英式音色，此时「英式」这一档会落到本地的**美式**音色上——**口音不准，但不卡**。反过来保留在线英式音色就等于每个词等网络。这里明确选了速度。用户若哪天要求口音优先，改 `pickVoice` 的查找顺序即可。

> **一条被自己推翻的判断。** 我一度把「模块里有个 `onVoicesReady()` 没有任何调用方」说成缺陷，理由是「首个会话的第一张卡拿不到音色」。**说重了**：`pickVoice()` 每次朗读都会重新 `getVoices()`，音色约 2.5 秒后就绪并自动进缓存，**会自愈**。因此顺手删掉了那个没人调用的 API，以及我刚为此加的 `ensureVoicesSubscribed()`——**不为一个不存在的缺陷留机制**。唯一的残留影响只是**每个会话的第一张卡退到浏览器默认音色**，而这等 2.5 秒再读比不退更差。

**验证**（`speechSynthesis.speak` 打桩 + 用 `Object.defineProperties` 覆盖真实音色对象的 `name`/`lang`/`localService` 伪造 Edge 音色表）：

| 项 | 结果 |
|---|---|
| 空闲时按 `S` | **零次**多余 `cancel` |
| 正在朗读时按 `S` | 先 `cancel` 再读 |
| 伪造：英式在线 + 美式本地（Edge 情形） | 挑中**本地美式** |
| 伪造：把上面两个的顺序颠倒 | **同结果**（与列表顺序无关） |
| 伪造：只有在线英式可挑 | 回退到它，**不崩** |
| 回归：翻背面 / 翻回正面 | 不读 / 读一次 |
| 回归：实际选中的音色 | `Microsoft Mark`（本地） |

> ⚠️ 伪造音色表必须用**真实 `SpeechSynthesisVoice` 对象**再覆盖属性。用普通对象赋给 `utter.voice` 会触发 WebIDL 的 TypeError，而这个异常会被 `dispatchEvent` 吞掉——症状是「挑出来是 `null` 且 `err` 也是 `null`」，极难定位。
>
> **验不到的**：改动是否真的治好了用户那台 Edge。开发机复现不出在线音色，只能靠他实机重听。若仍然慢，下一个嫌疑就是冷启动那 400~750ms（无法从 JS 侧消除）。

---

## 6. 会话队列逻辑（`lib/session.ts`）

```ts
async function buildSession(userId, opts): Promise<QueueItem[]
```

**队列构成与顺序**（**只适用于每日动线**；章节专项走 6.1、错词本走 6.2）：

```
1. 取所有 dueAt <= now 且 state != New 的复习词   ← 优先！旧词不复习会滚雪球
2. 取新词，数量 = min(dailyNewLimit - 今日已学新词数, 剩余)
3. 总长度受 dailyReviewLimit 限制（超出部分顺延，不是丢弃）
```

**会话内的重入队**（客户端 `StudySession.tsx` 负责）：
- 某词评分后，接口返回 `nextDueAt`
- 若该时间**落在本次会话范围内**（`isWithinSession()`，目前取 ≤20 分钟），就把这个词塞回**队尾**，本次会话内再见一次
- 具体延迟由 FSRS 的 learning step 决定，不由我们拍脑袋
- 队列元素换 key（`${wordId}-${rated}`）强制卡片重建，翻回正面

**今日已学新词数怎么算？**

`UserWordProgress.createdAt >= 今天零点` 的行数。**最初设计是从 `ReviewLog` 里数 `reps === 1` 的记录，实现时改掉了**——`reps === 1` 不一定是新词首次作答（复习态答错再答对也会让 reps 变化），而进度行的 `createdAt` 就是「这个词第一次出现」的确切时刻，语义干净得多。为此在 `UserWordProgress` 上加了 `@@index([userId, createdAt])`。

**今日复习数怎么算？**

不能简单数今天的全部流水——当天新学的词在会话内被反复提问也会写流水，那不算「复习」。判据是**这个词的进度行创建于今天之前**：

```ts
prisma.reviewLog.count({
  where: {
    userId,
    reviewedAt: { gte: today },
    word: { progress: { some: { userId, createdAt: { lt: today } } } },
  },
})
```

**两处都必须是数据库查询，不能用内存计数**，否则刷新页面就重置了。

**2026-10-16 追加：`startOfToday` / `localDayKey` 改成 `export`**

`lib/stats.ts` 要用它们做本地时区分组（热力图），逻辑一字未动，只是加上了 `export`。

`QueueItem` 同时多了 `isIelts` 和 `bncRank`（词卡上的「雅思」小印和词频刻度靠它俩）。**没有 `frqRank`**——方案里列了它，但词频刻度只用 BNC，加了就是死代码。

```ts
export function hasIeltsTag(tags: string | null | undefined): boolean {
  return Boolean(tags && tags.includes("ielts"));
}
```

用子串判断而不是更严谨的 `split().includes()`：ECDICT 的 `tags` 就是空格分隔的短标签串（`gk/ky/cet4/cet6/toefl/ielts/gre/zk`），实测 `"ielts"` 不是其中任何一个的子串，两者等价，而子串版本在 SQL 侧能直接写成 `LIKE`。

> **首页那张「雅思核心词 + band 估算」卡曾短暂存在，当天已按用户要求删除。** `TodayStats` 的 `ieltsTotal` / `ieltsMastered`、`getTodayStats` 里那条 `prisma.word.count({ where: { tags: { contains: "ielts" } } })`、`lib/stats.ts` 的 `estimateIeltsBand` + `BAND_STEPS` 档位表都一并撤掉了——留着就是没人读的死代码，而且每次渲染首页都要白跑一次 count。`hasIeltsTag` **保留**，词卡的小印仍在用它。

### 6.1 两条队列：每日动线 vs 章节专项（2026-10-16 两次修正）

`buildSession` 的**前两行**就分岔：带 `unitId` 走 `buildUnitSession`、带 `wordIds` 走 `buildWordListSession`（见 6.2），两个都不带才走上面那套每日规则。

| | 每日队列（`/study`） | 章节专项（`/study?unit=N`） |
|---|---|---|
| 取词范围 | 今天到期的复习词 + 配额内的新词 | **该章里还没有进度行的词** |
| 顺序 | 到期的排前面，再补新词 | 书序（`orderInUnit`） |
| 每日新词上限 | 生效 | **不适用** |
| 每日复习上限 | 生效 | **不适用** |
| 查询数 | 三条（到期行 / 已学词 id / 新词） | **一条**（该章 + 无进度行） |

#### 第一次修正：`unitId` 不再是每日动线的过滤器

章节模式原本是把 `unitId` 塞进每日动线里当**过滤条件**用的——取数逻辑没写错，语义错了。「点某一章只练那一章」于是变成了「今天原本要背的那几个词，恰好限定在这一章里」，配额和到期两条判据一个没少。实测 2026-10-16：第 1 章共 233 个词，当天新词已学 18 / 上限 20，点进去只拿到 **1 个到期词 + 2 个新词 = 3 个**；配额用光的日子点进去**一个词都没有**，直接弹「今天没有待学的词了」。这和 PRD 2.3 写的「专项学习（只背这一章的词）」是两回事，用户报的就是这个。**这是阶段二就带进来的原有缺陷，不是某一轮改出来的。**

配额、到期、先复习后学新这三条，都是**首页那条动线**的规则——目的是「每天固定喂一点、不让复习堆雪球」。章节专项是另一件事：用户主动挑了一章，要的就是把这一章走完，哪些词已经学过、哪些今天到期，都不该拦着他。

**表格里那个「不适用」只指专项自己不被拦，不等于它不记账。** 专项模式不读 `dailyNewLimit`，但它引入的每个新词照样写一行 `UserWordProgress`，而首页那条动线和 `getTodayStats` 都按「今天创建的进度行」数 `newDone`——于是专项学的新词会**占掉首页动线当天的新词额度**。实测 2026-10-16：`dailyNewLimit = 20`，当天在专项里学掉 31 个新词，首页的 `newRemaining` 就成了 0，按钮虽是「开始学习（N 个）」但队列里一个**新词**都排不出来，只剩复习词。`newDone` 的语义本来就是「今天引入了多少新词」，不论从哪条路进来，所以这是口径使然、没有特判。那条「今日新词」的显示溢出见 12.1。

#### 第二次修正：只给还没学过的词

第一版分岔之后是 `where: { unitId }`，**无条件返回整章**。于是用户学完前 21 个、退出再进来，第 1 张卡又是第 1 个词——他报「进度好像没保存，重新进入这一章要从头开始」。

**进度一直是在的**，实测确认过：第 1 章有 21 行 `UserWordProgress`（`orderInUnit` 恰好 1~21）、`ReviewLog` 里当天 8 条评分记录、章节列表页也正常显示「已学 21 / 233」。**丢的是位置，不是数据**——每次整章重排，队列里没有任何东西记得上次停在哪。

判据改成「有没有进度行」：

```ts
where: { unitId, progress: { none: { userId } } }
```

再进来天然就是接着上次学。**连带删掉了一段代码**：原先要取一次该章进度行、按 `wordId` 建 `Map`、给有行的词套真实卡片状态；现在取出来的全是没学过的词，一律 `emptyCard()`，那个 `Map` 和第二条查询都没有存在意义了。

**这一章里的复习不归这条路管**：学过、该复习的词由「今日功课」按到期时间给，这样每日复习上限（防积压崩盘）也不会被章节专项绕开。有意的取舍——代价是**整章学完后再点进来是空队列**，不再是「整章重来一遍」。

> **第三种空状态是这次修正逼出来的。** 学习页原先只有两种空法：答过若干后抽干（本轮做完）和一个都没答就空（今日无待办）。章节学完会落进后者，显示「今天没有待学的词了。去『章节词汇』挑一个章节加练」——**人已经在一个章节里了，还叫他去挑章节**。所以补了第三种：进门就空、且带着章（`rated === 0 && unit`）时显示「第 N 章 XX 已经学完」。章名由 `study/page.tsx` 单独查一条 `unit` 传下来，因为**队列为空时没有词卡可以读出章名**。主动作也跟着换——学完一章的人下一步是挑下一章，所以那一态的主按钮是「浏览章节词汇」，不是「回首页」。

**代价**：队列可能很长。最长的第 21 章 408 个词（这一章全部没学过时），服务端序列化后 **263 KiB**（第 1 章 233 个词是 148 KiB）。纯本地无网络请求可以接受；进度每评一次分就实时落库，中途退出不丢东西——这也正是学习页要写「进度已实时保存」的原因。

#### 验证（两次修正合并记）

| 项 | 结果 |
|---|---|
| `/study?unit=1`（第 1 章 233 词，已学 #1~#21） | **212 个**，第 1 张卡 `phenomenon` = 书序 **#22** ← 接着上次 |
| `/study?unit=2`（该章 0 个已学） | **124 个** = 该章总数，第 1 张卡 `photosynthesis` = #1 |
| 章节整章学完（临时给第 22 章 51 词造进度行，验完即删） | 显示「第 22 章 时间日期 已经学完」，无进度条、无词卡；按钮为「浏览章节词汇」（主）+「回首页」 |
| `/study?unit=999`（章不存在） | `unit` 为 null → 回落到「今日无待办」那套文案，不报错 |
| `/study`（每日动线） | **3 个**，与改前一致，一个字没改 |
| 侧栏高亮 | `/study?unit=1` 下「章节词汇」`aria-current="page"`，另外两项为 null |
| 锁高回归 | 1280×800 正面卡 **736×320**、`.flip-scene` 内联高 `320px`、背面 762px 翻面无裁切；375×812 正面卡 **343×320**、`.flip-scene` 320px |
| 横向溢出 | 两档视口均 **0** |
| 类型检查 | `npx tsc --noEmit` 通过 |

> ⚠️ **验的时候踩了一个坑**：预览面板被收起时 `innerWidth/innerHeight` 是 `0x0`，`WordCard` 那个量高度写进内联样式的 effect 会量到废值并把它留在 DOM 上——当时读到 `.flip-scene` 高 **758px**，看着像锁高坏了。**先 `preview_resize` 定好视口、再 `reload` 重跑 effect，读数才是真的**（重载后是 320px）。

### 6.2 队列三：错词本（`/study?weak=1`，2026-10-16）

**这一项不是新设计，是把预留的接口接通。** `buildSession` 原先只认「每日动线」和「章节专项」两种模式；`/stats` 的「老忘的词」那一栏当初是**刻意**做成只读、不给跳转的（13.9 记的「不做错词本」），就是等这一步——给 `buildSession` 加一次 `wordIds` 过滤，两处共用同一套排序。实现下来确实是这个形状：`src/lib/session.ts` 只多了一个可选字段、一行分岔、一个新函数。

| | 错词本（`/study?weak=1`） |
|---|---|
| 取词范围 | **调用方点名的那些 `wordId`**，一个不多一个不少 |
| 顺序 | **名单顺序**（不是书序，也不是到期时间） |
| 卡片状态 | **真实进度行**（`isNew: false`） |
| 每日新词 / 复习上限 | **不适用** |
| 到期筛选 | **不适用** |
| 查询数 | 一条（`userId` + `wordId in (...)`） |

#### 三处和每日动线不同，都是刻意的

1. **发真实进度行的卡，不是空卡。** 能进「老忘的词」就必须有 `ReviewLog`，有日志就有进度行，所以这些词一律不是新词。这里若像章节专项那样发 `emptyCard()`，FSRS 会拿一张全新的卡去排一个**已经在复习态**的词——稳定度、间隔、遗忘次数全部从头算。测试第 3 条守的就是这个：造一张稳定度 60 天的卡，断言评「一般」的间隔 > 3 天（空卡会落在 10 分钟的学习步长里）。
2. **不套每日配额、不按 `dueAt` 筛。** 理由和章节专项逐字相同（见 6.1）：配额和到期是**首页动线**「每天固定喂一点、别让复习堆雪球」的规则；用户主动点「集中攻克」，要的是一次把这些词过完，它们今天到没到期都不该拦着。注意 `buildWordListSession` 里**根本没有读 `userSettings` 那一步**，所以「把 `dailyNewLimit` 设成 0 也不影响错词本」是结构上成立的，不靠实测。
3. **按传入顺序排。** `orderInUnit` 在这里没有意义——名单顺序本身携带信息：忘得最多的排最前，这正是「集中攻克」想先解决的。

#### ⚠️ 「只给名单里的词」和「按名单顺序」由两处各管一半

```ts
const rows = await prisma.userWordProgress.findMany({
  where: { userId, wordId: { in: wordIds } },   // ← 收窄取回的行
  include: { word: { include: { unit: true, examples: true } } },
});
const byId = new Map(rows.map((r) => [r.wordId, r]));

return wordIds.flatMap((id) => {                // ← 决定顺序，并再兜一次集合
  const row = byId.get(id);
  return row ? [toQueueItem(row.word, row, false)] : [];
});
```

- `where` 里的 `wordId: { in: wordIds }` 收窄取回来的行（顺带别把整张进度表拉回来），走 `@@unique([userId, wordId])`，**不新增索引**；
- 最后那次 `wordIds.flatMap` 决定**顺序**，同时再兜一次集合。

**变异检查实测过，两条不能互相替代**：单独去掉 `where`、结果不变（`flatMap` 兜住了）；单独把 `flatMap` 换成 `rows.map`、集合仍对（`where` 兜住了）但**顺序塌回数据库给的 id 序**。也就是说「名单外的一个都不出现」有两条防线，而**顺序只有 `flatMap` 保得住**。`flatMap` 顺带跳过没有进度行的 id——名单和库对不上时最多少练一个词，不会整页 500。

#### 「前 20」这个数归位到 `lib/stats.ts`

`FORGETFUL_LIMIT` 原先写死在 `src/app/stats/page.tsx`。两处共用一个 20 却各写各的，改一处就会**静默分叉**——统计页列了 20 个、点进去只练到 15 个，且没有任何地方会报错。这正是 `session.ts` 的 `isMastered()` 那段注释批评过的「手抄副本」。现在 `stats.ts` 导出 `FORGETFUL_LIMIT`、`getForgetfulWords` 的默认值也是它，统计页和错词本都从这里取。

#### 入口两处，导航**不加第五项**

| 入口 | 位置 |
|---|---|
| 统计页「老忘的词」底部 | 「集中攻克这 N 个」→ `/study?weak=1` |
| 学习页「今天没有待学的词」空态 | 按钮行下面的文字链接「去错词本攻克老忘的词」 |

**不做成导航项是算出来的，不是省事**：`Nav.tsx` 的宽度预算里每项 68px、项间 2px、印章 40 + 品牌间隙 4，四项 = 322px，375px（可用 343）余 21px。**加第五项 = 392px、溢出 49px**；连 320px 的兜底（`max-[359px]:hidden`，只省 44px）都会失效——省完仍差 60px。

第二条入口做成**文字链接而不是第三个按钮**：那一态已经有「回首页」+「浏览章节词汇」两个按钮，各约 116px，375px 下可用 343px，硬塞第三个会换行。

**侧栏归属**：`/study?weak=1` 亮「研习统计」（从统计页进的），与 `/study?unit=N` 亮「章节词汇」同类。`Nav.tsx` 必须读 search params——query 不在 pathname 里，光看 pathname 分不出三种进法（11.13 和该文件的注释都记过这个 bug 家族）。**`unit` 和 `weak` 的优先级在 `study/page.tsx` 与 `Nav.tsx` 两处必须判得一模一样**，否则 `?unit=3&weak=1` 会页面走章节、高亮却亮「研习统计」。`pending` 那个 effect 的依赖数组也要带上这两个参数：`/study?unit=3` 和 `/study?weak=1` 之间前进后退时 pathname 一次都没变，只盯 pathname 的话高亮永远留在旧项上。

#### 验证（2026-10-16）

| 项 | 结果 |
|---|---|
| 统计页底部入口 | 「集中攻克这 7 个」→ `/study?weak=1` |
| 错词本队列 | 头部「错词本 · 第 1 章 自然地理」、还剩 7 个；RSC 负载里的 7 个 headword 与统计页那 7 行**逐个同序**（lithosphere → calamity → jeopardise → horizon → pebble → ore → mineral） |
| 侧栏归属 | `/study?weak=1` 下两套导航（bar + rail）的「研习统计」都拿到 `aria-current="page"` |
| `?unit=3&weak=1` | 走章节（拿到第 3 章整章 biologist / zoologist…），侧栏亮「章节词汇」，**页面与高亮一致** |
| 每日动线回归 | `/study` 仍是「复习 · 第 1 章 自然地理」+ 5 个到期词，与改前一致 |
| 375×812 横向溢出 | `/stats`、`/study`、`/study?weak=1` 三页均 **0**；导航 278px（与预算一致）；统计页入口链接 left 16 / right 135 |
| 单元测试 | `npm test` **48 条全绿**（原 41 + 新增 7），`npx tsc --noEmit` 退出码 0 |
| `dev.db` 指纹 | 测试与实景走查前后**逐位一致**（1617920 字节 / md5 `644229447fcbb0249a48de748c2b237a`） |

**没验到的两条**：「错词本进门就空」和「每日动线空态里的错词本链接」都需要**空队列**才渲染，而库里此刻有 5 个到期复习词、7 个老忘的词，触发不了；清空它们要动用户的实时学习数据（删日志 / 改配额），代价不划算。两条的判据都在代码里且是纯逻辑——空态分支 `weakDone = rated === 0 && weak`、链接条件 `rated === 0 && !chapterDone && !weak`，再加测试第 7 条（`wordIds: []` → 空队列）兜着。

> ⚠️ **走查时踩的坑：`next dev` 会累积成坏状态。** 连续十来次硬导航 + 反复 HMR 之后，**所有页面**（含与本次改动无关的首页）都停在 `app/loading.tsx` 的骨架屏上，`<main>` 的 HTML 一直是 `<!--$~--><template id="B:0">` + 骨架，控制台无错、dev overlay 无内容、服务端 `curl` 同一 URL 却是完整 HTML（167 KiB，含 `hidden id="S:0"`）。**重启 dev server 立刻恢复。** 判断依据是**首页也坏了**——本次改动碰不到首页，代码问题不会那样。下次再遇到「页面卡骨架」，先重启再怀疑代码。
>
> **同一天又补一条（2026-10-16）：坏状态还会留下幽灵 DOM。** 卡骨架之前那一次渲染的节点会留在 `<body>` 下面（**不在 `<main>` 里**），于是 `document.querySelector` 会命中早已不该存在的元素——实测在**首页**上 `document.querySelectorAll('form').length` 是 1（首页没有表单），学习页才有的 `input[aria-label="拼写答案"]` 在首页也找得到；连导航链接都有两组，一组尺寸正常、一组 0×0。**这会让走查读数不可信**（比如「结果态还有没有 form」会答成有）。客户端导航能暂时绕过渲染问题，但**清不掉这棵树**——只有 full reload 或重启 dev server 才清得掉。用 selector 取元素前先对个锚（如 `document.querySelectorAll('main').length === 1`）。

### 6.3 「已学」与「已掌握」两个口径（2026-10-16）

**起因**：用户报「章节词汇学习完之后，更新的进度没有能及时更新至章节词汇这个页面」。查完的结论是——**进度一行没丢，是那个数字的口径和直觉对不上**。

#### 页面原来只显示「已掌握」

`/units` 每行右边那栏从 [units/page.tsx:70](src/app/units/page.tsx:70) 显示的是 `{mastered} / {total}`，判据在 [第 27 行](src/app/units/page.tsx:27)：

```ts
if (p.state === "review" && p.scheduledDays >= 21) slot.mastered += 1;
```

21 天是 Anki 对「成熟卡片」的定义，和 `lib/session.ts:161` 的 `isMastered()` 同口径。刚学完的词 `scheduledDays` 只有几天，**这个数本来就不会动**。页面上能反映「学过」的只有下面那条进度条（`done={started}`），但它是按比例画的——第 2 章 124 个词，学 3 个 = 2.4%，肉眼看不出来。

**实测佐证**：第 1 章真实有 **24** 行 `UserWordProgress`，那栏却只显示 `1 / 233`（只有 `atmosphere` 的间隔到了 21 天以上）。

#### 排查中洗清的三条假设

| 假设 | 怎么测的 | 结果 |
|---|---|---|
| Next 路由缓存 / `staleTimes` 配错 | 读 `next.config.ts` — **没有** `staleTimes`，只有 `serverExternalPackages`；四个页面全是 `export const dynamic = "force-dynamic"` | ❌ 不是 |
| `<Link>` 预取拿到旧数据 | `/settings` 载入时侧栏会预取 `/units`（当时 unit 2 有 1 行）→ 往库里插第 2 行 → 点侧栏「章节词汇」→ 读到 `aria-valuenow="2"` | ❌ 不是，是新值 |
| 浏览器**后退键**返回陈旧页面 | 进 `/study?unit=2` → 插第 3 行 → `history.back()` → 读到 `aria-valuenow="2"`；硬刷新后同一页读到 **3** | ⚠️ 不是本项目的 bug |

后退那条要多说一句：那是 **bfcache**（前进后退缓存）——浏览器把离开时的页面整页冻住、原样还给你，不重新请求。**任何网站都这样**，包括 Anki Web、维基百科。判断依据就是「后退读到 2、硬刷新读到 3」，两者的差额正是 bfcache 冻结的那段时间里写入的那一行。

#### 改法：两个数并排，给不同的色

```tsx
<span className="shrink-0 whitespace-nowrap text-xs tabular-nums">
  <span className="text-[var(--color-ink)]">已学 {started}</span>
  <span className="mx-1.5 text-[var(--color-muted)]">·</span>
  <span className="text-[var(--color-muted)]">掌握 {mastered} / {total}</span>
</span>
```

- **「已学」用正文墨色**——它是随时在动的那个（学一个涨一个）
- **「掌握」用次要色**——21 天才动一次，不该抢视线
- 外层 `shrink-0 whitespace-nowrap`：数字块不参与收缩、不折行；右边的点线 leader 是 `flex-1`，随宽度收缩吸收差额
- **没有新增颜色令牌**，只用了既有的 `--color-ink` / `--color-muted`

页面底部那行小字也重写了，把两个口径讲清（原来只说「右边的数字是已掌握 / 总词数」，现在两个数），否则同样会有人盯着「掌握」以为没保存。

#### 验证

| 项 | 结果 |
|---|---|
| 375×812 | 数字块 **119px**、单行不折、`scrollWidth - clientWidth` = **0**；22 行行高一致（60~61px） |
| 1280×800 | 同上，横向溢出 **0** |
| 对比度（对纸底 `#faf8f3`） | 已学 `#1b1815` **16.65:1**；掌握 `#6e6353` **5.54:1**（小字需 ≥4.5:1） |
| 数据核对 | 第 1 章进度条 `aria-valuenow` = **24** = 库里该章行数；第 2 章清掉临时行后回到 **0** |
| 类型检查 | `npx tsc --noEmit` 通过 |

> 临时数据：为验证往 unit 2 插过 3 行（wordId 234/235/236），**验完已删净**，`UserWordProgress` 回到 24 行、全部属于 unit 1。

### 6.4 队列四：拼写（`/spelling`，2026-10-16）

**第四种来源，和错词本同构**：不读 `userSettings`、不看到期、按一个固定顺序给全。区别只在**名单从哪来**——错词本的名单由调用方给定（统计页那份 `rating = 1` 的排序），拼写的名单是「所有有进度行的词」，`buildSession` 自己查得到，所以调用方只要一个开关加一个可选的 `unit`。

> **调用方从 `/study?spell=1` 换成了 `/spelling`**（同日拆成独立页，见 14.8）。**这一层一个字没动**：`BuildSessionOptions.spell` 和上面的分岔顺序原样保留，`/study` 只是不再传它了，改在 `/study` 顶部把旧地址重定向到 `/spelling`。下面这张表里的「URL 上只要一个开关」说的就是 `opts.spell`。

| | 拼写（`/spelling`，`buildSession({ spell: true })`） |
|---|---|
| 取词范围 | **有 `UserWordProgress` 行的词**（学过的），可选再按 `unitId` 收窄 |
| 顺序 | `dueAt` 升序 |
| 卡片状态 | **真实进度行**（`isNew: false`） |
| 每日新词 / 复习上限 | **不适用** |
| 到期筛选 | **不适用** |
| 条数上限 | **`SPELL_LIMIT = 50`** |
| 查询数 | 一条 |

#### ⚠️ 分岔顺序：`spell` 必须排在 `unitId` 前面

```ts
if (opts.spell) return buildSpellSession(userId, opts.unitId);
if (opts.unitId) return buildUnitSession(userId, opts.unitId);
if (opts.wordIds) return buildWordListSession(userId, opts.wordIds);
```

`/spelling?unit=3`（即 `{ spell: true, unitId: 3 }`）要的是「**第 3 章里学过的**词」，而 `buildUnitSession` 给的是「第 3 章里**还没学过的**词」（6.1 第二次修正）。这两行一换，同一个请求就从「拼写检验」变成「章节初学」——而且**不会报错**，只是内容完全不对，页面上没有任何东西能提示「你现在其实是另一种模式」。所以 `spell` 这个分岔把 `unitId` **吃进自己的参数**往下传，而不是等上一行把它消费掉。

`tests/session.test.ts` 里「给定 unitId 时只给这一章学过的词」那条同时守这两件事——变异检查把这两行对调，它确实变红。

#### 三处刻意选择

1. **只给有进度行的词。** 拼写是**检验**不是初学——没见过的词第一题就写不出来，用户看到的是「这功能坏了」。用 `prisma.userWordProgress.findMany` 而不是 `prisma.word.findMany`：这个语义在**查询这一层**就定死了，不靠后续过滤兜。
2. **按 `dueAt` 升序，不按 `lastReviewAt`。** 不只是「最该复习的先来」——学习步长是 `["1m","10m"]`（5.4），**刚学完的新词 `dueAt` 就在几分钟后**，天然排在队首，正好接住「学完 20 个新词 → 立刻回头默写这 20 个」那条动线。按 `lastReviewAt` 升序**接不住**：刚学完的词 `lastReviewAt` 是「刚刚」，会沉到队尾——最想默写的那些词反而最后才出现。走现成的 `@@index([userId, dueAt])`，不新增索引。
3. **取前 50。** 已学词会涨到几百上千（全书 3580 个词），一次全给不现实；50 够一轮，答完随时退出——进度每题实时落库，不丢。

`where` 里的章节收窄走 `word: { unitId }` 这个关系过滤，同样不新增索引。

**发真实进度行的卡，不是空卡**：理由与错词本逐字相同（6.2 第 1 条）——这些词必然有进度行，发 `emptyCard()` 会让 FSRS 拿一张全新的卡去排一个**已经在复习态**的词。测试里那条断言与错词本同款（造稳定度 60 天的卡，断言评「一般」的间隔 > 3 天）。

---

## 7. 提取流水线设计（Python，零依赖）

### 7.1 `extract_images.py`

**必须按 PDF 对象结构解析**，不能扫 `FFD8`（实测 1002 个标记 vs 334 张真图）。

思路：
1. 扫描文件的间接对象：`N 0 obj ... endobj`
2. 筛出含 `/Subtype /Image` 且 `/Filter /DCTDecode` 的对象
3. 读该对象的 `/Length` 字段，从 `stream` 关键字后精确取 N 字节
4. 校验取出的字节以 `FFD8` 开头、`FFD9` 结尾（如果不符，记录警告）
5. 按对象在文件中的顺序编号输出 `data/pages/001.jpg`

**注意**：PDF 的 `stream` 关键字后跟 `\r\n` 或 `\n`，`/Length` 也可能写成间接引用（`/Length 12 0 R`）。两种情况都要处理。

### 7.2 `ocr_pages.py`

**为什么需要**：我读不了扫描图（Read 工具返回 `[Unsupported Image]`），PDF 又没有文字层（`/Font` = 0），所以只能本地 OCR。

**技术选择**：`rapidocr` + `onnxruntime`（PP-OCRv6 模型随包自带，本地 CPU 推理，**不联网**）。比 PaddleOCR 装得干净，比 EasyOCR 轻（不用 torch）。

**双栏处理是关键**：这本书每页两栏。OCR 返回的是一堆散块，若只按 y 坐标排序，左右两栏会**交错串行**，词条结构就毁了。做法：找一个竖直切分位置 x，使「不跨越它」的文字块最多（允许 ≤15% 的块跨越，因为少量标题会横跨两栏），然后**左栏读到底，再读右栏**。

**输出**：`data/ocr/NNN.txt`（纯文本）+ `data/ocr/NNN.json`（带坐标与置信度）。

**实测**：约 5–13 秒/页，334 页约 40 分钟。英文单词和中文释义准确；**音标不可靠**（`hydrogen` 被识别成 `/'pksıdzən/`，正确是 `/'haɪdrədʒən/`）。所以音标一律不采用 OCR 结果，由 ECDICT 提供。

### 7.3 `build_vocab.py`

- 输入：`data/ocr/*.txt`（配合 `.json` 里的坐标辅助判断词条边界）
- 输出：`data/words.raw.json`

**词条识别规则**（基于步骤 0 实测到的格式）：

一条词目以 **`单词 + /音标/`** 开头，后面跟着若干行：
- `词性. 释义`（如 `<词性. 释义>`）
- `[例]` 英文例句 + 中文翻译（0~n 条）
- `[搭]` 搭配（可选）
- 词根词源（可选，形如 `<词根>+<词根>→<释义>`）

**难点**：这些内容都会换行折断（长例句必然折行），所以**不能简单按行切**。判定词条边界的依据是「这一行是否以 `单词 + /音标/` 的模式开头」。`data/ocr/*.json` 里的块坐标可作辅助（词目行字号更大、更靠左）。

输出结构：

```json
{
  "chapters": [
    {
      "chapterNo": 1,
      "name": "自然地理",
      "startPage": 1,
      "words": [
        {
          "headword": "atmosphere",
          "orderInUnit": 1,
          "rawMeaning": "<词性. 释义>",
          "examples": [{ "en": "...", "cn": "..." }],
          "collocation": "<搭配组>",
          "etymology": "<词根>+<词根>→<释义>"
        }
      ]
    }
  ]
}
```

**词条边界的两个坑（2026-10-15 修）**

边界既然靠「这一行是不是词目行」来判，那么**词目行之后的任何无标签行都会归给当前词条**。于是：

1. **全书最后一个词会吞掉整页索引。** 书末索引（第 312 页起）的行是「单词 + 页码」格式，不带词目行特征，被当成它的正文一路累积下去。实测 `incidentally`（Ch22 第 51 个、书第 311 页，**全书最后一个词**）的 `note` 字段装了 **16793 字符**的索引页（`<单词><页码><单词><页码>…`）。第 3 步虽然有 `page >= INDEX_PAGE` 过滤，但拦的是**词条的起始页**，拦不住 body 里后续页的行。修法：在切分阶段（第 2 步）就直接丢掉 `page >= INDEX_PAGE` 的行。
2. **每章最后一个词的 `note` 尾部会粘一个页码。** 实测全书 **51 处**（Ch1 `1320`、Ch3 `3`、Ch4 `4`、Ch5 `5`、Ch6 `6`、Ch9 `9`、Ch10 `10`、Ch11 `11`…）。修法：丢弃整行纯数字。

改完重跑验证：词数仍是 3610，差异**只有那 51 个 `note` 字段**，headword / meaning / examples / collocation / etymology 一字未动。

> **数据侧也已对齐（2026-10-15）**。`incidentally` 是手工清的，其余 51 处用 `scripts/fix_notes.py`（改词表）+ `scripts/update_notes_db.ts`（改库）原地修掉，差异清单落在 `data/notes-changes.json`，两份脚本共用。两个脚本都幂等，修完重跑报 0 改动。修完复查：库中与词表不一致的词条 **0 处**、超 800 字符字段 **0 处**、`UserWordProgress` / `ReviewLog` 一行没动。

**第三类噪声：整条无汉字的 `note`（2026-10-16 修）**

`note` 是个兜底桶——归不进释义 / 例句 / 搭配 / 词源的无标签行全落进来。清完页码之后，桶里还剩 **28 条整条没有汉字的**：音标被 OCR 认成乱码（`flour` → `porıd3`、`sausage` → `f1∫7`、`midnight` → `əuvə'nait`）、隔壁词条的残片（`inventory` → `content`、`versatile` → `add`）、页码符号串（`June` → `21 23 24 25 2728 29 30`）。另有 3 条（`mercury` / `embark` / `wreath`）的页码粘在文字同一个 OCR 行里，`re.fullmatch(r"\d+")` 拦不住。

修法：`parse_entry` 收尾时，**整条 `note` 一个汉字都没有就清空**。判据必须是「整条」而不是「某一行」——一条 note 里夹着纯英文的名人名言（泰戈尔、达尔文的原文）是正常的，按行丢会把它们一起删掉（第一版就是按行写的，diff 里逮到 20 多处内容被削）。改完重跑：**28 条 `note` 清空，其余字段零变化**；数据侧沿用 `fix_notes.py` / `update_notes_db.ts`，清单扩到 77 条，两边重跑都报 0 改动。

> **还没动的一类**：73 个词的书内释义被 OCR 切进了 `note`——`n.` 被认成 `n1.`（`meteorite` → `n1. 陨石`）、或行首多一个页码（`dorm` → `5 n. 宿舍`），没匹配上词性正则，于是整行释义落进 `note`、`meaning` 反而是空的。不影响背诵（卡片取 ECDICT 的 `meaningCn`，缺的只是 `bookMeaning` 和 `pos`），是独立的解析精度问题，尚未处理。

### 7.4 `check_with_ecdict.py`

**数据来源**（已通过 GitHub API 查到真实资源，非猜测）：

`https://github.com/skywind3000/ECDICT/releases` → tag `1.0.28`，可选：

| 资源 | 大小 | 说明 |
|---|---|---|
| `ecdict-stardict-28.zip` | 67 MB | StarDict 格式，**实际用的这个** |
| `ecdict-sqlite-28.zip` | 207 MB | 直接是 SQLite 库 |

> ⚠️ 这份数据是 **2017 年**的，比较老。对雅思核心词影响很小，但缺失项要记入可疑清单人工补。

**实测的数据格式**（不是照抄文档，是下载后打开看的）：

StarDict 三个文件，`.ifo` 里写着 `sametypesequence=m`——意思是 `.dict` 里每条记录都是**一段纯文本、没有类型前缀**。一条记录长这样：

```
*['ætmәsfiә]   -K3
n. 大气, 空气, 气氛
[医] 大气; 大气压
(高研四六托 2217/1855)
```

- 第一行 `*` + `[音标]` + 填充
- 末行 `(考试标签 词频)`，标签是单字中文缩写（中=zk 高=gk 四=cet4 六=cet6 研=ky 托=toefl 雅=ielts 宝=gre），词频是 `bnc/frq`
- 中间是中文释义，可能多行，带 `[医]` `[网络]` 这类领域标记

`.idx` 是「词\0 + 4 字节大端偏移 + 4 字节大端长度」的定长记录流，按字节序排。

**流程**：

1. 解压 `ecdict-stardict-28.zip`（约 200 MB，只做一次）
2. 一遍扫过 `.idx`，把要找的词捞出来。**不建全量索引**——ECDICT 有 340 万条，全塞进内存不合算，而我们只要几千个词
3. 按偏移读 `.dict` 拿记录，解析成 `phonetic` / `meaningCn` / `tags` / `bnc` / `frq`
4. 命中 → 补字段；未命中 → 记入可疑清单（**不静默丢弃**）
5. 输出 `data/words.clean.json` + `data/ecdict-report.md`

**两个实测踩到的坑**：

- **ECDICT 只有一份音标**，分不出英式美式。所以数据模型里的 `phoneticUk` / `phoneticUs` 合并成了一个 `phonetic` 字段（见 4.1）。
- **它用西里尔字母 `ә`（U+04D9）冒充中央元音 `ə`（U+0259）**。看着一样，字节不同，不换掉的话检索和显示都会出问题。
- 还遇到「有 `cores` 却没有 `core`」这种，所以查不到时会再试一遍派生形（`+s/+es/+ed/+ing` 等），只在原形没命中时才用，不会污染正常结果。

### 7.5 `parse_index.py`（书末全书索引）

书末第 312–325 页（图片 321–334）是一份按字母排序的**全书索引**：单词 + 三位补零的书页码，横排 2–4 个子列。

**这是整条流水线里最重要的一次发现**：它是出版社自己排的完整词表，且 OCR 质量**远好于正文**（正文里被认烂的词，这里往往还在，还顺带给出页码）。于是它同时充当两个角色——补漏的数据源、以及交叉校验的基准答案。

**版面怎么读**：页码右对齐，OCR 会把一行拆成几个块，同一行的块按 x 排完就是「单词 页码 单词 页码 …」的流水。所以**不需要判断列**，按行分组后扫描「单词后面紧跟一个 1–3 位数字」即可。

**已知的 OCR 错**：整页的页码会一起认错（`098` 认成 `860`、`099` 认成 `660`，同一页几条一起错）。**不要去猜**（`860` 取后两位是 60，离真值 98 更远）——这条词照样收进词表，只是记成「页码不可用」。宁可没有页码，也不要归错章。

> 这里改过一版：最初把「页码不可用」的词整条丢掉，结果「词表 vs 索引」的按章对照虚报第 7 章少 29 个词——那批词在索引里明明都在，只是整页页码被认花了。**词可以没有页码，但不能少。**

### 7.6 `reconcile_index.py`（用索引给词表补漏纠错）

拿索引对齐词表，做四件事：

| 动作 | 判据 |
|---|---|
| **修** 改拼写 | 词典查不到、但索引里有**唯一**近形，且索引页码落在这条词附近（±3 页） |
| **补** 漏词 | 索引里有、词表里连近似拼写都没有的词，按索引页码归章补进去 |
| **删** 伪词 | 多词词条 + 词典查不到 + 索引里连近形都没有（真词不会这样） |
| **并** 去重 | 同一个词在同一章出现两次（正文与插图各排了一次），保留位置靠前的、内容取更全的 |

判据一律要求「**恰有一个**候选」——宁可漏改也不乱改。把一个真词换成书里没有的词，比留着一个错字更糟。

**加页码邻近约束的由来**：只按「近形唯一」判，曾把第 3 章的 `Orcart` 改成 `cart`、`Cestox` 改成 `custom`——那是别的章节里拼写相近的无关词。加上「索引页码必须落在这条词所在页附近」之后收敛。

**实际效果**：改名 7、补词 31、删伪词 19、同章去重 28。最终 **3594 条词 / 3552 个词形 / ECDICT 通过 3580（99.6%）**，22 章的「词表 vs 索引」差值全部落在 ±6 内。

脚本**幂等**：跑第二遍不会再改任何东西。

### 7.7 `verify_vocab.py`（旁证，非主依据）

拿**每页底部的「本页词索引条」**当基准，反查解析漏了哪些词——这条东西在 `build_vocab.py` 里是被丢掉的（见 `FOOTER_RATIO`），正好反过来当基准答案用。

但它比书末索引噪声大得多：页脚会混进 running head（`IELTS` / `Chapter`）和版权页文字，报出的「疑似真漏词」有一大半是假的。**已不作为主要依据**，保留作旁证。

### 7.8 `fix_spacing.py` + `update_spacing_db.ts`（修例句单词粘连）

**问题**：OCR 会把相邻单词粘成一个 token——`examinationcreated` 本该是 `examination created`。2026-10-15 量化：3635 条例句里 486 条（13.4%）中招，搭配 3.3%、词源 1.6%。

**做法**：拿 ECDICT 的 112 万条词形当白名单，给每个粘连 token 找一组词典词、拼起来恰好还原它。**不用重跑 OCR。**

**切分用 DP**（动态规划，求最小总代价的切法），每片代价：

```
cost(piece) = PIECE_PENALTY + int(base * SCORE_SCALE) - len(piece)
base        = min(NO_EVIDENCE, log10(rank + 1) * RANK_FACTOR)
```

`rank` 是 ECDICT 词频（越小越常见）。含义是：**常见词便宜、冷僻词贵、多切一片就多付一份 `PIECE_PENALTY`、片段长有奖励**。代价值卡在「比任何真实词都贵、比无证据碎片便宜」之间，所以只有真凑不出来时才走「留几个字母原样不动」。

**三个坑（这节最值钱的部分，都是实测撞出来的）**

| # | 坑 | 表现 | 结论 |
|---|---|---|---|
| 1 | **「在词典里 = 真词」不成立** | 112 万词形里混着人名（`achair` 标的是「阿恰伊尔(俄)」，地名）、缩写（`tsee`）、OCR 垃圾（`ofspring` 的释义是网络词「春天的来临」），**甚至把粘连本身也收了**（`hadto` 有词条、释义 `v. 必须`）。第一版按「token 在词典里就跳过」过滤，整批真实粘连被放过 | 不能拿词典当布尔开关，得分证据强弱 |
| 2 | **ECDICT 词频数据不可靠** | 实测 `is`=24648（它是最常用的词之一）、`was`=41040、`links`=40605、`shew`=25797，而 `are` / `were` / `has` / `had` / `been` / `does` 干脆**没有词频** | 曾试过「两片词频都 < 5000 才切」，结果 `Hewas` / `townwas` / `thelinks` / `adoptedour` 全漏切。**词频只能当 DP 的打分权重，不能当开关。** 只手工修确知坏掉的：`is` → 9 |
| 3 | **完整词被拆** | `plummeted` / `mosquitoes`——ECDICT 收了词形却没配词频，于是被切成 `plummet + ed` | 末片是纯词尾（`ed`/`es`/`ing`）且整词在词典里 → 判为拆坏了，回退 |

**最终判据（按优先级）**

1. 整词在词典里**且有实据**（自己词频 / `[原型]` 行 / 不规则变化表）→ 不碰
2. 词性标粘连（`usuallyadv.` / `estimatev.`）→ **单独认**，不走 DP。这类不能靠通用切分——`usuallyadv` 会被切成 `usually + a + dv`
3. 其余进 DP。切完再过两道闸：
   - 末片是纯词尾且整词在词典里 → 拆坏了，回退
   - 整词在词典里、有正经释义（`n. 水圈` 这种词性标开头的）、但没词频 → **只有每一片都够常见，才认这次切分**

第 3 条最后那闸是整节的核心权衡，为它专门加了一个判据：

```
hadto        → had + to           两片都超高频      → 切   ✓
hydrosphere  → hydro(23990) + sphere(3863)  有一片很冷 → 判定是整词，不切 ✓
```

`hydrosphere` 是真词（`n. 水圈, 水界, 水气`），只是恰好没词频，被当成垃圾切成了 `hydro sphere`——这是在浏览器里实际看到的，回头才补的判据。**代价**：`cannot` / `washbowl` / `allover` 这类真复合词会被切（`can not` / `wash bowl` / `all over`），读起来还算通顺，接受。

**两处细节**

- **缩写保护**：`doesn't` / `couldn't`——正则只吃字母，切到的是 `doesn`，后面还跟着 `'t`。检测到紧跟 `'t` / `’t` 就整块跳过，否则会拆成 `does n't`
- **只碰英文**：`TEXT_FIELDS = collocation / etymology / derived` 加 `WordExample.en`。中文释义和文化背景（`cultureNote`）不碰——那是中文，没有粘连问题

**落库用 `update_spacing_db.ts`，不重灌**

`prisma/seed.ts` 开头会清空 `UserWordProgress` / `ReviewLog` / `Word` / `Unit` / `User`，重灌会把学习进度一起冲掉。所以改成**整串原位替换**：拿 `spacing-changes.json` 建 `Map(旧文本 → 新文本)`，对 `Word` 三个字段和 `WordExample.en` 做查表替换，每 500 条一个 `$transaction`。

**结果**：3635 条例句改掉 **2655 条、3638 处**；落库 `Word` 914 行 + `WordExample` 2645 行；**进度 3 行 / 流水 4 行 / 用户 1 个一行没动**（`scripts/verify_spacing_db.ts` 复核）。

**已知残余错误**（都是边缘案例，不值得再花力气）

- `Gallard → Gal + lard`（人名）、`andsmashed → ands + mashed`、`Theseais → These ais`、`wasplaying → wasp laying`、`existon → existo n`
- `junkfood` 这类没切开的零星几个
- OCR 自身的 `I` → `l` 误认（`l saw a swarm`）约 10 处——**源数据问题，不是脚本的**

**用法**：`python scripts/fix_spacing.py`（**默认 dry-run**，只出报告）、`--apply` 才写文件、`--probe "is,was,the"` 单看某几个词的 ECDICT 记录。

### 7.9 `fix_notes.py` + `update_notes_db.ts`（修 `note` 字段的脏数据）

**问题**：`build_vocab.py` 的 `note` 是个兜底桶，混进两类脏数据——尾部粘页码（51 处）、整条无汉字的纯噪声（28 处 + 3 处行内粘数字）。成因和量级见 7.3，这里只说数据侧怎么对齐。

**做法**：修脚本只解决「以后」，「已经产出的」词表和库还得单独对齐。把旧脚本产物和新脚本产物逐词对比，再叠一轮「整条无汉字 / 尾部含数字」的规则清理，算出 `data/notes-changes.json`（77 条 `{chapterNo, headword, old, new}`），两份脚本共用：

| 脚本 | 改哪 |
|---|---|
| `scripts/fix_notes.py` | `data/words.clean.json` |
| `scripts/update_notes_db.ts` | 数据库的 `Word.cultureNote` |

**几个细节**

- **两个脚本都幂等**：只在「当前值恰好等于清单里的 `old`」时才写，跑第二遍报 0 改动。改数据不像改代码，能放心重跑才敢跑。
- **同章重名词不能压成单值**：`papaya` 在 Ch12 排了两次（正文一次、插图一次）。第一版用 `Map(headword → note)` 建索引，有差异的那条被同名的空值覆盖掉，整条修复就漏了。改成 `(chapterNo, headword) → note 列表` 才对。
- **写回 `clean.json` 不能重排格式**：原文件是 1 空格缩进 + CRLF。写之前把 `json.dumps` 的结果和原文做**字节级比对**，不一致就中止——否则真正的改动会被淹没在 79000 行的行尾差异里。
- **一个词可能压着两条链式变更**：`June` 的 note 先被页码修复动过一次、又被噪声清理动过一次（`132021…` → `21 23…` → 空）。脚本一轮只应用清单里匹配上的那一条，所以清单要先归并——同一个词只留最后一条，前面的必然已经落库了。

**为什么库也走原地更新**：同 7.8，`seed.ts` 会先清空 `UserWordProgress` / `ReviewLog`。

**结果**：词表改 31 个词、库改 30 行（少的一条是伪词 `Cestox`，`verified == false` 没入库）；复查「库与词表不一致 0 处 / 无汉字 `note` 0 条 / 尾部粘数字 0 条 / 进度 3 行、流水 4 行一行没动」。

**已知残余**：另有 73 个词的书内释义被切进了 `note`，已由 7.10 一并修掉。

**用法**：`python scripts/fix_notes.py` 和 `npx tsx scripts/update_notes_db.ts` **都默认 dry-run**，各自加 `--write` 才真写。

### 7.10 解析层三处改进 + 释义归位（2026-10-16）

**问题**：7.9 末尾留下的 73 个词——书里的释义行开头被 OCR 掺了东西，整行落进 `note` 兜底桶，`meaning` 空着：

```
meteorite   note='n1. 陨石'      n. 的点被认成 1
dorm        note='5 n. 宿舍'     行首多了一个章号 5
atlas       note='Ⅱ1. 表格'      整个 n. 被认成罗马数字
```

卡片显示有 ECDICT 的 `meaningCn` 兜底，背诵不受影响；缺的只是 `bookMeaning` 和 `pos`。

**但一查，影响面远不止 73 个。** 顺着这三条线索挖出三个根因，最终涉及 154 个词、260 处字段，横跨 meaning / note / examples / collocation / derived / etymology 六个字段。

**根因 1：页边章号块（最隐蔽，也是这次最值钱的发现）**

书在**偶数书页的左边缘**印着当前章号，一个大号孤立数字。实测 134 个这样的块落在 x < 115，而正文左栏起点在 x ≈ 115–146。`group_lines` 按 y 距离合并同一行的块，这数字正好和本页顶部第一个词条的释义行齐平，就被并了进去：

```
n. 宿舍            →  5 n. 宿舍
(=disk)n.光碟…     →  9 (=disk)n.光碟…
```

行首不再是词性，`POS_PREFIX_RE` 不认，整行掉进 `note`。同一类污染还散在例句（`a common3 ancestor`）、词源（`希4 腊神话`）、搭配、派生里。

**修法**：`drop_edge_marks(col)` 在分行前先剔掉这类块。三个条件同时成立才剔——内容是个 1~2 位数字、宽度很窄、整块落在本栏正文左边界之外。第三条用「含中文或长度 > 3 的块」的最小左边界当基准，正文里的数字不会被误伤。

**根因 2：词性缩写被认坏**

除了 `n1.`（点被认成 1），还有 `1.`（整个 n 丢了，只剩那个点）、`Ⅱ1.`（n. 被认成罗马数字加 1）。都在词条开头，一律还原成 `n.`——**词条的第一个词性缩写几乎总是 n**，而且只处理词条第一行，风险可控（`clean_leading_noise`）。

**根因 3：释义尾部粘数字**

`n. 洗涤剂 10`、`v. 凝视；沉思；考虑 20`。和 7.3 的「note 尾部粘页码」同源，上一轮只清了 note，meaning 里的漏了 14 处。`parse_entry` 收尾统一截掉。

**顺带放宽的四处正则**

| 位置 | 放宽了什么 | 例子 |
|---|---|---|
| `POS_PREFIX_RE` | 加 `ord`、全角 `】`、`(=xxx)` 后可选句点、结尾允许一个大写字母 | `ord.第一adv.最初`、`n[英】男校长`、`adj.X级` |
| `strip_leading_phonetic` | 开头斜杠被完全吃掉时，按「重音符号 + 词性表」剥 | `'əuvasi:zadj.海外的` |
| `parse_entry` | 加「整行中文、无词性前缀」的释义兜底 | `策略，战术`、`[尤美]公寓套房` |
| `(=xxx)` 剥离 | 允许跟一个句点 | `(=counselor).顾问` |

**一个意外收获：粘连自动分离**

本没打算动「释义续行拼接」那段逻辑（`if field in ("collocation","derived","meaning") and not SENT_END_RE.search(line)`）。实测发现它判的是**当前行**是否以句末标点结尾——书里的文化说明段一律以 `。` 收尾，所以会自动落进 `note` 而不是被拼进 `meaning`。于是 `chronology` / `hygiene` / `atlas` / `vegetarian` / `sandwich` / `devastate` / `costume` 的释义和词源自动分了家，不用另写切分规则。

**应用链**（词表已经产出，不能重跑整条流水线）

1. `python scripts/build_vocab.py` 重跑 → `data/words.raw.json`
2. 新旧产物逐词对比 → `data/parse-changes.json`（260 条 `{chapterNo, headword, field, old, new}`）
3. `python scripts/apply_parse_changes.py --write` → `data/words.clean.json`
4. `python scripts/fix_spacing.py --apply`（**必须紧接着跑**，理由见下面第 1 个坑）
5. `npx tsx scripts/update_parse_db.ts --write` → 数据库

**结果**：154 个词 / 260 处字段（meaning 100、note 98、examples 28、derived 19、collocation 11、etymology 4）。**headword 零变化**，词目数 3594 不变。体检：meaning 尾部粘数字 0、meaning 开头是认坏词性 0、note 无汉字 0。

**三个坑（都踩了）**

1. **`fix_spacing.py` 不是幂等的**。原先以为它可重跑（7.8 的落库是整串原位替换，看着无害）——**实则不然**。它每次都会重新评估「仍有粘连嫌疑」的文本，对上次切剩的残留再切一刀。这次重跑本意只是把解析层退回未修状态的 62 个字段重新补空格，它却顺带切了 8 个**没退回**的字段，且全切错：

   ```
   exist      'doesn\'t existo n the surface'  →  'doesn\'t ex is to n the surface'
   byproduct  'bypath n.旁道,小路'              →  'by path n.旁道,小路'
   coin       'coiner n.创造新词语的人'         →  'coin er n.创造新词语的人'
   ```

   靠 `parse-changes.json` 的清单过滤掉了：凡是 (词条, 字段) 不在「应改集合」里的改动，一律回滚到 spacing 之前的值（一次性脚本 `rollback_overreach.py`）。**以后谁要单独重跑 `fix_spacing.py`，先看清这批残留。**

2. **DB 同步必须从 `clean.json` 读最终值，不能从 `parse-changes.json` 读 `new`**。`parse-changes` 记的是 raw 状态（`betrayasecret`），而 `clean.json` 已经跑过 spacing（`betray a secret`）。第一版直接从 `new` 写库，把库里已经修好的例句、搭配又退回粘连——干跑时靠 `betray.collocation` 抽查发现。改成一律以 `clean.json` 为准，`parse-changes` 只用来确定「动哪些词条、哪些字段」。

3. **Prisma 6.19 嵌套 `select` 里带 `orderBy` 会让查询引擎 panic**（`no entry found for key`，`record.rs:69`，非可恢复）。`word.findMany({ select: { ..., examples: { orderBy: ... } } })` 直接崩。拆成两次查询（`word` 一次、`wordExample` 一次，再按 `wordId` 归并）就没事。

**落库**：`update_parse_db.ts` 原地更新，不重灌。`examples` 只增不改结构（本次 10 个词从无到有、18 个改文本，没有变少的），所以不删行。**进度 3 行 / 流水 4 行一行没动**（写前写后各查一次计数）。

**幂等性**：`apply_parse_changes.py` 对 meaning / note 严格比对 `old`（note 忽略尾部数字，因为 `fix_notes` 已经清过那一截）；对四个 spacing 字段不比对、照写 `new`。`update_parse_db.ts` 一律以 `clean.json` 为准比库值。两者重跑都报 0 改动。

**用法**：`python scripts/apply_parse_changes.py`（干跑）/ `--write`；随后 `python scripts/fix_spacing.py --apply`；再 `npx tsx scripts/update_parse_db.ts`（干跑）/ `--write`。

---

## 8. 测试策略

**计划与实际有落差，如实记录。**

| 层 | 测什么 | 计划怎么测 | 实际状态 |
|---|---|---|---|
| `lib/srs.ts` | FSRS 封装的正确性 | 单元测试：给定初始卡片 + 评分序列，断言 `dueAt` 递进 | ✅ **2026-10-16 已补**，`tests/srs.test.ts` 12 条（见 8.2） |
| `lib/session.ts` | 队列构成逻辑 | 单元测试：断言「复习词优先」「新词配额」「上限截断」 | ✅ **2026-10-16 已补**，`tests/session.test.ts` 29 条（见 8.2） |
| `lib/stats.ts` | 统计口径 | —— | ⬜ 没写。统计页刚落地、没改坏过，这笔不在本轮范围内（见 8.5） |
| 提取脚本 | 解析规则 | 固定页面样本做 fixture | ✅ 用全书 334 页跑通，产出对得上索引 |
| 数据质量 | `words.clean.json` | 校验脚本 | ✅ `check_with_ecdict.py` + `reconcile_index.py` |
| UI | 学习流程 | **手动，无自动化** | ✅ 已在浏览器实测 |

### 阶段二实际做了什么验证

**没有写自动化测试**——这个阶段的目标是「跑通主链路」，加测试框架会把范围撑大。替代手段是**端到端实测 + 直接查数据库**：

| 验的什么 | 怎么验 | 结果 |
|---|---|---|
| 评分落库正确 | 评「一般」后 `sqlite3` 查 `UserWordProgress` | `state=learning, reps=1, learningSteps=1, due=+10min` ✅ |
| 「简单」拉长间隔 | 复习态评「简单」，看 `scheduledDays` | 3 天 → 10 天 ✅ |
| 会话内重入队 | 评「一般」后看剩余数 | 剩余数不变（该词排回队尾）✅ |
| 设置生效 | 设置页改 25 → 查库 | DB 确认 25，已还原为 20 ✅ |
| 类型无错 | `npx tsc --noEmit` | 退出码 0 ✅ |
| 生产构建 | `npx next build` | 通过 ✅ |

**这笔技术债要在阶段三之前还掉**：`lib/srs.ts` 是纯函数（输入卡片 + 评分 → 输出新卡片），最好测；一旦 FSRS 参数调错，症状是「复习量不知不觉变得不合理」，不写测试很难发现。阶段三开工第一件事是补 `srs.ts` 和 `session.ts` 的单元测试。

### 8.1 为什么逾期了才发现

阶段三的粘连修复、热力图、统计页都做完之后才还上，原因是**后两项任务开始变得危险**：拼写/听写模式要动 `StudySession`，错词本要动 `buildSession`，两处都落在核心学习链路上。而 `buildSession` 的章节专项分支在 **2026-10-16 连着修了两轮**（先「点某一章只练那一章」实际变成「今天要背的那几个词恰好在这一章」，后「学过的词也在队列里、每次从头重排」），两次都是用户报错才发现的。有测试网兜着，这类回归自己就会红。

**2026-10-16 兑现了一半**：错词本正是「要动 `buildSession`」的那一类，落地时新增 7 条测试把它锁住（`describe("buildSession —— 错词本")`），变异检查确认三条**互相隔离**的信号——顺序 → 第 2 条、`isNew` → 第 3 条、到期筛选 → 第 4 条（详见 6.2 和 8.6）。拼写/听写模式那部分当时还没做——**同日稍晚一并补上**，见 8.8 和第 14 节。

### 8.2 怎么做到零新依赖

这是本项目第一次引入测试，硬约束「零新依赖」照样守住了——现成的东西已经够：

| 需要什么 | 用什么 |
|---|---|
| 测试框架 | Node 内置 **`node:test`**（Node v22.18.0） |
| 断言 | Node 内置 **`node:assert/strict`** |
| 跑 TypeScript | **`tsx --test`**（`tsx@4.23.15` 已在 devDependencies，它把 node 的参数透传） |

**没装 vitest / jest**。项目的测试需求是「纯函数 + 一个临时 SQLite」，Node 自带的足够；装 vitest 要多背 Vite 和一堆转译依赖。

```json
"test": "tsx --test --test-concurrency=1 tests/srs.test.ts tests/session.test.ts"
```

> **显式列文件，不用 `tests/**/*.test.ts` 通配**：npm 在 Windows 上走 `cmd.exe` 跑 script，通配展开行为跟 bash 不一致；将来加文件时顺手补一个名字，比赌通配符的跨平台行为稳。

### 8.3 测试库怎么和 `dev.db` 隔离

`session.ts` 的队列逻辑必须查真库才有意义（`where: { progress: { none: { userId } } }` 这种关系过滤，mock 掉 prisma 就等于没测），所以要建一个**独立的测试库** `prisma/test.db`。

指过去靠 **env 覆盖，不改 `.env`**：

```ts
// tests/env.ts —— 必须被测试文件「第一个」import
process.env.DATABASE_URL = "file:./test.db";
```

两个已核实的关键点：

1. **`import` 的求值顺序按声明顺序**，所以 `import "./env"` 写在 `import "../src/lib/session"` 前面，env 就一定先设好。被测模块内部是静态 `import { prisma } from "./db"`，`db.ts` 在模块求值时就 `new PrismaClient()` 读 env——那时已经被覆盖了。
2. **Prisma 不会用 `.env` 盖掉已经设好的值**。`@prisma/client` 运行时确实会调 `tryLoadEnvs` 读 `.env`，但走的是 dotenv 语义——**已存在的 `process.env` 优先，dotenv 默认不覆盖**。

建库用 `npx prisma migrate deploy`（不是 `db push`）：仓库已有 `prisma/migrations/`，deploy 幂等、结果确定、不做 drift 检查。`prisma/test.db` 落在 `.gitignore` 的 `prisma/*.db*` 覆盖范围内，不用改 `.gitignore`。

> **为什么不用 `new PrismaClient({ datasources: ... })`**：那得让 `db.ts` 导出可注入的构造函数，或者在产品代码里加「测试专用参数」。env 覆盖零侵入，产品代码一行不用动。

### 8.4 断言「形状」，不断言精确日期

这是最容易写错的地方。`FSRS_PARAMS.enable_fuzz: true`，而 ts-fsrs 的 fuzz seed 是 `` `${time}_${reps}_${difficulty*stability}` ``——**跟着时钟变**，所以断言「下次一定是 3 天后」的测试会随机红。断言分两档：

- **分钟级的学习步长可以断言到毫秒**：`ivl < 2.5` 时 ts-fsrs 直接 `Math.round(ivl)`、不过 fuzz，所以新卡答「忘了」的 `dueAt - now` 恰好是 1 分钟、答「一般」恰好 10 分钟
- **天级的复习间隔只断言关系**：四档 `dueAt` 严格递增、评完「简单」后 `scheduledDays` 变大、`state` 从 `learning` 推进到 `review`。**不写「下次一定是 N 天后」**

时间一律注入——`previewIntervals(row, now)` / `emptyCard(now)` 本来就接受 `now`，测试传固定时刻，不依赖 `Date.now()`。

### 8.5 为什么测试文件必须串行

**所有测试文件共用同一个 `prisma/test.db`，所以必须串行跑**（script 里那个 `--test-concurrency=1`）。Node 的 test runner 默认并发跑测试文件，两个文件同时 `resetDb()` 会互相把对方刚塞的 fixture 删掉——症状是「**单独跑全过、一起跑随机红一条**」，很难查。这个坑实测踩到过。

### 8.6 变异检查（绿了不代表在测东西）

41 条全绿之后，手动改坏四处生产代码，确认每处都让测试**变红**，再改回：

| 改坏什么 | 哪条变红 |
|---|---|
| `session.ts` 的 `isMastered`：`21` → `20` | 「复习态且间隔 ≥ 21 天才算掌握」 |
| `session.ts` 的 `buildUnitSession`：删掉 `progress: { none: { userId } }` | 「学过的词不再出现」「整章学完给空队列」 |
| `srs.ts` 的 `FSRS_PARAMS.enable_short_term` 改 `false` | 6 条 |
| `session.ts` 的 `buildSession`：去掉 `dueAt: { lte: now }` | 「还没到期的词不进队列」 |

改回后复跑全绿，`git diff src/` 为空——**产品代码零残留改动**。

### 8.7 本轮验证结果（2026-10-16）

| 验的什么 | 怎么验 | 结果 |
|---|---|---|
| 测试全过 | `npm test` | **41/41 绿**（11 个 suite），耗时约 20 秒 |
| 没碰真实进度 | 测试前后对 `prisma/dev.db` 取指纹（大小 + mtime + md5） | **逐位一致**（1617920 / `2026-10-16 16:55:30.515869400` / `644229447fcbb0249a48de748c2b237a`） |
| 类型无错 | `npx tsc --noEmit` | 退出码 0（`tsconfig.json` 的 `include: ["**/*.ts", …]` 自然覆盖 `tests/`） |
| 不回归 | 五个页面 HTTP 码 | `/`、`/units`、`/study`、`/settings`、`/stats` **全部 200** |
| 产品代码零改动 | `git diff --stat src/` | 空 |

**明确没做**：不给 React 组件写测试（UI 还是手动实测那套，项目没有 jsdom 也不打算加）；不写 CI（还没有远程仓库）；不给 `lib/stats.ts` 写测试（代码还新、没改坏过，同类逻辑以后按这套补即可）；不追求覆盖率数字；不重构 `srs.ts` / `session.ts` 来「方便测试」。

### 8.8 拼写模式带来的测试扩展（2026-10-16）

**41 → 48 → 72**：8.7 那轮是 41 条，错词本加到 48（见 6.2），这一轮加到 **72**。新增的 24 条里，**17 条是纯函数**（`tests/spelling.test.ts`，不碰数据库、不开浏览器，这个文件跑完 0.45 秒），**7 条是队列**（`tests/session.test.ts` 的 `describe("buildSession —— 拼写")`，照错词本那节的形状：`before(ensureTestDb)` + `beforeEach(resetDb)`）。

`package.json` 的 test script 是**显式列出文件名**的（不是 glob），新增测试文件必须手动加进去——**串行不变**（理由见 8.5）。

#### 比对算法特意拆出来，就是为了能有这份测试

`diffSpelling` 单独放 `src/lib/spelling.ts`、零依赖、不 import 任何 React——**拼写模式别的地方都得靠肉眼看，只有这里能锁住**。UI 只消费它的返回值渲染高亮，不自己判对错。

覆盖：完全一致；大小写与首尾空格归一化；单字漏 / 单字多 / 单字替换；多处差异的汇总文案；两个字母写反；`ops` 形状（除 `extra` 外槽位数恒等于正确词长度）。

#### 变异检查（五组，全部确认变红后改回）

| 改坏什么 | 哪条变红 |
|---|---|
| `buildSpellSession` 的 `where` 加 `dueAt: { lte: new Date() }` | 「到期时间在未来的词照给——拼写不看到期」 |
| `buildSpellSession` 的 `orderBy` 改 `dueAt: "desc"` | 「按 dueAt 升序——刚学完的词因此排在队首」 |
| `buildSession` 里把 `spell` 那行挪到 `unitId` **后面** | 「给定 unitId 时只给这一章学过的词」 |
| `diffSpelling` 回溯里把 `sub` 改成 `keep` | 「替换一个字母要和『一漏一多』分开算」+ 连带 4 条 |
| 回溯里去掉 `extra` 那条的 `same` 条件 | 「两个字母写反了：是两处写错，不是『漏一个、多一个』」 |

改回后复跑 **72 条全绿**，`git diff` 确认生产代码零残留。

#### ⚠️ 一条测试抓出了真 bug

写测试时按 PRD 的例子预设 `diffSpelling("environment", "environmentt")` 该报「第 **12** 个位置多敲了 t」，跑出来却是「第 11 个」——**这次是测试对、算法错**。

根因在回溯的偏好：从右下角往回走时，它先拿末尾那个 `t` 和正确词末位的 `t` 走了一次「同字对角」，于是**多敲的那个 `t` 被挤到了前面**。报「第 11 个位置多敲了 t」会让用户困惑——第 11 位本来就是 `t`，他没在那儿出错。

修法是给「多敲」加一个前置分支：**只在它与同字对角平局时才优先**。

```ts
const same = i > 0 && j > 0 && expected[i - 1] === typed[j - 1];

// 1) 与同字对角平局 → 判 extra，把多敲的字母报到更靠后的位置
if (same && dp[i][j] === dp[i][j - 1] + 1) { … }
// 2) 否则对角优先（能算成一次替换，就不拆成「一漏一多」）
if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (same ? 0 : 1)) { … }
// 3) 剩下才是「漏」
if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { … } else { extra }
```

**`same` 这个条件不能省**：去掉它，`ab` vs `ba` 会被拆成「extra + missing」，报「漏 1 个、多 1 个」——而用户实际是把两个字母顺序记反了，该报「写错 2 个」。这条也补了测试锁住（就是上表最后一行那条）。

修完确认既有的 6 条 `message` 断言**一条没动**：`enviroment` 仍是第 7 位漏、`environmunt` 仍是第 9 位写错、`xcat` 仍是第 1 位多敲、`cxat` 仍是 extra 计数、`cat`/`dog` 仍是写错 3 个、`cutx` 仍是「多了 1 个、写错 1 个」。

---

## 9. 未决技术问题

| # | 问题 | 阻塞什么 | 何时解决 | 状态 |
|---|---|---|---|---|
| 1 | 书的单元结构 | 数据模型定稿、解析规则 | 阶段一步骤 0 | ✅ **已解决**：22 个主题 Chapter，无大板块 |
| 2 | 每页多少词、全书总词量 | 提取工作量评估 | 阶段一步骤 2 后 | ✅ **已解决**：334 页共 3594 条词，平均每页约 11 条 |
| 3 | ECDICT 真实字段名 | `check_with_ecdict.py` | 下载后立即 | ✅ **已解决**：StarDict 格式，字段见 7.4；只有一份音标，已合并 `phonetic` |
| 4 | ECDICT License | 能否分享 | 分享前 | ⬜ 未开始（自己用不受影响） |
| 5 | OCR 识别出的英文长句有多少要人工校对 | 例句质量的验收标准 | 阶段一步骤 3 后 | ⚠️ **质量参差**：音标完全不可靠 → 一律用 ECDICT；例句/搭配/词源已进 MVP（背面全展开）。2026-10-15 量化：例句 486/3635（13.4%）有单词粘连，搭配 3.3%、词源 1.6%。**同日已用 `fix_spacing.py` 修复，见 7.8** |
| 6 | 词表里残余的坏词有多少 | 灌库前的数据可信度 | 阶段一收尾 | ✅ **已收敛**：99.6% 通过词典校验，剩 14 条待人工核对，灌库时按 `verified == false` 过滤 |
| 7 | SQLite 文件放哪、是否纳入版本管理 | 部署方式 | 阶段二 | ✅ **已解决**：`prisma/dev.db`，**已 gitignore**。数据库是可再生产物（重跑 seed 就有），不该进版本库 |
| 8 | 是否需要 `git init` | 版本管理 | 阶段二开始前 | ✅ **已解决**：已 `git init`，但按约定不自动 commit |

---

## 10. 怎么跑起来

**首次（或数据库重置后）**

```bash
npm install
npx prisma migrate dev     # 建表
npm run db:seed            # 灌数据：22 单元 / 3580 词 + 拓展阅读短文（3 篇）
npm run dev                # http://localhost:3000
```

**日常**：只要 `npm run dev`。数据库是本地文件 `prisma/dev.db`，关掉重开进度还在。

**写 / 改拓展阅读短文之后**（见第 15 节）

```bash
npm run check:passages     # 先校验覆盖率：{{标记}} vs 该章词表
npm run db:seed:passages   # 再灌库。只动 Passage 表，不碰词表和进度
```

`npm run check:passages` 不通过就别灌——缺词和越界词都会列出来。

**跑测试**

```bash
npm test
```

**72 条，约 35 秒**，`tsx --test --test-concurrency=1 tests/spelling.test.ts tests/srs.test.ts tests/session.test.ts`。打的是独立的 `prisma/test.db`，**不碰 `dev.db`**；测试进程不写 `.next/`，**和正在跑的 dev server 不冲突**（不需要停 dev）。原理见第 8 节。

**⚠️ 一个坑：`next build` 和 `next dev` 不能同时跑。**

两者共用 `.next/` 目录。跑完 `next build` 再回到 dev server，会出现满屏的：

```
Error: Cannot find module './897.js'
Require stack: ... .next/server/webpack-runtime.js
```

**这不是代码问题，是构建缓存串了。** 处理办法：**停掉 dev server 再重新起**（`Ctrl-C` 然后 `npm run dev`），不用删 `.next`。实测重启即可恢复。

真要跑生产构建检查，请**先停 dev server**，跑完 `npx next build` 后重新 `npm run dev` 时也会自动重建。

**改 FSRS 参数前先看 5.4**——那几个值直接影响「每天要复习多少词」，改完要连背几天才看得出影响，别凭手感当场调。

---

## 11. 视觉设计系统（2026-10-16）

> **本节按时间顺序记录。11.1–11.7 是「典藏书卷」第一版和导航壳层的记录，其中色板表（11.1）、圆角那一段（11.1）、对比度表（11.4）、侧栏宽度（11.7）都已被 11.8 覆盖。** 论证过程保留下来，因为那些结论（卡内嵌块不能借用页面底色、大圆角是 App 感最重的来源、`lg:min-w-0` 是必需而非保险）依然成立，变的只是具体数值。

改版方向定名**「典藏书卷」**：暖纸底、墨色正文、衬线标题、克制的墨绿强调色。目标是让界面看起来像一本装帧讲究的书，而不是通用 SaaS 面板。全站只做浅色、不做深色模式——**11.8 把侧栏翻成了近黑，但那是固定版式，不是主题切换**。

### 11.1 令牌层（`globals.css`）

改版前 `@theme` 里只有 10 个颜色变量，**没有字体、圆角、间距令牌**——这是所有视觉不一致的根源（同为「卡片」，首页主卡写 `rounded-2xl`、统计格写 `rounded-xl`）。现在补齐了了字体和圆角两类令牌。

**色板**（真值只在 `globals.css` 一处，组件一律走 `border-[var(--color-line)]` 这种任意值写法，换皮不改类名）：

| 令牌 | 值 | 角色 |
|---|---|---|
| `--color-canvas` | `#efe9dc` | 页面底：宣纸暖米白 |
| `--color-surface` | `#fbf8f1` | 卡片纸面，比页面底亮一档 |
| `--color-surface-2` | `#f4eee1` | 卡内嵌块（例句 / 搭配 / 词源），介于两者之间 |
| `--color-line` | `#dfd5c2` | 细线 |
| `--color-ink` | `#1b1815` | 正文墨色 |
| `--color-muted` | `#6e6353` | 次要文字 |
| `--color-brand` | `#1f4a3d` | 深墨绿：主按钮、进度条、当前导航、focus |

`--color-surface-2` 是新增的。此前卡内嵌块用的是 `--color-canvas`，等于和页面底色同一个值——卡片内部的块和卡片外的底一样深，看上去像卡片「漏」了。

**四档评分色**换成低饱和版（红/橙/蓝/绿的位置不变，对应忘了/困难/一般/简单）：

| 令牌 | 新值 | 旧值 |
|---|---|---|
| `--color-rate-again` | `#a33a2a` | `#ef4444` |
| `--color-rate-hard` | `#a8761c` | `#f59e0b` |
| `--color-rate-good` | `#2f5c86` | `#2563eb` |
| `--color-rate-easy` | `#2e6b4c` | `#10b981` |

旧的是 Tailwind 默认色，高饱和，放在暖纸底上会「跳」出来像贴上去的。

> **评分色没有重复定义。** 一度以为 `src/lib/rating.ts` 里硬编码了一份色值，读下来它写的是 `color: "var(--color-rate-again)"`——引用变量，真值只在 `globals.css`。所以换色只改了 1 个文件。

**圆角从 6 级收敛到 3 级**：`--radius-card: 6px`（卡片容器）、`--radius-control: 4px`（按钮、输入框、卡内嵌块）、`--radius-chip: 2px`（徽标、进度条）。`rounded-full` 只保留给 `SpeakButton` 的圆形图标按钮。

**大圆角是「App 感」最重的来源，小圆角是「书卷感」最重的来源**——纸书上的框是方的。

**全套去掉 `shadow-sm`**（原只在 `WordCard` 正反两面）。层次改由「底色差 + 一条细线」承担：纸书没有投影。

### 11.2 字体

`next/font/google` 引入 **Noto Serif SC 400 / 600**，暴露成 `--font-serif-sc`，再由 `@theme` 的 `--font-serif` 引用（加系统衬线兜底）。

**为什么不另配一个拉丁衬线**：Noto Serif CJK 的拉丁部分本身就是 Source Serif 的字形，**一个家族同时覆盖英文 headword 和中文标题**，少一次下载、少一处不一致。

**为什么是 `next/font/google` 而不是 `@fontsource`**（两条路都实测过）：

- `fonts.googleapis.com` 和 `fonts.gstatic.com` **现在都通**（实测 CSS 接口 200，0.93s）。`plan.md` 3.4 里记的「网络被拦截」那条**已经过期**。
- `@fontsource/noto-serif-sc` 解包后 **87 MB**，会塞进 `node_modules`；`next/font/google` 只把字体缓存进 `.next/static/media`（实测 **101 个 woff2，共 6.0 MB**）。
- 运行时两边都是自托管、零网络，对「纯本地运行」没有影响。

几个实测结论：

- 这个家族在 Google 侧是**变量字体**：CSS 返回 202 个 `@font-face`，但只有 **101 个唯一文件**，两个字重共用同一份切片。所以「引两个字重」的下载量并不翻倍。
- `subsets` 参数对这个家族**无效**：传 `latin` / `chinese-simplified` / 不传，返回的切片数都是 202。所以 `subsets: ["latin"]` 是个不影响的声明，中文覆盖不受损。
- **必须 `preload: false`**：101 个分片全量 preload 等于让浏览器在首帧前并发拉 101 个文件。交给浏览器按 `unicode-range` 按需取片即可。
- **实际首屏下载量**（浏览器只取命中的分片）：词库页是全站汉字最多的一页，实测取 **7 个分片共 437.6 KB**，全部来自 localhost 且带哈希可永久缓存。首页/学习页更少。这是一次性成本。

**衬线只用于标题性位置**，正文一律保持系统无衬线：

| 用衬线 `--font-serif` | 保持无衬线 |
|---|---|
| 页面 `h1`、卡片 headword、章节号、统计大数字 | 释义、例句、中文翻译、表单、按钮 |

理由有两条，第二条更硬：① 宋体在 18px 屏幕上笔画偏细，**长时间阅读不如黑体**，而正文正是每天盯最久的地方；② **换字体就是换行高**——背面正文的 `leading-[1.6]/[1.55]` 和全 `em` 间距是在系统无衬线下校准的，中文正文换宋体必须重新校准全部行高，而「不动机制」是这次改版的硬约束。

### 11.3 键盘焦点

改版前**除学习卡正面外，所有交互元素都没有 focus 样式**——而 `PRD.md` 第 3 节承诺了「支持键盘 Tab 导航」，这是个真实的无障碍缺口。现在在 `globals.css` 有一条全局规则：

```css
:where(a, button, [role="button"], input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
```

用 `:where()` 把选择器优先级压到 0，个别地方要覆盖不会被卡住；用 `outline` 而不是 `ring`，免得和已有的 `ring-*` 工具类打架。它是**无层级（unlayered）**的，因此优先于 Tailwind 的 `@layer utilities`——`outline-none` 压不过它。

### 11.4 对比度实测

在真实页面上用 WCAG 相对亮度公式逐个算的（不是估算）：

| 组合 | 对卡片底 `#fbf8f1` | 对页面底 `#efe9dc` |
|---|---|---|
| 墨色 `#1b1815` | **16.66 : 1** | 14.61 : 1 |
| 墨绿 `#1f4a3d` | **9.40 : 1** | 8.25 : 1 |
| 次要文字 `#6e6353` | **5.54 : 1** | 4.86 : 1 |
| 评分 · 一般 `#2f5c86` | 6.61 : 1 | 5.79 : 1 |
| 评分 · 忘了 `#a33a2a` | 6.19 : 1 | 5.43 : 1 |
| 评分 · 简单 `#2e6b4c` | 5.96 : 1 | 5.22 : 1 |
| 评分 · 困难 `#a8761c` | **3.75 : 1** | 3.29 : 1 |

正文全部过 4.5:1；四档评分色作为 3px 图形元素全部过 WCAG 1.4.11 要求的 3:1。最紧的是「困难」的赭橙 3.75——再浅一点就踩线了，调色时注意别往浅里走。

卡片面与页面底的亮度比只有 **1.15 : 1**，单看偏弱，但配上 `--color-line` 的发丝边框后边界清楚（改版前 canvas `#f6f7f9` vs surface `#ffffff` 只有约 1.05:1，反而更糊）。

### 11.5 改版对 `WordCard` 的影响（只动视觉）

`5.5` 里那套锁高机制、`BASE_FONT`、`em` 体系**一行没动**。改版在 `WordCard.tsx` 上只做了这些：

- 正反两面 `rounded-2xl → 6px`、删掉两处 `shadow-sm`、headword 加 `font-serif`
- headword 字号提了一档（`text-4xl sm:text-5xl → text-5xl sm:text-6xl`）——**衬线的 x-height 比无衬线小，同字号看着会小一圈**，不提一档会显小
- 卡内嵌块 `bg-canvas → bg-surface-2`、`rounded-lg → 4px`；`Section` 竖条 `2px → 1px`、标题加 `tracking-[0.2em]`
- 三处 `color-mix(..., white)` 的混色基色由纯白改成 `var(--color-surface)`——**纯白混进暖纸底会发灰显脏**

**新增两条，都是为了修换字体牵出来的问题：**

1. **`document.fonts` 的 `loadingdone` 事件会重测一次锁高。** 衬线字体是异步加载的：字体到位前后文字的折行和行高都会变，而外框高度早已冻结成 fallback 字体量出来的值——差一点就是背面被裁一截、或者底部空一截。这是纯加法，锁高算法本身没动。
2. **两面加 `min-w-0`，headword 加 `max-w-full break-words`。** 这是个**改版前就存在、被字号提档放大**的 bug：`internationalization` 这类长词折不动，会把整张卡撑宽出视口，再被 `.flip-scene` 的 `overflow: hidden` 切掉一截。桌面宽度下不触发（用户实际窗口够宽，所以一直没暴露），375px 下必现。加完之后卡片宽度恒定，长词折行留在卡内。

**改版后重测的锁高**（视口 1280×800 与 375×812 各跑一遍，结论一致）：

| 状态 | 外框高 | 正面高 | 背面高 | 背面被裁 | 页内滚动 | 横向溢出 |
|---|---|---|---|---|---|---|
| 未翻面 | 320 | 320 | 497 | — | 无 | 无 |
| 已翻面 | 497 | 320 | 497 | **否** | 无 | 无 |
| 翻回正面 | 320 | 320 | 497 | — | 无 | 无 |

**正面仍恒为 320px**——衬线 headword 提了一档字号也没有把它撑过 `min-h-[20rem]`。变高时 `transitionDelay` 为 `0ms`、变矮时为 `calc(var(--flip-duration) / 2)`，与 5.5 记录的行为一致。

> **再次撞上那个已知限制**：`height` 的收放动画过程仍然观察不到——预览面板隐藏时 CSS transition 被冻结（`style.height` 已是目标值，`computed` 停在起点）。**验的是静止后的布局和机制，不是动画过程。**

### 11.6 明确没做

- 深色模式
- 改任何业务逻辑、数据模型、接口（`lib/srs.ts` / `lib/session.ts` / `lib/tts.ts` / `api/*` 未动）
- 动 `globals.css` 的 `.flip-*` 区块

### 11.7 导航壳层：顶部栏 → 左侧栏（2026-10-16）

顶部那条横栏改成左侧侧边栏。`layout.tsx` 里的 `<header>` 整个搬进新的 `AppShell.tsx`。

**为什么要多一个 `AppShell` 组件**：`layout.tsx` 是 server component，读不到 `pathname`，而「学习页收起左侧栏」必须知道当前路由。`Nav.tsx` 虽然也是 client 组件，但它只负责链接列表，管不了外层的排布。所以把整个壳层（顶部栏 + 左侧栏 + 内容区）抽出来做成 client 组件，`layout.tsx` 只把 `children` 传进去。

> ⚠️ **这条动因已被撤销**（2026-10-16）：学习页不再收起侧栏，`AppShell` 也就不需要 `pathname` 了，已退回 server component。见 11.13。

> server component 把 `children` 作为 prop 传给 client component 是 App Router 的标准用法，页面本身仍是服务端渲染——`/units` 的 Prisma 查询、`force-dynamic` 都不受影响（已实测：22 行章节正常出）。

**断点行为**（`lg` = 1024px）：

| | <1024px | ≥1024px |
|---|---|---|
| 顶部横栏 | 显示 | `display:none` |
| 左侧竖栏 | `display:none` | 显示，220px，`sticky` + `h-dvh` |

两套导航同时挂在 DOM 里，靠断点切换——**任一时刻只有一套在无障碍树里**（另一套是 `display:none`，读屏会剔除）。实测 `querySelectorAll("nav")` 长度为 2，其中 `offsetParent !== null` 的只有 1 个。如果换成 `visibility` 或 `opacity` 藏，就会变成两个重复的导航地标，读屏用户要听两遍。

**为什么窄屏不跟着收成侧边栏**：375px 视口下卡片实测就占 343.3px，再挖掉一个固定侧栏，长单词（`internationalization`）和翻转锁高都会被挤坏。窄屏继续走原来的顶部栏，手机上的学习体验完全不变。

**布局用 flex 而不是 `fixed` + `pl-[220px]`**：

```
<div className="lg:flex">
  <aside className="hidden … lg:sticky lg:top-0 lg:h-dvh lg:w-[220px] lg:shrink-0 lg:flex-col">
  <div className="lg:min-w-0 lg:flex-1">
    <main className="mx-auto max-w-3xl px-4 py-6">
```

`fixed` 方案要把 220px 写死在两处（侧栏宽度 + 内容左边距），改宽度就得同步改两个数，迟早对不上。flex 只在一处声明宽度。

**`lg:min-w-0` 是必需的，不是保险**：flex 子项的 `min-width` 默认是 `auto`，不加的话内部长单词会把这列顶宽、溢出到侧栏底下——和 11.5 里修的那个卡片撑宽 bug 是同一个成因。实测加与不加的差别就是卡片宽度对不对得上。

**学习页的沉浸**（`IMMERSIVE = ["/study"]`）：这一页**只收起桌面那侧的栏**，窄屏顶部栏照旧保留——否则手机上就没有任何出口了（这页底下只有一个「退出」按钮）。沉浸时左侧栏是**整块不挂载**（不是 CSS 隐藏），避免留下点不动的死链。

> ⚠️ **2026-10-16 撤掉**：用户要求「左边侧栏固定，右边是和之前一模一样的学习页面」。学习页现在和其余页面一样常驻侧栏。见 11.13。

**验证结果**：

| 项 | 1280×800 | 375×812 |
|---|---|---|
| 侧边栏 | 显示，220px，`sticky`，高 = 视口 | `display:none` |
| 顶部栏 | `display:none` | 显示，57px |
| 卡片宽度 | **736px**（与改版前一致） | **343.3px**（与改版前一致） |
| 横向溢出 | 0 | 0 |
| 无障碍树里的 `<nav>` 数 | 1 | 1 |

`/study` 在 1280×800：侧边栏不存在，正面卡仍 **320px**，翻面后外框跟到背面 421px、无裁切，翻回时 `transitionDelay` 仍是 `calc(var(--flip-duration) / 2)`——**锁高机制一行未动，复测通过**。

> **一个 HMR 的坑**：新增 `AppShell.tsx` 的那一刻，dev server 日志里出现 `Invariant: Expected clientReferenceManifest to be defined. This is a bug in Next.js.`。这是 Next.js dev 模式下 client manifest 陈旧的老毛病，不是代码问题——判据是服务端渲染是否还成功：`curl` 拿到的 HTML 里含 `aside`，说明渲染正常，错误是瞬时的。**刷新页面即可，不用删 `.next`。**

### 11.8 深色书脊 + 暖白内页（2026-10-16 · 第二轮视觉改版）

**起因**：用户给了一张 1440×908 的桌面应用截图，要求「修改成类似于这种 UI 设计风格」。

> **前提必须说清楚：这一轮的设计判断有一半不是「看」出来的。** 当时的会话模型读不了图片（三张参考图全部返回 `[Unsupported Image]`），下面的参考图规格是把 JPEG **逐像素拆出来**的——颜色分布（Pillow `quantize` + MEDIANCUT）、逐行亮度网格、边界突变扫描、笔画宽度统计。所以「结构、配色、对比度对不对」我能证明，「好不好看」只能由用户亲眼看。

**参考图实测规格**：

| 项 | 值 |
|---|---|
| 左侧栏底色 | `#202626` —— 近黑，带极淡绿调（色相 165°、饱和度 2.5%） |
| 左侧栏宽度 | 266–271px @1440 宽 = 18.5%，**硬切到底**，无圆角无阴影 |
| 内容区底色 | `#f8f5ee` / `#f7f4eb` 暖 off-white（近白 `#fefdf9` 只是其中一块面板） |
| 面与面之差 | 只有 2% 左右 —— **卡片不靠填色区分，靠色调微差 + 细线** |
| logo | 圆角方块 49×50px、圆角约 12px（约占边长 24%）+ 右侧文字 |
| 菜单项 | 小图标（约 15px）+ 文字 |
| 强调色 | 几乎没有，近乎无彩 |

对照当时的状态（浅纸色侧栏 + 暖米白底），方向是**把「纸／墨」两端调个个儿**：侧栏 = 书脊／封皮，内容区 = 内页。

#### 色板（覆盖 11.1 那张表）

**内容区（整体提亮一档，墨色 / 墨绿 / 朱砂三色不变）**：

| 令牌 | 旧 | 新 | 备注 |
|---|---|---|---|
| `--color-canvas` | `#efe9dc` | `#faf8f3` | 页面底：暖白内页 |
| `--color-surface` | `#fbf8f1` | `#fffefb` | 卡片面，对 canvas 只差 **1.05:1** |
| `--color-surface-2` | `#f4eee1` | `#f1ede4` | **序反了**，见下文取舍 |
| `--color-line` | `#dfd5c2` | `#ded8ca` | 对 canvas **1.34:1**，卡片轮廓主要靠它 |

**深色书脊（侧栏与窄屏顶栏共用，四个都是新令牌）**：

| 令牌 | 值 | 对 `#202626` 的对比度 |
|---|---|---|
| `--color-rail` | `#202626` | — |
| `--color-rail-ink` | `#f5f2ec` | **13.75:1** ✓ |
| `--color-rail-muted` | `#a09a92` | **5.51:1** ✓ |
| `--color-rail-line` | `#343a39` | 1.32:1（勾线够用；上一版浅色侧栏的发丝线是 1.11:1，**反而更清楚了**） |
| `--color-rail-hover` | `#2a3331` | 1.18:1 |

**语义补充**：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--color-on-brand` | `#faf8f3` | 深底按钮 / 朱砂印章上的文字。对品牌绿 9.40:1、对朱砂 4.31:1 |
| `--color-focus` | `#1f4a3d` | 键盘焦点外框，深色面改写为 `rail-ink`，见下文 |

**朱砂与墨绿的分工原样不变**（朱做标记、墨做结构），两条硬边界也没变：朱砂对暖白底只有 **4.31:1**，够图形元素（3:1）和大号字，**不够 14px 正文的 4.5:1**。

**新增一条硬边界**：**墨绿对 `#202626` 只有 1.54:1，等于瞎掉。** 好消息是侧栏里本来就没用到墨绿（绿只出现在内容区），所以不需要额外造一个亮绿令牌——**约束是「不往深色面引绿色」**。

#### 核心做法：令牌局部重定义

侧栏整个子树翻深，最省事也最不易漏的做法**不是在 `Nav.tsx` 里写 `if (深色)`**，而是在容器上就地改写语义令牌：

```
<aside className="… bg-[var(--color-rail)]
                  text-[var(--color-rail-ink)]
                  [--color-ink:var(--color-rail-ink)]
                  [--color-muted:var(--color-rail-muted)]
                  [--color-line:var(--color-rail-line)]
                  [--color-surface-2:var(--color-rail-hover)]
                  [--color-focus:var(--color-rail-ink)]">
```

于是丢进深色面的任何组件——现在的 `Nav`、以后放进去的任何东西——**自动获得深色适配，组件代码一个颜色分支都不用写**。这一套抽成了 `AppShell.tsx` 里的 `DARK_SURFACE` 常量，左侧栏和窄屏顶栏共用（「品牌面深、内容面浅」在两种尺寸下都成立）。

> ⚠️ **陷阱（实施时靠自查 + Plan agent 独立复核抓到的）**：CSS 变量在**声明它的那个元素上**就解析成计算值了。`body { color: var(--color-ink) }` 是在 body 上算完的，子元素继承的是**算好的近黑色**，不是变量本身。所以只重定义 `--color-ink` **管不到**那些没有显式颜色类的元素——品牌文字「雅思词汇真经」正是这种情况，它会继承 body 的近黑，落在 `#202626` 上只有 **0.85:1**，等于看不见。
> **必须同时在容器上写 `text-[var(--color-rail-ink)]`**，把继承链的起点定下来。实测证实：不写的话品牌文字计算值是 `rgb(27, 24, 21)`，写了是 `rgb(245, 242, 236)`。

#### 焦点环：验证阶段抓出来的一个真实缺口

`globals.css` 的全局 `:focus-visible` 用的是 `outline: 2px solid var(--color-brand)`。侧栏翻深之后，**墨绿对 `#202626` 只有 1.54:1——桌面侧栏的三个导航链接在键盘 Tab 下没有任何可见的焦点反馈**。这正是「墨绿在近黑上等于瞎掉」那条约束的另一个落点：它不只影响文字，也影响焦点环。

修法沿用同一套机制：把颜色换成新令牌 `--color-focus`（默认 `#1f4a3d`），深色面把它改写成 `rail-ink`（13.75:1）。实测令牌解析：侧栏内 `rgb(245, 242, 236)`、内容区 `rgb(31, 74, 61)`。

> 这条**不在原计划里**，是逐项验证时量出来的。记在这里是因为它说明了一件事：令牌重定义这套机制不会自动覆盖到「在别处声明、但在本子树内生效」的规则——`:focus-visible` 是在 `globals.css` 里写的，用的却是容器作用域里的变量。

#### 图标：只上侧栏，顶栏不加

`Nav.tsx` 的 `NAV` 数组每项带一个 16px 内联 SVG（`fill="none"` + `stroke="currentColor"` + `stroke-width 1.6`，`aria-hidden`，**不装任何图标库**）：今日→日历、词库→摊开的书、设置→两根滑杆。

**但顶栏那套不渲染图标**，这是算出来的，不是漏的：

| | 宽度 |
|---|---|
| 375px 顶栏可用宽度 | 343.3px |
| 品牌「印章 40 + 间隙 8 + 六个字约 104」 | 152px |
| 三个带图标项（图标 16 + 间隙 6 + 两字 28 + 左右内边距 24）× 3 | 230px |
| 合计 | **382px —— 装不下** |

实测两字时期顶栏用了 315.7px、还剩 **27.6px** 余量，正好和「加图标要多 66px」对得上。

> ⚠️ **上面这张表是 11.10 时期的记录，导航项改成四字之后（见 11.12）这套账彻底变了**：不是「不加图标」就够，连品牌文字块也得收起来。留着是因为它记录了当时判据的来路，**不要拿它当现在的依据**。现依据见 11.7 那段宽度预算与 11.14（第五项只上 rail）。

#### 圆角（覆盖 11.1 那一段）

`--radius-card: 6px → 10px`、`--radius-control: 4px → 8px`、`--radius-chip: 2px → 4px`，另加 `--radius-mark: 10px`（品牌印章方块专用，方便和卡片圆角解耦）。

参考图的 logo 方块圆角约占边长 24%，放大圆角是往它靠的直接手段。**代价是「书卷感」会淡一些**（纸书上的框是方的），这一轮改由「深色书脊 + 暖白内页」那组面与面的对比来承担。

#### 其他细节

- **`html { color-scheme: light }`**：不加的话，系统偏好深色时原生 `<select>` 下拉、checkbox、滚动条会按深色渲染，落在新的暖白页上很突兀。实测 `getComputedStyle(document.documentElement).colorScheme === "light"`，设置页的 `select` / `input` / `checkbox` 全部跟着走。
- **去掉侧栏右缘的「书口双线」**（上一版的 `border-r` + `after:` 伪元素）：深色面与暖白面之间本来就是一道硬边界，参考图也是干净的直切，再叠两条线只会显脏。
- **侧栏宽度 220px → 240px**（覆盖 11.7 里的值）。参考图的比例是 18.5%@1440，240px 在 1280 下是 18.75%。
- **印章「词」字用 `--color-on-brand`，不走继承**：印章底永远是朱砂，前景就该跟着印章走；靠继承的话，以后把 `BrandMark` 放进浅色容器就会得到近黑字压在朱砂上。
- **四处「拿 `--color-canvas` 当文字色」改成 `--color-on-brand`**（首页主按钮、学习完成页按钮、设置页保存按钮、印章）。画布翻白后数值上仍成立，但语义是错的——换掉以免以后画布再变时静默崩掉。

#### 取舍与已知风险

1. **卡片填色基本消失。** `surface` 对 `canvas` 从 1.14:1 掉到 **1.05:1**。参考图实测也是 1.02:1——它同样不靠填色。**层级改由细线承担**，所以 `--color-line` 同步从 1.23:1 调到 **1.34:1**。这是全轮最需要用户亲眼确认的一点。
2. **`--color-surface-2` 的序反了。** 新值 `#f1ede4` 比新 canvas **更暗**，而 `globals.css` 原来的注释写它「介于两者之间」——注释已一并改掉。副作用是词库页的 `hover:bg-surface-2` 从「变亮」变成了「变暗」，且只有 **1.10:1**，**悬停反馈比上一版弱**（原计划估的是 1.06:1，实测略好）。功能没坏，但是否还感知得到要肉眼确认。
3. **朱砂当前页标记对深书脊 3.36:1**（上一版浅色侧栏上是 3.78:1）。仍过图形元素 3:1 的门槛，但余量变小了。
4. **印章「词」字对朱砂 4.31:1**，低于正文所需的 4.5:1。它是 `aria-hidden` 的装饰性字标，WCAG 对 logotype 无对比度要求，可接受——如实记一笔。
5. **窄屏顶栏高度 57px → 64.67px**：印章从 32px 放大到 40px 带出来的。不是 bug，但确实比上一版高 7.67px。

#### 验证结果

| 项 | 1280×800 | 375×812 |
|---|---|---|
| 侧栏 | 显示，**240px**，`sticky`，高 = 视口，底色 `rgb(32,38,38)` | `display:none` |
| 顶栏 | `display:none` | 显示，深色，高 64.67px |
| 品牌文字 | `rgb(245,242,236)`，对侧栏 **13.75:1**（**不是**近黑） | 同左 |
| 导航当前项 | ~~文字 13.75:1 + 左边 2px 朱砂竖条 + 底边发丝线~~ **已由 11.9 取代**：整块朱砂覆盖，文字 4.65:1 | 文字 13.75:1 + 2px 朱砂下划线 |
| 导航非当前项 | `rail-muted` **5.51:1** | 同左 |
| 导航图标 | 三项各一个 ✓ | 无（见上文宽度预算） |
| 内容区 | h1 对卡片面 17.53:1、次要文字对卡片面 5.83:1、章节号墨绿对 canvas 9.40:1 | 同左 |
| 卡片 | 736px、圆角 10px、边框 1px `#ded8ca`（1.34:1） | 343.3px |
| 横向溢出 | 0 | 0（词库 / 设置 / 学习三页同样为 0） |
| 无障碍树里的 `<nav>` 数 | 1（DOM 里 2 个，`display:none` 那个被剔除） | 1 |
| 键盘焦点令牌 | 内容区 `rgb(31,74,61)` | 侧栏内 `rgb(245,242,236)` |

`/study` 锁高复测：1280×800 正面卡仍 **320px**，翻面后外框跟到背面 **421px**、`clipped: false`；375×812 背面 **522px**，同样无裁切。**`WordCard` 的翻转与锁高逻辑这一轮一行未动**（已核：圆角、令牌、字号都不改变 `offsetHeight`）。

`npx tsc --noEmit` 通过。**没有跑 `next build`**——它和 dev server 共用 `.next/`，同时在跑会崩。

#### 明确没做

不做深色模式（深色只在侧栏，是固定版式）；不引入图片、纹理、图标库；**不装任何新依赖**；不换字体、不改任何字号；不动四档评分色（那是量过对比度的语义色）；不动 `WordCard` 的 3D 翻转与锁高；不动业务逻辑、数据模型、`lib/*`、`api/*`。

**「观感层面」的这一轮没人能替我确认**：深色侧栏配暖白底实际看起来如何、圆角放大后还剩多少「书卷感」、1.05:1 的卡片轮廓是否够清楚——这三条要用户亲眼看。

### 11.9 侧栏选中态：竖条 → 整块朱砂覆盖（2026-10-16 · 第三轮）

用户要求：侧栏当前页要**一片橙**盖住整项，鼠标划过其他项也要有，并去掉原来最左边那道朱砂竖条。

改动只有两处：`Nav.tsx` 的 `rail` 分支、`globals.css` 两个新令牌。**顶栏（窄屏）不动**，仍是 2px 朱砂下划线——那一栏只有一行高，再压一块底色会把品牌字挤没。

**为什么不能直接拿 `--color-seal` 当底色。** 朱砂对纸面 4.31:1，本来就只够画线。翻过来做侧栏的**底**、上面压 rail-ink 的 14px 导航文字时更紧：纯朱砂对 `#f5f2ec` 只有 **4.09:1**，差 0.41 过不了 4.5:1。这是本轮唯一真正需要推导的地方，新增两个 rail 专用令牌：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--color-rail-seal` | `color-mix(in srgb, var(--color-seal) 90%, var(--color-rail))` → `#b84a1f` | 选中项整块覆盖 |
| `--color-rail-seal-soft` | `color-mix(in srgb, var(--color-seal) 55%, transparent)` → 叠在 `#202626` 上得 `#7d3c22` | 划过项覆盖 |

压暗 10% 就把选中态拉到 **4.65:1**（过 4.5），观感几乎没变。划过那档半透明、透出深底，和选中项拉开明暗层次——两者都是「一片橙」，没有明暗差就分不出哪个是当前页。

**这是「朱砂不承载小号正文」那条约束的第一个例外**（`globals.css` 里已一并标注）。约束本身没错，错的是把「朱砂」当成一个色值——压暗一档之后它就够用了，不必另找一个颜色。

**去掉 `border-l-2` 的连带好处**：导航项左边缘现在和品牌印章左缘对齐（都在 16px）。项之间的目录发丝线（`border-b`）原样保留，橙色块上下仍有线，目录感没断。

#### 验证结果

| 项 | 值 |
|---|---|
| 选中块底色 | `color(srgb 0.721961 0.290196 0.120784)` = `#b84a1f` |
| 选中块尺寸 | 宽 208px（`240 - px-4×2`，铺满导航区） |
| 选中块圆角 | **8px**（`--radius-control`；当天先做的是直角，用户看过之后要求改圆） |
| 选中块文字 | `rgb(245,242,236)`，对块底 **4.65:1** ✅ |
| 块底对侧栏底 | 2.96:1（图形边界参考线是 3:1，差 0.04；色相差极大，实际辨识无碍） |
| 左边框 | `0px`（竖条已去掉） |
| 划过块 | `color(srgb 0.788 0.306 0.118 / 0.55)`，合成 `#7d3c22`，文字 **7.40:1** ✅ |
| 顶栏当前项 | 不变，2px 朱砂下划线 |

两条工具类都确认已在产物 CSS 里（`.bg-\[var\(--color-rail-seal\)\]`、`.hover\:bg-\[var\(--color-rail-seal-soft\)\]:hover`）——按名字搜 `document.styleSheets` 时要注意 `@layer` 里的规则得递归才找得到。`npx tsc --noEmit` 通过。

### 11.10 品牌字标：印章改「词」+ 英文副题（2026-10-16）

用户要求：印章里的「真」改成「词」，书名下面加一行英文小字。改动只在 `AppShell.tsx` 的 `BrandMark`，侧栏和窄屏顶栏共用一个组件，两处同时生效。

**印章字选「词」。** 那一个字要同时是**书名里的一个字**和**这本书在讲什么**。「词」两件事都占；「真」只占了前者——得先知道书名才能把这个字接上。「真经」那层意思交给完整的书名去承担。

**英文那行是版式补充，不承载信息。** 书脊上总要有一行拉丁字母压住版面。取 `IELTS VOCABULARY`（中文书名的直译，不译「真经」——译出来就从一行小字变成一句要读的话），全大写 + `tracking-[0.14em]` + 10px，色走 `--color-muted`（深色面上已被重定向到 rail-muted，5.51:1）。

**它没有改动任何既有尺寸**——这是选它、而不是选一句更长的英文的直接原因：

| 量 | 结果 |
|---|---|
| 英文行宽度 | **109px**，和中文行「雅思词汇真经」实测的 109px 恰好相同 → 品牌块宽度不变 |
| 两行合计高度 | 约 32px，仍矮于 40px 的印章 → **顶栏高度不变**（仍是印章撑起的那 40px + 上下 `py-3`） |
| 375px 下横向布局 | 品牌 157px，导航右缘 359px < 375 → **溢出 0**（当时是两字导航；四字之后品牌文字块在顶栏被收起，见 11.12） |

顺带把 `Nav.tsx` 里那段宽度预算注释从估算值（品牌 152px / 合计 382px）改成了实测值（157px / 387px）——它正是「窄屏顶栏为什么不加图标」的依据，用实测的数字更靠得住。

---

### 11.12 导航项改四字，窄屏顶栏收起品牌文字块（2026-10-16）

用户要求侧栏「目录」下那三个项改名字、要「高级一些」。三个候选方案（桌面四字 + 窄屏二字 / 全站二字文言 / 全站二字但好懂）里选了**全站四字**：

| 原名 | 新名 |
|---|---|
| 今日 | **今日功课** |
| 词库 | **章节词汇** |
| 设置 | **研习设置** |

其中第二项中途定过「词林总目」、随即被用户改成「章节词汇」（同样四个字，宽度一个像素都没变）。留这一笔是因为它标出了取向的边界：**「词林总目」更像书、但「章节词汇」更说得清这一页是什么**，最后按后者定。

**取向是「不像 App 菜单」，但可读性优先于「高级」。** 三个词落在同一套句式里（时间 / 范围 / 方式）：「今日功课」比「今日」多一层「这是要做的活」，「章节词汇」直接说清这一页是 22 章的词，「研习设置」比「设置」书面。更生的文言（如「凡例」——古籍正文前讲体例规则的那部分，语义其实最贴「设置」）没用：导航项认不出来就是失败，这条优先级高于「高级」。

**代价落在窄屏顶栏上，而且是硬的。** 375px 实测：

| | 宽度 |
|---|---|
| 顶栏可用宽度（375 − 左右 `px-4`） | **343.3px** |
| 四个字的项（四字 56 + 左右内边距 24） | 80px × 3 = **240px** |
| 三项间隙（`gap-1`） | 8px |
| 完整品牌块 | **156.76px** |
| 合计 | **404.76px —— 溢出 61.5px** |

能腾的位置全试算过：内边距 `px-3 → px-2` 每项省 8px（共 24px）、字号 14 → 13px 每项省 4px（共 12px），加起来 36px，缺口是 61.5px，**补不上**。三个字也装不下（溢出 23.5px）。这不是审美取舍，是算术。

所以顶栏做了两件事：**去掉图标**（沿用 11.10 的结论）**+ 收起品牌文字块，只留那枚「词」印章**。做法是 `BrandMark` 加一个 `compact` prop，`AppShell` 里顶栏传 `compact`、侧栏不传——两处共用组件，不写第二份。印章本身就是品牌标识，收掉书名不损失可识别性，只是手机上不再逐字念出书名。

收起后实测（375px）：

| 量 | 结果 |
|---|---|
| 品牌（印章） | 40px |
| 导航三项 | 80px × 3 + 间隙 8 = **248px** |
| 合计占用 | **292px**，余 **51px** |
| 顶栏高度 | **65px**（未变——印章 40 + 上下 `py-3`） |
| 横向溢出 | **0** |

桌面侧栏（1024px）不受影响：栏宽 240px、内容宽 208px，每项「图标 16 + 间隙 10 + 四字 56 + 内边距 24」= 106px，余 100px 出头。当前项仍是整块朱砂 `#b84a1f` 压 rail-ink 文字（4.65:1，见 11.9），三项实测高 41px / 41px / 40px（末项无下边框）。

**页内大标题跟着一起改**（同日，用户当场要求）：导航名改完，页内 h1 就成了全站唯一还写着旧名的地方——`/units` 的「词库」、`/settings` 的「设置」，点进去看到的和刚点的那一项对不上。改动是 `units/page.tsx` 与 `settings/page.tsx` 各一行 h1 文本（「章节词汇」「研习设置」）。学习完成页那句「去**词库**挑一个章节加练」和按钮「浏览**词库**」也一并跟进（「章节词汇」/「浏览章节词汇」）——**界面里不该再留下「词库」这个没有对应入口的词**。

改的是纯文本，但 h1 是 `text-3xl`（30px），得确认不会在窄屏折行：

| 量 | 结果 |
|---|---|
| `/units` h1「章节词汇」375px | 单行，横向溢出 **0** |
| `/settings` h1「研习设置」375px | 单行（文本宽 117px） |
| 学习完成页按钮组（注入隐藏 span 量文字宽） | 74 + 116 + 间隙 12 = **202px < 343px** |

唯一不同名的是首页：它的 h1 是「今天要背的在这儿」——那是一句状态描述（有待办 / 已完成两态），不是栏目名，**故意不跟导航对齐**。

**一处未验证的观感**：手机上顶栏只剩一枚印章、没有书名，是否显得太空——这得看实际渲染。

`src/app/icon.svg`（favicon）里的字同步改成「词」、底色同步从墨绿改成朱砂 `#C94E1E`——它是同一枚印章，留着「真」会出现「标签页一枚印、页面上另一枚印」，留着墨绿则是同一枚印两种底色。

底色换朱砂有一处代价：内框那条 `opacity="0.75"` 的暖白描边，对底的对比度从墨绿上的 **6.72:1** 掉到朱砂上的 **3.08:1**（按 0.75 混合后的**计算值**，非取色实测）。仍过图形元素的 3:1，`16px` 下那条框还看得见，但余量只剩 0.08。要更清楚就把 `opacity` 提到 0.9（同样是计算值 **3.78:1**），代价是那圈内框会比现在抢眼——**当前保持 0.75 不动**。

#### 追加：第四项「研习统计」的宽度重算（2026-10-16 晚）

统计页做完时导航加了第四项，顶栏那笔账要重算。**上面「三项 + 印章 = 292px / 余 51px」那两个数作废。**

| | 加项前 | 加项后（未收紧） | 加项后（收紧后） |
|---|---|---|---|
| 顶栏可用宽度（375 − 左右 `px-4`） | 343.3px | 343.3px | 343.3px |
| 导航项 | 80 × 3 = 240px | 80 × 4 = 320px | **68 × 4 = 272px** |
| 项间间隙 | 8（`gap-1`） | 12（`gap-1`） | **6（`gap-0.5`）** |
| 导航小计 | 248px | 332px | **278px** |
| 印章 + 品牌↔导航间隙 | 40 + 4 = 44px | 44px | 44px |
| **合计** | 292px（余 51） | **376px —— 溢出 32.7px** | **322px（余 21）** |

收的两处，都在 `Nav.tsx` 的 **bar 那支**：

- `<nav>` 上的项间间隙 `gap-1 → gap-0.5`（4px → 2px）
- bar 分支 `cls` 里的 `px-3 → px-1.5`（每项左右各 12px → 6px，每项 80 → 68px）

> ⚠️ **仓里有两个 `gap-1`、两处 `px-3`，改错一个就全错。**
> - `Nav.tsx` rail 分支的 `px-3`（`gap-2.5` 那一支）**不要动**——侧栏每项 208px 宽，收它只会让图标和文字贴到边线上
> - `AppShell.tsx` 顶栏容器上的 `gap-1`（品牌↔导航那个）**不要动**，收到 2px 的只有 `<nav>` 的项间间隙
>
> 写计划时第一版就搞混过，以为「两处保持一致」是对的——实际那两个 `gap-1` 管的是完全不同的两段间隙。

**实测（2026-10-16）**：

| 视口 | 印章 | 导航 | 合计 | 结果 |
|---|---|---|---|---|
| 375px | 40px | 278px（每项实测 **68px**） | 322px | 余 **21px**，溢出 0 |
| 360px | 40px | 278px | 322px | 余 **6px**，溢出 0 |
| 320px | `display: none` | 278px | 278px | 余 **10px**，溢出 0 |

顶栏右侧的对齐靠品牌 span 上的 `mr-auto`（自动外边距吃掉剩余空间），所以 375px 下印章贴左、导航贴右，中间那 21px 空档由它吸收。

**320px 的兜底**：给品牌 span（`AppShell.tsx` 里那个带 `mr-auto` 的）加 `max-[359px]:hidden`。印章是 `aria-hidden` 的装饰物，藏掉省 44px，导航 278px ≤ 288px 可用宽度。**这个兜底比记一条「已知例外」干净**，也**不能引用别处那条「271px 极窄屏例外」当先例**——那条后来作废了，项目的验收下限是 **375px**。

> 两个**没做**的选择，都是权衡后的：
> 1. **不上 `overflow-x-auto`**：粘性顶栏横向滚动没有滚动条提示、`sticky` 下还会把当前项藏起来，而且顶栏溢出会让**整页**出现横向滚动。
> 2. **给藏掉印章后的导航加 `ml-auto`**（让它仍然贴右）：那会让自动外边距在 ≥360px 下也平分剩余空间，把现在贴右对齐的导航往回推，为了极端宽度改坏常用宽度的对齐不划算。320px 下导航贴左可以接受。

桌面侧栏不受影响：240px 栏宽、内容宽 208px，四项带图标竖排，**每项实测 208px 宽**——上面 11.12 正文里写的「每项 106px」是内容宽度，不是可点区域宽度。

**新增的那枚图标**是三根高低不同的竖柱 + 一条基线（`Nav.tsx` 的 `ICON.stats`）：折线在 16px 下会糊成一团，柱状读得出高低，和设置那两根滑杆也一眼分得开。**照旧只上 rail，顶栏不取用 `icon` 字段。**

---

### 11.11 首页统计格：「天」这个单位怎么排（2026-10-16）

首页那三格（连续打卡 / 已掌握 / 总词数）当天连改了三轮，值得把结论记下来，因为**第三轮推翻的是第二轮的一条判断**。

**第一轮**：三格统一到 30px / 600 字重 / 墨色。此前「连续打卡」是朱砂的，三个并排的格子里单独染色会让它们看着不像一组——要么都染要么都不染，改回墨色。

**第二轮**：顺着上一条把值里的「天」也去掉，只留纯数字。理由是用户反馈「2 和天不搭配」。

**第三轮（当前，用户明确要求改回）**：标签改成「连续打卡天数」，值恢复成「2 天」。

> **用户那句「不搭配」的根因不是单位不该有，是单位没被排成单位。** 上一版把「天」按正文字号排在数字旁边，两个宽度相近的方块字并排，读起来像「两个字的词」而不是「一个数加一个单位」。这次按单位排：

| | 数字 | 单位 |
|---|---|---|
| 字号 | 30px | **14px** |
| 字重 | 600 | **400** |
| 颜色 | `--color-ink` | **`--color-muted`** |

三档同时降，主从关系才立得住——只改字号、字重不变，仍会觉得是「两个字的词」。基线对齐（inline 默认，不需要写 `align-baseline`）。

**标签从 11px 降到 10px，是被宽度逼的。** 全站微标签惯用 11px，但 375px 视口下格子的内容宽只有 **72.3px**（`(375 − 32 页边距 − 24 栅格间隙) / 3 − 32 内边距`），而「连续打卡天数」6 个 11px 汉字加 `tracking-[0.12em]` 是 `6×11 + 6×1.32 = 73.9px`——**超了 1.6px，「数」会单独掉到第二行**。降到 10px 是 `6×10 + 6×1.2 = 67.2px`。实测确认过：11px 时 Range 返回两个 rect（61.61 + 12.33，分行），10px 时是一个 67.2px 的 rect。

另外加了 `whitespace-nowrap` 兜底：**360px 视口下只剩 0.13px 余量**，字体度量稍有出入就会换行。宁可让那点宽度溢出到卡片的 16px 内边距里（看不见），也不要出「数」单独站在第二行这种一眼就看得出的破版。

| 量 | 375px | 360px | 320px |
|---|---|---|---|
| 标签宽度 / 格子内容宽 | 67.2 / 72.3 | 67.2 / 67.3 | 67.2 / 54.0 |
| 标签行数 | 1 | 1 | 1（nowrap 溢出内边距 3.8px，仍在卡片内） |
| 横向溢出 | 0 | 0 | 0 |
| 三格高度 | 89px | 89px | 89px |

**对比度**（`getComputedStyle` 取实际渲染色值算的，非估算）：单位「天」`--color-muted` 对卡片面 **5.83:1**（14px 正文门槛 4.5:1），数字 **17.53:1**。

**没变的**：三格仍是同一套排版、同一个颜色、同一个 30px 字号；单位只是这一个格子的后缀，另外两格没有单位。观感上「2 天」成不成立，得看实际渲染。

---

### 11.13 学习页撤掉「沉浸」：侧栏每页都在（2026-10-16）

**起因**：用户要求「左边侧栏固定，右边是和之前一模一样的学习页面」——即 11.7 里那个「学习页收起桌面侧栏」的决定被撤销，理由从「一次只做一件事」改成「背词中途想换章节或去设置，只能手打地址栏」。右侧卡片本来就只用到 768px（`max-w-3xl`），让出 240px 不改变它的宽度。

**撤掉的是什么**：`AppShell.tsx` 里的 `IMMERSIVE = ["/study"]` 和包住 `<aside>` 的 `{!immersive && (…)}`。侧栏现在**无条件挂载**，显示与否只由断点决定（`hidden … lg:flex`），不再有路由这一层判断。

**一个连带的简化**：撤掉之后 `AppShell` 里就没有 `pathname` 的用处了，于是去掉 `"use client"` 和 `usePathname`，**从 client component 退回 server component**。`children` 本来就是 `layout.tsx`（server）传进来的，页面仍照旧服务端渲染；全站只剩 `Nav.tsx` 是 client——它得读 pathname 标当前页。

**撤销后暴露的问题：学习页在侧栏里谁都不亮。** `/study` 不属于「今日功课 / 章节词汇 / 研习设置」三项中任何一项，实测三个 `<a>` 的 `aria-current` **全是 `null`**。而 11.9（整块朱砂覆盖）和 11.12（文案改四字）做的正是「让当前页一眼看得出来」——不处理就等于在学习页退回改版前「三个链接永远长得一样」。

处理方式：**学习页的归属看「是打哪儿进来的」**——它有两个入口，`Nav.tsx` 里按来源把它折算成某一项：

| 入口 | URL | 归属 |
|---|---|---|
| 首页「开始」按钮 | `/study` | 今日功课（那条动线的进行状态，不是并列的板块） |
| 章节词汇点某一章 | `/study?unit=N` | 章节词汇 |

> 这等于把 PRD 2.0 那句「当前所在的那一项要标出来」的语义从「当前路由」放宽成「当前在做的事」。

**踩了一个坑，记下来。** 第一版只判了 `pathname`、把整个 `/study` 都算给「今日功课」，于是从章节词汇进去的学习页也亮着「今日功课」——**用户当天就报了这个 bug**（「从章节词汇进去，学习单词，却跳到了今日功课」）。

根因：**query 不在 `pathname` 里**，`/study` 和 `/study?unit=N` 用 `usePathname()` 分不出来。修法是引入 `useSearchParams()` 读 `unit` 参数。

> `useSearchParams()` 通常要配 Suspense 边界（静态渲染时 CSR bailout），这个项目不用：四个页面全是 `force-dynamic`，没有静态预渲染。已实测 `/_not-found`（自动生成的静态 404 页也带这层 layout）——正常渲染 404 文案、侧栏与导航都在，dev server 日志里没有任何 Suspense 相关警告。

**实测**（逐页取 `aria-current`）：

| URL | 侧栏高亮 |
|---|---|
| `/` | 今日功课 |
| `/study` | 今日功课 |
| `/study?unit=1` | **章节词汇** |
| `/units` | 章节词汇 |
| `/spelling`、`/spelling?unit=1` | 拼写练习（11.14 加进来之后） |
| `/settings` | 研习设置 |
| `/nonexistent-xyz` | 全暗（404 页，符合预期） |

**明确没动的**：`/study` 页面本身一个字没改。底部那一行（自动发音开关 + 「进度已实时保存」+「退出」按钮）实测改前改后逐项一致——375×812 下退出按钮仍 **66×36**、右缘 359、与开关之间余 75px。

**验证**（`tsc --noEmit` 通过）：

| 项 | 1280×800 | 375×812 |
|---|---|---|
| 左侧栏 | **240×800**，`sticky`，`top: 0` | `display:none` |
| 顶部栏 | `display:none` | 显示，65px，`sticky` |
| 卡片正面 | 736×320 | 343×320 |
| `.flip-scene` | **320px**（`style.height` 与 computed 一致） | **320px** |
| 横向溢出 | 0 | 0 |
| 侧栏当前项 | 「今日功课」朱砂块 + `aria-current="page"` | — |

**另一处刻意的「不改」**：桌面端侧栏常驻之后，卡片右下角那个「退出」（目标同样是 `/`）和侧栏的「今日功课」在功能上重叠。**保留**——它一半的价值在「进度已实时保存」那句话上，那是导航链接不承载的语义（消除「我这一走会不会丢进度」的顾虑）；而且刚背完一轮时视线在卡片上，右下角比左上角近。窄屏更不必说，底部按钮离拇指最近。

---

### 11.14 导航第五、六项「拼写练习」「拓展阅读」：只上桌面侧栏（2026-10-16）

拼写从学习页拆成独立页 `/spelling` 时，侧栏要加第五项；同日拓展阅读做完，又加了第六项。**两项加不下的都是窄屏顶栏，不是侧栏**——桌面侧栏 240px 宽、内容宽 208px，六项带图标竖排绰绰有余（每项实测 208px）。所以做法是给 `NAV` 加一个标记，**只在 rail 那一侧出现**。

```ts
const NAV: { href: string; label: string; icon: React.ReactNode; railOnly?: boolean }[] = [
  { href: "/",         label: "今日功课", icon: ICON.today },
  { href: "/units",    label: "章节词汇", icon: ICON.units },
  { href: "/spelling", label: "拼写练习", icon: ICON.spelling, railOnly: true },
  { href: "/reading",  label: "拓展阅读", icon: ICON.reading,  railOnly: true },
  { href: "/stats",    label: "研习统计", icon: ICON.stats },
  { href: "/settings", label: "研习设置", icon: ICON.settings },
];

// 窄屏顶栏直接不渲染——宽度预算付不起第五、六项
if (!rail && item.railOnly) return null;
```

> **两项排在「章节词汇」之后、统计之前**：它们同属「在词汇上做的练习」那一类，统计与设置仍在最后。

`NAV.map` 的回调体为此从表达式体改成块体（要插那行 `if`）。新增两支图标，与既有四支同一套规格（16px、`fill="none"`、`stroke="currentColor"`、`strokeWidth 1.6`、`aria-hidden`）：**铅笔**（写字）给拼写，**右上角折起的纸页 + 一行字**给拓展阅读——后者和「章节词汇」那本摊开的书分得开（那个是两页对开，这个是单页）。

**为什么不硬塞进顶栏**：11.7 那笔账算完只剩 21px（375px 下），每多一项要多 **70px**（项 68 + 间隙 2），**第五项就溢出 49px**；320px 那道「藏印章省 44px」的兜底也补不平。要硬塞必须同时降字号、收内边距，还得把手机上唯一的品牌标识拿掉——为入口把整条栏改坏不划算。**这与 6.2 里错词本没做成导航项是同一条账**，那一条讲的就是窄屏顶栏，到现在一个像素没变，理由仍然成立。

> **第六项加进来之后，375px 那笔账一个数都没动**——因为 `railOnly` 让顶栏那侧压根不渲染它。实测 `nav` 仍是 278px、`scrollWidth` 仍是 375（见下表）。

**`current` 判定不用动**：`/spelling` 和 `/reading` 都不以 `/study` 开头，走的是 `pathname` 那条路，`active` 天然命中各自那项；`/reading?unit=N` 也一样——它就是这个板块本身，不像 `/study?unit=N` 那样要按来源折算归属。

**这两项的窄屏入口都在章节页**（`units/page.tsx` 每行那两颗按钮，见 15.5）：那一页本来就是「挑一章」的地方，从这里进正好落在你正看着的这一章，比导航栏那个不带参数的入口还准。拼写另在首页多一条；拓展阅读是独立的读物，不进首页那条动线。

#### 验证（1280×800 / 375×812）

| 项 | 1280×800 | 375×812 |
|---|---|---|
| 导航项数 | **6**（rail），每项 208px，顺序：今日功课/章节词汇/拼写练习/拓展阅读/研习统计/研习设置 | **4**（bar），无「拼写练习」「拓展阅读」 |
| 顶栏/侧栏宽度 | 侧栏 240px、`display:flex` | 导航实测 **278px** + 印章 40 = 318px（加间隙 4 = 322px，与预算一致） |
| 横向溢出 | 0 | **0**（`scrollWidth` 375 = `innerWidth`） |
| `aria-current` | `/reading` 下「拓展阅读」= `page` | — |

第六项加进来时复测过：`nav` 仍是 278px、`scrollWidth` 仍是 375——顶栏那侧一项没多渲染。

`AppShell.tsx` 未改动（侧栏宽度与断点都没动）。

> **连带的一个数变了**：`force-dynamic` 的页面从五个变成**七个**（`/spelling`、`/reading`）。`Nav.tsx` 里用 `useSearchParams()` 只要「没有静态预渲染」这个前提成立就安全，加页不改变这一点——但代码注释里写死的那个数字要跟着改（已改）。

---

## 12. 雅思向的统计与小组件（2026-10-16）

**起因**：用户要求「加入一些有关雅思的 UI 小元素、小组件，丰富页面内容」。当时的状态是——首页只有一张任务卡 + 3 个统计数字，词卡背面只有词条内容，**整站看不到任何和「雅思」这个词有关的东西**，虽然数据里其实存着。

**动手前先盘了库，确认哪些是真有的数据（不是编的）**：

| 数据 | 覆盖 | 用途 |
|---|---|---|
| `Word.tags` 含 `ielts` | 3580 词里 **2152** 个 | 12.4 的词卡小印 |
| `Word.bncRank` | 3385 词有值（195 个没有），范围 37–45890，中位 4252 | 12.3 的词频刻度 |
| `ReviewLog.reviewedAt` | 每次评分都写 | 12.2 的热力图 |
| `WordExample`（`cn` 非空） | 3642 条，英文长度中位 49 字符 | 12.4 的每日一句 |
| 22 个 Chapter 名 | 全有 | 各处出处标注 |

**零新依赖**：四个图形的全部实现是 CSS 与内联 SVG，没有引入任何图表库（阶段三那张「Recharts」的表仍然只是计划）。

### 12.1 答题卡进度格（`AnswerSheet.tsx`）

首页「今日新词」那条从细进度条换成方阵。三态：已完成填朱砂实心 / 当前那格（第 `newDone+1` 个）朱砂描边 / 未做空心。圆角 `2px`（20px 方块上用 `--radius-chip` 的 4px 显得圆）。

**只上首页，学习页保持原进度条。** 提问时写的是「学习页顶部同步复用」，实施时发现不成立：

- 首页的 `total` 是 `newLimit`（设置里的固定配额，5–200）——**只增不减**，格子一个个被涂满，正是答题卡的隐喻
- 学习页的 `total` 是**本轮队列长度**，会随每次评分递减。格子会一个个「消失」，看着像往回缩，不是涂卡

「待复习」那条同理不换：`dueCount` 是动态的，没有固定配额。

**超过 24 格自动回落成进度条**：`newLimit` 可设到 200，200 个 20px 方格在 736px 里排不下。规则写死在组件内部（`if (total < 1 || total > MAX_CELLS) return <ProgressBar .../>`），调用方不用管。默认 20，绝大多数情况走方格。实测 375px 下 20 格自动折成 2 行（每行 11 格）。

无障碍沿用 `ProgressBar` 那套：外层 `role="progressbar"` + `aria-valuenow/min/max`，格子全部 `aria-hidden`。实测 1280×800 下 `aria-valuenow=14 aria-valuemax=20`，填色 14 格、描边 1 格、空心 5 格，与库内 `newDone=14 / newLimit=20` 对得上。

**分子要封顶——`newDone` 可能大于 `newLimit`**（2026-10-16 补，用户报的现象）。章节专项自己不受每日配额约束（6.1），但它学的新词照样写进度行、照样被 `getTodayStats` 那条 `createdAt >= today` 数进 `newDone`。于是「配额 20、今天实际学了 31」时，`{newDone} / {newLimit}` 就渲染成反直觉的 `31 / 20`。修法是展示层夹一次：组件内部 `const shown = Math.min(done, total)`，`aria-label`、`aria-valuenow`、格子判定都走它（原先只夹了 `aria-valuenow`，可见文字与 `aria-label` 漏了）；首页那行可见文字在 `page.tsx` 里再夹一次。**数据层的 `newDone` 口径不动**——今天实际学了几个就是几个，封顶只发生在展示层。

### 12.2 学习热力图（`Heatmap.tsx`）

首页一段通栏区块（上下通栏细线），**不套卡片框**——首页已经堆了 3 张卡，再套框会一片方块。**排在页面最底**（2026-10-16 与每日一句对调过：先读一句、再回望记录）。近 **16 周**（112 天），每列一周、列内自上而下周一到周日。格子 11px + gap 3px ≈ 每列 14px × 16 = 224px，375px 视口放得下。

**起点对齐到本周周一往前推 `weeks-1` 周**（`getHeatmap` 里 `const weekday = (start.getDay() + 6) % 7`）。未来的格子照渲染、背景透明——位置必须占住，否则最后几列的星期对不齐。

**时区：`reviewedAt` 存 UTC，必须按本地日分组。** 复用 `session.ts` 的 `localDayKey()`（本次把它加上了 `export`），**不能用 `toISOString().slice(0, 10)`**——那样晚上 8 点后学的会被算到第二天。

**分档**（`HEAT_LEVELS = [1, 5, 15, 30]`，`heatLevel()` 返回 0–4）：

| 档 | 复习次数 |
|---|---|
| 0 | 0 |
| 1 | 1–4 |
| 2 | 5–14 |
| 3 | 15–29 |
| 4 | ≥30 |

**配色走墨绿不用朱砂**：朱砂的分工是「标记此刻」（新词、当前页），打卡是「已经在册的」，归墨绿那侧。五档用 `color-mix(in srgb, var(--color-brand) X%, var(--color-canvas))` 按比例兑浅，**不新增令牌**，X 取 **10 / 38 / 62 / 84 / 100**。

> **这组比例不是随手取的，是实测一轮后返工的结果。** 方案里原写 25/45/70/100，实测「没学」和「学了一天」只差 **1.27:1**——而这一对恰恰是整张图最要紧的区分。当前值是按各档实测亮度**等比铺开**倒推出来的，相邻两档落在 **1.69 / 1.71 / 1.77 / 1.56 : 1**，五档看着才是一把均匀的尺子。
>
> **浅色系五档做不到 WCAG 的 3:1。** 要让相邻档差 3:1，中间几档得暗到互相糊在一起。这里选的是**档距均匀**，精确数值另有底下那句文字摘要兜底（见下），格子组对读屏也是隐藏的。各档对 canvas 的对比度实测为 1.18 / 1.99 / 3.41 / 6.04 / 9.40——**上面三档自身过了 3:1**，只有最低两档是「越暗越有」的渐进色。

**零 JS**：纯服务端渲染 + 原生 `title` tooltip（`title={cell.future ? undefined : \`${cell.date} · 复习 ${cell.count} 次\`}`）。为了一格 hover 提示去挂十几行客户端代码不划算，这一块本来就是「扫一眼看趋势」。

无障碍：格子组 `aria-hidden`，另给一句文字摘要——「近 16 周学过 N 天，累计复习 M 次；最多的一天 K 次」。左侧星期标签只标周一/三/五/日，七行全标会挤成一团。

### 12.3 词频刻度（`FrequencyRuler.tsx`）

放在 `WordCard` 背面**头部区块内新起一行**（和 `pos` / `Chapter` / `新词` 同级）。用途是**决定值不值得花力气**——雅思阅读里高频词值得背到滚瓜烂熟，一个排位三万开外的生僻词，认得就行。它是词卡上唯一一个「和学习者决策相关」的元信息，所以放在**评分之前就看得见的位置**，不是正文末尾。

**用 BNC 不用 FRQ**：两个字段库里都有（都来自 ECDICT），BNC 是英式国家语料库，雅思偏英式，用它更贴。

**对数映射**（排位是对数尺度的：第 500 位和第 1500 位的实际差距，远大于第 20000 位和第 21000 位。线性映射会把绝大多数词挤在刻度最左端）：

```ts
const LOG_MIN = Math.log10(100);
const LOG_MAX = Math.log10(50000);
const SEGMENTS = 10;

score = 1 - clamp((log10(rank) - LOG_MIN) / (LOG_MAX - LOG_MIN), 0, 1)
filled = max(1, round(score * SEGMENTS))
```

**`max(1, ...)` 不能省**：全灭的刻度会被读成「这个词没有词频数据」，而不是「这词很生僻」——那是两个完全不同的意思。

档位文字：**≤3000 高频 / 3001–10000 中频 / >10000 低频**。

**`bncRank === null` 时整行不渲染**（195 个词没有），不留占位符——沿用 PRD 2.2「字段留空不显示占位符」。

> **锁高不受影响**：这是静态文本 + 定尺寸方块，`offsetHeight` 在挂载时就定死。`WordCard` 现有的 `resize` + `document.fonts` 监听已覆盖字体落地后的折行变化。**`WordCard` 的锁高逻辑一个字没动**（实测复核见 12.6）。

### 12.4 雅思小印与每日一句

**雅思小印**（`WordCard` 背面头部，和「新词」徽标同一行）：**描边式**，与「新词」的**填充式**刻意区分开——两者性质不同。新词是「此刻刚学的」（朱砂那侧的分工），雅思标签是词条自带的固有属性，归墨绿那侧的结构色。仅 `isIelts` 为真时渲染。

**每日一句**（首页，排在热力图前面，`lib/stats.ts` 的 `getDailySentence`）：左侧一道墨绿竖线（和词卡 `Section` 同一语言），中英对照 + 出处（`Chapter N 章名 · headword`）。

**选取是确定性的**：按日期做 hash，同一天多次打开是同一句，**不存任何状态、不写库**。

```ts
function hashDay(d: Date): number   // 用 Math.imul 做雪崩 hash
const skip = hashDay(now) % Math.max(1, total - 20);
// orderBy: { id: "asc" }, skip, take: 20
// 再从这 20 条里 find(c => c.en.length >= 20 && c.en.length <= 90) ?? candidates[0]
```

> **hash 必须用 `Math.imul` 做雪崩**：普通乘 32 位会溢出丢精度，相邻日期算出来的值几乎连续，取模后句子的分布会贴着词库顺序走（连号日期 = 连号句子），看起来就像「每天按顺序往下念」。

**为什么拉 20 条候选再挑长度**：3642 条例句里约 **13%** 有 OCR 残留粘连（见 7.8），短句和超长句里占比更高。用「候选 20 条内挑长度 20–90 字符」把这个概率压下来，**但不能完全消除**。全部不合格则退回第一条。

**这是本次唯一扩张字体规则的地方**：引文用 `font-serif`。理由——它是装饰性引文、不承载久读负担，且中文衬线在短段落上正是书卷气的来源。PRD 的「衬线只用于标题性位置」那条已同步加一句「以及每日一句的引文」。

### 12.5 验证结果

`npx tsc --noEmit` 退出码 0。**没跑 `next build`**——它和 dev server 共用 `.next/`。

**数据核对**（写一次性脚本直接查 SQLite，和首页渲染出来的数字逐个比，不接受「看起来对」）：

| 项 | 库内 | 页面 |
|---|---|---|
| 今日新词 | done 14 / limit 20 | 14/20，填 14 格 + 描边 1 格 + 空心 5 格 |
| 近 16 周 | 2 天 / 24 次 / 单日最大 20 | 「学过 2 天，累计复习 24 次；最多的一天 20 次」 |
| 每日一句 | `liberal` / Ch21 / 英文 56 字符 | 三行齐全，含 `Chapter 21 身心健康 · liberal` |
| 词卡词频刻度 | `calamity` → BNC 12502 | 「低频 · 英式语料库第 12502 位」 |
| 有/无词频的词 | 3385 / 195 | —（反例未跑，见下） |

热力图起点自查：今天 `2026-10-16`（周五）→ 本周周一 `2026-10-12` → 往前 15 周 `2026-06-29`（周一，✅）；末列末格 `2026-10-18`，其中 `10-17`、`10-18` 两格 `future=true`。

**锁高回归（最高优先级）**：`/study` 正面卡仍 **320px**；翻面后外框跟到背面 **525px**（`calamity`，比 11.8 那次高，因为头部多了一行词频刻度），**背面内部裁切量 0**，评分按钮完整落在外框内（`footVisible: true`）。

**收矮方向也验了**（读 Web Animations API 手动推进关键帧）：0 → 209ms 外框保持 525px、背面完整；**211ms 起才开始收矮**，而 210ms 正是翻转半程、卡片侧对屏幕的时刻——收的时候背面已不在画面里。最终稳定在 320px、正面完整可见。

**两档视口横向溢出均为 0**（1280×800 与 375×812），且没有任何元素的右边界超过视口。375 下方格阵自动折成 2 行 11 格。

**对比度实测**（`getComputedStyle` 取真实渲染色）：方格朱砂对卡片面 **4.53:1**；热力图五档对 canvas **1.18 / 1.99 / 3.41 / 6.04 / 9.40**，相邻档 **1.69 / 1.71 / 1.77 / 1.56**。

**Tab 落点**：新元素贡献 **0 个**（进度格是 `role="progressbar"` 不带 `tabindex`，热力图与刻度是纯展示），首页可聚焦元素数不变。

**测不了的两处，如实记录**：

1. **`bncRank` 为空的词不显示刻度、非雅思词不显示小印**——这两个反例没在浏览器里跑过。队列里凑不出这样的词，要摸到得知评分，那会写库、污染刚核对过的数字。这两处是 `!== null` / `isIelts` 单行判断，代码和库两端都确认过（195 个词无词频、1428 个词无雅思标签）。
2. **锁高动画的「运行过程」仍然观察不到**——浏览器预览面板隐藏时 CSS transition 被冻结（`style.height` 已是目标值，`computed` 停在起点）。这次靠手动推进 Web Animations 的关键帧绕过去了（见上），但那是**逐帧采样，不等于用户眼里看到的动画**。

### 12.6 明确没做

- **不动业务逻辑与数据模型**：`prisma/schema.prisma` 一个字段没加（`tags` / `bncRank` 本来就存在），`lib/srs.ts`、`lib/tts.ts`、`lib/rating.ts`、`api/*` 未动
- **不新增任何颜色令牌**：热力图和词频刻度全走现有的 `--color-brand` / `--color-line` / `--color-canvas` / `--color-surface`
- **零新依赖**，没有引入图表库
- **不改 `WordCard` 的锁高机制**（两处 `useLayoutEffect`、`scene.style.height`、`transitionDelay`、`.flip-scene` 引用全部原样）
- **`frqRank` 没有加进 `QueueItem`**：方案里列了它，但词频刻度只用 BNC，加了就是死代码

**只有用户肉眼能判断的两条**：抽到的例句好不好读、热力图密起来好不好看。

---

## 13. 统计页（`/stats`，2026-10-16）

阶段三第一块大内容。PRD 2.5 那四块终于落地，顺带把几个只有文档、没有代码的口径钉死。

### 13.1 「回顾」这条线为什么单独成页

`stats.ts` 开头就写着和 `session.ts` 的分工——**session 管「队列 + 今日该做什么」，stats 管「回头看一眼自己走过多远」**。热力图和每日一句（第 12 节）已经落在后者，但都寄生在首页上。统计页是这条线第一次独立成页，也是全站唯一一个**不产生待办、不写库、零交互**的页面。

直接查 Prisma，**不建 API 路由**：其余四页都没有，这一页更没有——纯服务端渲染，连一个点击都不接收。

### 13.2 三个实测出来的坑

方案是按 PRD 写的，但写之前先量了库，量出来三个坑，每一个都改掉了方案的一部分。

**① `lapses` 全是 0，「老忘的词」按原口径是空表。**
27 行 `UserWordProgress` 里 `lapses` **全为 0**。不是 bug——它要卡片**进入复习态之后**再答「忘了」才累加（映射 ts-fsrs 的 `card.lapses`），而现在的答错都发生在初次学习步长里，不算 lapse。**已与用户确认：改按 `ReviewLog` 里 `rating === 1` 的次数排**，现有 11 条，是真实存在的信号。以后卡片进入长间隔，`lapses` 会自然长起来，届时再考虑合并两个信号。

**② `ReviewLog` 没存当时的 state 快照。**
只有 `rating / reviewedAt / elapsedMs` 三列，所以「某天新学了几个、复习了几个」读不出来，得借 `UserWordProgress.createdAt` 反推：

- 某天**新学** = 进度行的创建日落在这一天
- 某天**复习** = 当天流水里，该词的进度行是**更早**创建的

这条判据和 `getTodayStats` 里那条复习计数**同源**（新词当天在会话内被反复提问也写流水，那不算复习），两处必须一样，否则首页和统计页会各说各话。

**③ 同一套判据在仓里有两份。**
`isMastered`（`state === "review" && scheduledDays >= 21`）在 `session.ts` 里是私有函数，注释写着「全站只有这一处判据」，但 `units/page.tsx` 有一份手抄的内联副本。统计页要算同一个数，不能变成第三份。→ 改成 `export`，`units/page.tsx` 与 `stats.ts` 都调它，注释里那句已失真的话一并修掉。

### 13.3 口径落定

| 口径 | 定义 | 依据 |
|---|---|---|
| 正确率 | 该日 `rating >= 3`（一般 / 简单）的占比 | 沿用 `StudySession.tsx` 里判断「记住了」的那个条件，不另造 |
| 已掌握 | `isMastered()` | Anki 对「成熟卡片」的定义 |
| 新学 / 复习 | 见 13.2 ② | 与 `getTodayStats` 同源 |
| 连续打卡 | 直接复用 `getTodayStats().streak` | 已实现且与首页一致，不重复实现 |
| 时间窗 | 图表一律近 **30** 天 | 16 周 = 112 列，375px 下每列不足 3px；30 列约 11px/列，与热力图方格同档 |

日期一律走 `localDayKey()`，**不能用 `toISOString().slice(0,10)`**——`reviewedAt` 存的是 UTC，用后者的话晚上 8 点之后学的词会被算到第二天。

### 13.4 数据层：`stats.ts` 追加三个纯读函数

`getDailyStats(userId, days = 30)` / `getStateBreakdown(userId)` / `getForgetfulWords(userId, limit = 20)`，各自带一个同名类型。**不动现有导出。**

- **`getDailyStats`**：先把该用户的 `{ wordId, createdAt }` 全取成 `Map`（现在 27 行，上限 3580，可忽略），再取窗口内的 `ReviewLog` 逐条归类。**先把 30 个空格子铺满**，没学的日子也占位——否则图上日期轴对不上。全程 JS 聚合，和 `getHeatmap` 同一路数。
- **`getStateBreakdown`**：五段必须互斥。判断顺序有讲究——**先问 `isMastered`（它本身是 `review` 的子集），再问剩下的 `review`**；反过来会把已掌握的那几个从「复习中」里丢出去。别把 `state === "review"` 整个当成已掌握：实测 22 行 review 里只有 **1** 行 `scheduledDays >= 21`，混起来会把「掌握」虚报 20 倍。
- **`getForgetfulWords`**：流水随时间线性增长（一年后约 8 万行），**不能拉全表**。一次 `groupBy({ by: ["wordId", "rating"] })` 就能同时拿到「忘了多少次」和「一共答过多少次」，不用查两遍；排序在 JS 里做。

> **两条 Prisma 类型级事实**（都实测过，省得下次再踩）：
> - `groupBy` 的 `orderBy: { _count: { wordId: "desc" } }` 合法——`ExcludeUnderscoreKeys`（`.prisma/client/index.d.ts:671`）把 `_count` 显式排除出「必须出现在 `by` 里」那条规则之外。本方案没依赖它（排序改在 JS 里做），但可用。
> - `groupBy` 只要给了 `take` 就**必须**给 `orderBy`，否则是类型错误（`index.d.ts:8060-8069`）。本方案不在 SQL 侧 `take`，绕开这条。
>
> 排序并列时以 `wordId` 升序兜底，保证同一天多次渲染顺序稳定。

### 13.5 三种图，零 JS、零依赖、零新令牌

全部沿用 `Heatmap.tsx` 的路子——**纯服务端渲染 + 内联样式**，不引图表库，图形全是 div 拼的。组件在 `src/components/`：`DailyBars.tsx` / `AccuracyBars.tsx` / `StateBar.tsx`，另把首页文件内私有的 `<Stat>` 抽成 `Stat.tsx`（首页和统计页的概览格共用；`settings/page.tsx` 的 `<StatRow>` 是另一种形状——标签左 / 值右的账册行，只有一处用，**不抽**）。

| 组件 | 画法 |
|---|---|
| `DailyBars` | 一天一列，柱内下段复习（墨绿）上段新学（朱砂），两段按次数分配 `flexGrow`；柱高按**窗口内最大值**归一 |
| `AccuracyBars` | 30 根小竖柱，柱高即当天正确率，**绝对刻度**（100% = 满格，顶边一条虚线标出） |
| `StateBar` | 两条 `width: %` 的横向堆叠条 |

**`DailyBars` 为什么归一化、`AccuracyBars` 为什么不**：每日学习量会随每天配额和复习堆积而变，用绝对刻度的话一个休假的周末会把其余日子全压成一根线；正确率本身就是 0~100 的百分比，读「这根柱到顶没到顶」比读相对高低直观得多。

**`StateBar` 为什么是两条**：全书 3580 个词里只学了 27 个（0.8%）。五段挤在一条上，学过的四段加起来不到 **3px**（实测「已学」那段宽 **2.6px**），全糊成一根线。拆成「全书尺度」和「已学内部构成」两条之后，上面那条传达「路还有多长」——那根 2.6px 的细线本身就是这个意思——下面那条（分母是 27 不是 3580）才读得出数。

配色分工沿用 `globals.css` 的约束：**朱砂只做填充与标记，墨绿只做结构**。堆叠条里「已掌握 / 复习中 / 重学中」是墨绿按掌握程度分的三档深浅，「学习中」用朱砂（它是**此刻正在进行的**），「未学」走 `--color-line`（纸面底色，不参与染色）。**没有新增任何颜色令牌。**

### 13.6 正确率这里不画折线（对 PRD 2.5 的有意偏离）

PRD 2.5 原写「正确率曲线 · 折线图」。复核下来折线在这个场景有两个真问题：

1. **「缺日」表达不了。** 一条 `<polyline>` 是一条连续路径，30 天窗口里只有 2 天有日志，其余 28 天会被折线直接连起来——**视觉上等于宣称那几天的正确率是插值出来的，那是撒谎**。现在数据只有 2 天，折线还会退化成孤立的一段。
2. 若坚持折线，得按「连续有数据的区段」切成多条 `polyline`。

→ 改用小竖柱：与 `Heatmap` / `FrequencyRuler` 拼格子的手法同一路，**零 SVG**，「这天没数据」天然表现为没有柱子，不需要任何特判。**PRD 2.5 的表述已同步改。**

> 顺带记一条 SVG 的坑：`preserveAspectRatio="none"` 拉伸下，`<polyline>` 的 stroke 本身有救（`vector-effect="non-scaling-stroke"` 能保住），**但叠在上面的 `<circle>` 数据点会被拉成扁椭圆**（`sx ≈ 10`）。真要画折线就得放弃数据点标记。

### 13.7 空数据守卫（库里只有 2 天，这些分支一定会走到）

- 归一化分母一律 `Math.max(…, 1)`（照抄 `ProgressBar.tsx` 的除零写法）
- 某天 `answers === 0` 时**正确率不画柱**，而不是画成 0% 的矮柱——**画成 0% 是撒谎**。反过来，有作答但全错的那天是真的 0%，给 **3% 的最小高度**让它可见，否则它会和「没学」长得一模一样
- 整块有作答的天数**不足 2 天**时只出一句文字摘要、不画图（一根柱子孤零零立着读不出任何东西）；`Heatmap.tsx` 的 `data.maxCount > 0 &&` 是同一种兜底
- 全书 0 词时 `StateBar` 出一句「这本书还没有词」

### 13.8 验证

**数字对账是这页唯一的正确性判据**——图是画出来的，不核对数字就等于没验。先直接查库拿真值，再抓 `/stats` 的 SSR HTML 逐项比对：

| 项 | 页面 | 库 |
|---|---|---|
| 近 30 天作答 | 42 | 42 |
| 近 30 天正确率 | 69% | 29 / 42 = 69.05% |
| 已掌握 | 1 | 1 |
| 新学 / 复习 | 27 / 6 | 27 / 6 |
| 最多的一天 | 30 | 24 + 6 |
| 全书 / 已学 | 3580 / 27（0.8%） | 3580 / 27 |
| 状态分布 | 1 · 21 · 0 · 5 | 1 · 21 · 0 · 5 |
| 老忘的词前三 | `lithosphere 3/4`、`calamity 2/3`、`jeopardise 2/2` | 同 |

**真实渲染的几何与颜色**（`getComputedStyle` / `getBoundingClientRect` 取实际值，不是看截图）：

- 10-16 那根柱 `height: 100%`、96px，下段复习墨绿 `rgb(31,74,61)` 19.2px、上段新学朱砂 `rgb(201,78,30)` 76.8px —— 6:24 的比例对
- 正确率只渲染 **2 根**柱（其余 28 天无作答确实没有元素），高度 50% / 71%，色 `rgb(31,74,61)`
- 堆叠条「复习中」段的实际色是 `color(srgb 0.482275 0.576784 0.53898)`，**手算 `brand 58% + canvas 42%` 得 `0.4823 / 0.5768 / 0.5389`——逐位对上，无串色**

**导航宽度**（第四项连带改的，算术见 11.12 的追加段）：375px 每项实测 **68px**、导航 278px、合计 322px、余 21px、溢出 0；360px 余 6px；320px 印章 `display:none`、余 10px、溢出 0。`/stats` 页顶栏与侧栏的「研习统计」都拿到 `aria-current="page"`，其余三页各自仍正确。桌面端侧栏 240px / 内容 208px、四项竖排、每项 208px。

**零回归**：首页三格、章节页 `已学 27 · 掌握 1`、设置页四个数、学习页卡片全部与改前一致；`git diff` 确认 `WordCard` / `StudySession` / `RatingButtons` / `globals.css` / `srs.ts` 这轮**一行未动**（结构上也不可能有回归）。另：`npx tsc --noEmit` 通过。

**没验到的两条**：空库态与「有效天数不足 2 天」两个分支（库里就是 2 天数据，触发不了，只有代码里的守卫兜着）；三种图好不好看、像不像同一本书里的——**只有用户亲眼能判断**。

### 13.9 明确没做

- **不动首页热力图**（PRD 2.5 已写明统计页不做这一块）
- **不动 `session.ts` 的队列逻辑**（除了把 `isMastered` 改成导出）
- **不建 API 路由、不引任何依赖、不新增颜色 / 圆角令牌**
- ~~不做单词级队列、不做错词本~~ ✅ **2026-10-16 错词本已做**（见 6.2）。「老忘的词」那一栏仍然是**盘点用、每行不给单独跳转**，但底部多了一条「集中攻克这 N 个」→ `/study?weak=1`。**逐词跳转仍然不做**——要的是「一批集中攻克」，不是一个个点进去
- **不做导出 / 分享**

---

## 14. 拼写 / 听写模式（2026-10-16）

**这是 `plan.md` 阶段三清单里的最后一项**，也是本文件最早记过「要动 `StudySession`、是核心学习链路、所以等测试补齐之后再做」的那一项。它服务的是 `plan.md` 立的三个「真正用起来」条件之一——**有检验手段**。翻面自评不算检验：翻面本身就等于给提示。

做法上有一条贯穿始终的约束：**把改动挡在 `WordCard` 之外**。新建一个 `src/components/SpellSession.tsx`，只管出题 / 收答案 / 比对；评分由一个 `onRate` 出口交回 `StudySession`，后者的队列消费、评分提交、会话内重排、`busy` / `error` 全部**一行没动**。

### 14.1 比对算法（`src/lib/spelling.ts`）

整项功能里唯一有真正算法的地方，也是唯一能脱离浏览器验证的部分——所以单独成文件、单独测试（见 8.8）。

```ts
export function normalizeSpelling(s: string): string;

export type CharOp =
  | { type: "keep";    expected: string }
  | { type: "sub";     expected: string; typed: string }
  | { type: "missing"; expected: string }
  | { type: "extra";   typed: string };

export function diffSpelling(expected: string, typed: string): SpellDiff;
```

**Levenshtein 编辑距离 DP + 回溯，零依赖手写。** 词最长二十来个字符，O(n·m) 绰绰有余，不值得为此引一个包。

**为什么不用最长公共子序列（LCS）**：LCS 只说得清「哪些字符两边都有」，分不出「写错了一个」和「漏一个、多一个」。`environment` 打成 `environmunt`，LCS 会判成「多了 u、漏了 e」；可用户实际是**第 9 个字母写错了**——PRD 2.7 要的正是「标出哪个位置没记牢」。带替换的编辑距离才对得上这个诉求。

#### 回溯的三条偏好（顺序即优先级）

```ts
while (i > 0 || j > 0) {
  const same = i > 0 && j > 0 && expected[i - 1] === typed[j - 1];
  if (same && dp[i][j] === dp[i][j - 1] + 1) { …extra… }                                  // 1
  if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (same ? 0 : 1)) { …keep/sub… }     // 2
  if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { …missing… } else { …extra… }               // 3
}
```

1. **与「同字对角」平局时判 `extra`** —— 让多敲的字母报在更靠后的位置。`environmentt` 该说「第 **12** 个位置多敲了 t」，而不是「第 11 个」：第 11 位本来就是 `t`，用户没在那儿出错。
2. **否则对角优先** —— 能算成一次替换，就不要拆成「一漏一多」（`environmunt` 是第 9 位写错，不是多 u 漏 e）。
3. **剩下才是「漏」**。

第 1 条**必须带 `same` 这个条件**：和替换平局时（`ab` vs `ba`）替换更贴切，那是两个字母写反了，不该报成「漏一个、多一个」。这个条件是怎么被一条测试逼出来的，见 8.8。

#### `message` 的生成规则

**只有一处差异时给精确位置**——PRD 2.7 要的就是「第 N 个字母漏了」这种说法；**多处差异退回汇总**，因为「第 3、7、11 个字母都错了」读起来比错本身还费劲。

| 情况 | message |
|---|---|
| 全对 | `拼对了` |
| 恰好一处 `missing` | `第 N 个字母漏了` |
| 恰好一处 `sub` | `第 N 个字母写成了「x」，应该是「y」` |
| 恰好一处 `extra` | `第 N 个位置多敲了「x」` |
| 多处 | `漏了 a 个、多了 b 个、写错 c 个字母`（只列非零项） |

N 由 `positionInExpected(ops, idx)` 给，取该差异在**正确词**里的位次（1-based）；对 `extra` 来说它没有对应的正确字符，拿到的是「插在第几个位置」——所以那一句用的是「**位置**」而不是「字母」，这个用词差异是有意的。

**判等与比对共用一套口径**（`normalizeSpelling`）：去首尾空白 + 转小写。只做这两下——大小写和首尾空格是打字失误，不是「没记住」。**不**动内部空格与连字符：`in spite of` 里那个空格、`well-known` 里那个连字符本身就是要记住的一部分，抹掉等于放水。

### 14.2 组件：`SpellSession` 是受控的

```ts
{ item, accent, busy, onRate }   // 全部 props
```

只出题、收答案、比对，**自己不碰网络**。评分由一个 `onRate` 出口交回 `StudySession`——那边早就有一套「提交 → 还在本次会话内就排回队尾」的逻辑（`isWithinSession`，20 分钟窗口），拼写**不重造**。`handleRate` 与 `WordCard` 一行没改。

`StudySession` 的改动就四处：

1. 加 `spell?: boolean` prop。
2. 卡片位置分流：`{spell ? <SpellSession key={…} …/> : <WordCard key={…} …/>}`。**`key` 里的 `-${rated}` 必须保留**——答错重排回来时 `wordId` 没变，只有换 key 才能把输入框和比对结果清干净。
3. 头部模式标签多一支：`spell ? "拼写" : weak ? "错词本" : current.isNew ? "新词" : "复习"`。
4. 底部那一行**不渲染「自动发音」开关**（它的语义是「转到单词面时自动朗读」，拼写模式里没有正面 / 背面），保留「进度已实时保存 + 退出」。

#### 内部状态与题面

`mode: "meaning" | "listen"`（默认 `"meaning"`）/ `typed` / `result: SpellDiff | null` / `supported`。四个 effect：探 `isSupported()`、听写模式下自动 `speak()`、挂载后聚焦输入框、**进结果态时把焦点交给「下一个」**。

| 模式 | 题面 |
|---|---|
| 看中文写英文 | 大字显示 `item.meaningCn` 或 `item.bookMeaning`（与 `WordCard` 同一条兜底口径） |
| 听写 | 一个大号 `SpeakButton` + 一行「点喇叭再听一遍」，**不显示任何文字线索** |

**切模式清空 `typed` 和 `result`**，不让上一模式的输入串台。

⚠️ 听写**不提 `S` 快捷键**（词卡那边有）：输入框占着键盘，`S` 会被当成字母打进去。喇叭按钮必须一直在——`tts.ts` 顶层注释记过 iOS Safari 要求用户手势才能 `speak()`，自动播可能被忽略，**它是兜底不是装饰**。

输入框 `autoComplete` / `autoCapitalize` / `autoCorrect="off"` + `spellCheck={false}`：手机键盘的自动首字母大写和「智能纠错」会替用户改答案，那这个练习就白做了。

**回车靠浏览器原生的表单隐式提交**：`<form onSubmit={…}>` + `<button type="submit">`，**没有 `onKeyDown`**。单行 `<input>` 在有提交按钮的表单里按 Enter 会触发 `submit` 事件，这是 HTML 的既定行为，少写一个 handler 就少一处可能写错的判据。（注意：合成的 untrusted `keydown` **不**触发它，所以自动化走查里要点按钮而不是派发 Enter。）

#### 答错要有一层缓冲

```
ok === true  → onRate(4)，直接进下一题（拼对了就该和翻面对了立刻评分一样顺）
ok === false → setResult(diff)，展示逐字符高亮 + 诊断，按钮变「下一个」；
               点它才 onRate(1)
```

这一层是**刻意的**：答错要记 rating 1、还会把这张卡排回队尾，**不能让第一次回车既提交又落库**——先让人看清错在哪，再决定走。

**结果态的「下一个」自己接住焦点**（2026-10-16 加）。此前它没有：输入框连同整个 `<form>` 在进结果态时被卸载，**焦点掉到 `<body>`**，而焦点在 body 上按回车按规范**什么都不会发生**。用户报过「答错后按回车能过」——那是浏览器自发的焦点处理，**各浏览器不一致**，属于「没实现、但碰巧能用」。现在进结果态时显式 `focus()` 到按钮上：**按钮获得焦点时回车激活它，是规范保证的行为**，跨浏览器一致，也就把「回车过题」从一个不确定的默认行为变成了明确的实现。顺带补掉一个可访问性缺口——焦点掉到 body 时，键盘用户按 Tab 会从页面开头重来。

注意这**不等于**取消了那层缓冲：第一次回车是**提交答案**，第二次才是过题，两次分开——用户总有中间那一眼。

**高亮渲染**：正确词按 `ops` 逐个字符铺开，`keep` 走正文色，`missing` / `sub` 走 `--color-rate-again` 加 2px 下划线；**`extra` 不渲染进这一行**（它在正确答案里没有位置），只在下面那句诊断里点名。

### 14.3 空态：第五支，且必须排在最前

`StudySession` 的空态原本四支，拼写加进来成了五支：

```ts
const spellDone   = rated === 0 && spell;      // ← 第一支
const weakDone    = rated === 0 && weak;
const chapterDone = rated === 0 && unit !== null;
```

**判定顺序不能反**：`?unit=3&spell=1` 这种地址下 `unit` 不为空、又还没答过，`spellDone` 若排在 `chapterDone` 后面，会先命中后者说出「第 3 章已经学完」——可用户是来默写的，那一章恰恰**有**学过的词，那是句错的诊断。

| 项 | 取值 |
|---|---|
| 标题 | 带 `unit` 时「第 N 章还没有学过的词」，否则「还没有学过的词」 |
| 正文 | 拼写练的是学过的词——先去「今日功课」背几个，回头再来默写。 |
| 动作 | 主动作「回首页」/ 次动作「浏览章节词汇」 |

底部那行错词本出口也加了 `!spell`——拼写进门就空时，把人往错词本引是南辕北辙。

### 14.4 三处入口

| 位置 | 文案 | 条件 |
|---|---|---|
| 桌面侧栏第三项 | 「拼写练习」→ `/spelling` | 无（导航项常驻） |
| 首页主按钮**下方** | 「拼写练习（N 个学过的词）」→ `/spelling` | `stats.started > 0` |
| 章节页**每一行**的**右侧**（桌面）／**下方**（窄屏） | 「拼写检验」→ `/spelling?unit=N` | 学过 ⇒ `<Link>`；没学过 ⇒ 同尺寸的压暗 `<span>` 占位 |

首页和章节页两处都是**按钮**（2026-10-16 当天改，此前是带下划线的文字链接）：尺寸、圆角、内边距和同一屏里那个主按钮**完全一致**，只有**填充**不同——主按钮墨绿实底，拼写走 1px 细描边。主按钮是「今天该干的事」，拼写是加练，主次改由填充承担、不再由「按钮 vs 链接」承担（两个都做成实底就分不出该点哪个了）。`stats.started` 是 `getTodayStats` 现成返回的，不用新查询。**侧栏那条只上桌面**（11.14），所以后两条在手机上不是「顺带也有」，而是主要入口。

> **按钮化的尺寸细节**（2026-10-16）：
> - 首页那两个包在 `mt-1 flex flex-col gap-2` 里——组内 8px 比组外那 16px（父容器的 `gap-4`）紧，读起来才像「主 + 辅」而不是两个并列动作。主按钮原来的 `mt-1` 挪到了这一层，它的位置一个像素没动。
> - **主按钮那一支补了 `border border-transparent`**：高度是内容撑开的，只有描边那支带边框，实测它会高出 1px（375px，DPR 缩放下）／2px（1x 屏）——上下叠着的两个按钮底边对不齐。透明边框只占宽度，实底填色照旧铺满（`background-clip` 默认就是 `border-box`），视觉零变化。改完两档视口实测同宽同高、左边缘对齐：1280 下 687×41、375 下 294×41，间距都是 8px。
> - 章节页那颗是小一号（`px-2.5 py-1 text-xs`、12px 字、69×25），**位置分两档**：
>   - **桌面（`lg:`）**：`<li>` 那一层是 `flex-row` + `items-baseline`，Link 走 `flex-1 min-w-0` 吃满剩余宽度，按钮 `lg:shrink-0` 靠右，和「已学 · 掌握」**基线对齐**（实测 1280 下两者垂直中心偏差 0px、间距 20px，点线 leader 仍有 389px）。文案**不带数字**——同一行左边「已学 N」就是同一个数，挨着放两遍是冗余（它单独占一行时才需要自报数量）。
>   - **窄屏**：退回 `flex-col`，按钮 `self-start ml-9 mb-3` 自己占一行、缩进到章名底下（`ml-9` = 目录行的 `px-2` 加章号那 16px 加 `gap-3`；实测按钮 left 52 / 章名 50）。
>
>   **窄屏为什么不能并排**（都是实测）：375px 下这一行光「章号 + 章名 + 已学 · 掌握」就吃掉 224px，塞进按钮后**点线 leader 宽度归 0**——目录的点线整个消失；按钮又因为居中于两行而比数字行低 12px，落在「右下」而不是「旁边」。更硬的一条是「已学」涨到三位数就会把章名挤到换行。所以并排只留给桌面。
> - **每一行都渲染，没学过的章占位**（2026-10-16 改，此前只在 `started > 0` 的章渲染）：22 行里只有两三行带按钮时，右边缘参差，那一列读不出「这是同一类东西」。现在没学过的章渲染一颗 `<span>`——**不是 `<Link>`**，那种章点进去必撞空态，给一条通向空页的链接不如不给。类名与可点那颗**逐字相同**，只多 `text-[var(--color-muted)] opacity-45`，所以两列尺寸分毫不差：实测 1280 下 22 颗右边缘**全是 1112**、宽 69、高 25，可点那颗与占位那颗的 `border` 都是 0.667px / `rgb(222,216,202)`；375 下缩进与章名对齐（left 52 / 章名 50）、点线 leader 仍有 86–98px、`scrollWidth` = 375。

> 侧栏那条是 14.8 拆页时加的；后两条的 `href` 从 `/study?spell=1` 改指向 `/spelling`，**文案一个字没变**。条件后来动过——章节页那颗先是「只在学过的章渲染」，当天又改成每章都渲染、没学过的走压暗占位。

**章节页那颗不能塞进整行里**：整行已经被一个 `<Link>` 包着，**`<a>` 套 `<a>` 是非法 HTML**（`WordCard.tsx` 里「不用 button 套 button」是同款坑）。所以 `<li>` 里多包了一层 flex 容器，那个 Link 和拼写按钮是它的两个孩子——桌面 `flex-row`（Link `flex-1 min-w-0`、按钮 `lg:shrink-0` 靠右），窄屏 `flex-col`（按钮另起一行）。目录行本身（章号 / 章名 / 点线 / 两个数字）一个像素没动，一直是原来那个 `px-2 pt-3 pb-1` 的 Link。占位那颗同样是这一层的孩子、同样在 Link 之外（它没有 `href`），所以 `a a` 的计数仍是 0。

### 14.5 导航归属：不用改

`Nav.tsx` 的判法是「`/study` 上带 `unit` → 章节词汇；带 `weak` → 研习统计；都不带 → 今日功课」。拼写**不改变来源**：`/study?spell=1`（首页进的）落「今日功课」，`/study?unit=N&spell=1`（章节页进的）落「章节词汇」——天然就对，`spell` 不需要进那个判据。

> **14.8 拆成独立页后这一整节作废**：`/spelling` 自己就是导航第五项，不再需要按来源折算归属。判据一个字没动——`/spelling` 不以 `/study` 开头，走的是 `pathname` 那条路，天然命中。留着是因为它记录了「为什么当时不需要改」。

### 14.6 验证（2026-10-16）

> ⚠️ **下面这张表是拆页之前那一轮（`/study?spell=1` 时期）的读数**，表里的 URL 现在已经改指 `/spelling`，归属也由 14.8 取代。留着是因为它记录了组件本身的行为——**组件那一层没变**，变的只是谁挂载它、地址长什么样。拆页当轮的验证在 14.8。

| 项 | 结果 |
|---|---|
| 首页入口 | 「拼写练习（27 个学过的词）」→ `/study?spell=1` |
| 章节页入口 | 只有学过的第 1 章出现「拼写检验这一章（27 个）」；`document.querySelectorAll("a a").length` = **0** |
| 默认模式 | 进去是「看中文写英文」，题面是中文释义；切「听写」后题面只剩喇叭、输入框被清空 |
| 答错 | 正确答案逐字符铺开，**只有漏掉的那个 `r`** 是 `rgb(163,58,42)` + 2px 下划线（其余 `rgb(27,24,21)` 正文色）；诊断「第 6 个字母漏了」（答案是 `jeopardise`，漏的是第 6 位的 `r`）；按钮变「下一个」，**焦点落在它上面**（`document.activeElement` 读出来就是它，`form` 个数归 0），且**未落库** |
| 答错后重排 | 点「下一个」→ 队列**仍是 27**（该词按 `1m/10m` 排回队尾），已完成 +1 |
| 答对 | `pebble` 输对 → 直接进下一题、**无结果区**，队列 27 → **26**，已完成 +1 |
| 空态 | `/study?unit=22&spell=1` → 「第 22 章还没有学过的词」（说明 `spellDone` 的判定顺序对） |
| 侧栏归属 | `/study?spell=1` → 「今日功课」；`/study?unit=N&spell=1` → 「章节词汇」（bar + rail 两处都拿到 `aria-current="page"`） |
| 375×812 横向溢出 | 题面态与**结果态**均 **0**（`scrollWidth` = 375，越界元素 0 个） |
| 不回归 | `/`、`/units`、`/stats`、`/settings`、`/study`、`/study?unit=1`、`/study?weak=1` 全部照常；后三种的头部模式标签分别是「复习 / 新词 / 错词本」，自动发音开关都在 |
| 单元测试 | `npm test` **72 条全绿**；`npx tsc --noEmit` 退出码 0（详见 8.8） |
| `dev.db` 指纹 | 跑测试前后**逐位一致**（1617920 字节 / md5 `eb3293dd5b5e7da2a389c6d50595fc89`，2026-10-16 走查结束时的读数）——测试走 `prisma/test.db` |

> **指纹与 8.7 那轮不同是正常的**：这一轮在浏览器里**真实作答过**，答对答错的记录真的落进了 `dev.db`，那是使用不是污染。要验的是「**跑测试**不碰它」——上表最后一项对的就是这个（这一条是收官时重新取的：走查中途记过一版 md5，之后又答了几题、库里跟着变了，**这个值只对 2026-10-16 那一刻有意义，之后再用还会变**）。

### 14.7 明确没做

- **不改 `WordCard.tsx`**、不改 `handleRate` 的提交与重排逻辑（改动全挡在组件外）
- **不动 schema、不迁移**：拼写结果走现成的 `/api/review`，落 `ReviewLog` 和 `UserWordProgress`，**不新增「模式」字段**。代价是统计页会把拼写算进「新学 / 复习」——这是可接受的，它确实是一次真实作答；要区分得动数据模型，不划算
- **不做单词级跳转**（章节页每一行不直接进某词的拼写）
- **不做「提示」按钮**（提前露一个字母）——PRD 没要求，先把主链路走通
- ~~**不给导航加第五项**（窄屏宽度预算已用满，见 6.2 与 PRD 2.6）~~ ✅ **同日拆页时加了，但只上桌面侧栏**（见 14.8 与 11.14）。**窄屏顶栏仍然没有第五项**——那条宽度预算一个像素没变
- **不新增颜色 / 圆角 / 字号令牌**，不引任何依赖

---

### 14.8 拆成独立页 `/spelling`（2026-10-16 同日）

**起因**：用户要求「把拼写与听写模式单独出来，在侧边栏单独一页」。此前它挂在学习页上（`/study?spell=1`），入口只有首页和章节页两条文字链接。

**新建 `src/app/spelling/page.tsx`**：server component、`force-dynamic`，形状照 `units/page.tsx`。四份数据并行取——`userSettings`（要 `accent`）、`buildSession(user.id, { spell: true, unitId })`、`userWordProgress` 的全部行（只为在 JS 里数出「每章学过几个词」）、以及全部 22 行 `unit`（一份数据同时供 chip 的章号与空态的章名）。**队列来源一个字没改**，还是 6.4 那个 `buildSpellSession`。

```tsx
const unitId = params.unit ? Number(params.unit) : undefined;
const validUnitId = unitId && Number.isInteger(unitId) ? unitId : undefined;
// …
<StudySession key={validUnitId ?? "all"} initialQueue={queue} accent={accent} unit={unit} spell />
```

**范围 chip**：页顶一排 `<Link>`（`flex flex-wrap`），最前是「全部 N」，后面每个**学过词的**章节一个「第 N 章 M」。选中态走实底朱砂 + `--color-on-brand`，未选中走 `--color-line` 描边——和 `SpellSession` 那两格模式 tab 是同一种「这里是当前位置」的语言。**纯服务端渲染、零 JS**（与 `/stats` 一致）。chip 上的数字是「这一范围里学过多少词」，与 `SPELL_LIMIT`（50，队列上限）是两回事。`aria-current` 用的是 `"true"` 而不是 `"page"`：这几个 chip 是**同一页上的筛选**，不是导航目的地（导航项才用 `page`）。

**一个计划里没有、实现时才发现的坑：`StudySession` 的 `queue` 是 `useState(initialQueue)`，只在挂载时读一次初值。** `/spelling` 是**唯一会在同一条路径上换 query 的页面**——点范围 chip 走的是 Next 的客户端导航，同路径只换 `?unit=`，**client component 不会被卸载**，服务端送来的新 props 直接丢掉。后果不是报错，而是**页面继续显示上一范围剩下的词，越答越少**，看着像「这一章真只有这么几个词」。修法是给 `<StudySession>` 一个随范围变化的 `key`（`key={validUnitId ?? "all"}`）**强制重挂载**。`/study` 那边没有这个问题（换章是从 `/units` 进来，是一次真正挂载），所以这个 `key` 只加在新页面上。

> 实测确认重挂载生效：往输入框打字 → 点另一个范围 chip → **输入框被清空**，队列与计数跟着换。

**`/study` 拆掉 `spell`**：`searchParams` 类型去掉它、`weak` 回到 `!validUnitId && Boolean(params.weak)`、`opts` 退回两层三元、不再给 `StudySession` 传 `spell`。文件头那段「四种进法」改成三种。**保留一条旧地址重定向**：

```ts
if (params.spell) redirect(validUnitId ? `/spelling?unit=${validUnitId}` : "/spelling");
```

放在**取用户和查设置之前**——它是纯路由判断，不该先做两次数据库查询再丢掉。理由：`/study?spell=1` 是上一版真正发布过、文档里也写着的地址，不重定向的话它会**静默落回每日动线**，那是个错的答案而不是个错误。

> ⚠️ **`redirect()` 在 Next 15 的 App Router 里对完整文档请求返回的是 200 + 流式 payload 里的 `NEXT_REDIRECT` 标记**，不是 HTTP 3xx——shell 先刷出去，客户端再跳。所以**用 curl 看到的是 200、HTML 主体里也 grep 不到目标页内容**，容易误判成「重定向没生效」。判据是响应里有没有 `NEXT_REDIRECT`，或者直接用浏览器看最终落在哪个地址。实测 `/study?spell=1` → `/spelling` 端到端成立。

**`StudySession.tsx` 去掉一处重复**：拼写模式下头部那行左边原本写「拼写 · 第 N 章 XX」，而 `SpellSession` 自己那行已经出过一次章名、`/spelling` 页顶还有 h1 和范围 chip——同一屏里第三次出现就是噪音，改成留空。**空 `<span>` 保留**：外层 `justify-between` 靠它把右边那句顶到行尾，改成整块不渲染右边会挪到左边。`modeLabel` 同时去掉拼写那一支（模式由页面自己的 h1 说明，再标一次是重复）。

#### 验证（2026-10-16）

| 项 | 结果 |
|---|---|
| `tsc --noEmit` / `npm test` | 退出码 0 / **72 条全绿**（这次没动被测代码，属回归确认） |
| `prisma/dev.db` | 跑测试前后**逐位一致**（1617920 字节 / md5 `78c9182c9d311fe5c613a6cb0aba1ba4`）——测试走 `prisma/test.db` |
| `/spelling` | h1 + 范围 chip（`全部 27` / `第 1 章 27`）+ 会话（`还剩 27 个 · 已完成 0`、模式 tab、释义、检查、进度已实时保存、退出）；进度行左侧已为空 |
| 点范围 chip | → `/spelling?unit=1`，chip 选中态跟着切，**输入框被清空**（重挂载生效） |
| 空态 | `/spelling?unit=22` → 「第 22 章还没有学过的词」+ 说明 + 回首页 / 浏览章节词汇，**范围 chip 仍在上方可换** |
| 旧地址 | `/study?spell=1` → 端到端落到 `/spelling` |
| 答错 | `jeopardize`（正确 `jeopardise`）→ 「第 9 个字母写成了「z」，应该是「s」」+ 逐字符高亮；`form` 个数 0；`document.activeElement` 是「下一个」按钮（14.2 那个焦点接管在新页面上仍成立）；**未点「下一个」，所以没有落库** |
| 不回归 | `/`、`/units`、`/stats`、`/settings`、`/study`、`/study?unit=3`、`/study?weak=1` 全部 200 且内容标记正确；**全站已无残留 `spell=` 链接** |

> **踩了一个 dev server 的坑，记下来**：走查中途 `<main>` 停在 `loading.tsx` 的骨架屏上，真页面渲染成一棵挂在 `<body>` 下、**不在 `<main>` 里**的树——于是 `document.querySelector('main').innerText` 读到「正在加载…」而内容其实已经渲染好了。**只有重启 dev server 能清掉**（full reload 也卡着），不是代码问题。

**明确没做**（这一轮）：不动 `lib/session.ts`（`buildSpellSession` 与 `BuildOptions.spell` 原样保留）、不动 `lib/spelling.ts`、不动 `SpellSession.tsx`、不动任何测试；**不提高 `SPELL_LIMIT`**（已学词超过 50 时队列仍只给 50 个，这是 6.4 里写明的现状）；不做下拉 / 横向滚动 / 「更多」菜单这类第二套导航；不给窄屏顶栏加第五项；不新增颜色 / 圆角 / 字号令牌，不引依赖。**`app/units/page.tsx` 那条章节页链接保留**——它是「从正看着的这一章直接进去」的深链，和同一行上面那条 `/study?unit=N` 同类，不是「同一目的地的第二条路」（当初删首页两个快捷入口，删的是和导航**完全等价**的 `词库`/`设置`）。

---

## 15. 拓展阅读（`/reading`，2026-10-16 · 试点两章）

**问题**：词卡把词一个个讲清楚，但「学会一个词」和「在一句话里认出它」是两件事。这一页把某一章的词嵌进中文原创短文，让词回到句子里。

### 15.1 形态选型：为什么是「自己写」而不是「把书上素材串起来读」

先做的是另一案——把书里已有的段落素材按章串起来当阅读材料。**用真实数据否掉它的三条理由**：

| | 实测 |
|---|---|
| 素材不是连贯文章 | 多数是词根记忆法那类条目，本身不构成可读的叙事 |
| 与词卡背面高度重合 | 那些素材正是学习卡背面已经在显示的内容——**是新容器，不是新信息** |
| 跨章串入 | 14 条（含 `Chapter` 字样，可识别），是 OCR 没切干净 |
| 覆盖 | 464 词 / 3580（**13%**），每章 2~65 条，中位 17——多数章根本凑不出一篇 |

改成自写之后还多了一条：**版权**。`schema.prisma` 里 `bookMeaning` / `collocation` / `derived` / `etymology` / `cultureNote` 有一段注释标明是「书中原创内容，受版权保护」，`plan.md` 第 6 节把「公开部署」标为**高**风险。自写短文 + 词义取 ECDICT 的 `meaningCn`（词典）而不是 `bookMeaning`（书上原话），**不新增版权暴露面**。

### 15.2 内容形态与两个脚本

**文件**：`content/passages/chapter-NN.md`（一位数补零：`chapter-04.md`）。一个文件 = 一章，`---` 分成篇：

```markdown
# 观测夜

……天文学家用 {{telescope}} 对准夜空，{{observatory}} 里……

---

# 断电之后

……
```

`{{headword}}` 是**唯一的标记语法**，一个语法同时解决四件事：渲染成可点词块、自测模式藏中文、**覆盖率能脚本自动校验**、存储只要一个 `String` 字段（不必给每个词建关联表）。标记允许连字符（`up-to-date` 这种）。解析器在 `scripts/lib/passage-files.ts`，两个脚本共用。

**`npm run check:passages`**（`scripts/check_passages.ts`，长期工具）：从 md 抽标记与该章词表比对，报缺词 / 越界词，有失败就 `exit 1`。当前输出：

```
第 4 章 太空探索 —— 2 篇
  1. 观测夜，标记 38 处 / 36 词，正文 888 字
  2. 断电之后，标记 37 处 / 37 词，正文 922 字
  合计覆盖 73/73（100.0%）
  ✓
第 22 章 时间日期 —— 1 篇
  1. 守钟人，标记 52 处 / 51 词，正文 1238 字
  合计覆盖 51/51（100.0%）
  ✓
全部通过
```

> **判据落在「章」，不落在「篇」**：一章拆几篇时篇与篇之间怎么分词是写作自由，但这一章的词必须被某篇标到。**这是 84 篇能批量写下去的前提**——没有这条校验，只能靠人眼核。
>
> 标记数与词数不等（38 处 / 36 词）是因为同一个词在一篇里出现几次；`wordCount` 存的是 `new Set(tags).size`。

**`npm run db:seed:passages`**（`scripts/seed_passages.ts`）：把 md 灌进 `Passage` 表，导出 `seedPassages(prisma)` 供 `prisma/seed.ts` 末尾调用（`main().then(() => seedPassages(prisma))`），所以 `npm run db:seed` 一次就能把词表和短文一起灌好。**幂等**：每章在 `$transaction` 里先 `passage.deleteMany({ where: { unitId } })` 再 `createMany`——某章从 3 篇改成 2 篇时不会留孤儿。脚本底部用 `process.argv[1]` 判断是否被直接运行，避免被 import 时重复执行。

**粒度**：每篇 40~60 词。全书 3580 词 / 22 章，按这个粒度约 **84 篇**（每篇 80 词则约 55 篇）。「每章一篇」不成立：最大第 21 章 408 词、第 5 章 395 词；最小第 22 章 51 词，一篇正好。**允许缺 2~3 个生僻词**——为塞进一个词把句子写坏更亏，校验脚本会把缺的列出来让人判断。

### 15.3 渲染：`lib/passages.ts` + `PassageReader.tsx`

**解析在服务端**（`src/lib/passages.ts`，纯函数）：把 `body` 切成 `Block[]`（段落 × token），客户端组件只拿现成结构做交互——**`{{}}` 的语法只在这一个文件里认，将来改语法不用动组件**。

```ts
export type Token = { t: "text"; v: string } | { t: "word"; v: string; cn: string };
export type Block = Token[];

export function shortMeaning(meaningCn: string): string   // 取第一行、去词性前缀
export function toParagraphs(body, meaningOf): Block[]
```

两个实现细节：

- **每段重起一个正则**（`new RegExp(TAG.source, "g")`）。带 `g` 的标志的正则 `exec` 会在 `lastIndex` 上记状态，跨段复用会漏标记。
- **`meaningOf` 由调用方给**，查不到返回空串——词块照常渲染，只是点开没内容，不报错（同学习页「字段缺了不显示占位符」那条）。

**`PassageReader.tsx`（client）只有一处客户端状态**：中文是「藏着」还是「露着」。

| 模式 | 表现 |
|---|---|
| **自测**（默认） | 中文全藏，点哪个词出哪个 |
| **对照阅读** | 中文直接跟在词后 |

**默认自测**的理由就是这一页存在的理由：一进来什么都摊开，和直接看学习卡背面没区别，眼睛会顺着中文滑过去。点开的词按**词面**存在 `Set<string>` 里（不按位置）——同一个词在一篇里出现几次，点开一处全露，不然整篇每处都要点一遍。

词块用 `<button>` 而不是 `<span onClick>`：键盘也要能走到（Tab 停在词上、回车看中文），这是 PRD 第 3 节那条无障碍承诺的一部分。

> **词块的中文取整行词典释义**（用户 2026-10-16 定）：`observatory` → 「天文台, 气象台, 了望台」。多义词会带一串、看着偏长，但**取第一个义项有取错文中那个意思的风险**——宁可长。`shortMeaning()` 只做两下：取第一行、去开头的词性前缀。查不到时显示 `—`。

### 15.4 路由 `src/app/reading/page.tsx`

server component、`force-dynamic`，取参口径照抄 `study/page.tsx` 与 `spelling/page.tsx`（`params.unit` → `Number` → `Number.isInteger` 校验），不另造一套。

- **章 chip 只列有短文的章**（`_count.passages > 0`）。短文是逐章补的，列了没写的章只会撞空态。chip 是纯 `<Link>`、零 JS，与 `/stats`、「拼写范围 chip」同一套做法。
- **不带 `unit` 时落在第一个有短文的章**，从导航进来直接有东西读，不用先在一片空章里挑。
- 查该章所有词的 `headword → shortMeaning(meaningCn)` 建 `Map`，再逐篇 `toParagraphs(p.body, (h) => map.get(h) ?? "")`，把 `{ id, title, blocks }[]` 喂给 `PassageReader`。
- 一页读完整章（**不按篇分页**）——章与篇的区别是写作粒度，不是浏览粒度。

**不吃配额、不写进度**：这一页不读 `UserWordProgress`、不落 `ReviewLog`，是所有页面里唯一与进度无关的学习页。它不是检验，是读物。

### 15.5 章节页那两颗按钮

`units/page.tsx` 每行右侧从一颗按钮变成**一组两颗**（`flex gap-2`），两个「有没有」是独立条件：

| 按钮 | 渲染条件 | 链接 |
|---|---|---|
| 拼写检验 | `started > 0`（这一章学过词） | `/spelling?unit=N` |
| 拓展阅读 | `hasPassage`（这一章写过短文） | `/reading?unit=N` |

两颗都**每一行都渲染**，没得做的用同尺寸的压暗 `<span>` 占位——22 行里只有几行有按钮的话右边缘会参差，那一列就读不出「这是同一类东西」（拼写那颗的原有理由，这里照搬）。占位不做成链接：那种章点进去只会撞空态。

> **窄屏也是并排**（`gap-2`，实测 52→198px，375px 下宽裕）。拆成上下两行会把每章撑高一行，22 章下来整页长出一屏。

### 15.6 验证（2026-10-16）

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 退出码 0 |
| `npm test` | **72 条全绿**（这次没动被测代码，属回归确认） |
| `prisma/dev.db` | 跑测试前后逐位一致（md5 `3653d71336e4454474d617eb196924dd`）——测试走 `prisma/test.db` |
| `npm run check:passages` | 第 4 章 73/73、第 22 章 51/51，全部通过 |
| `/reading` | h1 + 两个章 chip（第 4 章 2 篇 / 第 22 章 1 篇）+ 默认落在第 4 章的两篇；**页面里没有残留 `{{`** |
| 默认自测 | 75 个词块**全部不带中文** |
| 点词 | `observatory` → 「天文台, 气象台, 了望台」，且**按词面**全篇同词一起露 |
| 切「对照阅读」 | 75 / 75 个词块全部显示中文；切回自测只留已点开的 |
| 空态 | `/reading?unit=1`（没写短文的章）→ 「第 1 章还没有短文」，**章 chip 仍在上方可换** |
| 375×812 | 顶栏仍 **4 项**（无拼写、无拓展阅读）、`nav` 实测 **278px**、`scrollWidth` = 375 **零溢出**；章节页两颗按钮 52→198px、22 行全渲染 |
| 1280×800 | 侧栏 **6 项**（顺序见 11.14）、`/reading` 高亮 `aria-current="page"`；章节行高 **53px** 未变、按钮组右贴 8px |
| 不回归 | 13 条路由（含 `/spelling?unit=4`、`/study?weak=1`、`/reading?unit=22` 等）全部 200 |

> **验证方法上一个坑**：Browser 面板收起时页面**不做 hydration**（`visibilityState === 'hidden'`，页面里 h1 / button 都查不到 `__reactFiber$`，点词、切模式全无反应；`setInterval` 却照常跑，所以不是「冻结」）。先调一次 `preview_screenshot` 让面板变成可见，hydration 立刻完成。**量 DOM 结构（导航项、路由内容）不受影响，量交互和 rect 才受影响。**

### 15.7 明确没做

不记录阅读进度（读过哪篇、读了几遍都不存）；不做收藏 / 生词本联动；不做音频朗读；不做逐句翻译或语法标注；**不写第 4、22 章以外的章**（试点范围，其余 20 章约 80 篇待补）；不给窄屏顶栏加第六项；不新增颜色 / 圆角 / 字号令牌，不引依赖。`Passage` 表**不做版本号**——短文改了就重灌，没有需要保留的历史。

