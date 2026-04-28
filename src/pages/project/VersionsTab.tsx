// VersionsTab 项目下 version 列表 + 编辑 + 关联 ws 详情。
//
// 行可展开,展开后看:
//   - target_date / released_at / created_at(创建人)
//   - 这版下挂的 workstream 按 initiative 分组(各组 done/total 进度)
//   - 跳转到 workstream channel
//
// 行头始终有进度条(done/total),让用户不展开就能看到本版进度。
import { useMemo, useState } from 'react';
import {
  GitBranch, Plus, Pencil, ChevronRight, ChevronDown, Calendar, User,
  Workflow, Target, ExternalLink,
} from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import type {
  VersionResponse, WorkstreamResponse, InitiativeResponse,
} from '@/types/api';
import { statusTone, formatDateOnly, bucketWorkstreams } from './helpers';

interface VersionsTabProps {
  versions: VersionResponse[];
  initiatives: InitiativeResponse[]; // 用于反查 initiative.name
  // wsByVer: version_id → workstreams(version_id IS NULL 的不在这,所以只用关心非 null);
  // 由父组件构造,基于 roadmap 数据。
  wsByVer: Map<number, WorkstreamResponse[]>;
  archived: boolean;
  onCreate: () => void;
  onEdit: (v: VersionResponse) => void;
  onOpenChannel: (channelID: number) => void;
}

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'planning', label: '计划中' },
  { key: 'active', label: '进行中' },
  { key: 'released', label: '已发布' },
  { key: 'cancelled', label: '已取消' },
];

export function VersionsTab({
  versions, initiatives, wsByVer, archived, onCreate, onEdit, onOpenChannel,
}: VersionsTabProps) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const initName = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of initiatives) m.set(i.id, i.name);
    return m;
  }, [initiatives]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return versions;
    return versions.filter((v) => v.status === statusFilter);
  }, [versions, statusFilter]);

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
        {!archived && (
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={onCreate}>
            新建 version
          </Button>
        )}
      </div>
      {filtered.length === 0 ? (
        <GlassCard>
          <div className="py-6 text-center text-text-muted">
            <GitBranch className="mx-auto w-6 h-6 mb-2" strokeWidth={1.5} />
            <p className="text-[13px]">
              {statusFilter !== 'all' ? `没有 status="${statusFilter}" 的 version` : '还没有 version'}
            </p>
            <p className="text-[11px] mt-1">Version 是项目的里程碑 / 发布点标签</p>
          </div>
        </GlassCard>
      ) : (
        <div className="rounded-md border border-[#e8e7e3] bg-white">
          {filtered.map((v, idx) => {
            const wsList = wsByVer.get(v.id) ?? [];
            const buckets = bucketWorkstreams(wsList);
            const pct = buckets.total > 0 ? Math.round((buckets.done / buckets.total) * 100) : 0;
            const isExpanded = expanded.has(v.id);

            return (
              <div
                key={v.id}
                className={clsx(idx > 0 && 'border-t border-[#f0efe9]')}
              >
                <div className="group flex items-center gap-3 px-3 py-2">
                  <button
                    onClick={() => toggleExpand(v.id)}
                    className="p-0.5 text-text-muted hover:text-[#2383e2] rounded shrink-0"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.8} />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.8} />
                    )}
                  </button>
                  <GitBranch className="w-4 h-4 text-text-muted" strokeWidth={1.8} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-medium text-text-primary">{v.name}</p>
                      {v.is_system && <StatusChip tone="purple">system</StatusChip>}
                      <StatusChip tone={statusTone(v.status)}>{v.status}</StatusChip>
                      {buckets.total > 0 && (
                        <span className="text-[11px] text-text-muted">
                          {buckets.done}/{buckets.total} done · {pct}%
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {v.target_date
                        ? `目标 ${formatDateOnly(v.target_date)}`
                        : '无目标日期'}
                      {v.released_at && ` · 已发布 ${formatDateOnly(v.released_at)}`}
                    </p>
                  </div>
                  {/* 行尾迷你进度条(只在有 ws 时显示) */}
                  {buckets.total > 0 && (
                    <div className="w-20 h-1 bg-[#eeede8] rounded overflow-hidden shrink-0" title={`${buckets.done}/${buckets.total} done`}>
                      <div
                        className="h-full bg-[#16a34a]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  {!archived && !v.is_system && (
                    <button
                      type="button"
                      onClick={() => onEdit(v)}
                      className="p-1 text-text-muted hover:text-[#2383e2] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="编辑"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* 展开:挂的 workstream 按 initiative 分组 */}
                {isExpanded && (
                  <div className="px-3 pb-3 pl-9 space-y-3 bg-[#fafaf8]">
                    <div className="flex items-center gap-4 text-[11px] text-text-muted pt-2">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> 创建于 {formatDateOnly(v.created_at)}
                      </span>
                      {v.created_by ? (
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3 h-3" /> 创建人 user#{v.created_by}
                        </span>
                      ) : (
                        <span className="text-text-muted">系统创建</span>
                      )}
                    </div>
                    {wsList.length === 0 ? (
                      <p className="text-[12px] text-text-muted italic">
                        没有 workstream 挂这个 version
                      </p>
                    ) : (
                      <VersionWorkstreamGrouped
                        wsList={wsList}
                        initName={initName}
                        onOpenChannel={onOpenChannel}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 把 ws 列表按 initiative_id 分组渲染
function VersionWorkstreamGrouped({
  wsList, initName, onOpenChannel,
}: {
  wsList: WorkstreamResponse[];
  initName: Map<number, string>;
  onOpenChannel: (channelID: number) => void;
}) {
  const grouped = useMemo(() => {
    const m = new Map<number, WorkstreamResponse[]>();
    for (const ws of wsList) {
      const arr = m.get(ws.initiative_id) ?? [];
      arr.push(ws);
      m.set(ws.initiative_id, arr);
    }
    return Array.from(m.entries());
  }, [wsList]);

  return (
    <div className="space-y-2">
      {grouped.map(([initID, wss]) => {
        const buckets = bucketWorkstreams(wss);
        return (
          <div key={initID} className="rounded-md border border-[#e8e7e3] bg-white">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#f0efe9] bg-[#f7f6f3]">
              <Target className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
              <span className="text-[12px] font-medium text-text-primary">
                {initName.get(initID) ?? `Initiative #${initID}`}
              </span>
              <span className="text-[11px] text-text-muted">
                · {buckets.done}/{buckets.total} done
              </span>
            </div>
            {wss.map((ws, idx) => (
              <div
                key={ws.id}
                className={clsx(
                  'flex items-center gap-2 px-3 py-1.5 text-[12px]',
                  idx > 0 && 'border-t border-[#f0efe9]',
                )}
              >
                <Workflow className="w-3 h-3 text-text-muted shrink-0" strokeWidth={1.8} />
                <span className="text-text-primary truncate flex-1">{ws.name}</span>
                <StatusChip tone={statusTone(ws.status)}>{ws.status}</StatusChip>
                {ws.channel_id && (
                  <button
                    type="button"
                    onClick={() => onOpenChannel(ws.channel_id!)}
                    className="p-1 text-text-muted hover:text-[#2383e2] rounded"
                    title="进入 channel"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
