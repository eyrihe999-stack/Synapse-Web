// InitiativesTab 项目下的 initiative + 关联 workstream 完整视图。
//
// 卡片可展开/收起,展开后看:
//   - 完整 description / target_outcome(创建/编辑时填的)
//   - 创建时间 / 创建人 ID
//   - 该 initiative 下所有 workstream 的详细列表(name + status + version + description + 跳到 channel)
//   - workstream 状态分桶进度(done/total)
//
// 卡片头始终带状态 chip + ws 进度 chip(`5 ws · 3 done`),让用户不展开就能看到关键信号。
//
// 工具栏:
//   - 显示已归档 toggle(默认隐藏)
//   - status filter(active / planned / completed / cancelled)
//   - 创建按钮
import { useMemo, useState } from 'react';
import {
  Target, Plus, Pencil, Archive, ChevronRight, ChevronDown, X,
  ExternalLink, Calendar, User, Workflow,
} from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import type {
  InitiativeResponse, VersionResponse, WorkstreamResponse,
} from '@/types/api';
import { statusTone, formatDateOnly, bucketWorkstreams } from './helpers';

interface InitiativesTabProps {
  initiatives: InitiativeResponse[]; // 已按 toggle 过滤
  versions: VersionResponse[];
  wsByInit: Map<number, WorkstreamResponse[]>;
  archived: boolean;
  showArchived: boolean;
  archivedCount: number;
  onToggleShowArchived: (next: boolean) => void;
  onCreate: () => void;
  onEdit: (init: InitiativeResponse) => void;
  onArchive: (init: InitiativeResponse) => void;
  onCreateWorkstream: (init: InitiativeResponse) => void;
  onEditWorkstream: (ws: WorkstreamResponse) => void;
  onCancelWorkstream: (ws: WorkstreamResponse) => void;
  onOpenChannel: (channelID: number) => void;
}

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'planned', label: '计划中' },
  { key: 'completed', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
];

