"""从 SQLite 版的开发库导出学习进度，供导入 Postgres 用。

一次性脚本，不进流水线。用法：

    python scripts/export_sqlite.py

读取 `prisma/dev.db`（旧的 SQLite 库），写出 `data/progress-export.json`
（已在 .gitignore 里）。输出里不出现任何 word id——只记 (chapterNo, orderInUnit)，
因为新库的 id 不一定和旧库一致，拿 id 当外键会静默错位。

SQLite 里 Prisma 的 DateTime 存的是**整数毫秒**，这里原样导出，导入端再转 Date。
"""

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "prisma" / "dev.db"
OUT = ROOT / "data" / "progress-export.json"


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"找不到 {DB}")

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row

    user = con.execute("SELECT id, name FROM User ORDER BY id LIMIT 1").fetchone()
    if user is None:
        raise SystemExit("User 表是空的，没有可导出的进度")

    settings = con.execute(
        "SELECT dailyNewLimit, dailyReviewLimit, accent, autoSpeak "
        "FROM UserSettings WHERE userId = ?",
        (user["id"],),
    ).fetchone()

    progress = con.execute(
        """
        SELECT u.chapterNo, w.orderInUnit,
               p.state, p.stability, p.difficulty, p.dueAt, p.scheduledDays,
               p.learningSteps, p.reps, p.lapses, p.lastReviewAt, p.createdAt
        FROM UserWordProgress p
        JOIN Word w ON w.id = p.wordId
        JOIN Unit u ON u.id = w.unitId
        ORDER BY u.chapterNo, w.orderInUnit
        """
    ).fetchall()

    logs = con.execute(
        """
        SELECT u.chapterNo, w.orderInUnit, l.rating, l.reviewedAt, l.elapsedMs
        FROM ReviewLog l
        JOIN Word w ON w.id = l.wordId
        JOIN Unit u ON u.id = w.unitId
        ORDER BY l.reviewedAt, l.id
        """
    ).fetchall()

    payload = {
        "user": {"name": user["name"]},
        "settings": dict(settings) if settings else None,
        "progress": [dict(r) for r in progress],
        "logs": [dict(r) for r in logs],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"user:     {user['name']}")
    print(f"settings: {'有' if settings else '无'}")
    print(f"progress: {len(progress)}")
    print(f"logs:     {len(logs)}")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
