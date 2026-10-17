---
name: ielts-word-data
description: 词库数据全链路，从 PDF/OCR 到数据库。需要重跑词表提取、修复例句粘连或注记脏数据、核对 ECDICT 释义、改 Prisma schema、生成迁移、灌词灌短文、导入旧进度，或排查“迁移对着 pooler 报错”“seed 后进度没了”“例句粘在一起”时使用。覆盖脚本处理顺序、成对修正脚本、verified 过滤、directUrl、seed 的破坏性与危险操作边界。
---

# 词库数据（`scripts/` + `prisma/`）

## 前提：数据不在仓库

- `data/`、`ecdict/`、`*.pdf` 全部被 gitignore
- 里面是《雅思词汇真经》的例句、搭配、词根词源，属出版社版权内容
- 没有原书和自备流水线产物，`npm run db:seed` 跑不起来
- **任何情况下都不要把这些内容提交、贴进文档或写进注释**

仓库里只有代码和原创短文（`content/passages/`）。

## 一、提取流水线（PDF → 词表）

| 步骤 | 脚本 | 产物 |
|---|---|---|
| 1 | `extract_images.py` | PDF → 页面图片 |
| 2 | `read_outline.py` | 书的结构：章节、页码范围 |
| 3 | `ocr_pages.py` | 页面图片 → 文本 |
| 4 | `parse_index.py` | 书末索引 → 词条清单 |
| 5 | `build_vocab.py` | OCR 文本 + 索引 → `data/words.clean.json` |
| 6 | `check_with_ecdict.py` | 用 ECDICT 校验/补音标与释义 |
| 7 | `reconcile_index.py` | 用索引补漏纠错 |
| 8 | `verify_vocab.py` | 旁证，不是主依据 |

后面三步是“修数据”，按问题单独跑：

| 问题 | Python | TS 落库 |
|---|---|---|
| 例句单词粘连 | `fix_spacing.py` | `update_spacing_db.ts` |
| `note` 字段脏数据 | `fix_notes.py` | `update_notes_db.ts` |
| 解析层修正 | `apply_parse_changes.py` | `update_parse_db.ts` |

**成对使用。** Python 只生成修正清单，TS 才写库；只跑一半，数据库不会变。

### 关键约束

- **`verified === false` 必须过滤。** `prisma/seed.ts` 会丢掉这批词。实测 14 条，是“词典和索引都查不到、也不像被并成一行”的可疑词，多半 OCR 认错了字母，没有可信释义和音标。宁可少几个词。
- **音标只用 ECDICT，不用 OCR。** OCR 的音标完全不可靠。
- **中文释义用 ECDICT `meaningCn`**，权威且无版权问题。
- **书中原话**（释义、搭配、派生、词源、文化注记）单独存 `bookMeaning` / `collocation` / `derived` / `etymology` / `cultureNote`，公开分享时整体关闭。
- **词性**从书中释义行开头抠，`POS_PREFIX_RE` 已规范化。
- **编号**灌库时按章内顺序重编 `orderInUnit = i + 1`，抹掉源数据里的空洞；不要依赖旧编号。
- **零依赖。** Python 脚本只用标准库加少量已装的包。装包必须加官方源：

```bash
pip install <pkg> --index-url https://pypi.org/simple/
```

默认清华镜像在这台机器上连不上。

## 二、数据模型

| 表 | 归谁 | 说明 |
|---|---|---|
| `Unit` / `Word` / `WordExample` | 共享、基本不变 | 词库。`Word` 上的 `bookMeaning` / `collocation` / `derived` / `etymology` / `cultureNote` 是书中原创内容，受版权保护 |
| `UserWordProgress` | 每用户 × 每词一行 | FSRS 状态，`@@unique([userId, wordId])` |
| `ReviewLog` | 每用户每次作答一行 | 不可变流水，统计用 |
| `UserSettings` | 每用户一行 | 每日上限、口音、自动发音 |
| `Passage` | 挂 `Unit` | 原创短文，`body` 里用 `{{}}` 标记 |

