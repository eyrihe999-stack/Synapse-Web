// RoadmapTab Initiative × Version 网格视图。
//
// 行 = initiative,列 = Backlog + 各非 system 的活 version。
// 列规则:
//   - 第一列固定是虚拟 Backlog(对应 ws.version_id=NULL)
//   - system Backlog version(后端 seed 的占位)在这里**不另出一列**,合并到上面那一列
//   - cancelled version 不出列(已结束的版本视野里不再可见)
//
// 行头展示:initiative 名字 + 状态 chip + workstream 进度(done/total + 进度条)
// 列头展示:version 名字 + 状态 + target_date + 该版本进度
// 格子里:workstream 卡片(可点击跳 channel,左侧带 status 颜色条;hover 显示 description tooltip)
import { useMemo } from 'react';
import {
  LayoutGrid, Target, Workflow, ExternalLink, Calendar, ChevronDown,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusChip } from '@/components/ui/StatusChip';
import type {
  InitiativeResponse, VersionResponse, WorkstreamResponse,
} from '@/types/api';
import { statusTone, formatDateOnly, bucketWorkstreams } from './helpers';

interface RoadmapTabProps {
  initiatives: InitiativeResponse[];
  versions: VersionResponse[];
  // wsByInitVer key=`${initId}:${verId|'backlog'}`(由 ProjectDetailPage 主页面构造)
  wsByInitVer: Map<string, WorkstreamResponse[]>;
  // wsByInit 用于行尾 initiative 进度统计(由 ProjectDetailPage 传入)
  wsByInit: Map<number, WorkstreamResponse[]>;
  onOpenChannel: (channelID: number) => void;
}

// status → 卡片左侧颜色条颜色(hex,直接用 inline style 而不是 tailwind class
// 是因为 tailwind JIT 不能动态拼 class,索性直接 inline)
const STATUS_BAR_COLOR: Record<string, string> = {
  active: '#2383e2',
  done: '#16a34a',
  completed: '#16a34a',
  released: '#16a34a',
  blocked: '#d97706',
  draft: '#8a5cf6',
  planning: '#8a5cf6',
  planned: '#8a5cf6',
  cancelled: '#a8a29e',
};
function barColorFor(status: string): string {
  return STATUS_BAR_COLOR[status] ?? '#a8a29e';
}

