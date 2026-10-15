"""把 OCR 出来的页面文本，解析成结构化的词表。

输入：data/ocr/*.json（含文字、坐标、置信度）
输出：data/words.raw.json

**怎么认出词目行**（试错两轮后的结论，别退回按框高判断）

第一版用「框高 > 本页中位数 × 1.2」，实测不可靠：
  - `oxygen` 的单词块 51.2、音标块 55.7，音标反而更高 → 单词被漏掉
  - `core` 48.2 / `latitude` 49.7 / `disaster` 45.2 都低于阈值 → 整条词漏掉
  - 音标里全是升部、降部符号，框天然偏高，这个信号本身就不稳

改用的判据，三条叠加：

1. **按「行」看，不按「块」看**。OCR 常把「单词 + 音标」拆成左右两块，
   合并成一行后才是完整的词目（见 ocr_pages.group_lines）。
2. **剔除页脚**。每页底部有一条竖排的本页词索引（实测 y≥2770，正文最大
   只到 2576），不剔掉就会变成一堆假词目。
3. **按文本特征判**：无中文、不以 `[` 开头、不是纯音标、不是纯数字、
   去音标后是 1~3 个英文词且不以句点结尾。

词条内部字段（实测自原书）：
    单词 /音标/
    词性. 中文释义
    [例]英文例句 + 中文翻译
    [搭]搭配
    [记]派生词
    xxx(词根)+yyy(词根)→词源解释
    （无标签的整段中文 = 文化背景说明）

用法：
    python scripts/build_vocab.py
    python scripts/build_vocab.py --pages 10-23      # 只处理部分页，调试用
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ocr_pages import group_lines, split_columns  # noqa: E402  复用分栏 + 分行逻辑

# ---- 书的章节结构（来自第 9 页目录，已核对） ----
# (章号, 主题名, 起始书页码)
CHAPTERS = [
    (1, "自然地理", 1), (2, "植物研究", 21), (3, "动物保护", 31), (4, "太空探索", 45),
    (5, "学校教育", 53), (6, "科技发明", 85), (7, "文化历史", 95), (8, "语言演化", 103),
    (9, "娱乐运动", 109), (10, "物品材料", 123), (11, "时尚潮流", 135), (12, "饮食健康", 145),
    (13, "建筑场所", 159), (14, "交通旅行", 171), (15, "国家政府", 183), (16, "社会经济", 197),
    (17, "法律法规", 213), (18, "沙场争锋", 223), (19, "社会角色", 241), (20, "行为动作", 253),
    (21, "身心健康", 275), (22, "时间日期", 307),
]
INDEX_PAGE = 312      # 索引起始书页码
PAGE_OFFSET = 9       # 图片编号 = 书页码 + 偏移

FOOTER_RATIO = 0.94   # 行中心超过本页最大 y 的这个比例 → 判为页脚，丢弃
                      # 实测页脚索引条固定从 ~0.95 页高开始，正文最远到 ~0.91

# 释义行的词性前缀。OCR 出来的形态很杂，实测有这些：
#     n.大气层        n 氧化物（句点丢了）      n大理石（句点空格都没了）
#     v./n.战栗       （动名同形，两个词性连写）
#     nn. 生态学      （n 被重复识别）
#     11.霜           （n 被认成 11）
#     (=jeopardize)v.危害   （先给异体拼写）
# 所以不能只匹配开头一个词性，要允许「可选的 (=xxx) + 1~3 个词性 + 各种分隔符」，
# 再往后必须紧跟中文，否则就是别的行。
#
# 后来实测又补三种形态（见 tech-spec.md 7.10）：
#     ord.第一adv.最初      （ord 是序数词性，原先漏在表外）
#     (=counselor).顾问      （异体提示后面直接跟句点）
#     n[英】男校长           （方括号用了全角 `】` 收尾）
#     adj.X级的，青少年不宜   （词性后面跟一个大写字母再进中文）
POS_PREFIX_RE = re.compile(
    r"^\s*(?:\(\s*=\s*[A-Za-z\- ]+\s*\)\s*[.]?\s*)?"
    r"(?:(?:nn|n|vt|vi|v|adj|adv|a|ad|prep|conj|pron|num|art|int|aux|abbr|ord|pl|11|1l)"
    r"\s*[.、,，/|]?\s*){1,3}"
    r"(?:[\[（(【][^\]）)】]{0,20}[\]）)】])*"   # 中间可能插几段标注，如 `n.[~s](难闻…)`
    r"\s*[A-Z]?\s*[一-鿿]",
    re.I,
)
# 释义/搭配/派生的行首标记。OCR 会把 `]` 认成 1、l、I、|，实测有 `[记1hybrid`
MARKER_RE = re.compile(r"^\[\s*(?P<tag>[例搭记])\s*[\]1lI|]?\s*")
CJK_RE = re.compile(r"[一-鿿]")
# 词目里允许的字母：ASCII 加 Latin-1（`El Niño`、`résumé` 要用）。
# 掐掉中间的 × ÷ 两个数学符号，它们也在 Latin-1 里。
WORD_CHARS = "A-Za-zÀ-ÖØ-öø-ÿ"
WORD_RE = re.compile(f"[{WORD_CHARS}]+")
SENT_END_RE = re.compile(r"[。！？]$")   # 句末标点，用于区分「续行」和「另起一段」
# 整行就是一个音标，如 `/'pksıdzən/`、`/k:/`、`I'neit∫ə/`（开头的斜杠被认成 I）
PHONETIC_ONLY_RE = re.compile(r"^(?:/|[lLI1|](?=[ˈ'ˌ]))[^/]*/?$")
# 行内音标片段。开头的斜杠 OCR 极常认错，实测 `nature /'neɪtʃə/` 会变成
# `nature I'neit∫ə/`、`terrace /'terəs/` 变成 `terrace I'ters/`，
# 所以把 l L I 1 | 也当左斜杠用，但必须紧跟着重音符号才算数，
# 否则普通单词里的字母 l 会被误认。
PHONETIC_PART_RE = re.compile(r"/[^/]{0,60}/|(?<![A-Za-z])[lLI1|](?=[ˈ'ˌ])[^/]{0,60}/")
# 页面上用来标重点的装饰符号，不是内容
DECOR_RE = re.compile(r"[☆★*√♦■□◆●]+")
# 章节标题行（如 `Chapter 1`），不是词条
TITLE_RE = re.compile(r"(?i)^(chapter|unit|lesson|part|section|contents?)\b")
# 词目行前面偶尔挂一个编号，实测 19 处，如 `3 barn /ba:n/`、`31 deadline`。
# 这个数字不属于词条，不剥掉的话整条会被判成「不是纯英文」而丢掉。
ORDINAL_RE = re.compile(r"^\d{1,3}\s+")
# 偶数书页左边缘印着当前章号（`2`、`5`、`9`…，一个大号孤立数字）。OCR 把它
# 单列成块，位置又正好和本页第一个词条的释义行齐平，于是被并进同一行：
# `n. 宿舍` → `5 n. 宿舍`、`(=disk)n.光碟…` → `9 (=disk)n.光碟…`。见 drop_edge_marks。
EDGE_MARK_RE = re.compile(r"[\dⅠ-Ⅴ]{1,2}\.?")
# 词性缩写被 OCR 认坏的形态：`n1.`（点被认成 1）、`1.`（n 丢了只剩那个点）、
# `Ⅱ1.`（整个 n. 被认成罗马数字加 1）。只在词条开头启用，见 clean_leading_noise。
POS_RECOVER_RE = re.compile(
    r"\s*(?:[Ⅰ-Ⅴ]\s*1|[nN]\s*1|1)\s*[.、,，]\s*(?=[一-鿿\[（(【A-Z])"
)
# 音标专用字符。用来确认「被吃掉的斜杠」右边确实是音标
IPA_RE = re.compile(r"[/ˈˌəɪʊɛæɑɒɔʌɜʃʒθðŋɡ]")


def strip_ordinal(s: str) -> str:
    """去掉词目行开头的编号（`3 barn /ba:n/` → `barn /ba:n/`）。"""
    return ORDINAL_RE.sub("", s, count=1)


def cut_glued_phonetic(s: str) -> str:
    """切掉「和单词粘在一起」的音标，如 `showerJauə/`。

    正常词目不会出现「小写字母紧跟大写字母」这种边界，所以那里就是被 OCR
    吃掉的左斜杠（`/` 被认成了 `J`）。但必须确认右边确实是音标，否则
    `El Niño` 这类正常拼写会被误伤。
    """
    m = re.search(r"(?<=[a-z])[A-Z]", s)
    if m is None or not IPA_RE.search(s[m.start():]):
        return s
    return s[: m.start()]


def drop_edge_marks(col):
    """剔掉本栏外侧的章号标记块。

    偶数书页左边缘印着当前章号，一个大号孤立数字。它和本页顶部第一个词条的
    释义行（或词目行）正齐平，`group_lines` 按 y 距离会把两者并成一行，于是
    `n. 宿舍` 变成 `5 n. 宿舍`——行首不再是词性，整行就落进 note 了。

    三个条件同时成立才剔：内容是个 1~2 位数字、宽度很窄、整块落在本栏正文
    左边界之外。第三条用「含中文或长度 > 3 的块」的最小左边界当基准，正文
    里的数字不会被误伤。
    """
    body = [min(p[0] for p in b) for b, t, _s in col
            if b and (CJK_RE.search(t) or len(t.strip()) > 3)]
    if not body:
        return col
    left = min(body)
    return [it for it in col
            if not (it[0] and EDGE_MARK_RE.fullmatch(it[1].strip())
                    and max(p[0] for p in it[0]) < left)]


def clean_leading_noise(s: str) -> str:
    """剥掉释义行开头的 OCR 噪声，还原成标准形态。

    实测两类：页边章号残留（`5 v. 使具备资格`，块没剔干净时）、词性缩写被
    认坏（`n1.咬…`、`1.图，图表…`、`Ⅱ1. 表格…`）。后者一律还原成 `n.`——
    词条的第一个词性缩写几乎总是 n，而且这里只处理词条的第一行。
    """
    s = re.sub(r"^\s*\d{1,2}\s+", "", s)
    m = POS_RECOVER_RE.match(s)
    return "n." + s[m.end():] if m else s


def image_to_page(stem: str) -> int:
    """图片编号 → 书页码。"""
    return int(stem) - PAGE_OFFSET


def chapter_of(page: int):
    """书页码 → (章号, 主题名)。"""
    found = None
    for no, name, start in CHAPTERS:
        if page >= start:
            found = (no, name)
        else:
            break
    return found


def load_page(path: Path):
    """读一页 JSON，按阅读顺序返回「行」列表。

    每行是 (文本, 行高, 行中心 y)。文本把同一行内的各块按 x 拼起来，
    块与块之间补一个空格（OCR 拆块时会把空格吃掉）。行高取行内最高
    的那块——词目行常和音标并排，取最高的才反映真实字高。
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    items = [(it["box"], it["text"], it.get("score", 0.0)) for it in raw]
    if not items:
        return []

    all_ys = [p[1] for _b, _t, _s in items for p in _b] if all(_b for _b, _t, _s in items) else []
    page_bottom = max(all_ys) if all_ys else 0.0

    rows = []
    for col in split_columns(items):
        for line in group_lines(drop_edge_marks(col)):
            parts, ys = [], []
            for box, text, _score in line:
                t = text.strip()
                if not t:
                    continue
                parts.append(t)
                ys.extend(p[1] for p in box)
            if not parts:
                continue
            y_lo, y_hi = min(ys), max(ys)
            y_mid = (y_lo + y_hi) / 2
            # 页脚：每页底部那条竖排的本页词索引，不是正文
            if page_bottom and y_mid > page_bottom * FOOTER_RATIO:
                continue
            rows.append((" ".join(parts), y_hi - y_lo, y_mid))
    return rows


