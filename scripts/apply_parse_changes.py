"""把「解析层改进」带来的字段修复应用到 data/words.clean.json。

背景：`build_vocab.py` 的解析规则在 2026-10-16 补了三处（详见 tech-spec.md 7.10）：

  1. **页边章号块**。偶数书页左边缘印着当前章号（`5`、`9`…），OCR 把它单列
     成块，位置又和本页顶部第一个词条的释义行齐平，于是被并进同一行——
     `n. 宿舍` 变成 `5 n. 宿舍`。行首不再是词性，整条释义就落进了 note。
     同样的污染还散落在例句（`a common3 ancestor`）、词源（`希4 腊神话`）、
     搭配、派生里。
  2. **词性缩写被认坏**。`n.` 的点被认成 1（`n1.咬`）、整个 n 丢了只剩那个点
     （`1.图，图表`）、被认成罗马数字（`Ⅱ1. 表格`）。
  3. **释义末尾粘数字**（`n. 洗涤剂 10`、`v. 凝视；沉思；考虑 20`）。

修完之后，73 个词的书内释义从 note 归位到 meaning（卡片本来就靠 ECDICT 的
meaningCn 兜底，所以这次补的是 bookMeaning 和 pos），另有一批词的例句、
搭配、派生、词源里的杂质数字被清掉。

差异清单 `data/parse-changes.json` 由「新旧两次 build_vocab.py 产物逐词对比」
得出，格式 `[{chapterNo, headword, field, old, new}]`。

**examples / collocation / derived / etymology 要注意**：clean.json 里这几个
字段已经被 `fix_spacing.py` 修过词间空格，值不等于 raw 的 old。脚本会照写
new 值（等于退回未修 spacing 的状态），所以**跑完必须再跑一次
`fix_spacing.py --apply`** 把空格修回来。meaning / note 不受影响。

幂等性：meaning / note 重复跑无副作用（值已经是 new 就跳过）；上面那四个
字段在重跑 spacing 之后又会对不上 new，这是预期内的——顺序是
`apply_parse_changes.py --write` → `fix_spacing.py --apply`。

用法：
    python scripts/apply_parse_changes.py            # 干跑
    python scripts/apply_parse_changes.py --write
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLEAN = ROOT / "data" / "words.clean.json"
CHANGES = ROOT / "data" / "parse-changes.json"

# 这几个字段的值在 clean 里被 fix_spacing.py 改过，覆盖后要重跑 spacing
SPACING_FIELDS = {"examples", "collocation", "derived", "etymology"}


def note_matches(cur, old) -> bool:
    """note 比对时忽略尾部页码。

    clean 里的 note 已被 fix_notes.py 清过尾部页码（`…花圈 15` → `…花圈`），
    而清单里的 old 记的是 raw 的值，还带着那一截。不归一化的话这类词会被
    误判成「值已变」而跳过。
    """
    strip = lambda s: re.sub(r"\s+\d{1,3}\s*$", "", str(s or ""))
    return strip(cur) == strip(old)


def main() -> None:
    write = "--write" in sys.argv
    changes = json.loads(CHANGES.read_text(encoding="utf-8"))
    by_key: dict[tuple[int, str], list[dict]] = {}
    for c in changes:
        by_key.setdefault((c["chapterNo"], c["headword"]), []).append(c)
    print(f"差异清单：{len(changes)} 条，涉及 {len(by_key)} 个词")

    # newline="" 保留原始 CRLF，不然读回来全变 LF，写回去就不是原文件了
    text = CLEAN.open(encoding="utf-8", newline="").read()
    doc = json.loads(text)
    if json.dumps(doc, ensure_ascii=False, indent=1).replace("\n", "\r\n") != text:
        sys.exit("重序列化和原文件不一致，中止（格式已变，需先确认）")

    updated, already, skipped = 0, 0, []
    needs_spacing = 0
    for ch in doc["chapters"]:
        for w in ch["words"]:
            cs = by_key.get((ch["chapterNo"], w["headword"]))
            if not cs:
                continue
            for c in cs:
                cur = w.get(c["field"])
                if cur == c["new"]:
                    already += 1
                    continue
                if c["field"] in SPACING_FIELDS:
                    # 值可能已被 fix_spacing 改过，对不上 old 也照样写
                    needs_spacing += 1
                elif c["field"] == "note":
                    if not note_matches(cur, c["old"]):
                        skipped.append(
                            f"{w['headword']}.note：当前值既非旧值也非新值"
                            f"（当前 …{str(cur)[-24:]!r}）"
                        )
                        continue
                elif cur != c["old"]:
                    skipped.append(
                        f"{w['headword']}.{c['field']}：当前值既非旧值也非新值"
                        f"（当前 …{str(cur)[-24:]!r}）"
                    )
                    continue
                w[c["field"]] = c["new"]
                updated += 1

    print(f"{'' if write else '[干跑] '}更新 {updated} 条，已是新值 {already} 条，跳过 {len(skipped)} 条")
    print(f"其中 {needs_spacing} 条属于 {'/'.join(sorted(SPACING_FIELDS))}——写完要再跑 fix_spacing.py --apply")
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
