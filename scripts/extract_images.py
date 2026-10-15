"""从扫描版 PDF 中抠出每页的 JPEG 图片。

这本书每页就是一整张 JPEG（PDF 里 334 个 /DCTDecode 流）。

为什么不能简单扫 FFD8/FFD9：
    实测该文件里有 1002 个 FFD8 标记，但真图只有 334 张——多出来的
    是嵌在 JPEG APP 段里的 EXIF 缩略图。模糊匹配会抠出几百张废图。

正确做法：解析 PDF 间接对象，读每个流自己的 /Length 字段精确取字节。

用法：
    python scripts/extract_images.py                # 抠全部图到 data/pages/
    python scripts/extract_images.py --list         # 只列出，不写文件
    python scripts/extract_images.py --limit 10     # 只抠前 10 张（调试用）
"""

from __future__ import annotations

import argparse
import glob
import re
import sys
from pathlib import Path

# 间接对象头： "12 0 obj"
OBJ_RE = re.compile(rb"(\d+)\s+(\d+)\s+obj\b")
# stream 关键字（排除 endstream）
STREAM_RE = re.compile(rb"(?<!end)stream\r?\n")
# /Length 123  或  /Length 123 0 R
LENGTH_DIRECT_RE = re.compile(rb"/Length\s+(\d+)(?!\s+\d+\s+R)")
LENGTH_REF_RE = re.compile(rb"/Length\s+(\d+)\s+\d+\s+R")

JPEG_SOI = b"\xff\xd8"
JPEG_EOI = b"\xff\xd9"


def find_pdf(path_arg: str | None) -> Path:
    if path_arg:
        p = Path(path_arg)
        if not p.exists():
            sys.exit(f"找不到文件：{p}")
        return p
    hits = glob.glob("*.pdf")
    if not hits:
        sys.exit("当前目录下没找到 PDF 文件，请用第一个参数指定路径")
    if len(hits) > 1:
        sys.exit(f"找到多个 PDF，请指定要处理哪个：\n  " + "\n  ".join(hits))
    return Path(hits[0])


def split_objects(data: bytes) -> list[tuple[int, int, bytes]]:
    """返回 [(对象号, 起始偏移, 对象体字节)]。

    对象体从 'obj' 之后开始，到下一个对象头之前结束。
    这样即使 endobj 缺失或格式不规范也能正确切分。
    """
    matches = list(OBJ_RE.finditer(data))
    objects = []
    for i, m in enumerate(matches):
        obj_num = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(data)
        objects.append((obj_num, start, data[start:end]))
    return objects


def resolve_indirect_length(data: bytes, ref_obj_num: int) -> int | None:
    """处理 /Length 12 0 R 这种间接引用：去那个对象里把数字读出来。"""
    pattern = re.compile(rb"\b" + str(ref_obj_num).encode() + rb"\s+\d+\s+obj\b(.{0,200}?)\bendobj", re.S)
    m = pattern.search(data)
    if not m:
        return None
    num = re.search(rb"(\d+)", m.group(1))
    return int(num.group(1)) if num else None


def extract_jpeg(body: bytes, data: bytes) -> tuple[bytes, str] | None:
    """从对象体里取出 JPEG 字节。返回 (jpeg字节, 提取方式) 或 None。"""
    # 只处理真正的图像 + DCTDecode（= JPEG）流
    header = body[: body.find(b"stream")] if b"stream" in body else body
    if b"/Image" not in header or b"/DCTDecode" not in header:
        return None

    sm = STREAM_RE.search(body)
    if not sm:
        return None
    stream_start = sm.end()

    length: int | None = None
    direct = LENGTH_DIRECT_RE.search(header)
    if direct:
        length = int(direct.group(1))
    else:
        ref = LENGTH_REF_RE.search(header)
        if ref:
            length = resolve_indirect_length(data, int(ref.group(1)))

    # 主路径：按 /Length 精确切
    if length is not None:
        candidate = body[stream_start : stream_start + length]
        if candidate.startswith(JPEG_SOI) and candidate.endswith(JPEG_EOI):
            return candidate, "length"

    # 回退路径：/Length 不可信时，从流起点找到第一个 FFD9 收尾
    tail = body[stream_start:]
    eoi = tail.find(JPEG_EOI)
    if tail.startswith(JPEG_SOI) and eoi != -1:
        return tail[: eoi + 2], "fallback"

    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="从扫描 PDF 抠出页面 JPEG")
    ap.add_argument("pdf", nargs="?", help="PDF 路径（省略则用当前目录唯一的 PDF）")
    ap.add_argument("--out", default="data/pages", help="输出目录（默认 data/pages）")
    ap.add_argument("--list", action="store_true", help="只列出图片信息，不写文件")
    ap.add_argument("--limit", type=int, default=0, help="最多处理多少张（0 = 全部）")
    args = ap.parse_args()

    pdf_path = find_pdf(args.pdf)
    print(f"读取：{pdf_path}")
    data = pdf_path.read_bytes()
    print(f"大小：{len(data) / 1024 / 1024:.1f} MB")

    objects = split_objects(data)
    print(f"间接对象数：{len(objects)}")

    results = []
    for obj_num, _offset, body in objects:
        got = extract_jpeg(body, data)
        if got:
            results.append((obj_num, got[0], got[1]))

    by_method = {}
    for _n, _j, method in results:
        by_method[method] = by_method.get(method, 0) + 1
    print(f"抠出 JPEG：{len(results)} 张   （提取方式：{by_method}）")

    if not results:
        sys.exit("一张图都没抠出来，解析逻辑需要检查")

    sizes = [len(j) for _n, j, _m in results]
    print(f"单张大小：最小 {min(sizes)/1024:.1f} KB / 平均 {sum(sizes)/len(sizes)/1024:.1f} KB / 最大 {max(sizes)/1024:.1f} KB")

    if args.list:
        for i, (obj_num, jpeg, method) in enumerate(results, 1):
            print(f"  {i:3d}. 对象 {obj_num:5d}  {len(jpeg)/1024:8.1f} KB  [{method}]")
        return

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    items = results[: args.limit] if args.limit else results
    for i, (_obj_num, jpeg, _method) in enumerate(items, 1):
        (out_dir / f"{i:03d}.jpg").write_bytes(jpeg)

    print(f"\n已写入 {len(items)} 张到 {out_dir}/")
    if args.limit:
        print(f"（--limit {args.limit} 生效，共抠出 {len(results)} 张）")


if __name__ == "__main__":
    main()
