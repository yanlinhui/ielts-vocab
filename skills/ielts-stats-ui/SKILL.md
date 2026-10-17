---
name: ielts-stats-ui
description: 统计页与全站视觉呈现。改热力图、每日一句、掌握度、老忘的词、页面样式、颜色令牌、焦点环、深色侧栏或翻卡动画，或排查“晚上学的词算到第二天”“掌握数虚高”“老忘的词是空的”“侧栏里颜色消失”“翻卡被削边”时使用。覆盖本地日口径、isMastered、rating=1 口径、令牌层、朱砂对比度边界和零 JS 图表。
---

# 统计与界面呈现（`stats.ts` + `globals.css`）

## 一、统计口径

### 所有日期按本地日分组

`ReviewLog.reviewedAt` 存 UTC。用 `toISOString().slice(0,10)` 分组，晚上 8 点之后学的词会被算到第二天，热力图上出现“晚上学了两天”。

一律用 `localDayKey(d)`（`src/lib/session.ts`）。今日边界用 `startOfToday()`。

### 新学 vs 复习

`ReviewLog` 没有存作答当时的 state 快照，只能借 `UserWordProgress.createdAt` 反推：

- **新学** = 进度行的创建日就是这一天
- **复习** = 这天的流水里，该词的进度行是**更早**创建的
- 当天新词在会话内被反复提问也会写流水，**不算复习**

这个口径在 `session.ts` 的 `getTodayStats` 和 `stats.ts` 的 `getDailyStats` 两处使用，**必须一致**，否则首页和统计页各说各话。

### 已掌握

```ts
state === "review" && scheduledDays >= 21
```

统一调 `isMastered()`，不要在页面里内联。

**不要把 `state === "review"` 整体当已掌握。** 实测 2026-10-16：22 行 review 里只有 1 行 `scheduledDays >= 21`。刚学完的词稳定度只有几天，直接数 review 会把掌握数虚报约 20 倍。

`getStateBreakdown()` 的五段必须互斥，判断顺序：先 `isMastered`（review 的子集），再 `learning` / `review` / `relearning`。反过来会把已掌握的那几个丢出“复习中”。

### 口径函数只留一份

- `startOfToday()` / `localDayKey()` — 本地日，不要用 UTC 切片
- `isMastered()` — review 态且 `scheduledDays >= 21`
- `hasIeltsTag()` — 子串判断，与 SQL 侧 `LIKE` 等价

**不要在页面里内联。** 之前 `units/page.tsx` 手抄过一份 `isMastered` 的条件，改判据时漏改，数字就对不上。

### 老忘的词

口径是 **`ReviewLog.rating === 1` 的次数**，不是 `UserWordProgress.lapses`。

原因：`lapses` 只在卡片进入复习态之后答“忘了”才累加。实测 2026-10-16，27 行进度里 `lapses` 全为 0，按它排序这张表是空的。

- 用 `groupBy(["wordId", "rating"])` 一次拿到“忘了次数”和“总作答数”，不要把流水全拉回来
- 排除一次都没忘过的词
- 并列用 `wordId` 升序兜底，保证渲染顺序稳定
- `FORGETFUL_LIMIT = 20` 由统计页和错词本**共用**。各写各的会分叉：列表 20 个、点进去只练 15 个，且没人报错

### 热力图

- 16 周，列是周，每列周一到周日
- 起点对齐到**本周周一**再往前推 15 周，最后一列永远是本周
- 没到的日期 `future: true`，渲染成空白
- 分档 `HEAT_LEVELS = [1, 5, 15, 30]`，`heatLevel()` 统一判档
- 按本地日计数

### 每日一句

- **同一天必须恒定**。随机排序每次刷新都换，就不叫每日一句
- 用日期做雪崩 hash（`Math.imul`），不能直接用连号日期取模，否则相邻两天是相邻的两句
- 只取有中文翻译的例句
- 拉 20 条候选，取第一条英文长度在 20..90 的。单取一条约有 13% 概率撞上 OCR 粘连句

### 图表：零 JS、零依赖

统计页的三种图都是手写 `div` / SVG，**没有装 Recharts 之类的库**。不要因为“画图方便”引入依赖。

- 图是服务端渲染的静态结构，不需要客户端状态
- 空数据分支一定会走到（新库只有很少记录），每个图都要有 0 值呈现
- 正确率不画折线，见 tech-spec 13.6 的有意偏离

### 性能边界

- 进度行最多 3580 行，热力图和逐日统计在 JS 里聚合可以接受
- `ReviewLog` 随时间线性增长（一年约 8 万行），**不要全表拉回**。老忘的词走 `groupBy`，热力图只取窗口内的行

### 改口径时的检查

