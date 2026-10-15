"""交叉校验：拿每页底部的「本页词索引条」当基准，看解析结果漏了哪些词。

书每页底部有一条竖排的小字索引，列的就是这一页出现的词。这条东西在解析
时是被丢掉的（见 build_vocab.FOOTER_RATIO），但它正好可以反过来当**基准
答案**用——比人工对着图逐个核对省事得多。

注意：这条索引是 OCR 认出来的，本身带噪声（`lithosphere` 会变成 `ithosphere`、
`longitude` 变成 `ongitude`）。所以脚本只报「基准里有、结果里没有」的，且
容忍前后一页的范围（索引有时覆盖的是跨页）。

用法：
    python scripts/verify_vocab.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_vocab import FOOTER_RATIO, image_to_page  # noqa: E402
from ocr_pages import group_lines, split_columns  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# 索引条里的字母，OCR 常把它自己认错（`lithosphere` → `ithosphere`），
# 所以比对时允许丢掉开头一两个字母
LEADING_GARBAGE_RE = re.compile(r"^[^A-Za-z]+|[lI1|]+$")


def footer_words(img_path: Path) -> list[str]:
    """取出这一页底部索引条里的词。"""
    raw = json.loads(img_path.read_text(encoding="utf-8"))
    items = [(it["box"], it["text"], it.get("score", 0.0)) for it in raw]
    if not items:
        return []
    all_y = [p[1] for b, _t, _s in items for p in b if b]
    if not all_y:
        return []
    bottom = max(all_y)

    out: list[str] = []
    for col in split_columns(items):
        for line in group_lines(col):
            parts, ys = [], []
            for box, text, _score in line:
                parts.append(text.strip())
                ys.extend(p[1] for p in box)
            if not parts:
                continue
            if (min(ys) + max(ys)) / 2 <= bottom * FOOTER_RATIO:
                continue                      # 不是页脚，是正文
            for tok in " ".join(parts).split():
                tok = LEADING_GARBAGE_RE.sub("", tok.strip())
                if len(tok) >= 4 and re.fullmatch(r"[A-Za-z][A-Za-z\-']*", tok):
                    out.append(tok)
    return out


def close_enough(token: str, candidates: set[str]) -> bool:
    """索引条 OCR 不可靠，允许首字母丢失、大小写不同。"""
    t = token.lower()
    if t in candidates:
        return True
    return any(t in c or c in t for c in candidates if len(c) > 3)


def english_set(tokens: list[str]) -> set[str]:
    """这批词里，哪些在 ECDICT 中存在。

    用来区分两种「找不到」：
      - 索引条里有、ECDICT 里也有，但词表里没有 → **真的漏词了**
      - 索引条和 ECDICT 都没有 → 是索引条自己 OCR 认错了，不是漏词

    整批一次查完：ECDICT 的索引有 82 MB，一个词扫一遍是要命的。
    """
    from check_with_ecdict import build_candidates, extract_data, lookup

    idx_path, _ = extract_data()
    hits = lookup(idx_path, build_candidates(sorted(set(tokens))))
    return {k.lower() for k in hits}


def main() -> None:
    clean = json.loads((ROOT / "data/words.clean.json").read_text(encoding="utf-8"))

    by_page: dict[int, list[str]] = {}
    for ch in clean["chapters"]:
        for w in ch["words"]:
            by_page.setdefault(w["page"], []).append(w["headword"].lower())

    ocr_dir = ROOT / "data/ocr"
    total_tokens = 0
    misses: list[tuple[int, str]] = []

    for img in sorted(ocr_dir.glob("*.json")):
        page = image_to_page(img.stem)
        tokens = footer_words(img)
        if not tokens:
            continue
        # 索引有时覆盖的是跨页，所以把前后一页的词也算上
        nearby = set()
        for p in (page - 1, page, page + 1):
            nearby.update(by_page.get(p, ()))
        for tok in tokens:
            total_tokens += 1
            if not close_enough(tok, nearby):
                misses.append((page, tok))

    # 只留下「确实是英文词但词表里没有」的，那些索引条自己认错的丢掉
    known = english_set([tok for _p, tok in misses])
    real = [(p, t) for p, t in misses if t.lower() in known]
    noise = len(misses) - len(real)

    print(f"页脚索引共取到 {total_tokens} 个词")
    print(f"词表里找不到的 {len(misses)} 个中：")
    print(f"  - **疑似真漏词**（ECDICT 里有这个词）：{len(real)}")
    print(f"  - 索引条自己 OCR 认错的：{noise}")
    print()
    if real:
        print("疑似真漏掉的词：")
        for page, tok in real:
            print(f"  书页 {page:>3}  {tok}")
        print()
        print("对着原书那一页看一眼：是解析漏了，还是索引条自己认错了。")


if __name__ == "__main__":
    main()
