// 展示用的格式化。评分按钮下面那行「下次：3 天后」就靠它——
// 那行字是让用户建立正确评分习惯的关键，不然所有人都会无脑点「一般」。

/** 距目标时间还有多久，说成人话。 */
export function formatInterval(target: Date | string, now: Date = new Date()): string {
  const ms = new Date(target).getTime() - now.getTime();
  if (ms <= 0) return "现在";

  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `${minutes} 分钟后`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;

  const days = Math.round(hours / 24);
  if (days === 1) return "明天";
  if (days < 30) return `${days} 天后`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月后`;
  return `${Math.round(days / 365)} 年后`;
}

/** 一个词是不是「今天之内还要再见」（用于会话内重排）。 */
export function isWithinSession(
  target: Date | string,
  now: Date = new Date(),
): boolean {
  const ms = new Date(target).getTime() - now.getTime();
  return ms > 0 && ms <= 20 * 60_000;
}

/** 本地日期，如 "2026年10月15日 周三"。 */
export function formatDate(d: Date = new Date()): string {
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${week}`;
}