1. 新口径只留一份实现，页面引用它
2. 首页 `getTodayStats` 和统计页 `getDailyStats` 的“新学/复习”必须同步
3. `npm test`，尤其 `tests/session.test.ts` 的日期与计数用例
4. 用库里真实数据对一遍数字，不只看代码
5. 更新 `docs/PRD.md` 2.5 / 2.6 和 `docs/tech-spec.md` 第 12、13 节

## 二、视觉系统（`src/app/globals.css`）

### 令牌优先，不写死颜色

Tailwind 4 用 CSS 变量做主题，**没有 `tailwind.config.js`**。组件里一律：

```tsx
className="border-[var(--color-line)] text-[var(--color-ink)]"
```

不要在组件里写 `#1f4a3d` 这类字面值。换皮只改 `globals.css`。

令牌分两组：

- 语义色：`canvas` / `surface` / `surface-2` / `line` / `ink` / `muted` / `brand` / `seal` / `on-brand` / `focus`
- 书脊深色：`rail` / `rail-ink` / `rail-muted` / `rail-line` / `rail-hover` / `rail-seal` / `rail-seal-soft`

字体和圆角也是令牌：`--font-serif`、`--radius-card` / `control` / `chip` / `mark`。

### 配色方向

“深色书脊 + 暖白内页”：近黑侧栏（封皮）+ 暖白内容区 + 墨色正文 + 墨绿强调。

- **全程不用阴影。** 纸书没有投影。层次靠底色差 + 一条细线
- 卡片面和页面底只差约 1.05:1，轮廓主要靠 `--color-line`。这条线不要再调浅
- 圆角四档不要临时加第五档

### 朱砂（`--color-seal`）的使用边界

朱砂管“标记”，不管“结构”：印章、侧栏当前页覆盖块、新词进度填充。结构性元素（章节号、主按钮、区块竖线）走墨绿 `brand`。

这不是审美偏好，是对比度逼出来的：

- 朱砂对页面底 3.78:1、对卡片面 4.31:1
- 够图形元素（3:1）和大号字（3:1）
- **不够 14px 正文的 4.5:1**
- 唯一例外是侧栏选中块，用的是压暗 10% 的 `--color-rail-seal`，压 rail-ink 实测 4.65:1

所以：朱砂只做填充、印章、大号数字，不直接承载小号正文。要当按钮底色得先加深，但加深会和评分“忘了”的砖红撞车。

### 深色书脊里的组件

深底容器会就地重定义 `--color-line` / `--color-ink` / `--color-muted` / `--color-surface-2` 指向 `rail-*`。丢进侧栏的组件自动获得深色适配，**组件里不要写深色分支**。

两条禁令：

1. **深底里不能出现 `--color-brand`**。墨绿对 `#202626` 只有 1.54:1，等于瞎掉
2. **深底里不能直接用朱砂做 14px 文字底**。用 `--color-rail-seal`

焦点环走 `--color-focus`，深色面把它改写成 `rail-ink`。不要直接把焦点色写成 `brand`。

### 字体

- 衬线只用于标题性位置：页面 h1、卡片 headword、章节号、统计大数字
- 正文（释义、例句、翻译、表单、按钮）用系统无衬线。宋体在 18px 屏幕上笔画偏细，盯一天不如黑体耐读
- `--font-serif` 由 `next/font` 注入，后面跟系统衬线兜底

### 不做深色模式

`html { color-scheme: light }` 是必须的：系统偏好深色时，原生 `<select>`、checkbox、滚动条会按深色渲染，落在暖白页上很突兀。深色只存在于侧栏，那是固定版式，不是主题。

### 翻卡动画

`.flip-scene` / `.flip-card` / `.flip-face` 的约束：

- **不要加 `perspective`。** 有透视时近端半张卡会被放大，包围盒超出静止外框，1280 宽下实测超出约 10px，翻转过程会削边。正交投影不会
- 外框 `overflow: hidden` 裁掉没露出的那一面
- 外框高度要动画，且变矮延后半个翻转，否则会削掉还在画面里的那一面
- `prefers-reduced-motion` 下关掉过渡

### 交互与无障碍

- 可点元素用 `<button>`，不用 `<span onClick>`。键盘 Tab 和回车必须能到
- 全站焦点样式在 `:where(...):focus-visible`，用 `outline` 不用 `ring`，避免和现有工具类打架
- 触控目标高度至少 `min-h-9`（36px），窄屏也一样
- 状态不能只靠颜色表达，配文字或形状

## 验证

1. 375 和 1280 两档视口都看
2. 对比度用工具实测，不靠肉眼。正文 4.5:1，图形/大号字 3:1
3. 键盘 Tab 走一遍新控件
4. 深色侧栏里的新元素检查是否用了 `rail-*`
5. Browser 面板收起时页面不 hydrate，先截图激活再测交互
6. 翻卡在 1280 宽下完整转一遍，看边有没有被削
7. 统计数字与库里真实数据对一遍

## 相关 skill

`ielts-study` · `ielts-engineering`
