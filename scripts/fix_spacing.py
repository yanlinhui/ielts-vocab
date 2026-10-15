"""把 OCR 粘连的英文单词重新切开。

**要解决什么**：OCR 在中文标点/字距的影响下会吞掉词间空格，造出
`examinationcreated`、`andthelithospheretogetherform` 这种 token。实测例句里
13.4% 中招，读起来很别扭。

**怎么做**：拿 ECDICT 的全量词形当白名单，把 token 切成「每一片都在白名单
里」的序列，取总分最低的那种切法。

**为什么不能只看「词形合法」**：ECDICT 有 112 万条，里面混了大量生僻碎片，
于是 `Themachinedoesbinarycalculations` 会被切成
`The + machi + nedoes + binary + calculations`（`machi` / `nedoes` 都是合法
词形）。`machi + nedoes` 和 `machine + does` 片数一样，光看词形分不出好坏。

**为什么也不能只看词频**：ECDICT 的 bnc/frq 对**变形词大量缺失**——
`eats`/`begins`/`manners`/`tasks` 都没有词频行，于是
「`eat + slean`」和「`eats + lean`」会打平。

所以判据是三层：

1. **ECDICT 词频排名**（bnc/frq，越小越常用）——真词有排名，碎片没有
2. **ECDICT 自己标的 `[原型]`**——`eats`/`visited`/`begins` 自己没排名，但
   记录里明写了 `[原型] eat` / `[原型] visit` / `[原型] begin`，拿原形的排名
3. **`IRREGULAR` 兜底**——少数词 ECDICT 要么没标原型（`are` / `was`），要么
   标错了（`does` 被标成 `doe` 的复数，其实是 `do`）

每片还有一笔**固定代价**（`PIECE_PENALTY`）。没有它，把词剁成 `st + rang + les`
这种碎片串的总分会比整词还低——碎片多反而便宜，正是过度切碎的来源。

**试过但放弃的两条判据**

- **用规则砍词尾猜原型**（`thes`→`the`、`haves`→`have`、`ofs`→`of`、
  `wass`→`was`、`oaked`→`oak`、`dus`→`du`、`agood`→`ago`）。ECDICT 里塞满了
  缩写和生僻条目，砍一刀就落到超高频短词上，垃圾片段因此拿到几乎免费的代价，
  于是 `haves+oaked` 打赢了 `have+soaked`、`ofs+tarring` 打赢了 `of+starring`。
  换成词典自己标的 `[原型]` 后这类片段被如实判为「无证据」，整类错误消失。
- **「在本书语料里独立出现过」**：听起来很准（真词总在别的句子里被单独写出来），
  实测被污染得厉害。`litho` / `sphere` 的"独立出现"来自词源字段里的构词注解
  `litho(石头)+sphere(球体)`；`allthe` 的 5 次是**别的句子也粘了**，等于拿粘连
  证明粘连。已弃用。

**风险**：真正的生僻词如果不在 ECDICT 里，也会被硬切。所以这个脚本
**默认只出报告不动数据**，必须人工审过 `data/spacing-report.md` 才加 `--apply`。

用法：
    python scripts/fix_spacing.py              # 只出报告
    python scripts/fix_spacing.py --apply      # 改写 words.clean.json + 出替换表
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 注意别用 Path.with_suffix()：文件名是 `...2.4.2`，suffix 会被当成 `.2`，
# with_suffix('.idx') 会拼出 `...2.4.idx`。
STARDICT_DIR = ROOT / "ecdict" / "stardict"
STEM = "stardict-ecdict-2.4.2"
IDX_PATH = STARDICT_DIR / f"{STEM}.idx"
DICT_PATH = STARDICT_DIR / f"{STEM}.dict"
SOURCE = ROOT / "data" / "words.clean.json"
REPORT = ROOT / "data" / "spacing-report.md"
CHANGES = ROOT / "data" / "spacing-changes.json"

# ---- 切词参数 ----
MIN_TOKEN_LEN = 5       # 短于这个长度的 token 一律不碰（`ofa` 这种 3 字母太容易切错）
# 短 token 里混着人名和缩写，切错的代价比长 token 高得多，所以加一条更严的约束：
# 低于这个长度时，**每一片都必须有实据**（有词频 / 原形 / 不规则表），
# 不允许靠「无证据的词典碎片」凑出一个切法。
STRICT_BELOW = 8
MAX_PIECES = 8          # 一段里最多切出几片
MAX_PIECE_LEN = 22      # 单片最长长度，限制 DP 的搜索窗口
INF = 1 << 30           # DP 里的「走不通」
MIN_PIECE_LEN = 2       # 片段最短 2 字母……
SINGLE_OK = {"a", "i"}  # ……除了这两个真正的单词
# 基本只会当词尾、极少独立成词的后缀。用来认「把完整词拆成词干 + 词尾」的错切
# （`plummeted` → `plummet` + `ed`）。
SUFFIX_ONLY = {"ed", "es", "ing"}

# ---- 打分参数 ----
# 基础分按词频排名**连续**取值，不分成几档。分档会制造假平手：
# `dot`(4132) + `he`(11) 和 `do`(18) + `the`(1) 会落进同一档、代价完全相等，
# 而显然后者才是真词。连续取值直接把这两种拉开。
RANK_FACTOR = 1.5       # 基础分 = log10(排名+1) × 这个系数
NO_EVIDENCE = 20.0      # 查不到词频、原型也没有 → 这个基础分，远高于任何真实词
# ECDICT 有几处词频明显是坏的：`is` 被标成 24648（实际是最高频词之一），
# 不修它 `Thereis` / `isnot` 会被切去躲开 `is`、改选冷字。
# 注意：词频数据整体不可靠（见 split_token 末尾的说明），这里只修确知坏掉的。
RANK_FIX = {"is": 9}
PIECE_PENALTY = 400     # 每片固定代价，防止把词剁成碎片串
SCORE_SCALE = 100       # 基础分的权重
# 允许把 token 末尾 1~2 个字母原样留下。OCR 偶尔会多吞一个字母
# （`aggressivenessn`），DP 又必须覆盖全部字符，只能凑出
# `aggressive + nes + sn`。留个尾巴比凑碎片更接近真相。
# 代价卡在「比任何真实词都贵、比无证据碎片便宜」之间，所以只有真凑不出来时才走这条。
LEFTOVER_COST = 1500
MAX_LEFTOVER = 2
# 词性标注。书里「派生」栏排的是 `usually adv.` / `estimate v.`，OCR 把词和
# 词性粘成了一个 token。这不能靠通用切分解决——`usuallyadv` 会被切成
# `usually + a + dv`。所以单独认这条：token 末尾是词性缩写、且剥掉之后
# 剩下的部分本身是个词典词，就直接按「词 + 词性」切开。
# 长的排前面，免得 `adv` 被 `v` 抢先。**不能收 `art`**——它是真词，
# 会把 `andheart` 切成 `andhe + art`（实测踩到过）。
POS_TAGS = (
    "abbr", "pron", "prep", "conj", "adj", "adv", "aux",
    "num", "int", "vt", "vi", "pl", "n", "v",
)
MIN_POS_STEM = 3        # 词性前面的词至少这么长，避免误伤

# 不规则变化兜底。只给 ECDICT 自己标错或没标的词用：
#   are  —— 记录里根本没有 `[原型]` 行
#   does —— 标的是 `[原型] does 是 doe 的复数`（那是"母鹿"，不是动词 do）
# 原型的优先级是「ECDICT 的 [原型] 行 > 本表」，但本表命中的词直接覆盖 ECDICT。
IRREGULAR = {
    "am": "be", "is": "be", "are": "be", "was": "be", "were": "be", "been": "be",
    "has": "have", "had": "have",
    "does": "do", "did": "do", "done": "do",
    "goes": "go", "went": "go", "gone": "go",
    "said": "say", "made": "make", "took": "take", "taken": "take",
    "came": "come", "saw": "see", "seen": "see", "knew": "know", "known": "know",
    "got": "get", "gave": "give", "given": "give", "found": "find",
    "thought": "think", "told": "tell", "became": "become",
    "felt": "feel", "brought": "bring", "began": "begin", "begun": "begin",
    "kept": "keep", "held": "hold", "wrote": "write", "written": "write",
    "stood": "stand", "heard": "hear", "meant": "mean", "met": "meet",
    "ran": "run", "paid": "pay", "sat": "sit", "spoke": "speak", "spoken": "speak",
    "lay": "lie", "led": "lead", "grew": "grow", "grown": "grow", "lost": "lose",
    "fell": "fall", "built": "build", "understood": "understand",
    "drew": "draw", "drawn": "draw", "broke": "break", "broken": "break",
    "spent": "spend", "rose": "rise", "risen": "rise", "drove": "drive",
    "driven": "drive", "bought": "buy", "wore": "wear", "chose": "choose",
    "chosen": "choose", "ate": "eat", "eaten": "eat", "sold": "sell",
    "sang": "sing", "sung": "sing", "slept": "sleep", "taught": "teach",
    "fought": "fight", "flew": "fly", "flown": "fly", "threw": "throw",
    "thrown": "throw", "caught": "catch", "hid": "hide", "hidden": "hide",
    "hung": "hang", "shot": "shoot", "struck": "strike", "sought": "seek",
    "withdrew": "withdraw", "withdrawn": "withdraw", "arose": "arise",
    "arisen": "arise", "bore": "bear", "borne": "bear", "swore": "swear",
    "sworn": "swear", "tore": "tear", "torn": "tear", "woke": "wake",
    "woken": "wake", "dealt": "deal", "froze": "freeze", "frozen": "freeze",
    "wove": "weave", "woven": "weave", "wound": "wind", "lain": "lie",
}

RUN_RE = re.compile(r"[A-Za-z]+")
# ECDICT 记录末行的括号。里面可能是 `标签 BNC/FRQ`、只有 `BNC/FRQ`、
# 或者只有标签。见 parse_freq 的说明。
RECORD_TAIL_RE = re.compile(r"^\((?P<rest>[^)]*)\)$")
# 变形词的记录里会有这么一行，词典自己告诉我们原形是谁：
#     [原型] soaked 是 soak 的过去式和过去分词
#     [原型] be
PROTO_RE = re.compile(r"^\[原型\]\s*(?P<body>.+)$")
# 释义行以标准词性缩写开头，说明这是一条正经词条。用来认「在词典里、有正经
# 释义、却恰好没词频」的真词——`hydrosphere` 就是（`n. 水圈, 水界, 水气`，
# bnc/frq 全空），缺了这条判据它会被当成垃圾条目切成 `hydro + sphere`。
# **不收 `abbr.`**：`tsee` / `thes` / `ofs` / `wass` 这些 OCR 碎片在 ECDICT
# 里全是缩写条目，收进来会把真粘连整批放过。
DICT_POS_RE = re.compile(r"^(?:n|a|v|vt|vi|adj|adv|prep|conj|pron|num|int|art|aux)\.\s")
# 「像样的词条」也未必是真词——ECDICT 从语料里抓词时把粘连一起收进去了：
#     hadto  v. 必须          （had to）
#     onthe  n. 在            （on the）
#     outof  n. 在…外         （out of）
#     abetter n. 唆使者       （a better）
# 光看释义分不出它和 hydrosphere（`n. 水圈`，真词）的区别。真正的区别在
# **切出来是什么**：上面这些切成两片，每片都是超高频词；而 hydrosphere 切
# 成 hydro(23990) + sphere(3863)，有一片很冷。
# 所以给「像样的词条」再加一道门槛：只有切出来的每一片都够常见，才认这次
# 切分。阈值的标度是 base（log10(rank+1)*1.5），5.5 约对应 rank 3500。
COMMON_BASE = 5.5

# 需要修的字段。全是英文，中文释义/文化背景不碰。
TEXT_FIELDS = ("collocation", "etymology", "derived")


def iter_index():
    """流式扫 .idx，逐条产出 (词, 偏移, 长度)。

    .idx 是「词\\0 + 4 字节大端偏移 + 4 字节大端长度」的定长记录流，
    按字节序排序。同 check_with_ecdict.py 的解析。
    """
    raw = IDX_PATH.read_bytes()
    i, n = 0, len(raw)
    while i < n:
        j = raw.find(b"\x00", i)
        if j < 0:
            break
        word = raw[i:j]
        k = j + 1
        if k + 8 > n:
            break
        yield word, int.from_bytes(raw[k : k + 4], "big"), int.from_bytes(
            raw[k + 4 : k + 8], "big"
        )
        i = k + 8


def build_wordset() -> set[str]:
    """第一遍：全部纯字母词形（小写）。"""
    words: set[str] = set()
    for word, _, _ in iter_index():
        try:
            w = word.decode("ascii")
        except UnicodeDecodeError:
            continue
        if w.isalpha():
            words.add(w.lower())
    return words


def parse_freq(text: str) -> tuple[int | None, int | None]:
    """从一条 ECDICT 记录里抠出 (bnc, frq)。

    **末行的括号有四种形态**，只认「标签 数字/数字」那种会漏掉一大半极常用词
    （`is` / `was` / `held` / `fully` 全都会查不到词频，实测过）：

        (中高 1/1)          有标签
        (-/24648)           没标签，frq 有位、bnc 是横杠
        (33991/-)           bnc 有位、frq 是横杠
        (28648/21805)       完全没标签
        (高)                只有标签、**确实没有词频**（`does` / `are` 就是这样）

    返回 (None, None) 的最后一种是真的没数据，不是解析失败。
    """
    for ln in text.split("\n"):
        m = RECORD_TAIL_RE.match(ln.strip())
        if not m:
            continue
        rest = m.group("rest")
        if not any(c.isdigit() for c in rest):
            continue  # 只有标签，没有词频
        parts = rest.split()
        tail = parts[-1]  # 有标签时词频在最后一段，没标签时它就是唯一一段
        if "/" not in tail and not tail.isdigit():
            continue
        bnc_s, _, frq_s = tail.partition("/")
        bnc = int(bnc_s) if bnc_s.isdigit() else None
        frq = int(frq_s) if frq_s.isdigit() else None
        return bnc, frq
    return None, None


def parse_proto(text: str) -> str | None:
    """抠出 `[原型]` 那一行指的词。

    词典自己标了原形，比砍词尾可靠得多——`thes` / `ofs` / `wass` / `agood`
    这几种碎片里一个都没标。见过的写法：

        [原型] soaked 是 soak 的过去式和过去分词   → soak
        [原型] is 是 be 的第三人称单数             → be
        [原型] be                                  → be
    """
    for ln in text.split("\n"):
        m = PROTO_RE.match(ln.strip())
        if not m:
            continue
        body = m.group("body")
        if " 是 " in body:
            body = body.split(" 是 ", 1)[1].split("的", 1)[0]
        body = body.strip().lower()
        if body.isalpha():
            return body
    return None


def fetch_records(wanted: set[str]) -> dict[str, str]:
    """取这些词的 ECDICT 原始记录文本（命中才 seek+read）。"""
    offsets: dict[str, tuple[int, int]] = {}
    for word, off, size in iter_index():
        try:
            w = word.decode("ascii").lower()
        except UnicodeDecodeError:
            continue
        if w in wanted and w not in offsets:
            offsets[w] = (off, size)

    out: dict[str, str] = {}
    with DICT_PATH.open("rb") as fh:
        for w, (off, size) in offsets.items():
            fh.seek(off)
            out[w] = fh.read(size).decode("utf-8", errors="replace")
    return out


def own_rank(rec: tuple[int | None, int | None]) -> int | None:
    """一条记录自己的排名：bnc / frq 里取更好的那个。"""
    ranks = [r for r in rec if r is not None]
    return min(ranks) if ranks else None


def has_dict_pos(text: str) -> bool:
    """记录里有没有以标准词性缩写开头的释义行。见 DICT_POS_RE。"""
    for ln in text.split("\n"):
        if DICT_POS_RE.match(ln.strip()):
            return True
    return False


def build_evidence(
    candidates: set[str],
) -> tuple[dict[str, int | None], dict[str, str], set[str]]:
    """给候选片段取「自己的排名」「ECDICT 标的原型」「像样的词条」三样。

    要两轮：第一轮拿到片段的原型，第二轮去取**这些原型**的记录——原形自己
    多半不在候选集里（`soaked` 的原形 `soak` 未必是任何 token 的片段），
    不补取就拿不到排名，第二层判据就白设了。
    """
    rank: dict[str, int | None] = {}
    proto: dict[str, str] = {}
    posdict: set[str] = set()
    for w, text in fetch_records(candidates).items():
        rank[w] = own_rank(parse_freq(text))
        if has_dict_pos(text):
            posdict.add(w)
        p = parse_proto(text)
        if p:
            proto[w] = p

    # 补取原型的词频。两类原型都要：词典标了 `[原型]` 的那些，和不规则表
    # 兜底的（`have` / `be` / `do`）——后者未必是任何 token 的子串，
    # 不补取的话 `had` / `was` 这类切片会取不到词频、被当成碎片。
    missing = {p for p in proto.values() if p not in rank}
    missing |= {v for v in IRREGULAR.values() if v not in rank}
    if missing:
        for w, text in fetch_records(missing).items():
            rank[w] = own_rank(parse_freq(text))
    return rank, proto, posdict



class Scorer:
    """按三层判据给每一片打分。见模块开头。"""

    def __init__(
        self,
        rank: dict[str, int | None],
        proto: dict[str, str],
        posdict: set[str] | None = None,
    ):
        self.rank = rank
        self.proto = proto
        self.posdict = posdict or set()

    def is_dict_entry(self, w: str) -> bool:
        """ECDICT 里有没有一条正经释义（标准词性标开头）。

        和 `evidence` 分开：这条只说「是个真词条」，给不出排名，所以不参与
        DP 打分，只用来挡「整词本来就是真词、不该被切」的误伤。
        """
        return w in self.posdict

    def evidence(self, w: str) -> tuple[str, int | None, str]:
        """这一片的依据，返回 (来源, 排名, 展示文本)。来源取值见下。

        顺序固定为「自己 > 不规则表 > 词典标的原型」，越靠前越可信。
        """
        if w in POS_TAGS:
            return "pos", None, "词性"

        r = RANK_FIX.get(w)
        if r is None:
            r = self.rank.get(w)
        if r is not None:
            return "own", r, f"词频{r}"

        irr = IRREGULAR.get(w)
        if irr is not None:
            r = self.rank.get(irr)
            if r is not None:
                return "irregular", r, f"不规则→{irr}({r})"

        p = self.proto.get(w)
        if p is not None:
            r = self.rank.get(p)
            if r is not None:
                return "proto", r, f"原型→{p}({r})"

        return "none", None, "**无证据**"

    def base(self, w: str) -> float:
        """0 附近最像真词，NO_EVIDENCE 最像碎片。"""
        _, r, _ = self.evidence(w)
        if r is None:
            return NO_EVIDENCE
        return min(NO_EVIDENCE, math.log10(r + 1) * RANK_FACTOR)

    def cost(self, piece: str) -> int:
        return PIECE_PENALTY + int(self.base(piece) * SCORE_SCALE) - len(piece)


def collect_texts(raw: dict) -> list[str]:
    """词表里所有需要检查的英文串。"""
    texts: list[str] = []
    for ch in raw["chapters"]:
        for w in ch["words"]:
            for f in TEXT_FIELDS:
                if w.get(f):
                    texts.append(w[f])
            for ex in w.get("examples", []) or []:
                if ex.get("en"):
                    texts.append(ex["en"])
    return texts


def splittable_tokens(texts: list[str]) -> set[str]:
    """挑出所有长度够长的 token。

    **不能**只看「在不在词典里」就放过：ECDICT 那 112 万条字母词形里混着
    大量人名 / 缩写 / OCR 垃圾（`ofspring`、`himfor`、`achair` 全在里面），
    按「在词典里 = 真词」过滤会把整批真实粘连当没看见。
    真正的判据放在 `split_token`：在词典里**且有实据**才算真词、才不碰。
    """
    toks: set[str] = set()
    for s in texts:
        for m in RUN_RE.finditer(s):
            tok = m.group(0)
            if len(tok) < MIN_TOKEN_LEN:
                continue
            toks.add(tok)
    return toks


def collect_candidates(tokens: set[str], words: set[str]) -> set[str]:
    """这些 token 的所有可能片段（只收 ECDICT 里真有的词形）。

    单字母也要收：`SINGLE_OK` 里的 a / i 是合法片段，漏掉它们会让 `I`
    取不到词频、被当成碎片，于是 `Iwill` 反而比 `I + will` 便宜。
    """
    cands: set[str] = set()
    for tok in tokens:
        low = tok.lower()
        n = len(low)
        for i in range(n):
            for j in range(i + 1, min(n, i + MAX_PIECE_LEN) + 1):
                p = low[i:j]
                if len(p) < MIN_PIECE_LEN and p not in SINGLE_OK:
                    continue
                if p in words:
                    cands.add(p)
    return cands


def _dp(
    low: str, words: set[str], scorer: Scorer, strict: bool = False
) -> tuple[list[int], list[int]]:
    """对 low 跑一遍切分 DP，返回 (best, back)。

    `best[k]` = 切完前 k 个字母的最低总代价，`back[k]` = 最后一片的起点。
    `strict=True` 时只允许有实据的片段（见 STRICT_BELOW）。
    """
    n = len(low)
    best = [INF] * (n + 1)
    back = [-1] * (n + 1)
    best[0] = 0

    for i in range(n):
        if best[i] >= INF:
            continue
        for j in range(i + 1, min(n, i + MAX_PIECE_LEN) + 1):
            piece = low[i:j]
            if len(piece) < MIN_PIECE_LEN and piece not in SINGLE_OK:
                continue
            if piece not in words:
                continue
            if strict and scorer.evidence(piece)[0] == "none":
                continue
            cand = best[i] + scorer.cost(piece)
            # 平分时**优先让靠前的片段更长**（取更大的回溯点）——
            # `based + on` 和 `base + don` 这种同分的情况只能靠它分出来。
            if cand < best[j] or (cand == best[j] and i > back[j]):
                best[j] = cand
                back[j] = i
    return best, back


def _rebuild(tok: str, back: list[int], end: int, base: int = 0) -> list[str]:
    """按 back 指针还原 [base, base+end) 这一段的切分。"""
    pieces: list[str] = []
    k = end
    while k > 0:
        i = back[k]
        if i < 0:
            return []
        pieces.append(tok[base + i : base + k])
        k = i
    pieces.reverse()
    return pieces


def split_token(
    tok: str, words: set[str], scorer: Scorer, pos_tokens: set[str] | None = None
) -> list[str] | None:
    """把一个 token 切成若干词典词。切不动就返回 None（原样保留）。

    走词性标注那条路时会把 token 记进 `pos_tokens`，好让报告单独列出来——
    这类切分的依据是「词性缩写 + 剩下的部分本身是词典词」，比词频判据硬，
    不该混进「无证据」警告里。
    """
    low = tok.lower()
    n = len(low)
    if n < MIN_TOKEN_LEN:
        return None
    # 在词典里**且有实据**（词频 / 原形 / 不规则表）才算真词，整词原样放过。
    # 只有词形、没有任何实据的照样进 DP：里面既有垃圾词条（`ofspring`、
    # `tsee`、`achair`），也有 ECDICT 从语料里误收的粘连（`hadto`、`onthe`），
    # 两者只能靠「切出来是不是常见词」区分，见函数末尾。
    if low in words and scorer.evidence(low)[0] != "none":
        return None

    # 一、词性标注粘连（`usuallyadv.` / `estimatev.`）
    for tag in POS_TAGS:
        stem = low[: -len(tag)]
        if not low.endswith(tag) or len(stem) < MIN_POS_STEM:
            continue
        if stem not in words:
            continue
        # 单字母词性标（`n` / `v`）最容易被垃圾词条骗到——`tseen` 会被读成
        # 「`tsee` + n」。词干又短又没实据的一律不认。
        if len(stem) < 5 and scorer.evidence(stem)[0] == "none":
            continue
        if pos_tokens is not None:
            pos_tokens.add(tok)
        return [tok[: len(stem)], tok[len(stem) :]]

    # 首字母大写的大半是专有名词（`Bilbo` / `Smith`），切错代价远高于切对，
    # 一律走严格模式：每一片都得有实据。
    best, back = _dp(low, words, scorer, strict=n < STRICT_BELOW or tok[0].isupper())
    if best[n] >= INF:
        return None

    plan = (best[n], _rebuild(tok, back, n))

    # 二、末尾 1~2 个字母原样留下（OCR 多吞了一个字母：`aggressivenessn`）
    for k in range(n - MAX_LEFTOVER, n):
        if k < 1 or best[k] >= INF:
            continue
        cost = best[k] + LEFTOVER_COST
        if cost < plan[0]:
            plan = (cost, _rebuild(tok, back, k) + [tok[k:]])

    # 三、开头 1~2 个字母原样留下（`'s` / `'ll` 的撇号被 OCR 吞了：`sgoodnewsfor`）
    for h in range(1, MAX_LEFTOVER + 1):
        rest = low[h:]
        if not rest:
            break
        b2, back2 = _dp(rest, words, scorer, strict=n < STRICT_BELOW)
        if b2[len(rest)] >= INF:
            continue
        cost = LEFTOVER_COST + b2[len(rest)]
        if cost < plan[0]:
            plan = (cost, [tok[:h]] + _rebuild(tok, back2, len(rest), base=h))

    pieces = plan[1]
    if len(pieces) < 2 or len(pieces) > MAX_PIECES:
        return None
    # 拆成「词干 + 词尾」的两片切分，只有 token 本身不在词典里时才可信。
    # 词形已经在词典里（`plummeted`、`mosquitoes`——ECDICT 收了词形却没配
    # 词频），末片又正好是个纯词尾，那就是把一个完整的词切坏了。
    #
    # 这里刻意**不用词频高低**来判：ECDICT 词频数据本身很烂（`is` 标成
    # 24648、`was` 41040、`links` 40605、`are`/`has` 干脆没有），
    # 拿它当「常用 / 冷僻」的分界线会误伤一大片正确切分。
    if low in words and len(pieces) == 2 and pieces[-1].lower() in SUFFIX_ONLY:
        return None
    # 「在词典里、有像样的释义、但没词频」的词条，只有切出来的每一片都够
    # 常见才认（见 COMMON_BASE）：`hadto` → `had + to` 两片都是超高频，
    # 切；`hydrosphere` → `hydro + sphere` 里 `hydro` 很冷，说明它本来
    # 就是个整词，不切。
    if low in words and scorer.is_dict_entry(low):
        if not all(scorer.base(p) < COMMON_BASE for p in pieces):
            return None
    return pieces


def fix_text(
    s: str,
    words: set[str],
    scorer: Scorer,
    found: dict[str, list[str]],
    pos_tokens: set[str],
) -> str:
    """把一段文本里所有该切的 token 切掉。"""
    if not s:
        return s
    out: list[str] = []
    pos = 0
    for m in RUN_RE.finditer(s):
        tok = m.group(0)
        out.append(s[pos:m.start()])
        # 缩写（`doesn't` / `couldn't` / `weren't`）：RUN_RE 只吃字母，切到的
        # 是 `doesn`，后面还跟着 `'t`。拆开就成了 `does n't`，不如整块留着。
        if s[m.end() : m.end() + 2] in ("'t", "’t"):
            out.append(tok)
            pos = m.end()
            continue
        pieces = split_token(tok, words, scorer, pos_tokens)
        if pieces is None:
            out.append(tok)
        else:
            # 片段前后如果紧挨着字母或数字，补一个空格。
            # 处理 `positionis40degrees` 这种连数字一起粘的：
            # 切完 `is` 后面是 `4`，得补空格，否则还是 `is40degrees`。
            prev_ch = s[m.start() - 1] if m.start() > 0 else ""
            next_ch = s[m.end()] if m.end() < len(s) else ""
            pad_l = " " if prev_ch.isalnum() else ""
            pad_r = " " if next_ch.isalnum() else ""
            out.append(f"{pad_l}{' '.join(pieces)}{pad_r}")
            found.setdefault(tok, pieces)
        pos = m.end()
    out.append(s[pos:])
    return "".join(out)


def probe(words: list[str]) -> None:
    """打印这些词在 ECDICT 里的原始记录和解析结果。排查词频缺口用。"""
    wanted = {w.lower() for w in words}
    recs = fetch_records(wanted)
    for w in words:
        key = w.lower()
        if key not in recs:
            print(f"--- {w}: 不在 ECDICT 索引里")
            continue
        text = recs[key]
        print(f"--- {w}")
        for ln in text.split("\n"):
            print(f"    |{ln}")
        print(f"    词频 = {own_rank(parse_freq(text))}   原型 = {parse_proto(text)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="改写 words.clean.json")
    ap.add_argument("--probe", help="逗号分隔，打印这些词的 ECDICT 原始记录后退出")
    args = ap.parse_args()

    if not IDX_PATH.exists() or not DICT_PATH.exists():
        sys.exit(f"找不到 {IDX_PATH.name}。先跑 check_with_ecdict.py 解压 StarDict。")

    if args.probe:
        probe([w.strip() for w in args.probe.split(",") if w.strip()])
        return

    print("第一遍：读 ECDICT 词形 ...")
    words = build_wordset()
    print(f"  {len(words):,} 个纯字母词形")

    raw = json.loads(SOURCE.read_text(encoding="utf-8"))
    texts = collect_texts(raw)
    tokens = splittable_tokens(texts)
    print(f"  {len(texts):,} 段英文，其中 {len(tokens):,} 个 token 该切")

    candidates = collect_candidates(tokens, words)
    print(f"第二遍：给 {len(candidates):,} 个候选片段取词频和原型 ...")
    rank, proto, posdict = build_evidence(candidates)
    scorer = Scorer(rank, proto, posdict)

    found: dict[str, list[str]] = {}
    pos_tokens: set[str] = set()
    replacements: dict[str, str] = {}
    example_changes: list[tuple[str, str]] = []
    hits = 0

    def walk(s: str) -> str:
        nonlocal hits
        new = fix_text(s, words, scorer, found, pos_tokens)
        if new != s:
            hits += 1
            replacements[s] = new
        return new

    for ch in raw["chapters"]:
        for w in ch["words"]:
            for f in TEXT_FIELDS:
                if w.get(f):
                    w[f] = walk(w[f])
            for ex in w.get("examples", []) or []:
                if ex.get("en"):
                    before = ex["en"]
                    ex["en"] = walk(before)
                    if ex["en"] != before:
                        example_changes.append((before, ex["en"]))

    # ---- 报告 ----
    def note(piece: str) -> str:
        return scorer.evidence(piece.lower())[2]

    by_len = sorted(found.items(), key=lambda kv: (-len(kv[0]), kv[0]))
    risky_rows = [
        kv
        for kv in by_len
        if kv[0] not in pos_tokens and any(note(p) == "**无证据**" for p in kv[1])
    ]
    pos_rows = [kv for kv in by_len if kv[0] in pos_tokens]
    kinds: dict[str, int] = {}
    for _, pieces in found.items():
        for p in pieces:
            k = scorer.evidence(p.lower())[0]
            kinds[k] = kinds.get(k, 0) + 1

    def table(rows: list[tuple[str, list[str]]]) -> list[str]:
        out = ["| 原 token | 长度 | 切分 | 片数 | 各片依据 |", "|---|---|---|---|---|"]
        for tok, pieces in rows:
            detail = "、".join(f"{p}:{note(p)}" for p in pieces)
            out.append(
                f"| `{tok}` | {len(tok)} | `{' + '.join(pieces)}` | {len(pieces)} | {detail} |"
            )
        return out

    lines = [
        "# OCR 粘连重切报告",
        "",
        "> 由 `scripts/fix_spacing.py` 生成。白名单 = ECDICT 全量词形，"
        "切分判据 = 词频排名 / `[原型]` / 不规则表（见脚本开头）。",
        "",
        f"- 词形白名单：{len(words):,} 条",
        f"- 改动了 **{hits}** 处文本（其中例句 **{len(example_changes)}** 条）",
        f"- 涉及 **{len(found)}** 个不同的粘连 token",
        f"- 片段依据分布：词频 {kinds.get('own', 0)}、不规则表 {kinds.get('irregular', 0)}、"
        f"原型 {kinds.get('proto', 0)}、词性 {kinds.get('pos', 0)}、"
        f"**无证据 {kinds.get('none', 0)}**",
        "",
        f"## 需要人工看的 {len(risky_rows)} 个 token",
        "",
        "> 只要有一片落进「无证据」就列在这里。无证据 = 那一片在 ECDICT 里"
        "既没有词频、也没有 `[原型]`，很可能是被硬切开的。",
        "",
    ]
    lines += table(risky_rows)
    lines += [
        "",
        f"## 词性标注粘连（{len(pos_rows)} 个，依据比词频硬，通常不用看）",
        "",
        "> 书里「派生」栏排的是 `usually adv.` / `estimate v.`，OCR 把词和词性"
        "缩写粘在一起。这一类的依据是「词性缩写 + 剩下的部分本身是词典词」，"
        "比词频判据硬，所以不进上面那张表。",
        "",
    ]
    lines += table(pos_rows)
    lines += [
        "",
        "## 全部切分决定（按 token 长度降序）",
        "",
        "> 「依据」列：`词频N` = ECDICT 自己的排名（越小越常用）；"
        "`原型→X(N)` = ECDICT 标的原形；`不规则→X(N)` = 脚本兜底表；"
        "`词性` = 词性标注；**`无证据` 是危险信号。**",
        "",
    ]
    lines += table(by_len)

    # 抽样要**铺满全书**——只取前 80 条的话全落在第 1 章，审不出后面的问题
    SAMPLE = 80
    step = max(1, len(example_changes) // SAMPLE)
    sample = example_changes[::step][:SAMPLE]
    lines += ["", f"## 改动后的句子（全书均匀抽样 {len(sample)} 条）", ""]
    for before, after in sample:
        lines.append(f"- `{before}`")
        lines.append(f"  → `{after}`")

    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nhits={hits} distinct_tokens={len(found)} examples_changed={len(example_changes)}")
    print(f"片段依据：own={kinds.get('own', 0)} irregular={kinds.get('irregular', 0)} "
          f"proto={kinds.get('proto', 0)} pos={kinds.get('pos', 0)} "
          f"无证据={kinds.get('none', 0)}")
    print(f"需人工看 = {len(risky_rows)} 个 token；词性粘连 = {len(pos_rows)} 个")
    print(f"报告：{REPORT.relative_to(ROOT)}")

    if args.apply:
        SOURCE.write_text(
            json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        pairs = [{"old": o, "new": nw} for o, nw in sorted(replacements.items())]
        CHANGES.write_text(
            json.dumps(pairs, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        print(f"已改写 {SOURCE.relative_to(ROOT)}")
        print(f"替换表：{CHANGES.relative_to(ROOT)}（{len(pairs)} 对）")
    else:
        print("(dry-run，源文件没动)")


if __name__ == "__main__":
    main()
