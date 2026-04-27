// SystemEventCard kind=system_event 消息的渲染卡片。
//
// 后端 eventcard consumer 把 14 种 channel/task 事件转成 `kind=system_event`
// 消息,body 是结构化 JSON(见 types/api.ts SystemEventBody)。
// 这里按 event_type 分支渲染:图标 + 一句话文案 + 点击跳转(仅 task 类有跳转)。
//
// 前端**不做**数据回查 —— detail 里的 principal_id 用 principalDirByID 查 display_name,
// task_title / role / decision 等业务字段直接从 detail 读。未知 event_type 降级显示
// 原 body(防止新增后端事件类型时前端白屏)。
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList, Hand, FileText, Check, X as Cross, RotateCcw, Ban,
  UserPlus, UserMinus, Users, UserCog, Paperclip, FileMinus, Archive,
  Info, FilePlus, Lock, Unlock, FileEdit, Trash2,
} from 'lucide-react';
import type { PrincipalDirEntry } from '@/hooks/useOrgPrincipals';

interface SystemEventCardProps {
  /** 整条消息的 body(JSON 字符串)*/
  bodyJSON: string;
  /** 消息创建时间 ISO */
  createdAt: string;
  /** 查 actor / target 的 display_name 用 */
  principalDirByID: Map<number, PrincipalDirEntry>;
  /** 当前 channel id —— 用于 channel_document.* 卡片跳转(detail 里不带 channel_id) */
  channelId?: number;
}

interface ParsedBody {
  event_type: string;
  actor_principal_id: number;
  detail: Record<string, string>;
}

