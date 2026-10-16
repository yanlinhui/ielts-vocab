/**
 * content/passages/*.md 的解析。
 *
 * 文件格式（一篇之内）：
 *
 *     # 标题
 *
 *     正文……该章的词用 {{headword}} 包住。
 *
 *     ---
 *
 *     # 下一篇标题
 *
 * 用 `---` 单独一行分篇，`# ` 开头那一行是篇名。校验脚本和灌库脚本都走这里，
 * 免得两处各写一套解析、慢慢跑偏。
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "content", "passages");

/** 标记里的词。允许连字符（up-to-date 这种） */
const TAG = /\{\{([a-zA-Z][a-zA-Z-]*)\}\}/g;

export type ParsedPassage = {
  title: string;
  body: string;
  /** 正文里所有标记，含重复 */
  tags: string[];
};

export type ParsedFile = {
  file: string;
  chapterNo: number;
  passages: ParsedPassage[];
};

export function tagsOf(body: string): string[] {
  return [...body.matchAll(TAG)].map((m) => m[1]);
}

export function parsePassages(raw: string): ParsedPassage[] {
  return raw
    .split(/^---\s*$/m)
    .map((chunk) => {
      const t = chunk.trim();
      if (!t) return null;
      const m = t.match(/^#\s+(.+)$/m);
      if (!m) return null;
      const body = t.replace(/^#\s+.+$/m, "").trim();
      return { title: m[1].trim(), body, tags: tagsOf(body) };
    })
    .filter((p): p is ParsedPassage => p !== null);
}

export function readPassageFiles(): ParsedFile[] {
  return readdirSync(DIR)
    .filter((f) => /^chapter-\d+\.md$/.test(f))
    .sort()
    .map((file) => ({
      file,
      chapterNo: Number(file.match(/chapter-(\d+)\.md/)![1]),
      passages: parsePassages(readFileSync(path.join(DIR, file), "utf8")),
    }));
}

/** 把标记剥掉，得到读者实际看到的正文——用来数长度 */
export function plainText(body: string): string {
  return body.replace(TAG, "$1");
}
