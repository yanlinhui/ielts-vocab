"""用 ECDICT 校验 OCR 词表，补上音标和权威中文释义。

输入：data/words.raw.json（build_vocab.py 的产物）
      ecdict/ecdict-stardict-28.zip
输出：data/words.clean.json + data/extraction-report.md

**ECDICT 到底长什么样**（下载后实测，不是照抄文档）

StarDict 格式三个文件，`.ifo` 里写着 `sametypesequence=m`，意思是
`.dict` 里每条记录都是一段纯文本，没有类型前缀。实测一条记录长这样：

    *['ætmәsfiә]   -K3
    n. 大气, 空气, 气氛
    [医] 大气; 大气压
    (高研四六托 2217/1855)

拆开来是：
    第一行  `*` + `[音标]` + 一些填充
    末行    `(考试标签 词频)`，标签是单字中文缩写，词频是 `bnc/frq`
    中间   中文释义，可能多行，带 `[医]` `[网络]` 这类领域标记

`.idx` 是「词\\0 + 4 字节大端偏移 + 4 字节大端长度」的定长记录流，按词的
字节序排序。

**为什么要用 ECDICT 而不是信 OCR 的释义**：OCR 的音标完全不可靠（实测
`hydrogen` 被认成 `/'pksıdzən/`），中文释义偶尔也会串行。ECDICT 的释义是
权威的，且顺带给了考试标签和词频。

**代价**：ECDICT 只有一份音标，分不出英式美式，所以数据模型里的
`phoneticUk` / `phoneticUs` 两个字段只会有前者。已同步改了技术规范。

用法：
    python scripts/check_with_ecdict.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ZIP_PATH = ROOT / "ecdict" / "ecdict-stardict-28.zip"
EXTRACT_DIR = ROOT / "ecdict" / "stardict"
STEM = "stardict-ecdict-2.4.2"                    # 压缩包里的文件名（含目录前缀）

# 考试标签的单字缩写 → ECDICT 的标准 tag 值。
# 这张表是从实测记录里反推的（如 `高研四六托` = 高考/考研/四级/六级/托福）
TAG_MAP = {
    "中": "zk", "高": "gk", "四": "cet4", "六": "cet6",
    "研": "ky", "托": "toefl", "雅": "ielts", "宝": "gre",
}
FREQ_RE = re.compile(r"^\((?P<tags>[^)\s]*)\s+(?P<bnc>\d+)?/?(?P<frq>\d+)?\)$")
PHONETIC_RE = re.compile(r"^\*\s*\[([^\]]*)\]")
# ECDICT 里用西里尔字母 ә (U+04D9) 当中央元音，正常 IPA 是 ə (U+0259)
PHONETIC_FIXES = {"ә": "ə", "ɑ": "ɑ", "ɡ": "g"}


def extract_data(force: bool = False) -> tuple[Path, Path]:
    """把 StarDict 三个文件解出来。重复调用不会重复解压。"""
    idx_path = EXTRACT_DIR / f"{STEM}.idx"
    dict_path = EXTRACT_DIR / f"{STEM}.dict"
    if idx_path.exists() and dict_path.exists() and not force:
        return idx_path, dict_path

    if not ZIP_PATH.exists():
        sys.exit(f"找不到 {ZIP_PATH}。先从 GitHub release 1.0.28 下载 ecdict-stardict-28.zip")
    EXTRACT_DIR.mkdir(parents=True, exist_ok=True)
    print("解压 ECDICT（约 200 MB，只做一次）...")
    with zipfile.ZipFile(ZIP_PATH) as z:
        for name in z.namelist():
            base = name.rsplit("/", 1)[-1]
            if not base.startswith(STEM) or name.endswith("/"):
                continue
            target = EXTRACT_DIR / base
            if target.exists():
                continue
            with z.open(name) as src, target.open("wb") as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
    return idx_path, dict_path


def lookup(idx_path: Path, candidates: dict[bytes, list[str]]) -> dict[str, tuple[int, int, str]]:
    """一遍扫过 .idx，把要找的词捞出来。

    不建全量索引：ECDICT 有 340 万条，全塞进内存不合算，而我们只要几千个词。
    直接在字节层面比较，命中了才解码。

    返回 {原词: (偏移, 长度, 实际命中的词形)}。第三个元素用于记录「是靠词形
    变体找到的」，比如 `core` 是靠 `cores` 命中的。
    """
    raw = idx_path.read_bytes()
    found: dict[str, tuple[int, int, str]] = {}
    i, n = 0, len(raw)
    while i < n:
        j = raw.find(b"\x00", i)
        if j < 0:
            break
        word = raw[i:j]
        i = j + 1
        if i + 8 > n:
            break
        offset = int.from_bytes(raw[i : i + 4], "big")
        size = int.from_bytes(raw[i + 4 : i + 8], "big")
        i += 8
        originals = candidates.get(word)
        if originals:
            matched = word.decode("utf-8", errors="replace")
            for orig in originals:
                found.setdefault(orig, (offset, size, matched))
    return found


def parse_record(text: str) -> dict:
    """把一条 ECDICT 记录拆成音标 / 释义 / 标签 / 词频。"""
    lines = [ln.rstrip() for ln in text.split("\n")]
    while lines and not lines[-1].strip():
        lines.pop()

    phonetic, tags, bnc, frq = "", [], None, None
    body: list[str] = []

    for k, ln in enumerate(lines):
        if k == 0:
            m = PHONETIC_RE.match(ln)
            if m:
                phonetic = normalize_phonetic(m.group(1))
                continue
        m = FREQ_RE.match(ln.strip())
        if m:
            tags = [TAG_MAP[c] for c in m.group("tags") if c in TAG_MAP]
            bnc = int(m.group("bnc")) if m.group("bnc") else None
            frq = int(m.group("frq")) if m.group("frq") else None
            continue
        if ln.strip():
            body.append(ln.strip())

    return {
        "phonetic": phonetic,
        "meaningCn": "\n".join(body),
        "tags": " ".join(tags),
        "bnc": bnc,
        "frq": frq,
    }


def normalize_phonetic(p: str) -> str:
    out = p.strip().strip("/")
    for bad, good in PHONETIC_FIXES.items():
        out = out.replace(bad, good)
    return out


def build_candidates(words: list[str]) -> dict[bytes, list[str]]:
    """给每个词生成几个大小写变体，一并去查。"""
    cand: dict[bytes, list[str]] = {}
    for w in words:
        for variant in {w, w.lower(), w.capitalize()}:
            cand.setdefault(variant.encode("utf-8"), []).append(w)
    return cand


def verb_forms(w: str) -> list[str]:
    """词形变体，用于「ECDICT 收了派生形却没收原形」的情况。

    实测这份 ECDICT 有 `cores` 没有 `core`、有 `penguins` 没有 `penguins` 之外的
    原形，所以查不到时要把派生形也试一遍。只在原形没命中时才用，不会污染正常结果。
    """
    out = [w + "s", w + "es", w + "d", w + "ed", w + "ing"]
    if w.endswith("e"):
        out += [w[:-1] + "ing", w[:-1] + "ed"]
    if w.endswith("y"):
        out += [w[:-1] + "ies", w[:-1] + "ied"]
    return out


def enrich(words: list[str]) -> dict[str, dict]:
    """给定一批词，返回 {词: ECDICT 解析结果}。查不到的词不出现在结果里。

    先按原形查一遍，没命中的再试派生形——实测这份 ECDICT 有 `cores` 却没有
    `core`。派生形只在原形没命中时才用，不会覆盖正常结果。
    """
    idx_path, dict_path = extract_data()
    found = lookup(idx_path, build_candidates(words))

    rest = [w for w in words if w not in found]
    if rest:
        var_cand: dict[bytes, list[str]] = {}
        for w in rest:
            for v in verb_forms(w):
                var_cand.setdefault(v.encode("utf-8"), []).append(w)
        for w, hit in lookup(idx_path, var_cand).items():
            found.setdefault(w, hit)

    out: dict[str, dict] = {}
    with dict_path.open("rb") as f:
        for w, (offset, size, matched) in found.items():
            f.seek(offset)
            rec = parse_record(f.read(size).decode("utf-8", errors="replace"))
            rec["matchedForm"] = matched
            out[w] = rec
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="用 ECDICT 校验词表")
    ap.add_argument("--raw", default="data/words.raw.json")
    ap.add_argument("--out", default="data/words.clean.json")
    ap.add_argument("--report", default="data/ecdict-report.md")
    args = ap.parse_args()

    raw_path = ROOT / args.raw
    if not raw_path.exists():
        sys.exit(f"找不到 {raw_path}，先跑 scripts/build_vocab.py")
    data = json.loads(raw_path.read_text(encoding="utf-8"))

    words = [w for c in data["chapters"] for w in c["words"]]
    unique = sorted({w["headword"] for w in words})
    print(f"{len(words)} 条词，去重后 {len(unique)} 个词形")

    entries = enrich(unique)
    print(f"ECDICT 命中 {len(entries)}/{len(unique)}")
    idx_path, _ = extract_data()
    found_forms = sum(1 for w, e in entries.items()
                      if e["matchedForm"].lower() != w.lower())
    if found_forms:
        print(f"  其中 {found_forms} 个是靠派生形找到的（如 core ← cores）")

    missing: list[tuple[int, str]] = []
    ok = 0
    for ch in data["chapters"]:
        for w in ch["words"]:
            entry = entries.get(w["headword"])
            if entry is None:
                w["verified"] = False
                missing.append((ch["chapterNo"], w["headword"]))
                continue
            ok += 1
            w["verified"] = True
            # 音标一律用 ECDICT 的，OCR 的音标不采用
            w["phonetic"] = entry["phonetic"]
            w["meaningCn"] = entry["meaningCn"]
            w["tags"] = entry["tags"]
            w["bnc"] = entry["bnc"]
            w["frq"] = entry["frq"]
            # 靠派生形命中时记一笔：音标和释义可能和原形不完全对应
            if entry["matchedForm"].lower() != w["headword"].lower():
                w["matchedForm"] = entry["matchedForm"]
            w.pop("phoneticRaw", None)

    # 判断「是不是几个词被并成了一行」时，不能只看词表里出现过的词——
    # `sparrow` 可能整本书只在这个方框里出现过一次。所以把候选的分词单独查一遍。
    tokens = sorted({t for _no, w in missing for t in w.split()
                     if len(w.split()) >= 2 and t.isalpha()})
    token_known = {t.lower() for t in tokens} & {u.lower() for u in unique}
    if tokens:
        token_hits = lookup(idx_path, build_candidates(tokens))
        token_known |= {k.lower() for k in token_hits}
    merged = [m for m in missing if is_merged_headword(m[1], token_known)]
    other = [m for m in missing if not is_merged_headword(m[1], token_known)]

    out_path = ROOT / args.out
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    write_report(ROOT / args.report, data, words, ok, len(entries), len(unique),
                 merged, other)
    print(f"\n写入 {out_path}")
    print(f"校验通过 {ok}，未命中 {len(missing)}（其中 {len(merged)} 个疑似多个词并成一行）")
    print(f"质量报告 {ROOT / args.report}")


def is_merged_headword(word: str, known: set[str]) -> bool:
    """判断这个「词」是不是 OCR 把几个词目并到了一行。

    书里有几页把单词排成小方框并排摆放（如动物名称那一页），OCR 会把
    `eagle` `sparrow` 读成一行。特征是：整体查不到，但拆开每个词都能查到。
    """
    tokens = word.split()
    if len(tokens) < 2:
        return False
    if not all(t.isalpha() for t in tokens):
        return False
    return all(t.lower() in known for t in tokens)


def write_report(path: Path, data: dict, words: list[dict], ok: int,
                 hit: int, unique: int, merged: list[tuple[int, str]],
                 other: list[tuple[int, str]]) -> None:
    lines = ["# 词表提取质量报告", ""]
    lines.append(f"- 词条总数 **{len(words)}**")
    lines.append(f"- 去重后词形 **{unique}**")
    lines.append(f"- ECDICT 命中 **{hit}**（{hit / unique * 100:.1f}%）")
    lines.append(f"- 未命中 **{len(merged) + len(other)}**")
    lines.append("")

    lines += ["## 各章词数", "", "| 章 | 主题 | 词数 | 起始页 |", "|---|---|---|---|"]
    for ch in data["chapters"]:
        lines.append(f"| {ch['chapterNo']} | {ch['name']} | {len(ch['words'])} | {ch['startPage']} |")
    lines.append("")

    lines += [
        "## 一、疑似「多个词目被 OCR 并成一行」", "",
        "书里有几页（主要是动物、身体器官那几个小方框）把单词并排摆放，OCR 读成一行。",
        "特征是整体查不到，但拆开每个词都能查到。**这些要拆成多条词条，或是从词表里删掉。**",
        "",
        "| 章 | 词形 | 拆开后 |",
        "|---|---|---|",
    ]
    for no, word in merged:
        lines.append(f"| {no} | `{word}` | {' / '.join(word.split())} |")
    lines.append("")

    lines += [
        "## 二、其他查不到的词（需人工核对）", "",
        "可能是 OCR 认错，也可能是 ECDICT（2017 年数据）没收这个词。逐条对着原书看一眼即可。",
        "",
        "| 章 | 词形 |",
        "|---|---|",
    ]
    for no, word in other:
        lines.append(f"| {no} | `{word}` |")
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
