# 项目 Skills

给 Claude Code 用的项目技能包（Agent Skills）。按**功能板块**划分，一个大模块一份，不再按函数拆碎。每个子目录一个技能，入口是 `SKILL.md`，里面的 `description` 决定什么时候会被自动加载。

## 怎么启用

Claude Code 只会从 `.claude/skills/` 发现项目技能。把需要的目录复制过去：

```bash
mkdir -p .claude/skills
cp -r skills/ielts-* .claude/skills/
```

然后新开一个会话（技能在会话启动时加载）。只想启用一部分，就单独复制对应的目录。

`.claude/settings.local.json` 已被 gitignore；是否把 `.claude/skills/` 提交进仓库由你决定。仓库是公开的，这些技能里没有任何密码或书中原文，提交是安全的。

## 六个板块

| 技能 | 覆盖什么 | 什么时候会用到 |
|---|---|---|
| [ielts-study](ielts-study/SKILL.md) | 背词主链路：四种队列、每日配额、FSRS 排期、发音与快捷键 | 改“今天学哪些词、什么顺序”、间隔、朗读；排查队列异常 |
| [ielts-spelling](ielts-spelling/SKILL.md) | 拼写与听写：出题、比对算法、错误位置、焦点、章节范围 | 改拼写判对错、提示文案、听写模式 |
| [ielts-reading](ielts-reading/SKILL.md) | 拓展阅读：短文格式、`{{}}` 标记、覆盖率、灌库、自测显隐 | 写短文、跑校验、排查“脚本说覆盖了页面不显示” |
| [ielts-word-data](ielts-word-data/SKILL.md) | 词库数据：PDF/OCR 流水线、修正脚本、Prisma 建模、迁移、灌库、导入 | 重新生成词表、改 schema、灌库 |
| [ielts-stats-ui](ielts-stats-ui/SKILL.md) | 统计口径与视觉呈现：热力图、每日一句、掌握度、令牌、对比度、翻卡 | 改统计页、图表、颜色字体、深色侧栏 |
| [ielts-engineering](ielts-engineering/SKILL.md) | 工程底座：代码地图、命令、测试、登录部署、文档维护 | 进入仓库第一站；跑测试、改密码、发版、审计文档 |

## 它们怎么配合

```
ielts-engineering                 ← 先读这一个：怎么跑、怎么测、怎么发
   ├── 学习链路
   │     ielts-study → ielts-spelling
   ├── 内容链路
   │     ielts-word-data → ielts-reading
   └── 呈现
         ielts-stats-ui
```

数据流向：`ielts-word-data` 产出的词库喂给 `ielts-study` 和 `ielts-reading`；`ielts-study` 产生的作答流水喂给 `ielts-stats-ui` 的统计。

## 设计原则

- **按板块，不按函数。** 一个功能从数据到界面写在一份里，改的时候不用来回翻五个文件
- **只写“读代码看不出来”的东西。** 代码里已写清楚的事实不重复；重点是不可见的约束、踩过的坑、为什么这样选
- **每条约束都给出后果。** 不写“必须串行”，写“两个文件同时 resetDb 会互删 fixture，症状是单独跑全过、一起跑随机红”
- **指向代码和文档，不复制实现。** 具体行号会漂，函数名和文件路径更稳
- **不写密码、密钥、书中原文。** 仓库是公开的

## 维护

技能和代码一样会过期。改动涉及某个板块时，顺手检查对应 `SKILL.md`：

- 函数改名了？更新引用
- 新踩了一个坑？补进对应小节
- 某条约束被推翻了？删掉它，并在 `docs/` 里记原因

技能里的数字（72 条测试、86 篇短文、3580 词）也要和 `docs/` 保持一致。
