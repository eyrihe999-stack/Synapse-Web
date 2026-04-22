/**
 * 格式化时间戳为本地日期字符串。
 * 支持三种输入:Unix 秒级、Unix 毫秒级、ISO-8601 字符串(后端 time.Time 序列化结果)。
 * 0 / 空串 / 无效值统一返回占位符。
 */
export function formatTs(
  ts: number | string | undefined | null,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (ts == null || ts === '' || ts === 0) return '—';
  let d: Date;
  if (typeof ts === 'string') {
    d = new Date(ts);
  } else {
    // 秒级时间戳（< 1e12 ≈ 2001 年的毫秒时间戳）转为毫秒
    const ms = ts < 1e12 ? ts * 1000 : ts;
    d = new Date(ms);
  }
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', opts ?? { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * 把时间戳归一化成 Date。支持 Unix 秒/毫秒 + ISO 字符串;无效返 null。
 */
function parseTs(ts: number | string | undefined | null): Date | null {
  if (ts == null || ts === '' || ts === 0) return null;
  let d: Date;
  if (typeof ts === 'string') {
    d = new Date(ts);
  } else {
    d = new Date(ts < 1e12 ? ts * 1000 : ts);
  }
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 相对时间展示。
 *   过去 → "刚刚" / "3 分钟前" / "5 小时前" / "2 天前" / "3 个月前" / "1 年前"
 *   未来 → "1 分钟后" / "2 小时后" / "3 天后" / ...
 * 无效值返回占位符。
 */
export function formatRelativeTs(ts: number | string | undefined | null): string {
  const d = parseTs(ts);
  if (!d) return '—';
  const diffMs = d.getTime() - Date.now();
  const absSec = Math.abs(diffMs) / 1000;
  const future = diffMs > 0;
  const suffix = future ? '后' : '前';
  if (absSec < 45) return future ? '片刻后' : '刚刚';
  const min = absSec / 60;
  if (min < 60) return `${Math.floor(min)} 分钟${suffix}`;
  const hr = min / 60;
  if (hr < 24) return `${Math.floor(hr)} 小时${suffix}`;
  const day = hr / 24;
  if (day < 30) return `${Math.floor(day)} 天${suffix}`;
  const mon = day / 30;
  if (mon < 12) return `${Math.floor(mon)} 个月${suffix}`;
  return `${Math.floor(mon / 12)} 年${suffix}`;
}

/**
 * 同时展示相对 + 绝对时间。布局紧凑时展示 "3 天前 · 2025-04-19"。
 */
export function formatRelativeWithAbs(
  ts: number | string | undefined | null,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (parseTs(ts) == null) return '—';
  return `${formatRelativeTs(ts)} · ${formatTs(ts, opts)}`;
}

/**
 * 把字节数格式化成人类可读形式。负数或非法值返回占位符。
 */
export function formatBytes(bytes: number | undefined | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
