// 四档评分。
//
// 单独放一个文件、不写在 lib/srs.ts 里，是因为 srs.ts 会 import Prisma，
// 只能在服务端跑；而按钮、卡片这些客户端组件也要用这个类型和文案。
// 让客户端去 import 一个牵着数据库的文件是很容易踩的坑。

export type Rating = 1 | 2 | 3 | 4;

export interface RatingMeta {
  value: Rating;
  label: string;
  /** 悬停提示，帮用户理解该选哪档 */
  hint: string;
  /** 键盘快捷键 */
  key: string;
  /** CSS 变量名 */
  color: string;
}

export const RATINGS: readonly RatingMeta[] = [
  {
    value: 1,
    label: "忘了",
    hint: "完全没想起来，或者想错了",
    key: "1",
    color: "var(--color-rate-again)",
  },
  {
    value: 2,
    label: "困难",
    hint: "想起来了，但很费劲、犹豫了很久",
    key: "2",
    color: "var(--color-rate-hard)",
  },
  {
    value: 3,
    label: "一般",
    hint: "正常想起来了。最常用的一档",
    key: "3",
    color: "var(--color-rate-good)",
  },
  {
    value: 4,
    label: "简单",
    hint: "秒答，毫不费力",
    key: "4",
    color: "var(--color-rate-easy)",
  },
];
