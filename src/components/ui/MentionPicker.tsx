// MentionPicker 输入框 @ 提及候选面板。
//
// 用法:
//   父组件维护 textarea 的 value + cursor,发现 "@xxx" 查询时把 query 传进来,
//   本组件弹 dropdown 列匹配的 principal;用户选中后通过 onPick 回调返回 principal,
//   父组件负责替换文本 + 把 principal_id 加入 mentions 数组。
//
// 键盘:
//   ↑↓ 移动高亮(父组件捕获 keydown 再 forward 过来,通过 activeIndex prop 控制)
//   Enter 选当前项(父组件捕获后调 onPick)
//   Esc 关闭(父组件控制 open state)
//
// 设计取舍:用受控模式 —— 不在组件内 listen 全局 keydown,避免和 textarea 行为打架。
import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { Bot, Globe2, UserCircle2 } from 'lucide-react';
import { UserAvatar } from './UserIdentity';
import type { PrincipalDirEntry } from '@/hooks/useOrgPrincipals';

interface MentionPickerProps {
  candidates: PrincipalDirEntry[];
  activeIndex: number;
  onPick: (entry: PrincipalDirEntry) => void;
  onHover: (index: number) => void;
  // 相对 textarea 的定位锚点;父组件算好传进来
  anchor?: { left: number; bottom: number };
}

export function MentionPicker({
  candidates,
  activeIndex,
  onPick,
  onHover,
  anchor,
}: MentionPickerProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // 保证 active 项在可视区
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLLIElement>(`[data-idx="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (candidates.length === 0) {
    return (
      <div
        className="absolute z-40 min-w-[220px] rounded-md bg-white border border-[#e3e2dc] shadow-lg p-3 text-[12px] text-text-muted"
        style={
          anchor
            ? { left: anchor.left, bottom: anchor.bottom }
            : { left: 0, bottom: '100%', marginBottom: 8 }
        }
      >
        没有匹配的成员
      </div>
    );
  }

  return (
    <div
      className="absolute z-40 w-[280px] rounded-md bg-white border border-[#e3e2dc] shadow-lg overflow-hidden"
      style={
        anchor
          ? { left: anchor.left, bottom: anchor.bottom }
          : { left: 0, bottom: '100%', marginBottom: 8 }
      }
    >
      <ul ref={listRef} className="max-h-[220px] overflow-y-auto py-1">
        {candidates.map((c, idx) => {
          const isActive = idx === activeIndex;
          return (
            <li
              key={`${c.kind}-${c.principalId}`}
              data-idx={idx}
              onMouseDown={(e) => {
                e.preventDefault(); // 不让 textarea 失焦
                onPick(c);
              }}
              onMouseEnter={() => onHover(idx)}
              className={clsx(
                'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-[13px]',
                isActive ? 'bg-[#2383e2]/[0.08]' : 'hover:bg-[#f4f3ef]',
              )}
            >
              {c.kind === 'agent' ? (
                <div className="w-6 h-6 rounded-full bg-[#2383e2]/10 flex items-center justify-center shrink-0">
                  {c.isGlobalAgent ? (
                    <Globe2 className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                  ) : (
                    <Bot className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                  )}
                </div>
              ) : (
                <UserAvatar
                  avatarUrl={c.avatarUrl}
                  fallback={c.displayName}
                  size="xs"
                  tone="muted"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    className={clsx(
                      'truncate',
                      isActive ? 'text-[#2383e2] font-medium' : 'text-text-primary',
                    )}
                  >
                    {c.displayName}
                  </span>
                  {c.isGlobalAgent && (
                    <span className="text-[10px] px-1 py-px rounded bg-[#2383e2]/10 text-[#2383e2] font-medium whitespace-nowrap">
                      全局
                    </span>
                  )}
                  {c.kind === 'agent' && !c.isGlobalAgent && (
                    <span className="text-[10px] text-text-muted whitespace-nowrap">agent</span>
                  )}
                </div>
                {c.secondary && (
                  <div className="text-[11px] text-text-muted truncate">{c.secondary}</div>
                )}
              </div>
              {c.kind === 'user' && !c.avatarUrl && (
                <UserCircle2 className="w-4 h-4 text-text-muted shrink-0" strokeWidth={1.5} />
              )}
            </li>
          );
        })}
      </ul>
      <div className="px-2 py-1 text-[10px] text-text-muted border-t border-[#f0efe9] bg-[#fbfaf8]">
        ↑↓ 切换 · Enter 选中 · Esc 关闭
      </div>
    </div>
  );
}
