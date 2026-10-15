"""读出 PDF 的书签（大纲）树。

为什么需要它：
    本书是扫描件，没有文字层。但 PDF 本身带了 331 个书签，
    书签标题通常就是书的目录结构（单元名、板块名）。
    这是唯一不靠「看图」就能拿到结构信息的途径。

难点：
    该 PDF 用了压缩对象流（/ObjStm），书签对象被 zlib 压在里面，
    直接搜字节搜不到，必须先解压再解析。

用法：
    python scripts/read_outline.py [pdf]
"""

from __future__ import annotations

import os
import re
import sys
import zlib
from pathlib import Path


def find_pdf(arg: str | None) -> Path:
    if arg:
        p = Path(arg)
        if not p.exists():
            sys.exit(f"找不到文件：{p}")
        return p
    hits = [x for x in os.listdir(".") if x.lower().endswith(".pdf")]
    if not hits:
        sys.exit("当前目录下没找到 PDF")
    return Path(hits[0])


def load_objects(data: bytes) -> dict[int, bytes]:
    """收集所有 PDF 对象：常规对象 + 压缩对象流里的对象。"""
    objects: dict[int, bytes] = {}
    hits = [(int(m.group(1)), m.start(), m.end()) for m in re.finditer(rb"(\d+) 0 obj", data)]
    objstms = []
    for i, (num, _s, e) in enumerate(hits):
        end = hits[i + 1][1] if i + 1 < len(hits) else len(data)
        body = data[e:end]
        objects[num] = body
        head = body[: body.find(b"stream")] if b"stream" in body else body
        if b"/ObjStm" in head:
            objstms.append((num, body, head))

    for num, body, head in objstms:
        sm = re.search(rb"stream\r?\n", body)
        if not sm:
            continue
        length = re.search(rb"/Length\s+(\d+)", head)
        if not length:
            continue
        raw = body[sm.end() : sm.end() + int(length.group(1))]
        try:
            dec = zlib.decompress(raw)
        except zlib.error:
            continue
        n = int(re.search(rb"/N\s+(\d+)", head).group(1))
        first = int(re.search(rb"/First\s+(\d+)", head).group(1))
        nums = [int(x) for x in dec[:first].split()]
        pairs = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)][:n]
        for i, (onum, off) in enumerate(pairs):
            stop = first + (pairs[i + 1][1] if i + 1 < len(pairs) else len(dec))
            objects[onum] = dec[first + off : stop]
    return objects


def ref(obj: bytes, key: str) -> int | None:
    """读 /Key 12 0 R 这样的间接引用。"""
    m = re.search(re.escape(key.encode()) + rb"\s+(\d+)\s+0\s+R", obj)
    return int(m.group(1)) if m else None


def parse_literal_string(buf: bytes, pos: int) -> bytes:
    """从 pos（指向 '('）解析一个 PDF 字面字符串，处理嵌套括号与转义。"""
    depth, i, out = 1, pos + 1, bytearray()
    while i < len(buf):
        ch = buf[i : i + 1]
        if ch == b"\\":
            out += buf[i : i + 2]
            i += 2
            continue
        if ch == b"(":
            depth += 1
        elif ch == b")":
            depth -= 1
            if depth == 0:
                return bytes(out)
        out += ch
        i += 1
    return bytes(out)


def unescape(s: bytes) -> bytes:
    out, i = bytearray(), 0
    while i < len(s):
        if s[i : i + 1] == b"\\":
            nxt = s[i + 1 : i + 2]
            if nxt == b"n":
                out += b"\n"
            elif nxt == b"r":
                out += b"\r"
            elif nxt == b"t":
                out += b"\t"
            elif nxt in (b"(", b")", b"\\"):
                out += nxt
            elif nxt.isdigit():
                j, oct_s = i + 1, b""
                while j < len(s) and len(oct_s) < 3 and s[j : j + 1].isdigit():
                    oct_s += s[j : j + 1]
                    j += 1
                out.append(int(oct_s, 8) & 0xFF)
                i = j
                continue
            else:
                out += nxt
            i += 2
            continue
        out += s[i : i + 1]
        i += 1
    return bytes(out)


def title_of(obj: bytes) -> str | None:
    m = re.search(rb"/Title\s*\(", obj)
    if not m:
        return None
    raw = unescape(parse_literal_string(obj, m.end() - 1))
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", "replace")
    if raw.startswith(b"\xff\xfe"):
        return raw[2:].decode("utf-16-le", "replace")
    return raw.decode("utf-8", "replace")


def main() -> None:
    pdf = find_pdf(sys.argv[1] if len(sys.argv) > 1 else None)
    data = pdf.read_bytes()
    objects = load_objects(data)

    catalog = objects.get(2, b"")
    root_num = ref(catalog, "/Outlines")
    if root_num is None:
        sys.exit("这个 PDF 没有书签")
    root = objects.get(root_num)
    if root is None:
        sys.exit(f"找不到大纲根对象 {root_num}")

    lines: list[str] = []

    def walk(num: int | None, depth: int) -> None:
        guard = 0
        while num and guard < 5000:
            guard += 1
            obj = objects.get(num)
            if obj is None:
                break
            t = title_of(obj)
            lines.append("    " * depth + (t if t is not None else "(无标题)"))
            child = ref(obj, "/First")
            if child:
                walk(child, depth + 1)
            num = ref(obj, "/Next")

    walk(ref(root, "/First"), 0)

    print(f"文件：{pdf}")
    print(f"书签条目数：{len(lines)}")
    print()
    print("\n".join(lines))


if __name__ == "__main__":
    main()
