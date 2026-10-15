"""用书末的「全书索引」给抠出来的词表补漏、去伪、纠拼。

从前文正文里抠词，总有一小撮会出问题：OCR 把并排的几个方框词并成一行
（`eagle sparrow`），或者把词目行整个认烂（`funnus` 其实是 `fungus`）。
这些在正文文字层面救不回来——但**书末那份索引能救**，那是出版社自己排的
完整词表，同一批词在索引里的识别率反而高得多。

于是做三件事：

  补  索引里有、词表里没有（连近似拼写都对不上）的词，按索引给的页码归章补进去
  删  词表里有、索引里连近形都没有、且整条 ECDICT 也不认识的，删掉
  修  词表里 ECDICT 查不到、但索引里有个唯一近形的，用索引的拼写改过来

**判据都要求「恰有一个」候选**——宁可漏改也不乱改。把一个真词换成书里没有
的词，比留着一个错字更糟。

输入：data/words.clean.json（check_with_ecdict.py 的产物）
      data/book-index.json（parse_index.py 的产物）
输出：data/words.clean.json（就地更新）+ data/extraction-report.md

用法：
    python scripts/reconcile_index.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_vocab import chapter_of                     # noqa: E402
from check_with_ecdict import enrich                   # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MAX_EDIT = 2                 # 「近形」的编辑距离上限
INDEX_PAGE = 312             # 索引起始书页码，正文最后一页是 311


def edit_within(a: str, b: str, k: int = MAX_EDIT) -> bool:
    """a 和 b 的编辑距离是否 ≤ k。逐行算，一行里最小值超了就提前退出。"""
    if abs(len(a) - len(b)) > k:
        return False
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1,
                         prev[j - 1] + (a[i - 1] != b[j - 1]))
        if min(cur) > k:
            return False
        prev = cur
    return prev[len(b)] <= k


def near(word: str, pool: list[str]) -> list[str]:
    """pool 里和 word 编辑距离 ≤ MAX_EDIT 的词。"""
    return [w for w in pool if w != word and edit_within(word, w)]


def close_page(rec: dict, page: int, slack: int = 3) -> bool:
    """索引里这个词的页码，是否落在这条词所在页附近。"""
    return any(abs(p - page) <= slack for p in rec["pages"])


def match_case(old: str, new: str) -> str:
    """跟着原来的大小写走。索引里偶发一个大写开头（`cord` 被认成 `Cord`），
    照抄会让词表里突然冒出一个首字母大写的普通词。"""
    if old[:1].islower() and new[:1].isupper():
        return new[:1].lower() + new[1:]
    return new


def richness(w: dict) -> tuple:
    """同章里同一个词出现两次时，留哪一条：有书里正文的那条更值钱。"""
    return (bool(w.get("meaning")), len(w.get("examples") or []), bool(w.get("meaningCn")))


def dedupe(words: list[dict]) -> tuple[list[dict], list[str]]:
    """同一个词在同一章里出现两次就去重（书里插图/方框和正文各排了一次）。

    保留首次出现的位置，但内容取更全的那条。
    """
    best: dict[str, dict] = {}
    order: list[str] = []
    for w in words:
        key = w["headword"].lower()
        if key not in best:
            best[key] = w
            order.append(key)
        elif richness(w) > richness(best[key]):
            best[key] = w
    removed = [k for k in order if sum(1 for w in words if w["headword"].lower() == k) > 1]
    return [best[k] for k in order], removed


def blank_entry(headword: str, page: int) -> dict:
    """补进来的词只有词典数据，书里的例句/搭配/词源是空的。"""
    return {
        "headword": headword,
        "meaning": "",
        "examples": [],
        "collocation": "",
        "derived": "",
        "etymology": "",
        "note": "",
        "page": page,
        "orderInUnit": 0,
        "verified": True,
    }


def main() -> None:
    clean_path = ROOT / "data/words.clean.json"
    index_path = ROOT / "data/book-index.json"
    if not index_path.exists():
        sys.exit(f"找不到 {index_path}，先跑 scripts/parse_index.py")
    data = json.loads(clean_path.read_text(encoding="utf-8"))
    index = json.loads(index_path.read_text(encoding="utf-8"))

    idx_by_lower = {w["lower"]: w for w in index["words"]}
    idx_pool = sorted(idx_by_lower)
    deck_words = [w for c in data["chapters"] for w in c["words"]]
    deck = {w["headword"].lower() for w in deck_words}

    # ---------- 1. 挑出候选：要改名的、要补的 ----------
    #    改名除了「近形唯一」，还要求索引里的页码落在这条词附近——否则会把
    #    `Orcart` 改成别的章节里一个拼写相近的词（实测踩过：`Orcart`→`cart`）。
    rename_plan: dict[int, str] = {}
    rename_unresolved: list[tuple[dict, str]] = []
    for w in deck_words:
        if w.get("verified"):
            continue
        hw = w["headword"].lower()
        cands = [c for c in near(hw, idx_pool) if close_page(idx_by_lower[c], w["page"])]
        if len(cands) == 1:
            rename_plan[id(w)] = cands[0]
        elif cands:
            rename_unresolved.append((w, " / ".join(sorted(cands)[:4])))

    add_candidates: list[str] = []
    for lower, rec in idx_by_lower.items():
        if lower in deck:
            continue
        if near(lower, sorted(deck)):
            continue          # 词表里已有近形，多半只是拼写/词形差异，不用补
        add_candidates.append(lower)

    # 目标词是不是真在词典里，一次问清
    targets = sorted({*rename_plan.values(), *add_candidates})
    print(f"待确认候选：改名 {len(rename_plan)}、补词 {len(add_candidates)}")
    info = enrich(targets) if targets else {}

    # ---------- 2. 改名 ----------
    renamed: list[tuple[str, str]] = []
    rename_failed: list[tuple[str, str]] = []
    for w in deck_words:
        new = rename_plan.get(id(w))
        if new is None:
            continue
        if new not in info:
            rename_failed.append((w["headword"], new))
            continue
        old = w["headword"]
        w["headword"] = match_case(old, idx_by_lower[new]["word"])
        apply_ecdict(w, info[new])
        renamed.append((old, w["headword"]))

    # ---------- 3. 删伪词 ----------
    dropped: list[tuple[int, str, str]] = []
    kept_flagged: list[tuple[int, str]] = []
    for ch in data["chapters"]:
        keep = []
        for w in ch["words"]:
            hw = w["headword"]
            lowered = hw.lower()
            # `El Niño` 这类书里确实收录、但词典查不到的词，索引里对得上，要留住。
            # 真的「并成一行」的伪词，索引里不会有一条一模一样的。
            in_index = lowered in idx_by_lower or bool(near(lowered, idx_pool))
            merged = len(hw.split()) > 1 and not w.get("verified")
            if merged and not in_index:
                dropped.append((ch["chapterNo"], hw, "OCR 把并排几个词并成一行"))
                continue
            if not w.get("verified"):
                kept_flagged.append((ch["chapterNo"], hw))
            keep.append(w)
        ch["words"] = keep

    # ---------- 4. 补词 ----------
    deck = {w["headword"].lower() for c in data["chapters"] for w in c["words"]}
    added: list[tuple[int, str, int]] = []
    skipped: list[tuple[str, str]] = []
    for lower in add_candidates:
        if lower in deck:
            continue
        entry = info.get(lower)
        if entry is None:
            skipped.append((idx_by_lower[lower]["word"], "ECDICT 也没有这个词"))
            continue
        pages = [p for p in idx_by_lower[lower]["pages"] if 1 <= p < INDEX_PAGE]
        if not pages:
            skipped.append((idx_by_lower[lower]["word"], "索引页码不可用"))
            continue
        page = min(pages)
        ch = chapter_of(page)
        if ch is None:
            skipped.append((idx_by_lower[lower]["word"], f"页码 {page} 落不到任何一章"))
            continue
        no, _name = ch
        w = blank_entry(idx_by_lower[lower]["word"], page)
        apply_ecdict(w, entry)
        insert_by_page(data["chapters"][no - 1]["words"], w)
        deck.add(lower)
        added.append((no, w["headword"], page))

    # ---------- 5. 同章去重 + 重排序号 + 落盘 ----------
    deduped: list[tuple[int, str]] = []
    for ch in data["chapters"]:
        ch["words"], removed = dedupe(ch["words"])
        deduped += [(ch["chapterNo"], w) for w in sorted(removed)]
        for i, w in enumerate(ch["words"], 1):
            w["orderInUnit"] = i
    clean_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(len(c["words"]) for c in data["chapters"])
    verified = sum(1 for c in data["chapters"] for w in c["words"] if w.get("verified"))

    # 每章完整性体检：索引里的词按页码能归到哪一章。
    # 词表里有的词用词表自己的章（正文抠出来的页码比索引可靠），
    # 只有索引独有的词才按索引页码归章——索引页码本身有认错的，所以这个表是粗估。
    deck_chapter: dict[str, int] = {}
    for c in data["chapters"]:
        for w in c["words"]:
            deck_chapter.setdefault(w["headword"].lower(), c["chapterNo"])
    idx_per_chapter: dict[int, set[str]] = {}
    for lower, rec in idx_by_lower.items():
        no = deck_chapter.get(lower)
        if no is None:
            pages = [p for p in rec["pages"] if 1 <= p < INDEX_PAGE]
            ch = chapter_of(min(pages)) if pages else None
            if ch is None:
                continue
            no = ch[0]
        idx_per_chapter.setdefault(no, set()).add(lower)

    # 索引页码和词表页码是否对得上——对得上才说明拿索引页码归章是可靠的
    #
    # 页数对不上的算「不一致」；索引里这条词压根没有可用页码（整页页码被 OCR
    # 认花）的另算一类——那是索引的锅，不是词表的问题，混在一起会虚报一大截。
    mismatch = 0
    no_page = 0
    for c in data["chapters"]:
        for w in c["words"]:
            rec = idx_by_lower.get(w["headword"].lower())
            if rec is None:
                continue
            if not rec["pages"]:
                no_page += 1
            elif not any(abs(p - w["page"]) <= 1 for p in rec["pages"]):
                mismatch += 1

    write_report(ROOT / "data/extraction-report.md", data, index, idx_per_chapter,
                 total, verified, renamed, rename_failed, rename_unresolved,
                 dropped, added, deduped, kept_flagged, skipped, mismatch, no_page)

    print(f"改名 {len(renamed)}，补词 {len(added)}，删伪词 {len(dropped)}，同章去重 {len(deduped)}")
    print(f"共 {total} 条词，ECDICT 校验通过 {verified}")
    print(f"质量报告 {ROOT / 'data/extraction-report.md'}")


def apply_ecdict(w: dict, entry: dict) -> None:
    w["verified"] = True
    w["phonetic"] = entry["phonetic"]
    w["meaningCn"] = entry["meaningCn"]
    w["tags"] = entry["tags"]
    w["bnc"] = entry["bnc"]
    w["frq"] = entry["frq"]
    if entry["matchedForm"].lower() != w["headword"].lower():
        w["matchedForm"] = entry["matchedForm"]
    else:
        w.pop("matchedForm", None)


def insert_by_page(words: list[dict], w: dict) -> None:
    """按页码插进该章，保持章内大致按书页排列。"""
    pos = len(words)
    for i, other in enumerate(words):
        if other["page"] > w["page"]:
            pos = i
            break
    words.insert(pos, w)


def write_report(path: Path, data: dict, index: dict, idx_per_chapter: dict,
                 total: int, verified: int, renamed, rename_failed,
                 rename_unresolved, dropped, added, deduped, kept_flagged,
                 skipped, mismatch, no_page) -> None:
    uniq = len({w["headword"].lower() for c in data["chapters"] for w in c["words"]})
    lines = ["# 词表提取质量报告", ""]
    lines.append(f"- 词条总数 **{total}**（去重后 {uniq} 个词形）")
    lines.append(f"- ECDICT 校验通过 **{verified}**（{verified / total * 100:.1f}%）")
    lines.append(f"- 书末索引共 **{index['uniqueWords']}** 个词形，用于交叉校验")
    lines.append(f"- 索引页码与词表页码不一致的 **{mismatch}** 条；"
                 f"另有 **{no_page}** 条在索引里没有可用页码（OCR 把整页页码认花了，"
                 f"词本身是在的）")
    lines.append("")

    lines += ["## 各章词数（对照书末索引）", "",
              "「索引」列是按索引里各词的页码归到这一章的词数。两列差得多，"
              "说明那一章的正文页抠漏了；差 1~2 个属于索引页码本身认错，正常。", "",
              "| 章 | 主题 | 词表 | 索引 | 差 | 起始页 |", "|---|---|---|---|---|---|"]
    for ch in data["chapters"]:
        n = len(ch["words"])
        m = len(idx_per_chapter.get(ch["chapterNo"], ()))
        lines.append(f"| {ch['chapterNo']} | {ch['name']} | {n} | {m} | {m - n:+d} | {ch['startPage']} |")
    lines.append("")

    lines += [f"## 一、用索引补回来的词（{len(added)}）", "",
              "正文里整行被 OCR 认烂、抠不出来的词，靠索引找回。"
              "**这些词没有书里的例句/搭配/词源，只有词典数据。**", "",
              "| 章 | 词 | 书页 |", "|---|---|---|"]
    for no, word, page in added:
        lines.append(f"| {no} | `{word}` | {page} |")
    lines.append("")

    lines += [f"## 二、按索引修正拼写的词（{len(renamed)}）", "",
              "词典里查不到、但索引里有唯一近形，按索引改了。", "",
              "| 原样 | 改为 |", "|---|---|"]
    for old, new in renamed:
        lines.append(f"| `{old}` | `{new}` |")
    lines.append("")

    lines += [f"## 三、删掉的伪词（{len(dropped)}）", "",
              "书里有几页把单词并排排在小方框/插图里（动物、器官、蔬果那些），"
              "OCR 会把几个词读成一行。特征是整条查不到、索引里也没有近形。", "",
              "| 章 | 原样 | 说明 |", "|---|---|---|"]
    for no, word, why in dropped:
        lines.append(f"| {no} | `{word}` | {why} |")
    lines.append("")

    lines += [f"## 四、同章内重复、已去重（{len(deduped)}）", "",
              "书里有几页把单词既排在正文又排进插图/小方框里，抠出来就是同一个词两条。"
              "同一个词在同一章里只该出现一次，保留位置靠前的那条、内容取更全的那条。", "",
              "| 章 | 词 |", "|---|---|"]
    for no, word in deduped:
        lines.append(f"| {no} | `{word}` |")
    lines.append("")

    lines += [f"## 五、仍需人工核对（{len(kept_flagged)}）", "",
              "词典和索引都查不到，但也不像「并成一行」，保留了。"
              "可能是 OCR 认错字，也可能是索引自己没收录。**对着原书看一眼即可。**"
              "灌库时这些词会被过滤掉（`verified: false`），不影响背诵。", "",
              "| 章 | 词表里的样子 |", "|---|---|"]
    for no, word in kept_flagged:
        lines.append(f"| {no} | `{word}` |")
    lines.append("")

    if rename_unresolved:
        lines += [f"### 近形候选不唯一，没敢改（{len(rename_unresolved)}）", "",
                  "| 原样 | 候选 |", "|---|---|"]
        for w, cands in rename_unresolved:
            lines.append(f"| `{w['headword']}` | {cands} |")
        lines.append("")

    if rename_failed:
        lines += [f"### 索引里有近形但词典查不到，没改（{len(rename_failed)}）", "",
                  "| 原样 | 索引里的样子 |", "|---|---|"]
        for old, new in rename_failed:
            lines.append(f"| `{old}` | `{new}` |")
        lines.append("")

    if skipped:
        lines += [f"### 索引里有但补不进来（{len(skipped)}）", "",
                  "| 词 | 原因 |", "|---|---|"]
        for word, why in skipped:
            lines.append(f"| `{word}` | {why} |")
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
