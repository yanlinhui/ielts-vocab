/**
 * 一格里一个大数字 + 一行小标签。首页那三格和统计页的 KPI 共用。
 *
 * 三格刻意长得一模一样——同色、同字号。首页那次教训：连续打卡曾经是朱砂的，
 * 三格并排时一格染色会让它们看起来不是一组；同一行里的同伴，要么都染要么都不染。
 *
 * `unit` 是给「天」这种单位用的：小一号、不加粗、走次要色。**不是每格都有**，
 * 但走的是同一套排版，所以有单位的格子看着仍像同一个家族的。
 * 单位必须比数字明显弱一档才读得出主从——上一版失败的那次是把「天」按正文字号
 * 排在数字旁边，两个字形差不多的字并排，看着像「两个字的词」。
 */
export default function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-center">
      <div className="font-serif text-3xl font-semibold tabular-nums">
        {value}
        {unit && (
          <span className="ml-1 text-sm font-normal text-[var(--color-muted)]">{unit}</span>
        )}
      </div>
      {/* 标签 10px 而不是全站微标签惯用的 11px：375px 下格子内容宽只有 72px，
          「连续打卡天数」6 个 11px 汉字加 0.12em 字距是 73.9px，最后一个「数」
          会被挤到第二行单独站着。10px 降到 67.2px，375px 余 5px。

          nowrap 是兜底：360px 下只剩 0.13px 余量，字体度量稍有出入就会换行。
          宁可让那 0.13px 溢出到卡片的内边距里（左右各 16px，看不见），也不要
          让「数」一个人掉到第二行——那才是一眼就看得出的破版。 */}
      <div className="mt-1 whitespace-nowrap text-[10px] tracking-[0.12em] text-[var(--color-muted)]">
        {label}
      </div>
    </div>
  );
}
