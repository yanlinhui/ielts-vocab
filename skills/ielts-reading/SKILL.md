---
name: ielts-reading
description: 拓展阅读模块全貌。新增或改写短文、处理 {{headword}} 标记、跑覆盖率校验、调阅读器自测显隐，或排查“脚本说覆盖了页面却不显示”“点词不显示中文”“再点收不回去”“释义显示成 -2”时使用。覆盖两处必须一致的正则、按章而非按篇的覆盖判据、白名单规则、shortMeaning 取行和阅读器的客户端状态。
---

# 拓展阅读（`content/passages/` + `passages.ts` + `PassageReader.tsx`）

## 内容从哪来

- 源文件：`content/passages/chapter-NN.md`，在仓库里，**原创内容，不受书中版权约束**
- 一篇的格式：

```markdown
# 篇名

正文……该章的词用 {{headword}} 包住。

---

# 下一篇
```

- `---` 单独一行分篇，`# ` 开头那行是篇名
- 灌库脚本：`scripts/seed_passages.ts`（幂等：每章先删光再重插）
- 校验脚本：`scripts/check_passages.ts`

## 标记语法

```regex
\{\{([a-zA-Z][a-zA-Z-]*(?: [a-zA-Z][a-zA-Z-]*)*)\}\}
```

- 允许连字符：`{{up-to-date}}`
- 允许词内空格：`{{carbon dioxide}}`。全书 13 个词条本身带空格，不认空格它们一个都标不上
- 不含数字、标点

**这个正则有两份，必须逐字一致：**

- `src/lib/passages.ts` — 渲染用
- `scripts/lib/passage-files.ts` — 校验和灌库用

改一处忘另一处，就会出现“脚本说覆盖了、页面显示不出来”。改语法时两处一起改。

## 覆盖判据按章，不按篇

一章可以拆成多篇，分篇之间怎么分配词是写作自由；硬要求是**这一章的所有词被某篇标到**。

- `check_passages.ts` 按 `chapterNo` 汇总
- 比对走小写：正文把 `GAS STATION` 写成 `gas station` 是自然的，报缺词时给回原样
- 有不覆盖或标了别章的词，脚本非零退出

### 白名单必须有理由

`KNOWN_MISSING` 是“人判断后决定不覆盖”的落点。每一条都要写明依据，不能每次跑脚本临时决定。现有条目都是 OCR/词典脏数据（如第 3 章 `the Beast` 释义是“阿特拉斯火箭”）。

新增白名单时在表的注释里写清为什么这个词不值得为它硬造句子。**不要为了脚本变绿而加。**

## 渲染链路

`/reading` 不带 `unit` 时落在**第一个有短文的章**；只列有短文的章，避免点进去撞空态。这一页不读也不写 `UserWordProgress`，不吃配额，是全站唯一和进度无关的学习页。

1. 服务端把 `Passage.body` 交给 `toParagraphs(body, meaningOf)`，切成 `Block[]`（段落 × token）
2. `meaningOf` 负责把 headword 查成中文；查不到给空串，词块照常渲染，只是点开没东西
3. 中文取 ECDICT 的 `meaningCn`，**不取 `bookMeaning`**。后者是书中原话、受版权保护
4. `shortMeaning()` 取**第一个含中文的行**，不是第一行。ECDICT 少数词组首行是占位编号（`carbon dioxide` 是 `-2`），按第一行会显示 `-2`
5. 客户端 `PassageReader` 只拿现成 token 做交互，不认 `{{}}` 语法

## 自测显隐的约定

- 默认进“自测”，中文全藏
- 点词显示中文，**再点一下收回**
- 状态按**词面**存（`Set<string>`），不按位置：同一个词在一篇里出现几次，点开一处就全露出来
- 收回也只收这个词，其他已展开的不受影响
- 实现方向靠 `Set.delete()` 的返回值判断：

```ts
if (!next.delete(word)) next.add(word);
```

- 用 `<button>` 而不是 `<span onClick>`：键盘 Tab 要能走到、回车要能看中文（PRD 第 3 节的无障碍承诺）
- 模式按钮和提示文案必须同步：自测时提示“点词看中文，再点一下收回去”

## 新增或改写短文后的流程

```bash
npm run check:passages        # 先确认覆盖
npm run db:seed:passages      # 再灌库
npm run dev                   # 最后在浏览器里读一遍
```

浏览器里至少检查：

1. 每篇标题、分段正常
2. 抽 3 个词点开，中文正确，不是 `-2` 这类占位
3. 同一个词出现两次，点一次两处都展开
4. 再点一次收回
5. 切到“对照阅读”，中文直接显示
6. Tab 能停在词上，回车能展开

## 与其他模块的边界

- 词表变动会打破短文覆盖。改完 `data/` 或重灌词库后必须重跑 `check:passages`，见 `ielts-word-data`
- `body` 里的标记由服务端解析，客户端不解析；新增交互不要往 `PassageReader` 里塞正则
- 短文是原创内容，和书中例句不同，可以进仓库；但不要把书中释义抄进短文

## 相关 skill

`ielts-word-data` · `ielts-stats-ui` · `ielts-engineering`
