---
name: ielts-study
description: 背词主链路。改“今天学哪些词、什么顺序”、评分后的间隔、卡片发音与快捷键，或排查“点进某一章没有词”“错词本顺序乱了”“评分抛 FSRSValidationError”“每个词慢半拍”“同一个词读两遍”时使用。覆盖四种队列的分岔顺序、每日配额的适用范围、必须持久化的 FSRS 字段、提交事务不变量、空卡与真实卡的取舍。
---

# 背词学习（`session.ts` + `srs.ts` + `WordCard`）

## 链路

```
/study?unit=&weak=&spell=   →  buildSession(userId, opts)   →  QueueItem[]
                                                              ↓
                                        WordCard（正面 / 背面 / 发音）
                                                              ↓ 评分 1~4
                                        POST /api/review → submitRating()
                                                              ↓
                                        $transaction{ progress.upsert + reviewLog.create }
```

拼写走同一套评分出口，只是题面换成了 `SpellSession`，见 `ielts-spelling`。

## 四种队列

`buildSession` 按 `opts` 分岔，**判断顺序不能调换**：

| 顺序 | 模式 | 入口 | 判据 | 卡片 |
|---|---|---|---|---|
| 1 | 拼写 | `/spelling[?unit=N]`，页面调 `{ spell: true, unitId }` | 学过的词（有进度行），按 `dueAt` 升序，最多 50 | 真实卡 |
| 2 | 章节专项 | `/study?unit=N` | 这一章**没有**进度行的词，按 `orderInUnit` | 空卡 |
| 3 | 错词本 | `/study?weak=1` + `wordIds` | 调用方点名，按名单顺序 | 真实卡 |
| 4 | 每日动线 | `/study` 默认 | 到期旧词优先 + 新词补配额 | 旧词真实卡 / 新词空卡 |

入口约定：

- 旧的 `/study?spell=1` 会 302 到 `/spelling`（带 `unit` 一并带过去）
- `/study?unit=3&weak=1` 按章节走，`unit` 优先于 `weak`
- 错词本的名单由页面现查 `getForgetfulWords(user.id, FORGETFUL_LIMIT)` 再摘成 `wordId` 列表

### 为什么拼写分支必须排最前

`/spelling?unit=3` 要的是“第 3 章里**学过**的词”。先接住 `unitId` 再往下走；反过来先判 `unitId`，请求会被章节专项吃掉，变成“第 3 章还没学过的词”，和用户点的入口对不上。

## 每日动线（只有这一条吃配额）

1. 先复习到期旧词，再学新词。旧词不复习会越积越多。
2. 到期复习数受 `dailyReviewLimit` 截断。
3. 新词数 = `dailyNewLimit` 减去今天已经学过的。
4. “今天已学新词” = 今天首次创建的进度行（`UserWordProgress.createdAt`），不是流水条数。
5. “新词” = 这个用户还没有进度行的词。

## 专项模式为什么绕开配额

用户主动点了一章 / 错词本 / 拼写，要的是“把这一块过完”，不是“今天固定喂一点”。配额、到期、先复习后学新这三条只属于首页动线，套到专项模式上会造成：

- 实测 2026-10-16：第 1 章 233 个词，当天配额已用 18/20，点进去只拿到 3 个；配额用光时一个都没有，弹“今天没有待学的词了”。
- 用户原话是“学习的模式仍然是今日功课的模式”。

所以专项模式一律**不看 `dueAt`、不套上限**。

### 各自的额外约定

- **章节专项只给没有进度行的词。** 第一版无条件返回整章，用户学完前 21 个退出再进，第一张卡又是第 1 个，他会以为进度没保存。进度一直在，丢的是位置；按“有没有进度行”过滤后，天然接着上次学。
- **错词本和拼写发真实进度行。** 这些词必然有进度行；发 `emptyCard()` 会让 FSRS 拿全新卡片重排一个学过的词，稳定度、间隔、遗忘次数全部从头算。
- **错词本顺序只能靠 `wordIds.flatMap` 保住。** `where wordId in (...)` 只负责收窄集合；换成 `rows.map` 集合仍对，但顺序会塌回数据库的 id 序。顺序本身携带信息：忘得最多的排最前。
- **拼写按 `dueAt` 升序。** 刚学完的新词 `dueAt` 就在几分钟后，天然落在队首，正好接住“学完 20 个新词立刻回头默写”。换成 `lastReviewAt` 升序会把这批沉到队尾。

