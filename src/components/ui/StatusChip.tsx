// StatusChip 紧凑的状态标签。
//
// 5 种调色(对齐 index.css 的 --color-accent-*),用 tone prop 选;
// 未登记的 tone 走 neutral。文字长度建议 ≤ 8 字,超了会 truncate。
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type StatusTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'purple';

interface StatusChipProps {
  tone?: StatusTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

const TONE_STYLES: Record<StatusTone, string> = {
  neutral: 'bg-[#eeede8] text-text-secondary',
  blue: 'bg-[#2383e2]/[0.10] text-[#2383e2]',
  green: 'bg-[#448361]/[0.12] text-[#448361]',
  amber: 'bg-[#cb912f]/[0.12] text-[#cb912f]',
  red: 'bg-[#d44c47]/[0.12] text-[#d44c47]',
  purple: 'bg-[#8a5cf6]/[0.12] text-[#8a5cf6]',
};

export function StatusChip({ tone = 'neutral', children, icon, className }: StatusChipProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap',
        TONE_STYLES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