def normalize_head_line(s: str) -> str:
    """词目行统一先做两步清洗，识别和解析共用，免得两边判得不一样。"""
    return cut_glued_phonetic(strip_ordinal(s)).strip()


def is_headword_row(text: str) -> bool:
    """这一行是不是词目行。判据见模块开头的说明。"""
    t = normalize_head_line(DECOR_RE.sub(" ", text).strip())
    if not t or len(t) > 40 or CJK_RE.search(t):
        return False
    if t.startswith("[") or t.startswith("【"):
        return False
    if PHONETIC_ONLY_RE.match(t):
        return False
    if re.fullmatch(r"[\dIVXivx.\s]+", t):
        return False
    if TITLE_RE.match(t):
        return False

    body = PHONETIC_PART_RE.sub(" ", t)               # 剥掉音标
    # 形如 `u,d uo`、`at,daoid`：单字逗号分隔，是 OCR 拆坏的音标碎片，不是单词。
    # 必须在剥掉音标之后再查，否则 `lithosphere/'1θəu,sfiə/` 会被误杀
    if re.search(r"[A-Za-z],[A-Za-z]", body):
        return False

    body = body.replace("'", "").replace("-", " ")
    words = [w for w in re.split(r"[\s,;:]+", body) if w]
    if not words or len(words) > 3:
        return False
    if not all(WORD_RE.fullmatch(w) for w in words):
        return False
    if t.endswith(","):
        return False                                  # 信末落款之类（实测 `Yours sincerely,`）
    if t.endswith(".") and not PHONETIC_PART_RE.search(t):
        return False                                  # 例句续行常以句点结尾，真词目不会
    return sum(len(w) for w in words) >= 3