## 加第五种队列前先回答四个问题

1. **谁触发？** 新增 query 参数时，注意它和 `unit` / `spell` 的组合语义。
2. **吃不吃每日配额？** 用户主动点的入口通常不吃，首页动线才吃。
3. **发空卡还是真实卡？** 只包含“没学过”的词才发空卡；只要可能有进度行就必须发真实卡。
4. **顺序由什么决定？** 书名序、到期时间、还是调用方给的名单？写清楚，并加测试。

然后在 `buildSession` 最前面按正确优先级插分支，并补队列说明。

## FSRS 调度

### 铁律

**只有 `src/lib/srs.ts` 可以 import `ts-fsrs`。** 其他文件只用它导出的 `Rating` / `previewIntervals` / `submitRating` / `emptyCard` / `getCardRow` / `CardRow`。换算法或 ts-fsrs 大版本改 API 时，改动只落在一个文件里。

**客户端组件不能 import 这个文件**，它牵了 Prisma。评分类型和文案在 `src/lib/rating.ts`，那个文件没有服务端依赖。

### 8 个字段必须全存

| 字段 | 含义 | 省了会怎样 |
|---|---|---|
| `stability` | 稳定度，越大忘得越慢 | 每次都从 0 算，间隔永远长不起来 |
| `difficulty` | 难度，合法区间 1..10 | 变成 0 时 ts-fsrs 直接抛错，不是静默算错 |
| `dueAt` | 下次到期时间 | 队列无法排序 |
| `state` | new/learning/review/relearning | 调度分支全错 |
| `scheduledDays` | 当前排到的间隔天数 | 每次复习都从 0 起算 |
| `learningSteps` | 处在第几个学习步长 | 学习步长反复回到第一步 |
| `reps` | 作答次数 | 调度历史失真 |
| `lapses` | 进入复习态后答“忘了”的次数 | 统计和排序失真 |

`state` 在库里是小写字符串，靠 `STATE_TO_DB` / `DB_TO_STATE` 映射到 `FsrsState`。不要把枚举数字写进库。

### 参数（`FSRS_PARAMS`）

- `request_retention: 0.9` — 复习时希望还有 90% 概率记得
- `maximum_interval: 36500` — 实际等于不封顶
- `enable_fuzz: true` — 加随机扰动，避免同一天学的词永远挤在同一天
- `enable_short_term: true` + `learning_steps: ["1m", "10m"]` — 新词当天再见两次
- `relearning_steps: ["10m"]` — 复习态答“忘了”后重新学

集中在一处，不要散落到调用点。

### 两个核心操作

**`previewIntervals(row, now)`**：一次 `scheduler.repeat()` 算出四档，不要调四次 `next()`。四档预览是给用户建立正确评分习惯用的；不显示，所有人都会无脑点“一般”，FSRS 就退化成固定间隔。

**`submitRating(userId, wordId, rating, elapsedMs?)`** 必须做对三件事：

1. 没有进度行时用 `emptyCard(now)`，不要伪造半空记录。
2. `userWordProgress.upsert` 和 `reviewLog.create` 放在**同一个 `$transaction`** 里。只做一半，当日正确率和统计就会错乱。
3. `createdAt` 只能在 `create` 分支出现。放进 `update` 会改写“这个词是哪天学会的”，进而破坏“今日新学”和“旧词复习”的全部口径。

### 容易踩的坑

