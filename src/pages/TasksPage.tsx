// TasksPage 我的任务 —— 两栏:
//   左栏:我是 assignee 的任务(状态 ∈ assigned / in_progress / changes_requested / submitted)
//   右栏:我是 reviewer 待审批的任务(status=submitted)
//
// 后端没有 "reviewer 待办" 的专用接口,近似做法:
//   /v2/users/me/tasks 只返回 assignee 的。Reviewer 待办第一版先留空 +"功能筹备"占位;
//   等后端加 /v2/users/me/reviews 之类接口再填。
//
// 前端这里主要先把 assignee 的任务做好,配合 TaskDetailPage 就能完整跑任务生命周期。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListChecks, Inbox, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/Toast';
import { taskApi } from '@/api/task';
import { useOrgStore } from '@/store/org';
import { useOrgPrincipals } from '@/hooks/useOrgPrincipals';
import { getErrorMessage } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import { getTaskStatusMeta } from '@/lib/taskMeta';
import type { TaskResponse, TaskStatus } from '@/types/api';

type Filter = 'active' | 'done' | 'all';

const ACTIVE_STATUSES: TaskStatus[] = [
  'in_progress',
  'revision_requested',
  'submitted',
];

export function TasksPage() {
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const { byPrincipalID } = useOrgPrincipals(currentOrg?.org.slug);

  const [tasks, setTasks] = useState<TaskResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('active');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await taskApi.listMy('', 200, 0);
      setTasks(res.data.result ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const filteredAssigned = tasks.filter((t) => {
    if (filter === 'active') return ACTIVE_STATUSES.includes(t.status);
    if (filter === 'done')
      return !ACTIVE_STATUSES.includes(t.status) && t.status !== 'open';
    return true;
  });

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="我的任务"
        subtitle="作为执行人或审批人参与的所有任务"
        loading={loading}
        onRefresh={fetch}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左栏 2/3:我是 assignee 的 */}
        <section className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-text-primary flex items-center gap-1.5">
              <ListChecks className="w-4 h-4 text-[#2383e2]" strokeWidth={1.8} />
              由我执行
              <span className="text-[11px] text-text-muted font-normal">
                · {filteredAssigned.length}
              </span>
            </h3>
            <Tabs
              variant="segmented"
              tabs={[
                { key: 'active' as Filter, label: '进行中' },
                { key: 'done' as Filter, label: '已完结' },
                { key: 'all' as Filter, label: '全部' },
              ]}
              activeKey={filter}
              onChange={setFilter}
            />
          </div>
          {loading && tasks.length === 0 ? (
            <GlassCard>
              <div className="h-2 bg-[#eeede8] rounded animate-pulse" />
            </GlassCard>
          ) : filteredAssigned.length === 0 ? (
            <GlassCard>
              <div className="py-8 text-center text-text-muted">
                <Inbox className="mx-auto w-8 h-8 mb-2" strokeWidth={1.3} />
                <p className="text-[13px]">
                  {filter === 'active' ? '目前没有待办任务' : '没有匹配的任务'}
                </p>
                {filter === 'active' && (
                  <p className="text-[11px] mt-1">被派任务后会出现在这里</p>
                )}
              </div>
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {filteredAssigned.map((t) => {
                const meta = getTaskStatusMeta(t.status);
                const Icon = meta.icon;
                return (
                  <GlassCard
                    key={t.id}
                    className="cursor-pointer group !p-3"
                    hover
                  >
                    <div
                      onClick={() => navigate(`/org/tasks/${t.id}`)}
                      className="flex items-start gap-3"
                    >
                      <Icon
                        className={clsx('w-4 h-4 mt-0.5 shrink-0', meta.textColor)}
                        strokeWidth={1.8}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-medium text-text-primary truncate group-hover:text-[#2383e2]">
                            {t.title}
                          </p>
                          <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
                        </div>
                        {t.description && (
                          <p className="text-[12px] text-text-secondary line-clamp-1 mt-0.5">
                            {t.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted">
                          <span>
                            {formatRelativeWithAbsSeconds(
                              Math.floor(new Date(t.updated_at).getTime() / 1000),
                            )}
                          </span>
                          <span>
                            来自 channel #{t.channel_id}
                          </span>
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}
        </section>

        {/* 右栏 1/3:reviewer 待办(功能筹备) */}
        <section className="space-y-3">
          <h3 className="text-[14px] font-medium text-text-primary flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[#8a5cf6]" strokeWidth={1.8} />
            等我审批
          </h3>
          <GlassCard>
            <div className="py-6 text-center text-text-muted">
              <Sparkles className="mx-auto w-6 h-6 mb-2" strokeWidth={1.3} />
              <p className="text-[12px]">
                "我作为 reviewer 的待办"第一版尚未开放
              </p>
              <p className="text-[11px] mt-1">
                暂时在任务详情页通过 URL 直达审批
              </p>
            </div>
          </GlassCard>
          <GlassCard>
            <h4 className="text-[12px] font-medium text-text-primary mb-2">提示</h4>
            <ul className="text-[12px] text-text-secondary space-y-1 list-disc pl-4">
              <li>任务需认领后开工;`open` 状态需要先 claim</li>
              <li>markdown 产物通过详情页提交,审批人会在此列出</li>
              <li>被 @ 到的顶级 agent 会自动帮你派任务</li>
            </ul>
          </GlassCard>
        </section>
      </div>

      {/* 辅助 —— 仅用于确认 directory 已加载,不展示 */}
      <div className="hidden">{byPrincipalID.size}</div>
    </div>
  );
}