export function SystemEventCard({ bodyJSON, createdAt, principalDirByID, channelId }: SystemEventCardProps) {
  const navigate = useNavigate();

  const parsed = useMemo<ParsedBody | null>(() => {
    try {
      const obj = JSON.parse(bodyJSON);
      if (!obj || typeof obj !== 'object' || !obj.event_type) return null;
      return obj as ParsedBody;
    } catch {
      return null;
    }
  }, [bodyJSON]);

  if (!parsed) {
    return (
      <SystemEventShell icon={<Info className="w-3.5 h-3.5" />} tone="neutral" createdAt={createdAt}>
        <span className="text-text-muted">无法解析的系统事件</span>
      </SystemEventShell>
    );
  }

  const actorName = nameOf(principalDirByID, parsed.actor_principal_id);
  const d = parsed.detail || {};

  const taskLink = d.task_id
    ? () => navigate(`/org/tasks/${d.task_id}`)
    : undefined;

  const docLink = d.document_id && channelId
    ? () => navigate(`/org/channels/${channelId}/documents/${d.document_id}`)
    : undefined;

  switch (parsed.event_type) {
    case 'task.created': {
      const viaPid = d.created_via_principal_id ? Number(d.created_via_principal_id) : 0;
      const viaName = viaPid > 0 ? nameOf(principalDirByID, viaPid) : '';
      return (
        <SystemEventShell icon={<ClipboardList className="w-3.5 h-3.5" />} tone="blue" createdAt={createdAt} onClick={taskLink}>
          <b>{actorName}</b>
          {viaName ? <> 通过 <b>{viaName}</b> 派发了</> : <> 创建了</>}
          任务「<span className="text-accent">{d.task_title || `#${d.task_id}`}</span>」
          {d.assignee_principal_id && d.assignee_principal_id !== '0' && (
            <> 指派给 <b>{nameOf(principalDirByID, Number(d.assignee_principal_id))}</b></>
          )}
        </SystemEventShell>
      );
    }

    case 'task.claimed':
      return (
        <SystemEventShell icon={<Hand className="w-3.5 h-3.5" />} tone="blue" createdAt={createdAt} onClick={taskLink}>
          <b>{actorName}</b> 认领了任务「<span className="text-accent">{d.task_title || `#${d.task_id}`}</span>」
        </SystemEventShell>
      );

    case 'task.submitted':
      return (
        <SystemEventShell icon={<FileText className="w-3.5 h-3.5" />} tone="blue" createdAt={createdAt} onClick={taskLink}>
          <b>{actorName}</b> 提交了任务「<span className="text-accent">{d.task_title || `#${d.task_id}`}</span>」的产物
        </SystemEventShell>
      );

    case 'task.reviewed': {
      const decision = d.decision;
      const toneMap: Record<string, 'green' | 'amber' | 'red'> = {
        approved: 'green',
        request_changes: 'amber',
        rejected: 'red',
      };
      const iconMap: Record<string, React.ReactNode> = {
        approved: <Check className="w-3.5 h-3.5" />,
        request_changes: <RotateCcw className="w-3.5 h-3.5" />,
        rejected: <Cross className="w-3.5 h-3.5" />,
      };
      const verbMap: Record<string, string> = {
        approved: '通过了审批',
        request_changes: '打回重做了',
        rejected: '驳回了',
      };
      return (
        <SystemEventShell
          icon={iconMap[decision] ?? <FileText className="w-3.5 h-3.5" />}
          tone={toneMap[decision] ?? 'neutral'}
          createdAt={createdAt}
          onClick={taskLink}
        >
          <b>{actorName}</b> {verbMap[decision] ?? `审批(${decision})`}任务「
          <span className="text-accent">{d.task_title || `#${d.task_id}`}</span>」
        </SystemEventShell>
      );
    }

    case 'task.cancelled':
      return (
        <SystemEventShell icon={<Ban className="w-3.5 h-3.5" />} tone="neutral" createdAt={createdAt} onClick={taskLink}>
          <b>{actorName}</b> 取消了任务「<span className="text-accent">{d.task_title || `#${d.task_id}`}</span>」
        </SystemEventShell>
      );

    case 'task.assignee_changed': {
      const newA = Number(d.new_assignee_principal_id || 0);
      return (
        <SystemEventShell icon={<UserCog className="w-3.5 h-3.5" />} tone="blue" createdAt={createdAt} onClick={taskLink}>
          <b>{actorName}</b> 把任务「<span className="text-accent">{d.task_title || `#${d.task_id}`}</span>」
          {newA === 0
            ? ' 执行人清空了'
            : <> 改派给 <b>{nameOf(principalDirByID, newA)}</b></>}
        </SystemEventShell>
      );
    }

    case 'task.reviewers_changed':
      return (
        <SystemEventShell icon={<Users className="w-3.5 h-3.5" />} tone="blue" createdAt={createdAt} onClick={taskLink}>
          <b>{actorName}</b> 更新了任务「<span className="text-accent">{d.task_title || `#${d.task_id}`}</span>」的审批人
          {d.new_reviewer_count && <>({d.new_reviewer_count} 人,需 {d.new_required_approvals} 通过)</>}
        </SystemEventShell>
      );

    case 'channel.member_added': {
      const target = Number(d.target_principal_id || 0);
      return (
        <SystemEventShell icon={<UserPlus className="w-3.5 h-3.5" />} tone="green" createdAt={createdAt}>
          <b>{actorName}</b> 把 <b>{nameOf(principalDirByID, target)}</b> 加入了 channel
          {d.role && <>(角色:{displayRole(d.role)})</>}
        </SystemEventShell>
      );
    }

    case 'channel.member_removed': {
      const target = Number(d.target_principal_id || 0);
      return (
        <SystemEventShell icon={<UserMinus className="w-3.5 h-3.5" />} tone="red" createdAt={createdAt}>
          <b>{actorName}</b> 把 <b>{nameOf(principalDirByID, target)}</b> 移出了 channel
        </SystemEventShell>
      );
    }

    case 'channel.member_role_changed': {
      const target = Number(d.target_principal_id || 0);
      return (
        <SystemEventShell icon={<UserCog className="w-3.5 h-3.5" />} tone="blue" createdAt={createdAt}>
          <b>{actorName}</b> 把 <b>{nameOf(principalDirByID, target)}</b> 的角色从 {displayRole(d.old_role)} 改为 {displayRole(d.new_role)}
        </SystemEventShell>
      );
    }

    case 'channel.kb_attached':
      return (
        <SystemEventShell icon={<Paperclip className="w-3.5 h-3.5" />} tone="blue" createdAt={createdAt}>
          <b>{actorName}</b> 挂载了知识源
          {d.kb_source_id && d.kb_source_id !== '0' && <>(source #{d.kb_source_id})</>}
          {d.kb_document_id && d.kb_document_id !== '0' && <>(document #{d.kb_document_id})</>}
        </SystemEventShell>
      );

    case 'channel.kb_detached':
      return (
        <SystemEventShell icon={<FileMinus className="w-3.5 h-3.5" />} tone="neutral" createdAt={createdAt}>
          <b>{actorName}</b> 解除了知识源挂载
          {d.kb_source_id && d.kb_source_id !== '0' && <>(source #{d.kb_source_id})</>}
        </SystemEventShell>
      );

    case 'channel.archived':
      return (
        <SystemEventShell icon={<Archive className="w-3.5 h-3.5" />} tone="neutral" createdAt={createdAt}>
          <b>{actorName}</b> 归档了 channel
          {d.cascaded_from_project_id && <>(级联自项目归档)</>}
        </SystemEventShell>
      );

    // ── 共享文档(PR #9') ──
    case 'channel_document.created':
      return (
        <SystemEventShell icon={<FilePlus className="w-3.5 h-3.5" />} tone="green" createdAt={createdAt} onClick={docLink}>
          <b>{actorName}</b> 新建了文档「
          <span className="text-accent">{d.document_title || `#${d.document_id}`}</span>」
        </SystemEventShell>
      );

    case 'channel_document.locked':
      return (
        <SystemEventShell icon={<Lock className="w-3.5 h-3.5" />} tone="amber" createdAt={createdAt} onClick={docLink}>
          <b>{actorName}</b> 正在编辑「
          <span className="text-accent">{d.document_title || `#${d.document_id}`}</span>」
        </SystemEventShell>
      );

    case 'channel_document.unlocked': {
      const forced = d.forced === 'true';
      const priorPID = Number(d.prior_holder_principal || 0);
      return (
        <SystemEventShell icon={<Unlock className="w-3.5 h-3.5" />} tone="neutral" createdAt={createdAt} onClick={docLink}>
          {forced ? (
            <>
              <b>{actorName}</b> 强制解锁了「
              <span className="text-accent">{d.document_title || `#${d.document_id}`}</span>」
              {priorPID > 0 && <>(原持有人 <b>{nameOf(principalDirByID, priorPID)}</b>)</>}
            </>
          ) : (
            <>
              <b>{actorName}</b> 完成了「
              <span className="text-accent">{d.document_title || `#${d.document_id}`}</span>」的编辑
            </>
          )}
        </SystemEventShell>
      );
    }

    case 'channel_document.updated': {
      const versionShort = (d.version || '').slice(0, 7);
      return (
        <SystemEventShell icon={<FileEdit className="w-3.5 h-3.5" />} tone="blue" createdAt={createdAt} onClick={docLink}>
          <b>{actorName}</b> 保存了「
          <span className="text-accent">{d.document_title || `#${d.document_id}`}</span>」
          {versionShort && <> v<span className="font-mono">{versionShort}</span></>}
          {d.edit_summary && <>:{d.edit_summary}</>}
        </SystemEventShell>
      );
    }

    case 'channel_document.deleted':
      return (
        <SystemEventShell icon={<Trash2 className="w-3.5 h-3.5" />} tone="red" createdAt={createdAt}>
          <b>{actorName}</b> 删除了文档「{d.document_title || `#${d.document_id}`}」
        </SystemEventShell>
      );

    default:
      return (
        <SystemEventShell icon={<Info className="w-3.5 h-3.5" />} tone="neutral" createdAt={createdAt}>
          <span className="text-text-muted">未知事件类型:{parsed.event_type}</span>
        </SystemEventShell>
      );
  }
}

// ─── 壳 + 样式 ─────────────────────────────────────────────────────────────

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

const toneClass: Record<Tone, string> = {
  neutral: 'border-[#e8e7e3] bg-[#f8f7f3] text-text-secondary',
  blue:    'border-[#c7e1ff] bg-[#f0f7ff] text-[#2366a8]',
  green:   'border-[#c7ebd2] bg-[#f0faf3] text-[#2e7d4a]',
  amber:   'border-[#f0d9a6] bg-[#fdf6e6] text-[#9a6814]',
  red:     'border-[#f0c2c2] bg-[#fdf0f0] text-[#a5342f]',
};

function SystemEventShell({
  icon, tone, createdAt, children, onClick,
}: {
  icon: React.ReactNode;
  tone: Tone;
  createdAt: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const time = formatTime(createdAt);
  const clickable = !!onClick;
  return (
    <div
      className={`mx-auto max-w-[80%] px-3 py-1.5 rounded-md border text-[12px] flex items-center gap-2 ${toneClass[tone]} ${clickable ? 'cursor-pointer hover:brightness-95' : ''}`}
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 leading-relaxed">{children}</span>
      <span className="shrink-0 text-[10px] opacity-70">{time}</span>
    </div>
  );
}

function nameOf(dir: Map<number, PrincipalDirEntry>, pid: number): string {
  if (!pid) return '未知';
  return dir.get(pid)?.displayName ?? `principal#${pid}`;
}

function displayRole(role: string | undefined): string {
  switch (role) {
    case 'owner': return '所有者';
    case 'member': return '成员';
    case 'observer': return '观察者';
    default: return role ?? '?';
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}
