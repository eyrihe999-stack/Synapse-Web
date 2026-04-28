// ChannelsTab 项目下 channel 列表 + 创建。
//
// Console channel 已被 ProjectDetailPage 抽到顶部按钮,这里 list 不含 kind='project_console'。
import { Hash, Plus, Workflow } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import type { ChannelResponse } from '@/types/api';

interface ChannelsTabProps {
  channels: ChannelResponse[];
  archived: boolean;
  onCreate: () => void;
  onOpen: (c: ChannelResponse) => void;
}

export function ChannelsTab({ channels, archived, onCreate, onOpen }: ChannelsTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-text-muted">
          {channels.length} 个 channel
          {channels.some((c) => c.kind === 'workstream') && (
            <span className="ml-2 inline-flex items-center gap-1 text-[11px]">
              <Workflow className="w-3 h-3" /> workstream channel 由系统自动建,挂 workstream
            </span>
          )}
        </p>
        {!archived && (
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={onCreate}>
            新建 channel
          </Button>
        )}
      </div>
      {channels.length === 0 ? (
        <GlassCard>
          <div className="py-6 text-center text-text-muted">
            <Hash className="mx-auto w-6 h-6 mb-2" strokeWidth={1.5} />
            <p className="text-[13px]">这个项目下还没有 channel</p>
            <p className="text-[11px] mt-1">建一个用来发起协作 / 派任务,或在 Initiatives 下建 workstream 自动获得 channel</p>
          </div>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {channels.map((c) => (
            <GlassCard key={c.id} className="cursor-pointer group" hover>
              <div onClick={() => onOpen(c)} className="flex items-start gap-2">
                <Hash className="w-4 h-4 text-[#2383e2] mt-0.5 shrink-0" strokeWidth={1.8} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-[14px] font-medium text-text-primary truncate group-hover:text-[#2383e2]">
                      {c.name}
                    </h3>
                    {c.kind === 'workstream' && (
                      <StatusChip tone="purple" icon={<Workflow className="w-3 h-3" />}>
                        workstream
                      </StatusChip>
                    )}
                    {c.status === 'archived' && <StatusChip tone="neutral">已归档</StatusChip>}
                  </div>
                  {c.purpose && (
                    <p className="mt-0.5 text-[12px] text-text-secondary line-clamp-2">
                      {c.purpose}
                    </p>
                  )}
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