def strip_leading_phonetic(s: str) -> str:
    """去掉行首挂着的音标。

    一个词有动名两种读音时，书里会把音标分别写在两个义项前，OCR 之后就成了
    `/'mɒdərət/adj.适度的…`。更麻烦的是开头的斜杠常被吃掉，变成
    `'mddərt/adj.…`，所以不能按「必须斜杠开头」来匹配。

    做法：只看第一个汉字之前的那一段，如果里面有斜杠，就把最后一个斜杠之前
    的全当音标丢掉。
    """
    m = CJK_RE.search(s)
    head = s[: m.start()] if m else s
    cut = head.rfind("/")
    if cut >= 0:
        return s[cut + 1 :].strip()
    # 开头的斜杠被完全吃掉时，行首直接就是音标本体：`'əuvasi:zadj.海外的…`
    # （原文是 `/əuvəˈsiːz/adj.…`）。重音符号是音标独有的，正常拼写不会以它
    # 开头，据此剥到词性缩写前为止。
    m2 = re.match(
        r"\s*['ˈˌ][^一-鿿]*?(?=(?:nn|vt|vi|adj|adv|prep|conj|pron|num|art|int"
        r"|aux|abbr|ord|pl|n|v|a|ad)\s*[.、])",
        head,
        re.I,
    )
    return s[m2.end() :].strip() if m2 else s


