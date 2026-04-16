/**
 * 格式化 Unix 时间戳为本地日期字符串。
 * 自动判断秒级 / 毫秒级时间戳，0 或无效值返回占位符。
 */
export function formatTs(
  ts: number | undefined | null,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (!ts) return '—';
  // 秒级时间戳（< 1e12 ≈ 2001 年的毫秒时间戳）转为毫秒
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', opts ?? { year: 'numeric', month: '2-digit', day: '2-digit' });
}
