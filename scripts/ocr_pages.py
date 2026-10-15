"""对抠出来的页面图做 OCR，输出每页的文字。

为什么需要它：
    这本书是纯扫描件，没有文字层，而 AI 读图在本环境不可用
    （Read 返回 Unsupported Image）。所以只能靠本地 OCR 拿到文字，
    再据此判断书的单元结构、抽取单词。

依赖（装在项目 .venv 里）：
    .venv/Scripts/python.exe -m pip install --index-url https://pypi.org/simple/ rapidocr onnxruntime Pillow

用法：
    python scripts/ocr_pages.py --pages 1-12        # 先只看前 12 页，判断结构
    python scripts/ocr_pages.py --all               # 全书（很慢，几分钟到几十分钟）
    python scripts/ocr_pages.py --pages 1-12 --json # 额外输出带坐标的 JSON
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import re
import sys
import time
from pathlib import Path

# 每个 worker 只用 1 个线程：多进程 + 多线程会让 CPU 互相抢，反而更慢。
# 必须在导入 onnxruntime / numpy 之前设置，所以放在模块最顶部。
for _var in (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
):
    os.environ.setdefault(_var, "1")


def load_engine():
    """新版包名是 rapidocr，旧版是 rapidocr_onnxruntime，两个都兼容。"""
    try:
        from rapidocr import RapidOCR  # type: ignore

        return RapidOCR(), "rapidocr"
    except ImportError:
        pass
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore

        return RapidOCR(), "rapidocr_onnxruntime"
    except ImportError:
        sys.exit(
            "没装 OCR 引擎。请先运行：\n"
            "  .venv/Scripts/python.exe -m pip install "
            "--index-url https://pypi.org/simple/ rapidocr onnxruntime Pillow"
        )


def normalize(raw) -> list[tuple[list, str, float]]:
    """把两种 API 的返回值统一成 [(box, text, score), ...]。

    新版 rapidocr：返回对象，带 .boxes / .txts / .scores
    旧版 rapidocr_onnxruntime：返回 (结果列表, 耗时)，结果是 [[box, text, score], ...]
    """
    if raw is None:
        return []
    if hasattr(raw, "txts"):
        boxes = getattr(raw, "boxes", None)
        txts = raw.txts or ()
        scores = getattr(raw, "scores", None) or [0.0] * len(txts)
        out = []
        for i, t in enumerate(txts):
            box = boxes[i].tolist() if boxes is not None else []
            out.append((box, t, float(scores[i])))
        return out
    if isinstance(raw, tuple) and len(raw) == 2 and not isinstance(raw[1], str):
        raw = raw[0]
    if not raw:
        return []
    return [(item[0], item[1], float(item[2])) for item in raw]


def _x_center(item) -> float:
    box = item[0]
    if not box:
        return 0.0
    xs = [p[0] for p in box]
    return (min(xs) + max(xs)) / 2


def split_columns(items):
    """判断页面是不是双栏，是则按「左栏整体 → 右栏整体」切开。

    这本书是双栏排版。OCR 给的是散块，若只按 y 排序，左右两栏就会
    交错串行，整个词条结构就毁了。

    做法：找一个竖直切分位置 x，使「不跨越它」的文字块最多。因为有
    少量横跨两栏的标题会干扰，所以允许最多 15% 的块跨越。
    """
    boxes = [it[0] for it in items if len(it[0]) == 4]
    if len(boxes) < 8:
        return [items]

    spans = [(min(p[0] for p in b), max(p[0] for p in b)) for b in boxes]
    lo = min(a for a, _ in spans)
    hi = max(b for _, b in spans)
    width = hi - lo
    if width <= 0:
        return [items]

    best = None
    for k in range(1, 100):
        frac = k / 100
        if not 0.25 <= frac <= 0.75:
            continue
        x = lo + width * frac
        cross = sum(1 for a, b in spans if a < x < b)
        n_left = sum(1 for a, b in spans if b <= x)
        n_right = sum(1 for a, b in spans if a >= x)
        if n_left < len(boxes) * 0.2 or n_right < len(boxes) * 0.2:
            continue
        if best is None or cross < best[0]:
            best = (cross, x)

    if best is None or best[0] > len(boxes) * 0.15:
        return [items]

    cut = best[1]
    left = [it for it in items if _x_center(it) < cut]
    right = [it for it in items if _x_center(it) >= cut]
    return [left, right]


def order_page(items):
    """整页阅读顺序：双栏则左栏读到底再读右栏，单栏则直接从上到下。"""
    out = []
    for col in split_columns(items):
        out.extend(sort_lines(col))
    return out


def group_lines(items: list[tuple[list, str, float]]) -> list[list[tuple[list, str, float]]]:
    """把一块块文字按「同一行」分组，行内再按 x 从左到右排。

    必须保留分组信息：OCR 常把「单词 + 音标」拆成左右两块，若直接展平
    成一个个块，单词和它的音标就变成两行了。词目识别需要看到完整的行。

    行高的估算：用「纵中心差 < 本块高度 × 0.6」判断是否同一行，避免
    同一行文字因轻微高度差被拆散。
    """

    def key(item):
        box = item[0]
        if not box:
            return (0.0, 0.0)
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        return (min(ys), min(xs))

    items = sorted(items, key=key)
    lines: list[list[tuple[list, str, float]]] = []
    for item in items:
        box = item[0]
        if not box:
            if lines:
                lines[-1].append(item)
            else:
                lines.append([item])
            continue
        ys = [p[1] for p in box]
        y_mid = (min(ys) + max(ys)) / 2
        h = max(1.0, max(ys) - min(ys))
        placed = False
        for line in lines:
            ref = line[0][0]
            rys = [p[1] for p in ref]
            r_mid = (min(rys) + max(rys)) / 2
            if abs(y_mid - r_mid) < h * 0.6:
                line.append(item)
                placed = True
                break
        if not placed:
            lines.append([item])

    for line in lines:
        line.sort(key=lambda it: min((p[0] for p in it[0]), default=0.0))
    return lines


def sort_lines(items: list[tuple[list, str, float]]) -> list[tuple[list, str, float]]:
    """单栏内按阅读顺序排：先纵坐标（行），再横坐标（列）。"""
    out = []
    for line in group_lines(items):
        out.extend(line)
    return out


def parse_page_spec(spec: str, total: int) -> list[int]:
    """支持 '1-12' / '1,3,5' / '1-5,9' 三种写法。"""
    pages: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", part)
        if m:
            pages.extend(range(int(m.group(1)), int(m.group(2)) + 1))
            continue
        if part.isdigit():
            pages.append(int(part))
            continue
        sys.exit(f"看不懂的页码写法：{part}")
    return [p for p in sorted(set(pages)) if 1 <= p <= total]


# ---- 多进程 worker ----
# 模型加载一次要几秒，不能每页都加载。放在 initializer 里，每个进程只加载一次。
_ENGINE = None


def _worker_init() -> None:
    global _ENGINE
    _ENGINE = load_engine()[0]


def _worker_run(task):
    """处理一页。task = (序号, 总数, 图片路径字符串)。"""
    _idx, _total, path_str = task
    t0 = time.time()
    try:
        items = order_page(normalize(_ENGINE(path_str)))
    except Exception as exc:  # noqa: BLE001 — 单页失败不该拖垮整批
        return {"path": path_str, "error": f"{type(exc).__name__}: {exc}"}
    return {
        "path": path_str,
        "n": len(items),
        "text": "\n".join(it[1] for it in items),
        "json": [{"text": it[1], "score": round(it[2], 3), "box": it[0]} for it in items],
        "elapsed": time.time() - t0,
    }


def check_deps() -> None:
    """在父进程先探一次依赖，避免每个 worker 都抛一样的错。"""
    for mod in ("rapidocr", "rapidocr_onnxruntime"):
        try:
            __import__(mod)
            return
        except ImportError:
            continue
    sys.exit(
        "没装 OCR 引擎。请先运行：\n"
        "  .venv/Scripts/python.exe -m pip install "
        "--index-url https://pypi.org/simple/ rapidocr onnxruntime Pillow"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="对页面图做 OCR")
    ap.add_argument("--input", default="data/pages", help="页面图目录")
    ap.add_argument("--out", default="data/ocr", help="输出目录")
    ap.add_argument("--pages", help="页码，如 1-12 或 1,3,5")
    ap.add_argument("--all", action="store_true", help="处理全部页面")
    ap.add_argument("--json", action="store_true", help="额外输出带坐标的 JSON")
    ap.add_argument("--workers", type=int, default=6, help="并行进程数（默认 6）")
    ap.add_argument(
        "--skip-existing",
        action="store_true",
        help="已经输出过 .txt 的页面就跳过（断点续跑用）",
    )
    args = ap.parse_args()

    in_dir = Path(args.input)
    images = sorted(in_dir.glob("*.jpg"))
    if not images:
        sys.exit(f"{in_dir} 里没有 jpg，先跑 scripts/extract_images.py")

    if args.all:
        targets = images
    elif args.pages:
        wanted = parse_page_spec(args.pages, len(images))
        targets = [images[p - 1] for p in wanted]
    else:
        sys.exit("请指定 --pages 1-12 或 --all")

    check_deps()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.skip_existing:
        before = len(targets)
        targets = [t for t in targets if not (out_dir / f"{t.stem}.txt").exists()]
        print(f"已完成，跳过 {before - len(targets)} 页")
    if not targets:
        print("没有需要处理的页面")
        return

    workers = max(1, args.workers)
    print(f"待处理 {len(targets)} 页，并行 {workers} 个进程")

    started = time.time()
    done = 0
    failed = 0
    tasks = [(i, len(targets), str(img)) for i, img in enumerate(targets, 1)]

    if workers == 1:
        _worker_init()
        stream = (_worker_run(t) for t in tasks)
        pool = None
    else:
        pool = mp.Pool(workers, initializer=_worker_init)
        stream = pool.imap_unordered(_worker_run, tasks)

    try:
        for r in stream:
            done += 1
            stem = Path(r["path"]).stem
            if "error" in r:
                failed += 1
                print(f"  [{done}/{len(targets)}] {stem} 失败：{r['error']}", flush=True)
                continue
            (out_dir / f"{stem}.txt").write_text(r["text"], encoding="utf-8")
            if args.json:
                (out_dir / f"{stem}.json").write_text(
                    json.dumps(r["json"], ensure_ascii=False, indent=1), encoding="utf-8"
                )
            if done % 10 == 0 or done == len(targets):
                elapsed = time.time() - started
                rate = done / elapsed if elapsed else 0
                left = (len(targets) - done) / rate if rate else 0
                print(
                    f"  [{done}/{len(targets)}] 已用 {elapsed:.0f}s，预计还需 {left:.0f}s",
                    flush=True,
                )
    finally:
        if pool is not None:
            pool.close()
            pool.join()

    tail = f"，失败 {failed} 页" if failed else ""
    print(f"\n完成 {len(targets)} 页{tail}，用时 {time.time()-started:.0f}s，输出到 {out_dir}/")


if __name__ == "__main__":
    main()
