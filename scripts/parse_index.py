"""把书末的「全书索引」解析成一份权威词表。

书末第 312–325 页（图片 321–334）是一份按字母排序的索引，每条是
「单词 + 书页码」，横排 4 个纵列。它的价值在于：**这是出版社自己排的完整词表**。

比从前文正文里抠更可靠——正文里被 OCR 认烂、抠漏的词，这里往往还在，
而且顺带给出页码，章节归属直接就能定下来。实测 OCR 质量很好：

    beak 035    bound 215    campus 061   charter 214

**版面怎么读**：页码是右对齐的，OCR 会把一行拆成几个块，同一行的块按 x
排完就是「单词 页码 单词 页码 …」的流水。所以不需要判断列，按行分组后
扫描「单词后面紧跟一个 1~3 位数字」即可。

**已知的 OCR 错**：整页的页码会一起认错，且同一页的几条一起错。
**不要去猜**（`860` 取后两位是 60，离真值 98 更远）——这条词照样收进词表，
只是记成「页码不可用」。词表因此少几个页码，但不会少词。

用法：
    python scripts/parse_index.py
    → data/book-index.json
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ocr_pages import group_lines  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
INDEX_FIRST_PAGE = 312        # 索引起始书页码
PAGE_OFFSET = 9               # 图片编号 = 书页码 + 偏移
LAST_TEXT_PAGE = 311          # 正文最后一页；索引里的页码不会超过它

# 词条里可能出现的大小写、连字符、撇号，以及 `New Zealand` 这类空格
WORD_RE = re.compile(r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]*(?: [A-Za-zÀ-ÿ'’\-]+)*$")
NUM_RE = re.compile(r"^\d{1,3}$")


def fix_page(n: int) -> int | None:
    """页码超出正文范围就不要了。

    索引里的页码是三位补零印的（`054`、`098`）。OCR 偶尔会把这三位认乱，
    实测 `098` 被认成 `860`、`099` 被认成 `660`，而且同一页的几条会一起错。
    **不要去猜**（`860` 取后两位是 60，离真值 98 更远）——直接判为不可用，
    宁可这条词没有页码，也不要把它归错章。
    """
    return n if 1 <= n <= LAST_TEXT_PAGE else None


def parse_page(path: Path) -> list[tuple[str, int | None]]:
    """一页索引 → [(单词, 页码)]。页码可能是 None（OCR 没认出来）。"""
    raw = json.loads(path.read_text(encoding="utf-8"))
    items = [(it["box"], it["text"], it.get("score", 0.0)) for it in raw]

    out: list[tuple[str, int | None]] = []
    for line in group_lines(items):
        toks = [t.strip() for _b, t, _s in line if t.strip()]
        pending: str | None = None
        for tok in toks:
            if NUM_RE.match(tok):
                if pending is not None:
                    out.append((pending, fix_page(int(tok))))
                    pending = None
                continue
            if WORD_RE.match(tok) and 1 < len(tok) <= 30:
                if pending is not None:
                    out.append((pending, None))   # 上一个词没跟页码
                pending = tok
            else:
                if pending is not None:
                    out.append((pending, None))
                    pending = None
        if pending is not None:
            out.append((pending, None))
    return out


def main() -> None:
    ocr_dir = ROOT / "data/ocr"
    pages = sorted(ocr_dir.glob("*.json"))
    idx_pages = [p for p in pages if int(p.stem) - PAGE_OFFSET >= INDEX_FIRST_PAGE]
    if not idx_pages:
        sys.exit("没找到索引页（图片编号应 ≥ 321）")

    entries: list[dict] = []
    for p in idx_pages:
        for word, page in parse_page(p):
            entries.append({"word": word, "page": page})

    with_page = [e for e in entries if e["page"] is not None]
    # 按小写归并，但保留首次出现时的原始拼写（`Bible`、`El Niño` 的大小写要留住）
    #
    # **页码不可用的词也要留下**，只是 pages 为空。反过来做（整条丢掉）会让
    # 「词表 vs 索引」的按章对照凭空少掉一大批词——实测第 7 章因此虚报少 29 个，
    # 而那批词在索引里明明都在，只是整页页码被 OCR 认花了。
    unique: dict[str, dict] = {}
    for e in entries:
        key = e["word"].lower()
        slot = unique.setdefault(key, {"word": e["word"], "pages": set()})
        if e["page"] is not None:
            slot["pages"].add(e["page"])

    result = {
        "entries": entries,
        "uniqueWords": len(unique),
        "words": sorted(
            ({"word": v["word"], "lower": k, "pages": sorted(v["pages"])}
             for k, v in unique.items()),
            key=lambda d: d["lower"],
        ),
    }
    out = ROOT / "data/book-index.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"索引页 {len(idx_pages)} 张（书页 {INDEX_FIRST_PAGE}–{int(idx_pages[-1].stem) - PAGE_OFFSET}）")
    no_page = sum(1 for v in unique.values() if not v["pages"])
    print(f"读出词条 {len(entries)} 条，其中有页码的 {len(with_page)}，"
          f"去重后 {len(unique)} 个词形（其中 {no_page} 个没有可用页码）")
    print(f"写入 {out}")


if __name__ == "__main__":
    main()
