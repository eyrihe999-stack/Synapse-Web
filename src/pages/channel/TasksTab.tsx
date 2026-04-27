// TasksTab channel 维度的任务列表(按状态过滤)。
//
// 点击 task 行跳到 TaskDetailPage。新建任务走 Modal(最小字段:标题 + 描述 +
// assignee);复杂配置(reviewers / required_approvals)在详情页再完善。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ListChecks, Check, UserCircle2, Bot, Globe2, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/Toast';
import { taskApi } from '@/api/task';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import { getTaskStatusMeta } from '@/lib/taskMeta';
import type { PrincipalDirEntry } from '@/hooks/useOrgPrincipals';
import type { TaskResponse, TaskStatus } from '@/types/api';

interface TasksTabProps {
  channelId: number;
  principalDirByID: Map<number, PrincipalDirEntry>;
  channelMembers: Array<{ principal_id: number }>;
  canManage: boolean;
}

type Filter = 'open' | 'closed' | 'all';

const FILTER_STATUSES: Record<Filter, TaskStatus[]> = {
  open: ['open', 'in_progress', 'submitted', 'revision_requested'],
  closed: ['approved', 'rejected', 'cancelled'],
  all: [],
};

export function TasksTab({
  channelId,
  principalDirByID,
  channelMembers,
  canManage,
}: TasksTabProps) {
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<TaskResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    description: string;
    isLightweight: boolean; // true = 不需要文件交付,submit 走 inline_summary
    assignee: number | null;
    reviewers: number[]; // principal_id 数组
    requiredApprovals: number; // 0 = 无需审批(即 reviewers=[] 时的默认)
  }>({ title: '', description: '', isLightweight: false, assignee: null, reviewers: [], requiredApprovals: 0 });
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setForm({ title: '', description: '', isLightweight: false, assignee: null, reviewers: [], requiredApprovals: 0 });
  };

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await taskApi.listByChannel(channelId, '', 100, 0);
      setTasks(res.data.result ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const filtered = useMemo(() => {
    if (filter === 'all') return tasks;
    const allowed = new Set(FILTER_STATUSES[filter]);
    return tasks.filter((t) => allowed.has(t.status));
  }, [tasks, filter]);

  const memberCandidates = useMemo(() => {
    return channelMembers
      .map((m) => principalDirByID.get(m.principal_id))
      .filter((x): x is PrincipalDirEntry => !!x);
  }, [channelMembers, principalDirByID]);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    // required_approvals 合法性:必须 ≤ len(reviewers);选了 reviewer 但 required=0
    // 的情况后端允许,代表"允许审批人审但不强制通过才结"——这场景少见,UI 默认
    // auto-pick = min(len(reviewers), 1) 让用户不用自己算。
    const reviewers = form.reviewers;
    let required = form.requiredApprovals;
    if (reviewers.length === 0) required = 0;
    else if (required <= 0) required = 1;
    else if (required > reviewers.length) required = reviewers.length;

    setSaving(true);
    const res = await apiCall(() =>
      taskApi.create({
        channel_id: channelId,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        output_spec_kind: 'markdown',
        is_lightweight: form.isLightweight || undefined,
        assignee_principal_id: form.assignee || undefined,
        reviewer_principal_ids: reviewers.length > 0 ? reviewers : undefined,
        required_approvals: required,
      }),
    );
    setSaving(false);
    if (res.ok) {
      toast('success', reviewers.length > 0
        ? `任务已派发,需 ${required}/${reviewers.length} 审批人通过`
        : '任务已派发(无需审批)');
      setShowCreate(false);
      resetForm();
      fetchTasks();
    }
  };

  const toggleReviewer = (pid: number) => {
    setForm((f) => {
      const has = f.reviewers.includes(pid);
      const next = has ? f.reviewers.filter((x) => x !== pid) : [...f.reviewers, pid];
      // reviewer 数变化时,required 自动 clamp 到合法范围
      let req = f.requiredApprovals;
      if (next.length === 0) req = 0;
      else if (req <= 0) req = 1;
      else if (req > next.length) req = next.length;
      return { ...f, reviewers: next, requiredApprovals: req };
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Tabs
          variant="segmented"
          tabs={[
            { key: 'open' as Filter, label: '进行中', badge: tasks.filter((t) => FILTER_STATUSES.open.includes(t.status)).length },
            { key: 'closed' as Filter, label: '已完结', badge: tasks.filter((t) => FILTER_STATUSES.closed.includes(t.status)).length },
            { key: 'all' as Filter, label: '全部', badge: tasks.length },
          ]}
          activeKey={filter}
          onChange={setFilter}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={fetchTasks}
            title="刷新"
          />
          {canManage && (
            <Button
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowCreate(true)}
            >
              派任务
            </Button>
          )}
        </div>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="h-2 bg-[#eeede8] rounded animate-pulse" />
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#e3e2dc] py-8 text-center text-text-muted">
          <ListChecks className="mx-auto w-6 h-6 mb-2" strokeWidth={1.5} />
          <p className="text-[13px]">
            {filter === 'closed' ? '还没有已完结的任务' : filter === 'open' ? '没有进行中的任务' : '这个 channel 还没有任务'}
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-[#e8e7e3] bg-white overflow-hidden">
          {filtered.map((t, idx) => {
            const meta = getTaskStatusMeta(t.status);
            const Icon = meta.icon;
            const assignee = t.assignee_principal_id
              ? principalDirByID.get(t.assignee_principal_id)
              : null;
            return (
              <div
                key={t.id}
                onClick={() => navigate(`/org/tasks/${t.id}`)}
                className={clsx(
                  'flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#f4f3ef]',
                  idx > 0 && 'border-t border-[#f0efe9]',
                )}
              >
                <Icon className={clsx('w-4 h-4 mt-0.5 shrink-0', meta.textColor)} strokeWidth={1.8} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-text-primary truncate">{t.title}</p>
                    <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
                    {t.is_lightweight && (
                      <span className="px-1 py-0.5 text-[9px] rounded bg-[#eef5ff] text-[#2383e2] border border-[#d0e3ff] shrink-0">
                        轻量
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-[12px] text-text-secondary line-clamp-1 mt-0.5">
                      {t.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted">
                    {assignee ? (
                      <span>执行:{assignee.displayName}</span>
                    ) : (
                      <span>未指派</span>
                    )}
                    <span>
                      {formatRelativeWithAbsSeconds(
                        Math.floor(new Date(t.created_at).getTime() / 1000),
                      )}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          resetForm();
        }}
        title="派发新任务"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="标题"
            placeholder="简短描述任务目标"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            autoFocus
          />
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">描述(可选)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4}
              placeholder="讲清输入 / 约束 / 验收标准。支持 Markdown。"
              className="w-full px-3 py-2 text-[13px] rounded border border-[#e3e2dc] bg-white text-text-primary focus:outline-none focus:border-[#2383e2] resize-none"
            />
          </div>
          <div>
            <label className="flex items-start gap-2 text-[13px] text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={form.isLightweight}
                onChange={(e) => setForm({ ...form, isLightweight: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="text-text-primary font-medium">轻量任务(无需文件交付)</span>
                <span className="block text-[12px] text-text-secondary mt-0.5">
                  适合 review PR / 口头汇报 / 确认某事完成等无产物场景。提交时只需填写"完成情况描述"。
                </span>
              </span>
            </label>
          </div>
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">
              执行人(可留空,稍后认领)
            </label>
            <select
              value={form.assignee || ''}
              onChange={(e) =>
                setForm({ ...form, assignee: e.target.value ? Number(e.target.value) : null })
              }
              className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white focus:outline-none focus:border-[#2383e2]"
            >
              <option value="">— 未指派 —</option>
              {memberCandidates.map((c) => (
                <option key={`${c.kind}-${c.principalId}`} value={c.principalId}>
                  {c.displayName}
                  {c.kind === 'agent' ? ' · agent' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">
              审批人(可多选;留空则任务提交即完成,无需审批)
            </label>
            <div className="rounded border border-[#e3e2dc] bg-white max-h-[180px] overflow-y-auto">
              {memberCandidates.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-text-muted italic">
                  还没有可选的 channel 成员
                </p>
              ) : (
                memberCandidates.map((c) => {
                  const checked = form.reviewers.includes(c.principalId);
                  return (
                    <label
                      key={`rev-${c.kind}-${c.principalId}`}
                      className={clsx(
                        'flex items-center gap-2 px-2.5 py-1.5 cursor-pointer border-b border-[#f0efe9] last:border-b-0',
                        checked ? 'bg-[#2383e2]/[0.06]' : 'hover:bg-[#f4f3ef]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleReviewer(c.principalId)}
                        className="shrink-0"
                      />
                      {c.kind === 'agent' ? (
                        c.isGlobalAgent ? (
                          <Globe2 className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                        ) : (
                          <Bot className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                        )
                      ) : (
                        <UserCircle2 className="w-3.5 h-3.5 text-text-muted" strokeWidth={1.8} />
                      )}
                      <span className="text-[12px] text-text-primary flex-1 truncate">
                        {c.displayName}
                      </span>
                      {c.secondary && (
                        <span className="text-[10px] text-text-muted truncate max-w-[150px]">
                          {c.secondary}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>
          {form.reviewers.length > 0 && (
            <div>
              <label className="block text-[13px] text-text-secondary mb-1">
                所需通过数({form.reviewers.length} 位审批人中)
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {Array.from({ length: form.reviewers.length }, (_, i) => i + 1).map((n) => {
                  const active = form.requiredApprovals === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setForm({ ...form, requiredApprovals: n })}
                      className={clsx(
                        'px-2.5 py-1 text-[12px] rounded border transition-colors',
                        active
                          ? 'border-[#2383e2] bg-[#2383e2]/[0.08] text-[#2383e2] font-medium'
                          : 'border-[#e3e2dc] text-text-secondary hover:bg-[#f4f3ef]',
                      )}
                    >
                      {n === form.reviewers.length ? `全部 ${n}` : `${n} 位`}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-text-muted">
                {form.requiredApprovals >= form.reviewers.length
                  ? '所有审批人都通过才结'
                  : `任意 ${form.requiredApprovals} 位审批人通过即结`}
              </p>
            </div>
          )}
          <p className="text-[11px] text-text-muted bg-[#f4f3ef] px-2 py-1.5 rounded flex items-start gap-1.5">
            <Check className="w-3 h-3 mt-0.5 shrink-0 text-[#448361]" strokeWidth={2.2} />
            <span>
              产物格式为 Markdown。
              {form.reviewers.length === 0
                ? '未选审批人 → 提交即完成(approved)。'
                : `需 ${form.requiredApprovals}/${form.reviewers.length} 审批通过才结。`}
            </span>
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreate(false);
                resetForm();
              }}
            >
              取消
            </Button>
            <Button onClick={handleCreate} loading={saving} disabled={!form.title.trim()}>
              派发
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
