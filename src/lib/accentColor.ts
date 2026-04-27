// accentColor 按 id 稳定生成一个"视觉色号"(6 色循环),给卡片做 accent 条和
// 图标圆底用。同一 id 每次返同样的色,换浏览器 / 重新登录后视觉一致。
//
// 不追求绝对均匀分布 —— 少量色号,简单取模即可。

export interface AccentPalette {
  // 用作 accent bar / 进度条的实色(#RRGGBB)
  solid: string;
  // 用作图标圆底的浅色(带透明)
  tintBg: string;
  // 用作图标前景的深色
  tintFg: string;
  // 悬浮发光色(hover 时渲染 shadow/ring)
  glow: string;
}

const PALETTES: AccentPalette[] = [
  {
    // 蓝(和 --color-accent 同源)
    solid: '#2383e2',
    tintBg: 'rgba(35, 131, 226, 0.10)',
    tintFg: '#2383e2',
    glow: 'rgba(35, 131, 226, 0.25)',
  },
  {
    // 紫
    solid: '#8a5cf6',
    tintBg: 'rgba(138, 92, 246, 0.10)',
    tintFg: '#8a5cf6',
    glow: 'rgba(138, 92, 246, 0.25)',
  },
  {
    // 绿(--color-accent-green)
    solid: '#448361',
    tintBg: 'rgba(68, 131, 97, 0.12)',
    tintFg: '#448361',
    glow: 'rgba(68, 131, 97, 0.25)',
  },
  {
    // 琥珀(--color-accent-amber)
    solid: '#cb912f',
    tintBg: 'rgba(203, 145, 47, 0.12)',
    tintFg: '#cb912f',
    glow: 'rgba(203, 145, 47, 0.25)',
  },
  {
    // 珊瑚红(--color-accent-red 暖一些的变体)
    solid: '#d86158',
    tintBg: 'rgba(216, 97, 88, 0.10)',
    tintFg: '#d86158',
    glow: 'rgba(216, 97, 88, 0.22)',
  },
  {
    // 青
    solid: '#0891b2',
    tintBg: 'rgba(8, 145, 178, 0.10)',
    tintFg: '#0891b2',
    glow: 'rgba(8, 145, 178, 0.25)',
  },
];

// hashID 小整数也能散开(MySQL autoincrement 1,2,3... 直接取模会连续相同色)。
// 用简单乘法 hash + xor,保证同 id 稳定、相邻 id 色号跳开。
function hashID(id: number): number {
  let h = id * 2654435761; // Knuth's multiplicative hash
  h ^= h >>> 16;
  return Math.abs(h | 0);
}

export function getAccent(id: number | string): AccentPalette {
  const n = typeof id === 'number' ? id : parseInt(String(id), 10) || 0;
  return PALETTES[hashID(n) % PALETTES.length];
}

// 取名字首字符 —— 中文 / 英文都取第一个(Array.from 对 emoji 也友好)。
export function pickInitial(name: string): string {
  if (!name) return '•';
  const chars = Array.from(name.trim());
  return chars[0].toUpperCase();
}
