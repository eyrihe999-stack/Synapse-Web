// Tabs 极简 tab 容器。外部控制 activeKey,内部只负责渲染按钮 + 触发 onChange。
//
// 只做水平 tab bar,不做左侧垂直 tab(KnowledgePage 已有自家的 routed tab 作为特例)。
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  // 右侧的计数 / 徽章(比如"消息 · 12")
  badge?: ReactNode;
  // 关联的 icon(lucide 组件类型,放在 label 前)
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  disabled?: boolean;
}

interface TabsProps<K extends string = string> {
  tabs: TabItem<K>[];
  activeKey: K;
  onChange: (key: K) => void;
  className?: string;
  // 底部 border 风格。inline=紧凑,underline=下划线激活态,segmented=胶囊分段
  variant?: 'underline' | 'segmented';
}

export function Tabs<K extends string = string>({
  tabs,
  activeKey,
  onChange,
  className,
  variant = 'underline',
}: TabsProps<K>) {
  if (variant === 'segmented') {
    return (
      <div
        className={clsx(
          'inline-flex items-center gap-0.5 p-0.5 rounded-md bg-[#eeede8]',
          className,
        )}
      >
        {tabs.map((t) => {
          const isActive = t.key === activeKey;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              disabled={t.disabled}
              onClick={() => !t.disabled && onChange(t.key)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1 rounded text-[13px] transition-colors',
                isActive
                  ? 'bg-white text-text-primary shadow-sm font-medium'
                  : 'text-text-secondary hover:text-text-primary',
                t.disabled && 'opacity-40 cursor-not-allowed',
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />}
              {t.label}
              {t.badge != null && (
                <span className="ml-0.5 text-[11px] text-text-muted">{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={clsx('flex items-end gap-0 border-b border-[#e8e7e3]', className)}>
      {tabs.map((t) => {
        const isActive = t.key === activeKey;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.key)}
            className={clsx(
              'relative flex items-center gap-1.5 px-3 py-2 text-[13px] transition-colors -mb-px border-b-2',
              isActive
                ? 'border-[#2383e2] text-text-primary font-medium'
                : 'border-transparent text-text-secondary hover:text-text-primary',
              t.disabled && 'opacity-40 cursor-not-allowed',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />}
            {t.label}
            {t.badge != null && (
              <span
                className={clsx(
                  'ml-0.5 px-1.5 py-0 text-[11px] rounded',
                  isActive ? 'bg-[#2383e2]/10 text-[#2383e2]' : 'bg-[#eeede8] text-text-muted',
                )}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