export function InitiativesTab({
  initiatives, versions, wsByInit,
  archived, showArchived, archivedCount, onToggleShowArchived,
  onCreate, onEdit, onArchive,
  onCreateWorkstream, onEditWorkstream, onCancelWorkstream, onOpenChannel,
}: InitiativesTabProps) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const verName = useMemo(() => {
    const m = new Map<number, string>();
    for (const v of versions) m.set(v.id, v.name);
    return m;
  }, [versions]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return initiatives;
    return initiatives.filter((i) => i.status === statusFilter);
  }, [initiatives, statusFilter]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-[12px] text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => onToggleShowArchived(e.target.checked)}
            />
            显示已归档
            {archivedCount > 0 && <span className="text-text-muted">({archivedCount})</span>}
          </label>
          <div className="flex items-center gap-1 text-[11px]">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={clsx(
                  'px-2 py-0.5 rounded transition-colors',
                  statusFilter === f.key
                    ? 'bg-[#2383e2]/10 text-[#2383e2] font-medium'
                    : 'text-text-muted hover:text-text-primary hover:bg-[#eeede8]',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {!archived && (
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={onCreate}>
            新建 Initiative
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <GlassCard>
          <div className="py-6 text-center text-text-muted">
            <Target className="mx-auto w-6 h-6 mb-2" strokeWidth={1.5} />
            <p className="text-[13px]">
              {statusFilter !== 'all'
                ? `没有 status="${statusFilter}" 的 Initiative`
                : showArchived
                  ? '没有 Initiative(包括归档的)'
                  : '没有进行中的 Initiative'}
            </p>
            <p className="text-[11px] mt-1">
              {statusFilter !== 'all'
                ? '— 切换上方 filter 看其他状态'
                : showArchived
                  ? '— 还没建过任何 Initiative'
                  : archivedCount > 0
                    ? `— 已归档 ${archivedCount} 个,勾上"显示已归档"可看`
                    : 'Initiative 是"为什么做"的主题轴(可跨多个 version 持续推进)'}
            </p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {filtered.map((init) => {
            const wsList = wsByInit.get(init.id) ?? [];
            const buckets = bucketWorkstreams(wsList);
            const isArchivedInit = !!init.archived_at;
            const isExpanded = expanded.has(init.id);

            return (
              <GlassCard key={init.id} className={isArchivedInit ? 'opacity-60' : ''}>
                {/* 头部:折叠/展开 + 名字 + 状态 + 进度 + 操作 */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <button
                      onClick={() => toggleExpand(init.id)}
                      className="mt-0.5 p-0.5 text-text-muted hover:text-[#2383e2] rounded shrink-0"
                      title={isExpanded ? '收起' : '展开'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" strokeWidth={1.8} />
                      ) : (
                        <ChevronRight className="w-4 h-4" strokeWidth={1.8} />
                      )}
                    </button>
                    <Target className="w-4 h-4 text-[#2383e2] mt-0.5 shrink-0" strokeWidth={1.8} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[14px] font-medium text-text-primary truncate">
                          {init.name}
                        </h3>
                        <StatusChip tone={statusTone(init.status)}>{init.status}</StatusChip>
                        {init.is_system && <StatusChip tone="purple">system</StatusChip>}
                        {isArchivedInit && <StatusChip tone="neutral">已归档</StatusChip>}
                        {/* workstream 进度 chip */}
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-text-muted ml-1"
                          title={`总 ${buckets.total} · done ${buckets.done} · active ${buckets.active} · blocked ${buckets.blocked} · draft ${buckets.draft} · cancelled ${buckets.cancelled}`}
                        >
                          <Workflow className="w-3 h-3" strokeWidth={1.8} />
                          {buckets.total > 0
                            ? `${buckets.done}/${buckets.total} done`
                            : '0 ws'}
                        </span>
                      </div>
                      {!isExpanded && init.description && (
                        <p className="mt-0.5 text-[12px] text-text-secondary line-clamp-1">
                          {init.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!archived && !isArchivedInit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Plus className="w-3.5 h-3.5" />}
                        onClick={() => onCreateWorkstream(init)}
                      >
                        Workstream
                      </Button>
                    )}
                    {!archived && !isArchivedInit && !init.is_system && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil className="w-3.5 h-3.5" />}
                          onClick={() => onEdit(init)}
                          title="编辑"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Archive className="w-3.5 h-3.5" />}
                          onClick={() => onArchive(init)}
                          title="归档"
                        />
                      </>
                    )}
                  </div>
                </div>

                {/* 展开:完整信息 + workstream 详细列表 */}
                {isExpanded && (
                  <div className="mt-3 pl-9 space-y-3">
                    {init.description && (
                      <div>
                        <p className="text-[11px] text-text-muted mb-0.5">描述</p>
                        <p className="text-[13px] text-text-primary whitespace-pre-wrap">
                          {init.description}
                        </p>
                      </div>
                    )}
                    {init.target_outcome && (
                      <div>
                        <p className="text-[11px] text-text-muted mb-0.5">目标结果(Target Outcome)</p>
                        <p className="text-[13px] text-text-primary whitespace-pre-wrap">
                          {init.target_outcome}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-4 text-[11px] text-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> 创建于 {formatDateOnly(init.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3 h-3" /> 创建人 user#{init.created_by}
                      </span>
                      {init.archived_at && (
                        <span className="inline-flex items-center gap-1">
                          <Archive className="w-3 h-3" /> 归档于 {formatDateOnly(init.archived_at)}
                        </span>
                      )}
                    </div>

                    <div>
                      <p className="text-[11px] text-text-muted mb-1.5">
                        Workstreams ({wsList.length})
                        {buckets.total > 0 && (
                          <span className="ml-2">
                            {buckets.active > 0 && <span className="text-[#2383e2]">{buckets.active} 进行中 </span>}
                            {buckets.blocked > 0 && <span className="text-[#d97706]">{buckets.blocked} 阻塞 </span>}
                            {buckets.done > 0 && <span className="text-[#16a34a]">{buckets.done} 完成 </span>}
                            {buckets.draft > 0 && <span className="text-[#8a5cf6]">{buckets.draft} 草稿 </span>}
                            {buckets.cancelled > 0 && <span className="text-text-muted">{buckets.cancelled} 取消 </span>}
                          </span>
                        )}
                      </p>
                      {wsList.length === 0 ? (
                        <p className="text-[12px] text-text-muted italic">
                          暂无 workstream{!archived && !isArchivedInit && '。点上方"Workstream"按钮新建'}
                        </p>
                      ) : (
                        <div className="rounded-md border border-[#e8e7e3] bg-white">
                          {wsList.map((ws, idx) => (
                            <WorkstreamRow
                              key={ws.id}
                              ws={ws}
                              versionName={ws.version_id ? verName.get(ws.version_id) : undefined}
                              borderTop={idx > 0}
                              canEdit={!archived && !isArchivedInit}
                              onEdit={onEditWorkstream}
                              onCancel={onCancelWorkstream}
                              onOpenChannel={onOpenChannel}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── workstream 单行子组件 ──────────────────────────────────────────────────

interface WorkstreamRowProps {
  ws: WorkstreamResponse;
  versionName: string | undefined;
  borderTop: boolean;
  canEdit: boolean;
  onEdit: (ws: WorkstreamResponse) => void;
  onCancel: (ws: WorkstreamResponse) => void;
  onOpenChannel: (channelID: number) => void;
}

function WorkstreamRow({
  ws, versionName, borderTop, canEdit, onEdit, onCancel, onOpenChannel,
}: WorkstreamRowProps) {
  return (
    <div
      className={clsx(
        'group flex items-start gap-2 px-3 py-2',
        borderTop && 'border-t border-[#f0efe9]',
      )}
    >
      <Workflow className="w-3.5 h-3.5 text-[#2383e2] mt-0.5 shrink-0" strokeWidth={1.8} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-text-primary truncate">{ws.name}</span>
          <StatusChip tone={statusTone(ws.status)}>{ws.status}</StatusChip>
          <span className="text-[11px] text-text-muted">
            {ws.version_id ? `→ ${versionName ?? `v${ws.version_id}`}` : '→ Backlog'}
          </span>
        </div>
        {ws.description && (
          <p className="mt-0.5 text-[12px] text-text-secondary line-clamp-2">
            {ws.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {ws.channel_id && (
          <button
            type="button"
            onClick={() => onOpenChannel(ws.channel_id!)}
            className="p-1 text-text-muted hover:text-[#2383e2] rounded"
            title="进入 workstream channel"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => onEdit(ws)}
              className="p-1 text-text-muted hover:text-[#2383e2] rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="编辑"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {ws.status !== 'cancelled' && ws.status !== 'done' && (
              <button
                type="button"
                onClick={() => onCancel(ws)}
                className="p-1 text-text-muted hover:text-[#d44c47] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="取消(标记 cancelled)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
