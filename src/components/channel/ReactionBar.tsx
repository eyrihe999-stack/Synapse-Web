// ReactionBar 消息底部的 emoji 反应条(PR #12')。
//
// UI 形态:
//   - 每个被打过的 emoji 一个 pill:`👍 Alice, Bob`(用 displayName 列出全部人,不 summary)
//   - 点击 pill:若当前用户已打 → 撤销;否则 → 添加(反向切换)
//   - 右侧 +emoji 按钮 hover/click 展开预设 12 个 emoji 面板,点了就 add
//
// 和文本气泡 / system_event 卡片都挂在一起,通过 messageID + 现有 reactions 数组驱动。
// 更新走"乐观 UI + 失败回滚 + 成功后让外层轮询刷新"。
import { useState, useRef, useEffect } from 'react';
import { SmilePlus } from 'lucide-react';
import { clsx } from 'clsx';
import { channelApi } from '@/api/channel';
import { toast } from '@/components/ui/Toast';
import { ALLOWED_REACTION_EMOJIS, type ReactionEntry } from '@/types/api';
import type { PrincipalDirEntry } from '@/hooks/useOrgPrincipals';
import { apiCall } from '@/lib/api-helpers';

interface ReactionBarProps {
  messageID: number;
  reactions?: ReactionEntry[];
  /** 当前登录用户的 principal_id —— 判断某 pill 是否"已打过"*/
  currentPrincipalID: number;
  principalDirByID: Map<number, PrincipalDirEntry>;
  /** 点击后触发的外层刷新(让下一个轮询周期拿到最新结果)*/
  onChanged?: () => void;
  /** 某些场景(归档 channel、系统消息底下是否允许加反应)的禁用开关 */
  disabled?: boolean;
}

export function ReactionBar({
  messageID, reactions, currentPrincipalID, principalDirByID, onChanged, disabled,
}: ReactionBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyEmoji, setBusyEmoji] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点外部关面板
  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [pickerOpen]);

  const rs = reactions ?? [];
  const hasAny = rs.length > 0;

  async function toggle(emoji: string, mine: boolean) {
    if (disabled || busyEmoji) return;
    setBusyEmoji(emoji);
    const res = await apiCall(() =>
      mine ? channelApi.removeReaction(messageID, emoji)
           : channelApi.addReaction(messageID, emoji),
    );
    setBusyEmoji(null);
    if (res.ok) {
      onChanged?.();
    } else {
      toast('error', mine ? '撤销反应失败' : '添加反应失败');
    }
  }

  async function addFromPicker(emoji: string) {
    setPickerOpen(false);
    const existing = rs.find((r) => r.emoji === emoji);
    const mine = !!existing && existing.principal_ids.includes(currentPrincipalID);
    await toggle(emoji, mine);
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-1 flex-wrap">
      {hasAny && rs.map((r) => {
        const mine = r.principal_ids.includes(currentPrincipalID);
        const names = r.principal_ids
          .map((pid) => principalDirByID.get(pid)?.displayName ?? `#${pid}`)
          .join(', ');
        return (
          <button
            key={r.emoji}
            onClick={() => toggle(r.emoji, mine)}
            disabled={disabled || busyEmoji === r.emoji}
            title={names}
            className={clsx(
              'px-1.5 py-0.5 rounded-full border text-[11px] leading-none flex items-center gap-1 transition-colors',
              mine
                ? 'border-[#2383e2]/30 bg-[#f0f7ff] text-[#2366a8]'
                : 'border-[#e8e7e3] bg-white text-text-secondary hover:bg-[#f4f3ef]',
              (disabled || busyEmoji === r.emoji) && 'opacity-60 cursor-not-allowed',
            )}
          >
            <span className="text-[13px] leading-none">{r.emoji}</span>
            <span className="truncate max-w-[220px]">{names}</span>
          </button>
        );
      })}

      {!disabled && (
        <>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="px-1 py-0.5 rounded-full border border-dashed border-[#d6d5cf] text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
            title="添加反应"
          >
            <SmilePlus className="w-3 h-3" strokeWidth={1.8} />
          </button>

          {pickerOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 p-1.5 rounded-md border border-border-default bg-white shadow-md flex gap-0.5">
              {ALLOWED_REACTION_EMOJIS.map((e) => {
                const existing = rs.find((r) => r.emoji === e);
                const mine = !!existing && existing.principal_ids.includes(currentPrincipalID);
                return (
                  <button
                    key={e}
                    onClick={() => addFromPicker(e)}
                    className={clsx(
                      'w-7 h-7 rounded text-[16px] flex items-center justify-center transition-colors',
                      mine
                        ? 'bg-[#e9f2ff] text-[#2366a8]'
                        : 'hover:bg-[#f4f3ef]',
                    )}
                    title={mine ? '撤销 ' + e : '添加 ' + e}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
