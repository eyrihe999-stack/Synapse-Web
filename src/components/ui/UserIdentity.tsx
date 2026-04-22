// UserIdentity 用户身份卡 —— 所有展示"一个用户"的地方共用。
//
// 组合:
//   <UserAvatar>    纯头像(带字母 fallback)
//   <UserIdentity>  头像 + 名字 + badges + 副标题(email / user_id / 自定义)
//
// 业务信息网格(角色、加入时间、状态等)仍由各页面在 UserIdentity 外侧自行渲染 ——
// 本组件只负责"这是谁",不管"他在这个上下文里的属性"。
import type React from 'react';
import { clsx } from 'clsx';
import { Mail, Hash } from 'lucide-react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeCls: Record<AvatarSize, { box: string; text: string; name: string; sub: string }> = {
  xs: { box: 'h-6 w-6 rounded',     text: 'text-[10px]', name: 'text-[12px]', sub: 'text-[10px]' },
  sm: { box: 'h-8 w-8 rounded-md',  text: 'text-[12px]', name: 'text-[13px]', sub: 'text-[11px]' },
  md: { box: 'h-10 w-10 rounded-md', text: 'text-[14px]', name: 'text-[14px]', sub: 'text-[12px]' },
  lg: { box: 'h-12 w-12 rounded-lg', text: 'text-[16px]', name: 'text-[15px]', sub: 'text-[12px]' },
  xl: { box: 'h-16 w-16 rounded-xl', text: 'text-[20px]', name: 'text-[17px]', sub: 'text-[13px]' },
};

type AvatarTone = 'accent' | 'muted' | 'warn';

const toneCls: Record<AvatarTone, string> = {
  accent: 'bg-accent/[0.08] text-accent',
  muted: 'bg-bg-secondary text-text-secondary',
  warn: 'bg-amber-50 text-amber-700',
};

function pickInitial(s: string | null | undefined): string {
  const trimmed = (s ?? '').trim();
  if (!trimmed) return '?';
  // 取首个有意义字符(兼容 emoji / 中文 / 英文)
  const first = [...trimmed][0];
  return first ? first.toUpperCase() : '?';
}

interface UserAvatarProps {
  avatarUrl?: string | null;
  fallback?: string | null;
  size?: AvatarSize;
  className?: string;
  tone?: AvatarTone;
}

export function UserAvatar({
  avatarUrl,
  fallback,
  size = 'sm',
  className,
  tone = 'accent',
}: UserAvatarProps) {
  const cls = sizeCls[size];
  const initial = pickInitial(fallback);
  return (
    <div
      className={clsx(
        'flex items-center justify-center shrink-0 overflow-hidden',
        cls.box,
        toneCls[tone],
        className,
      )}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className={clsx('font-medium', cls.text)}>{initial}</span>
      )}
    </div>
  );
}

interface UserIdentityProps {
  avatarUrl?: string | null;
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
  // secondary 决定默认副标题组成。若传 subtitle 则忽略此项。
  //   email_and_id  email · ID 123   (默认)
  //   email         只 email
  //   user_id       只 ID
  //   none          不显示副标题
  secondary?: 'email_and_id' | 'email' | 'user_id' | 'none';
  // 自定义副标题 —— 覆盖 secondary
  subtitle?: React.ReactNode;
  // 名字旁边的 badges(例如 owner / 你 / 已是成员 / 已过期)
  badges?: React.ReactNode;
  // 右侧尾随内容(例如操作按钮)
  trailing?: React.ReactNode;
  size?: AvatarSize;
  avatarTone?: AvatarTone;
  className?: string;
}

export function UserIdentity({
  avatarUrl,
  displayName,
  email,
  userId,
  secondary = 'email_and_id',
  subtitle,
  badges,
  trailing,
  size = 'sm',
  avatarTone = 'accent',
  className,
}: UserIdentityProps) {
  const cls = sizeCls[size];
  const name = displayName || '未命名用户';
  const fallback = displayName || email || userId;

  // secondary 默认把 email 和 user_id 各占一行,风格统一为 "icon + 值"。
  //   email  → Mail  + email
  //   id     → Hash  + user_id(mono)
  // 传了 subtitle 则直接使用 subtitle(单行,由调用方自行设计)。
  const showEmail =
    subtitle === undefined && !!email && (secondary === 'email' || secondary === 'email_and_id');
  const showUserId =
    subtitle === undefined && !!userId && (secondary === 'user_id' || secondary === 'email_and_id');
  const hasSub = subtitle !== undefined || showEmail || showUserId;

  return (
    <div className={clsx('flex items-center gap-3 min-w-0', className)}>
      <UserAvatar avatarUrl={avatarUrl} fallback={fallback} size={size} tone={avatarTone} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={clsx('font-medium text-text-primary truncate', cls.name)}>
            {name}
          </span>
          {badges}
        </div>
        {hasSub && (
          <div className={clsx('text-text-muted space-y-0.5 leading-tight', cls.sub)}>
            {subtitle !== undefined ? (
              <div className="truncate">{subtitle}</div>
            ) : (
              <>
                {showEmail && (
                  <div className="flex items-center gap-1 min-w-0" title={email ?? undefined}>
                    <Mail className="h-3 w-3 shrink-0 opacity-70" strokeWidth={1.6} />
                    <span className="truncate">{email}</span>
                  </div>
                )}
                {showUserId && (
                  <div className="flex items-center gap-1 min-w-0 font-mono" title={userId ?? undefined}>
                    <Hash className="h-3 w-3 shrink-0 opacity-70" strokeWidth={1.6} />
                    <span className="truncate">{userId}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {trailing}
    </div>
  );
}
