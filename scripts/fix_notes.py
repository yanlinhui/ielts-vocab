"""把 note 字段的脏数据修复应用到 data/words.clean.json。

背景：`build_vocab.py` 里的 note 是个兜底桶——没有标签、又归不进释义/例句/
搭配/词源的行都落进来。桶里混着两类脏数据：

  1. **尾部粘页码**：`…等等。2`、`demonstration。5`（独立成行的，或粘在文字
     后面的）。最严重的 `incidentally` 曾吞掉整页索引，16793 字符。
  2. **整条没有汉字的纯噪声**：音标被 OCR 认成乱码（`pnq 2`、`porıd3`、
     `əuvə'nait`）、隔壁词条的残片（`content`、`add`）、页码符号串
     （`21 23 24 25 2728 29 30`）。

两类都已在 `build_vocab.py` 里堵住（成因见 tech-spec.md 7.3）；这里把已经
产出的词表按差异清单原地对齐，不必重跑整条流水线。

差异清单 `data/notes-changes.json` 由「旧脚本产物 vs 新脚本产物」逐词对比得出，
外加一轮「整条无汉字 / 尾部含数字」的规则清理；库侧那几十行由
`scripts/update_notes_db.ts` 同步。

幂等：只在当前值恰好等于 old 时才替换，重复跑无副作用。写回保持原有的
1 空格缩进 + CRLF 行尾（重序列化前先校验字节级无损）。

用法：
    python scripts/fix_notes.py            # 干跑
    python scripts/fix_notes.py --write
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLEAN = ROOT / "data" / "words.clean.json"
CHANGES = ROOT / "data" / "notes-changes.json"


def main() -> None:
    write = "--write" in sys.argv
    changes = json.loads(CHANGES.read_text(encoding="utf-8"))
    print(f"差异清单：{len(changes)} 条")

    # newline="" 保留原始 CRLF，不然读回来全变 LF，写回去就不是原文件了
    text = CLEAN.open(encoding="utf-8", newline="").read()
    doc = json.loads(text)

    # 安全网：确认这个格式能字节级还原，否则写回去会污染整个文件
    if json.dumps(doc, ensure_ascii=False, indent=1).replace("\n", "\r\n") != text:
        sys.exit("重序列化和原文件不一致，中止（格式已变，需先确认）")

    by_key: dict[tuple[int, str], list[dict]] = {}
    for c in changes:
        by_key.setdefault((c["chapterNo"], c["headword"]), []).append(c)

    updated, skipped = 0, []
    for ch in doc["chapters"]:
        for w in ch["words"]:
            cs = by_key.get((ch["chapterNo"], w["headword"]))
            if not cs:
                continue
            cur = w.get("note") or ""
            if any(c["new"] == cur for c in cs):
                continue  # 已经是修好的值
            hit = next((c for c in cs if c["old"] == cur), None)
            if hit is None:
                skipped.append(f"{w['headword']}：找不到匹配的旧值（当前 …{cur[-20:]!r}）")
                continue
            w["note"] = hit["new"]
            updated += 1

    print(f"{'' if write else '[干跑] '}更新 {updated} 个词，跳过 {len(skipped)} 个")
    for s in skipped:
        print("   跳过：", s)

    if write:
        out = json.dumps(doc, ensure_ascii=False, indent=1).replace("\n", "\r\n")
        CLEAN.open("w", encoding="utf-8", newline="").write(out)
        print(f"\n已写回 {CLEAN}")
    else:
        print("\n加 --write 真写。")


if __name__ == "__main__":
    main()