- **`elapsed_days` 是补偿字段。** ts-fsrs 6.0 会删掉，但现在类型上仍必填，按 `lastReviewAt` 自己算。
- **新词在当天会话内会再出现。** 学习步长是分钟级，这是设计。
- **`lapses` 不等于“忘了的次数”。** 它只在进入复习态后累加；统计页的“老忘的词”走 `ReviewLog.rating === 1`，见 `ielts-stats-ui`。
- **“已掌握”不是 `state === "review"`。** 判据是 `isMastered()`：review 态且 `scheduledDays >= 21`。直接数 review 会虚报约 20 倍。

## 发音与快捷键

浏览器自带 Web Speech API，不下载、不存放音频。`src/lib/tts.ts` 是唯一封装，组件只调 `speak()` / `stopSpeaking()` / `isSupported()`。

### 四个必须处理的坑

1. **`getVoices()` 异步就绪。** 刚加载可能是空数组，Chromium/Windows 实测约 2.5 秒后才有音色。每次朗读重新取，不要缓存空数组；也不要为了等音色而延迟朗读——第一张卡退到默认音色，比先安静 2.5 秒好。
2. **iOS Safari 要求第一次朗读由用户手势触发。** 所以是“用户点过一次之后自动朗读”，不是“一进页面就响”。
3. **连续触发要 cancel，但只在真的还在念时**：`if (synth.speaking || synth.pending) synth.cancel();`。无条件 `cancel()` 紧接着 `speak` 会吞掉新的一次。
4. **音色优先本地。** `localService === false` 是云端合成，每读一次都要网络往返。Edge 的在线自然语音听感好但**每个词慢半拍**（用户 2026-10-16 报过）。优先级：本地+口音精确 → 本地任意英文 → 在线+口音精确 → 在线任意英文。已知代价是中文版 Windows 常没有本地英式音色，“英式”会落到本地美式——**这里明确选了速度**。

`utter.lang` 跟着实际选中的音色走，不要写死口音值。

### 自动朗读的三个时点

`autoSpeak` 管“卡片正面正在显示时读一次”：

1. 这张卡第一次出现（换词会重建组件）
2. 从背面翻回正面
3. 在学习页点开那个开关

**翻到背面看释义时不读。** 那时眼睛在中文上，再念英文是噪音；翻回正面重读，用来印证刚记下的音形。

- 条件是“此刻正面在显示”，不是“这张卡读过没有”
- `spokenRef` 守卫同一个正面只读一次。React StrictMode 在 dev 下会把 effect 跑两遍，少了守卫会读两遍，第二遍 cancel 掉第一遍
- `autoSpeak` 留在 effect 依赖里是故意的：开关一翻就重跑，正面时立刻发音，不会出现“开关和卡片各读一遍”

### 设置

- `UserSettings.autoSpeak` 的 schema 默认是 `false`
- 但没有设置行时页面取 `?? true`，**实际默认是开**
- 开关只 PATCH `{ autoSpeak }` 一个字段，`/api/settings` 逐字段处理，不要回写其余三项

### 键盘

- 空格 / 回车：翻面
- `S`：发音（正反两面都可以）
- `1`~`4`：评分，**只在已翻面且不在提交中时接受**，防止手快评了没看到的词
- 输入框里不拦截；带 Ctrl / Cmd / Alt 的组合让给浏览器

## 验证

- `npx tsc --noEmit`、`npm test`（重点 `tests/session.test.ts` 43 条、`tests/srs.test.ts` 12 条）
- 断言只写**关系**，不写精确日期：`enable_fuzz` 的 seed 跟着时钟变
- 例外：学习步长是“现在 + N 分钟”，不过 fuzz，可以断言到毫秒
- fixture 里 `difficulty` 给 5、`stability` 给 1；留 0 会当场抛 `FSRSValidationError`
- 手动：配额用光的账号点某一章，仍应拿到整章的未学词
- 手动：学完 5 个新词立刻进拼写，这 5 个应排在队首
- 手动：统计页“集中攻克”点进去，第一个词应是忘得最多的
- 朗读：打开开关换词读一次；翻背面不读；翻回正面再读；连点喇叭不排队
- Edge 上不应每个词都慢半拍，否则检查 `pickVoice` 顺序

## 相关 skill

`ielts-spelling` · `ielts-stats-ui` · `ielts-engineering`