“架构预留多用户”指的就是这个拆分：加用户只需给他建一套进度，词库共用。当前只有一个用户、一个密码门锁，不做注册。

## 三、Postgres 的两个连接串

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

- `DATABASE_URL` 线上是 Neon pooler（主机名带 `-pooler`），运行时用
- `DIRECT_URL` 迁移和 seed 用直连。**PgBouncer 事务模式跑不了 DDL**
- 不写 `directUrl`，`migrate deploy` 会对着 pooler 报错
- 本地两个变量相同
- 两个变量都要设，Prisma Migrate 优先读 `DIRECT_URL`

## 四、改 schema

```bash
# 1. 改 prisma/schema.prisma
# 2. 生成并应用迁移（本地开发库）
npx prisma migrate dev --name 说明
# 3. 生成客户端
npx prisma generate
# 4. 类型检查 + 测试
npx tsc --noEmit && npm test
```

约定：

- **只维护 Postgres 一套迁移。** `prisma/migrations-sqlite/` 是 SQLite 时代存档，不往里加东西
- 不要用 `prisma db push`。迁移历史是确定的，线上靠 `migrate deploy`
- 改字段后同步更新 `docs/tech-spec.md` 4.1 和 README 的环境变量表（如涉及）
- 新字段给默认值时，想清楚旧行怎么解释；统计口径可能依赖它

## 五、灌库

`prisma/seed.ts` 第一步就删光：

```
WordExample → ReviewLog → UserWordProgress → Word → Unit → User
```

所以：

- **`npm run db:seed` 会清空所有学习进度**
- 在已有进度的库上跑之前，必须先告诉用户，确认后再执行
- `db:seed` 内部会调 `seedPassages`，跑完短文也一起灌了
- 只更新短文时用 `npm run db:seed:passages`，它不动词和进度

`db:seed` 还会过滤 `verified === false`、按 `(unitId, orderInUnit)` 重新编号、建默认用户和设置。

## 六、本地数据库

便携版 Postgres，没有装成服务，每次开机手动起：

```bash
E:/pg/pgsql/bin/pg_ctl.exe -D "E:/pg/data" -l "E:/pg/pg.log" -o "-p 5432" start
```

两个库：`ielts`（开发）、`ielts_test`（测试，只允许 localhost）。

## 七、从 SQLite 时代导入进度

```bash
python scripts/export_sqlite.py    # -> data/progress-export.json
npm run db:seed && npm run db:seed:passages
npm run db:import
```

- 导入按 `(chapterNo, orderInUnit)` 找词，不依赖旧 id
- 导入前会清空目标库的进度和流水
- **导入后不要再跑 `db:seed`**，会把刚导进来的进度删掉
- `ReviewLog` 没有唯一键，重跑导入会翻倍；脚本会先清空

## 危险操作

| 操作 | 风险 |
|---|---|
| `db:seed` / `db:reset` | 清空进度和流水，不可恢复 |
| 删 `Unit` / `User` | 级联删掉进度、流水、例句、短文 |
| 对 Neon 跑迁移 | 动生产库；先确认连接串指向哪 |
| 改 `migration_lock.toml` | 不要手动改 |
| 把 `data/` 加回 git | 直接违反版权边界和公开仓库的前提 |

拿不准时先 `npm run db:studio` 只读看一眼，或先导出。

## 验证

1. 产物行数、章数对得上：22 章 / 3580 词 / 3645 例句
2. 抽样检查：音标不是乱码，释义来自 ECDICT，例句没有粘连
3. `npm run db:seed` 在**测试库或备份后**跑，不要在真实进度上跑
4. 跑完 `npm run check:passages`，确认短文覆盖没被词表变动打破
5. 更新 `docs/tech-spec.md` 第 7 节对应小节

## 相关 skill

`ielts-reading` · `ielts-engineering`
