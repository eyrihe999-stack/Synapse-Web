// AvatarStack 成员头像堆叠(最多显示 N 个,剩余"+X")。
//
// 使用:<AvatarStack items={[{id, displayName, avatarUrl}, ...]} max={4} />
// 密度紧凑的列表 / 卡片里展示"成员构成"用,比单独的 badge 列表更省横向空间。
import { clsx } from 'clsx';
import { UserAvatar } from './UserIdentity';

export interface AvatarStackItem {
  id: string | number;
  displayName: string;
  avatarUrl?: string;
}

interface AvatarStackProps {
  items: AvatarStackItem[];
  max?: number;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export function AvatarStack({ items, max = 4, size = 'sm', className }: AvatarStackProps) {
  const visible = items.slice(0, max);
  const extra = items.length - visible.length;
  return (
    <div className={clsx('flex items-center', className)}>
      {visible.map((item, idx) => (
        <div
          key={item.id}
          className={clsx(idx > 0 && '-ml-1.5')}
          title={item.displayName}
        >
          <UserAvatar
            avatarUrl={item.avatarUrl}
            fallback={item.displayName}
            size={size}
            tone="muted"
          />
        </div>
      ))}
      {extra > 0 && (
        <div
          className={clsx(
            '-ml-1.5 rounded-full bg-[#eeede8] border border-[#fbfaf8] flex items-center justify-center text-text-muted font-medium',
            size === 'xs' && 'w-5 h-5 text-[9px]',
            size === 'sm' && 'w-7 h-7 text-[10px]',
            size === 'md' && 'w-9 h-9 text-[12px]',
          )}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}