def split_en_cn(s: str) -> tuple[str, str]:
    """按第一个中文字符切开英文和中文。"""
    m = CJK_RE.search(s)
    if not m:
        return s.strip(), ""
    return s[: m.start()].strip(), s[m.start():].strip()


def parse_entry(lines: list[str]) -> dict:
    """把一条词目的所有行解析成字段。

    lines[0] 是词目行（单词 + 可能带音标），其余是正文行。
    """
    head_line = normalize_head_line(lines[0])
    rest = lines[1:]

    # 词目行的形态很杂：`atmosphere/'ætməsfiə/`、`beggar l'begə/`（斜杠被认成 l）、
    # `terrace I'ters/ ☆`（斜杠被认成 I，后面还跟个装饰符号）、
    # `hydrogen /'haıdrədzən/ hydrogen`（拆块后重复识别）。
    # 统一处理：先去掉装饰符和音标，把剩下的当词目；重复的去掉一半。
    ph = PHONETIC_PART_RE.search(head_line)
    phonetic = ph.group(0).strip("/") if ph else ""
    toks = PHONETIC_PART_RE.sub(" ", DECOR_RE.sub(" ", head_line)).split()
    if len(toks) >= 2 and len(toks) % 2 == 0 and toks[: len(toks) // 2] == toks[len(toks) // 2:]:
        toks = toks[: len(toks) // 2]
    headword = " ".join(toks)

    # 音标可能被换行拆到下一行（实测 thaw /θɔː/ 就是这样）
    if not phonetic and rest and PHONETIC_ONLY_RE.match(rest[0]):
        phonetic = rest[0].strip("/ lLI1|").strip()
        rest = rest[1:]

    entry = {
        "headword": headword,
        "phoneticRaw": phonetic,
        "meaning": "",
        "examples": [],
        "collocation": "",
        "derived": "",
        "etymology": "",
        "note": "",
    }

    field = None
    for raw in rest:
        line = raw.strip()
        if not line:
            continue

        m_mark = MARKER_RE.match(line)
        if m_mark:
            payload = line[m_mark.end():].strip()
            tag = m_mark.group("tag")
            if tag == "例":
                entry["examples"].append(payload)
                field = "example"
            elif tag == "搭":
                entry["collocation"] = payload
                field = "collocation"
            else:
                entry["derived"] = payload
                field = "derived"
            continue

        # 标记行处理完再剥音标：例句里本来就可能出现 `/`（如 `take up/on`），
        # 先剥会把正常内容也切掉
        line = strip_leading_phonetic(line)
        if not line:
            continue

        # 词条开头的释义行常被 OCR 弄坏（见 clean_leading_noise）。只在还没
        # 识别到任何字段时才剥，免得把正文中间的编号当成词性缩写。
        if field is None and not entry["meaning"]:
            line = clean_leading_noise(line)

        if POS_PREFIX_RE.match(line):
            line = PHONETIC_PART_RE.sub("", line)     # 清掉句中残留的音标
            # 「异体拼写」提示留着没用，去掉；`11.` 是 n 被认错，改回来
            line = re.sub(r"^\(\s*=\s*[A-Za-z\- ]+\s*\)\s*[.]?\s*", "", line).strip()
            line = re.sub(r"^1[1l][\s.、]*", "n.", line, flags=re.I)
            entry["meaning"] = (entry["meaning"] + " " + line).strip()
            field = "meaning"
            continue

        # 整行中文、不带词性前缀，也是释义（`策略，战术`、`[尤美]公寓套房`）。
        # 词目行之后的第一行只可能是释义，不会是别的。
        if (field is None and not entry["meaning"]
                and CJK_RE.search(line) and not SENT_END_RE.search(line)):
            entry["meaning"] = line.strip()
            field = "meaning"
            continue

        if "→" in line:
            entry["etymology"] = (entry["etymology"] + line).strip() if field == "etymology" else line
            field = "etymology"
            continue

        # 无标签的行：判断它是接着上一字段，还是另起一段「文化说明」
        #
        # 这两者用行距区分不了（实测文化说明和例句续行的行距完全一样），
        # 只能靠句末标点：上一字段已经收尾（以 。！？ 结束）却还有无标签的
        # 文字，那就是新段落。
        if field == "example" and entry["examples"]:
            _en, cn = split_en_cn(entry["examples"][-1])
            if SENT_END_RE.search(cn.strip()):
                field = "note"
            else:
                entry["examples"][-1] += line
                continue
        if field == "etymology":
            entry["etymology"] += line
            continue
        if field in ("collocation", "derived", "meaning") and not SENT_END_RE.search(line):
            if field == "collocation":
                entry["collocation"] += line
            elif field == "derived":
                entry["derived"] += line
            else:
                entry["meaning"] += line
            continue
        # 孤立的数字是页脚页码之类的残留，不是文化背景。实测全书最后一个词
        # `incidentally` 的 note 里就混进过一个光秃秃的 "22"（它的正文之后
        # 紧跟索引页，索引页整体在切分阶段就被丢掉了，剩这个数字卡在页尾）。
        if re.fullmatch(r"\d+", line):
            continue
        entry["note"] = (entry["note"] + line).strip()
        field = "note"

    # 例句拆成 英文 / 中文
    parsed_ex = []
    for ex in entry["examples"]:
        en, cn = split_en_cn(ex)
        parsed_ex.append({"en": en, "cn": cn})
    entry["examples"] = parsed_ex

    # 释义行末尾偶尔挂一个数字：`n. 洗涤剂 10`、`v. 凝视；沉思；考虑 20`、
    # `n. 花环，花冠；（祭奠用的）花圈 15`。实测 14 处，全是纯数字，是相邻的
    # 页码或章号被 OCR 并进了同一行——同一类噪声，上一轮只清了 note 里的，
    # meaning 里的漏了下来。
    if entry["meaning"]:
        entry["meaning"] = re.sub(r"\s+\d{1,3}\s*$", "", entry["meaning"])

    # 整条 note 一个汉字都没有的，全是噪声：音标被 OCR 认成乱码（`pnq 2`、
    # `porıd3`、`əuvə'nait`）、隔壁词条的残片（`content`、`add`）、页码符号串
    # （`21 23 24 25 2728 29 30`）。书里的文化背景说明一律是中文——实测全表
    # 「无汉字」的 note 只有 29 条，逐条核对都是噪声。
    # 判据必须是「整条」而不是「某一行」：一条 note 里夹着纯英文的名人名言
    # （泰戈尔、达尔文的原文）是正常的，按行丢会连它们一起删掉。
    if entry["note"] and not CJK_RE.search(entry["note"]):
        entry["note"] = ""

    return entry


def main() -> None:
    ap = argparse.ArgumentParser(description="OCR 文本 → 结构化词表")
    ap.add_argument("--ocr", default="data/ocr", help="OCR 结果目录")
    ap.add_argument("--out", default="data/words.raw.json", help="输出 JSON")
    ap.add_argument("--pages", help="只处理这个图片范围，如 10-23")
    args = ap.parse_args()

    ocr_dir = Path(args.ocr)
    files = sorted(ocr_dir.glob("*.json"))
    if not files:
        sys.exit(f"{ocr_dir} 里没有 json。先跑 scripts/ocr_pages.py --all --json")

    if args.pages:
        m = re.fullmatch(r"(\d+)-(\d+)", args.pages)
        if not m:
            sys.exit("--pages 格式应为 10-23")
        lo, hi = int(m.group(1)), int(m.group(2))
        files = [f for f in files if lo <= int(f.stem) <= hi]
    print(f"读取 {len(files)} 页 OCR 结果")

    # 1) 逐页取出已排好序的行，标出词目
    #    全局行序列，用于跨页合并词条
    global_rows: list[tuple[int, str, bool]] = []   # (书页码, 文本, 是否词目)
    for f in files:
        page = image_to_page(f.stem)
        for text, _h, _y in load_page(f):
            global_rows.append((page, text, is_headword_row(text)))

    # 2) 按词目切分
    entries: list[tuple[int, list[str]]] = []   # (起始书页码, 行列表)
    cur_page, cur_head, cur_body = None, None, []
    for page, text, is_hw in global_rows:
        # 书末索引（第 312 页起）整页丢掉。**必须在这里断，不能只靠第 3 步那个
        # 「起始页 >= INDEX_PAGE 就跳过」**——索引页的行是「单词 + 页码」格式，
        # 不带词目行特征，会被当成上一个词条的正文一路累积下去。实测全书最后
        # 一个词 `incidentally` 因此吞掉了整页索引（16793 字符，全是
        # `<单词><页码><单词><页码>…`），一股脑塞进它的「文化背景」字段。
        if page >= INDEX_PAGE:
            continue
        if is_hw:
            if cur_head is not None:
                entries.append((cur_page, [cur_head] + cur_body))
            cur_page, cur_head, cur_body = page, text, []
        else:
            if cur_head is None:
                continue          # 开头的页眉页脚之类，丢掉
            cur_body.append(text)
    if cur_head is not None:
        entries.append((cur_page, [cur_head] + cur_body))

    print(f"切出 {len(entries)} 条词目")

    # 3) 解析 + 归章
    chapters: dict[int, dict] = {}
    for no, name, start in CHAPTERS:
        chapters[no] = {"chapterNo": no, "name": name, "startPage": start, "words": []}

    skipped = 0
    for page, lines in entries:
        ch = chapter_of(page)
        if ch is None or page >= INDEX_PAGE:
            continue              # 索引页不是正文词条
        no, _name = ch
        word = parse_entry(lines)
        if not word["headword"]:
            skipped += 1
            continue
        word["page"] = page
        word["orderInUnit"] = len(chapters[no]["words"]) + 1
        chapters[no]["words"].append(word)

    result = {"chapters": [chapters[no] for no, _n, _s in CHAPTERS]}
    out = Path(args.out)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(len(c["words"]) for c in result["chapters"])
    print(f"\n共 {total} 条词，写入 {out}" + (f"（丢弃空词目 {skipped} 条）" if skipped else ""))
    print(f"{'章':>3}  {'主题':<8} {'词数':>5}")
    for c in result["chapters"]:
        n = len(c["words"])
        if n:
            print(f"{c['chapterNo']:>3}  {c['name']:<8} {n:>5}")


if __name__ == "__main__":
    main()