export function RoadmapTab({
  initiatives, versions, wsByInitVer, wsByInit, onOpenChannel,
}: RoadmapTabProps) {
  // 列:第一列虚拟 Backlog;后面跟非 system + 非 cancelled 的 version
  const cols = useMemo(() => {
    const liveVers = versions.filter((v) => v.status !== 'cancelled' && !v.is_system);
    return [
      { id: 'backlog' as const, name: 'Backlog', system: true, version: null as VersionResponse | null },
      ...liveVers.map((v) => ({ id: v.id, name: v.name, system: false, version: v })),
    ];
  }, [versions]);

  // 每一列的 workstream 总数 + done(用于列头进度统计)
  const colStats = useMemo(() => {
    const m = new Map<number | 'backlog', { total: number; done: number }>();
    for (const col of cols) m.set(col.id, { total: 0, done: 0 });
    for (const init of initiatives) {
      for (const col of cols) {
        const list = wsByInitVer.get(`${init.id}:${col.id}`) ?? [];
        const stat = m.get(col.id)!;
        stat.total += list.length;
        stat.done += list.filter((w) => w.status === 'done').length;
      }
    }
    return m;
  }, [cols, initiatives, wsByInitVer]);

  if (initiatives.length === 0) {
    return (
      <GlassCard>
        <div className="py-10 text-center text-text-muted">
          <LayoutGrid className="mx-auto w-7 h-7 mb-3" strokeWidth={1.4} />
          <p className="text-[14px] font-medium text-text-primary">Roadmap 还是空的</p>
          <p className="text-[12px] mt-1.5 max-w-md mx-auto">
            Roadmap 是 Initiative × Version 的二维网格 ——
            行是"为什么做"(initiative),列是"什么时候发"(version),
            格子里堆"具体在做什么"(workstream)。
          </p>
          <p className="text-[12px] mt-1 max-w-md mx-auto">
            先到 <span className="font-medium">Initiative</span> tab 建一个,
            再在它下面挂 <span className="font-medium">Workstream</span>。
          </p>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3">
      {/* 顶部图例 / 说明 */}
      <div className="flex items-center justify-between gap-3 text-[11px] text-text-muted flex-wrap">
        <p>
          行 = Initiative · 列 = Version · 格子 = Workstream · 点击 ws 卡片跳到对应 channel
        </p>
        <div className="flex items-center gap-3">
          <Legend color="#8a5cf6" label="未启动" />
          <Legend color="#2383e2" label="进行中" />
          <Legend color="#d97706" label="阻塞" />
          <Legend color="#16a34a" label="完成" />
          <Legend color="#a8a29e" label="取消" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#e8e7e3] bg-white shadow-sm">
        <table className="min-w-full text-[12px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="text-left font-medium text-text-secondary px-4 py-3 border-b border-[#e8e7e3] sticky left-0 bg-[#fafaf8] z-20 min-w-[260px] max-w-[260px]">
                <div className="flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                  <span>Initiative</span>
                  <ChevronDown className="w-3 h-3 text-text-muted" />
                </div>
              </th>
              {cols.map((col) => {
                const stat = colStats.get(col.id)!;
                const pct = stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0;
                return (
                  <th
                    key={col.id}
                    className="text-left font-medium px-3 py-3 border-b border-l border-[#e8e7e3] bg-[#fafaf8] min-w-[200px] align-top"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-text-primary">{col.name}</span>
                      {col.system ? (
                        <span className="text-[9px] px-1 py-px rounded bg-[#8a5cf6]/10 text-[#8a5cf6]">
                          backlog
                        </span>
                      ) : col.version ? (
                        <StatusChip tone={statusTone(col.version.status)}>
                          {col.version.status}
                        </StatusChip>
                      ) : null}
                    </div>
                    {col.version?.target_date && (
                      <p className="mt-0.5 text-[10px] text-text-muted inline-flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" />
                        {formatDateOnly(col.version.target_date)}
                      </p>
                    )}
                    {stat.total > 0 && (
                      <div className="mt-1.5">
                        <div className="flex items-center justify-between text-[10px] text-text-muted mb-0.5">
                          <span>{stat.done}/{stat.total} done</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1 bg-[#eeede8] rounded overflow-hidden">
                          <div
                            className="h-full bg-[#16a34a] transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {initiatives.map((init) => {
              const wsAll = wsByInit.get(init.id) ?? [];
              const buckets = bucketWorkstreams(wsAll);
              const pct = buckets.total > 0 ? Math.round((buckets.done / buckets.total) * 100) : 0;
              return (
                <tr key={init.id} className="align-top">
                  <td className="px-4 py-3 border-b border-[#f0efe9] sticky left-0 bg-white z-10 max-w-[260px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Target
                        className="w-3.5 h-3.5 text-[#2383e2] shrink-0"
                        strokeWidth={1.8}
                      />
                      <span className="font-medium text-text-primary truncate">
                        {init.name}
                      </span>
                      <StatusChip tone={statusTone(init.status)}>{init.status}</StatusChip>
                      {init.is_system && (
                        <span className="text-[9px] px-1 py-px rounded bg-[#8a5cf6]/10 text-[#8a5cf6]">
                          system
                        </span>
                      )}
                    </div>
                    {buckets.total > 0 ? (
                      <div className="mt-1.5">
                        <div className="flex items-center justify-between text-[10px] text-text-muted mb-0.5">
                          <span>{buckets.done}/{buckets.total} ws · {pct}%</span>
                          <span className="font-mono">
                            {buckets.active > 0 && <span className="text-[#2383e2]">{buckets.active}↗ </span>}
                            {buckets.blocked > 0 && <span className="text-[#d97706]">{buckets.blocked}■ </span>}
                          </span>
                        </div>
                        <div className="h-1 bg-[#eeede8] rounded overflow-hidden">
                          <div
                            className="h-full bg-[#16a34a] transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 text-[10px] text-text-muted italic">无 workstream</p>
                    )}
                    {init.target_outcome && (
                      <p
                        className="mt-1.5 text-[10px] text-text-muted line-clamp-2"
                        title={init.target_outcome}
                      >
                        {init.target_outcome}
                      </p>
                    )}
                  </td>
                  {cols.map((col) => {
                    const key = `${init.id}:${col.id}`;
                    const list = wsByInitVer.get(key) ?? [];
                    return (
                      <td
                        key={col.id}
                        className="px-2 py-2 border-b border-l border-[#f0efe9] align-top min-w-[200px]"
                      >
                        {list.length === 0 ? (
                          <span className="text-text-muted text-[11px]">—</span>
                        ) : (
                          <div className="space-y-1">
                            {list.map((ws) => (
                              <WorkstreamCard
                                key={ws.id}
                                ws={ws}
                                onOpenChannel={onOpenChannel}
                              />
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function WorkstreamCard({
  ws, onOpenChannel,
}: {
  ws: WorkstreamResponse;
  onOpenChannel: (channelID: number) => void;
}) {
  const clickable = !!ws.channel_id;
  const tooltip = ws.description
    ? `${ws.name} (${ws.status})\n${ws.description}`
    : `${ws.name} (${ws.status})`;
  const barColor = barColorFor(ws.status);

  return (
    <div
      className={
        'group relative flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded bg-white border border-[#e8e7e3] hover:border-[#2383e2]/50 hover:shadow-sm transition-all overflow-hidden ' +
        (clickable ? 'cursor-pointer' : '')
      }
      title={tooltip}
      onClick={() => clickable && onOpenChannel(ws.channel_id!)}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: barColor }}
        aria-hidden
      />
      <Workflow className="w-3 h-3 text-text-muted shrink-0 ml-0.5" strokeWidth={1.8} />
      <span className="text-text-primary truncate flex-1 text-[12px]">{ws.name}</span>
      <StatusChip tone={statusTone(ws.status)}>{ws.status}</StatusChip>
      {clickable && (
        <ExternalLink
          className="w-3 h-3 text-text-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          strokeWidth={1.8}
        />
      )}
    </div>
  );
}
