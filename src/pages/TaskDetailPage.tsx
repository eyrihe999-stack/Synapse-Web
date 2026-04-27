// TaskDetailPage 任务详情 + 生命周期操作(claim / submit / review / cancel)。
//
// 按当前 user 的角色渲染不同 action:
//   - 我是 assignee 且 status ∈ {assigned, in_progress, changes_requested}: 显示 "开始 / 提交产物"
//   - 我是 assignee 且 status === 'open':可以 "认领"(claim)
//   - 我是 reviewer 且 status === 'submitted':显示 "审批"
//   - 我是 creator 且 status ∈ active: 显示 "取消"
//
// 时间线展示:创建 → 各次提交 → 各次审批 + 最终决议。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  PlayCircle,
  Ban,
  Hash,
  Bot,
  Globe2,
  UserCircle2,
  Sparkles,
  UserCog,
  Users as UsersIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx } from 'clsx';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { StatusChip } from '@/components/ui/StatusChip';
import { UserAvatar } from '@/components/ui/UserIdentity';
import { toast } from '@/components/ui/Toast';
import { taskApi } from '@/api/task';
import { channelApi } from '@/api/channel';
import { useAuthStore } from '@/store/auth';
import { useOrgStore } from '@/store/org';
import { useOrgPrincipals } from '@/hooks/useOrgPrincipals';
import { apiCall } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import { getTaskStatusMeta } from '@/lib/taskMeta';
import type {
  TaskDetailResponse,
  ReviewDecision,
  ChannelMemberResponse,
} from '@/types/api';

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const taskID = id ? Number(id) : 0;
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const me = useAuthStore((s) => s.user);
  const { byPrincipalID } = useOrgPrincipals(currentOrg?.org.slug);

  const [detail, setDetail] = useState<TaskDetailResponse | null>(null);
  const [channelMembers, setChannelMembers] = useState<ChannelMemberResponse[]>([]);
  const [loading, setLoading] = useState(false);

  const [showSubmit, setShowSubmit] = useState(false);
  const [submitForm, setSubmitForm] = useState({ content: '', summary: '' });
  const [submitting, setSubmitting] = useState(false);

  const [showReview, setShowReview] = useState(false);
  const [reviewForm, setReviewForm] = useState<{
    decision: ReviewDecision;
    comment: string;
  }>({ decision: 'approved', comment: '' });
  const [reviewing, setReviewing] = useState(false);

  // 变更 assignee / reviewers Modal 状态
  const [showEditAssignee, setShowEditAssignee] = useState(false);
  const [assigneeForm, setAssigneeForm] = useState<number>(0); // 0 = 清空
  const [savingAssignee, setSavingAssignee] = useState(false);

  const [showEditReviewers, setShowEditReviewers] = useState(false);
  const [reviewersForm, setReviewersForm] = useState<{ ids: number[]; required: number }>({
    ids: [],
    required: 0,
  });
  const [savingReviewers, setSavingReviewers] = useState(false);

  const fetch = useCallback(async () => {
    if (!taskID) return;
    setLoading(true);
    const res = await apiCall(() => taskApi.get(taskID));
    setLoading(false);
    if (res.ok && res.data) {
      setDetail(res.data);
      // 拉 task 所在 channel 的成员 —— 给 edit assignee / edit reviewers Modal 做候选源,
      // 也用于判断当前 user 是否是 channel owner(权限放宽 edit 按钮)。
      try {
        const mRes = await channelApi.listMembers(res.data.task.channel_id);
        setChannelMembers(mRes.data.result ?? []);
      } catch {
        setChannelMembers([]);
      }
    }
  }, [taskID]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const myPid = me ? Number(me.principal_id) : 0;
  const task = detail?.task;
  const reviewers = detail?.reviewers ?? [];

  const iAmAssignee = !!task && task.assignee_principal_id === myPid;
  const iAmReviewer = reviewers.includes(myPid);
  const iAmCreator = !!task && task.created_by_principal_id === myPid;
  const iAmChannelOwner = useMemo(
    () => channelMembers.some((m) => m.principal_id === myPid && m.role === 'owner'),
    [channelMembers, myPid],
  );

  // 后端 nil slice 被序列化成 null(Go 默认行为),这里显式退化为 [] 避免 .map 崩溃。
  // 前端三处会用到这三个数组:timeline、latestSubmission、reviewers 审批面板。
  const submissions = useMemo(() => detail?.submissions ?? [], [detail]);
  const reviews = useMemo(() => detail?.reviews ?? [], [detail]);

  // 后端 ListSubmissions 返回 id DESC(最新在前,timeline UI 新在上符合直觉),
  // 所以"最新"是第 0 项,不是最后一项。之前 submissions[length-1] 是取的最旧那条,
  // 会把 approve 发到旧 submission 上撞 uk_task_reviews_submission_reviewer。
  const latestSubmission = useMemo(() => {
    if (submissions.length === 0) return null;
    return submissions[0];
  }, [submissions]);

  const handleClaim = async () => {
    if (!task) return;
    const res = await apiCall(() => taskApi.claim(task.id));
    if (res.ok) {
      toast('success', '已认领');
      fetch();
    }
  };

  const handleSubmit = async () => {
    if (!task) return;
    // 轻量任务:summary 必填,content 不传;普通任务:content 必填。
    if (task.is_lightweight) {
      if (!submitForm.summary.trim()) return;
    } else {
      if (!submitForm.content.trim()) return;
    }
    setSubmitting(true);
    const res = await apiCall(() =>
      taskApi.submit(task.id, task.is_lightweight
        ? { inline_summary: submitForm.summary.trim() }
        : {
            content_kind: task.output_spec_kind,
            content: submitForm.content,
            inline_summary: submitForm.summary.trim() || undefined,
          },
      ),
    );
    setSubmitting(false);
    if (res.ok) {
      toast('success', '已提交审批');
      setShowSubmit(false);
      setSubmitForm({ content: '', summary: '' });
      fetch();
    }
  };

  const handleReview = async () => {
    if (!task || !latestSubmission) return;
    setReviewing(true);
    const res = await apiCall(() =>
      taskApi.review(task.id, {
        submission_id: latestSubmission.id,
        decision: reviewForm.decision,
        comment: reviewForm.comment.trim() || undefined,
      }),
    );
    setReviewing(false);
    if (res.ok) {
      toast('success', '审批已提交');
      setShowReview(false);
      setReviewForm({ decision: 'approved', comment: '' });
      fetch();
    }
  };

  const handleCancel = async () => {
    if (!task) return;
    if (!confirm('取消这个任务?取消后不能恢复。')) return;
    const res = await apiCall(() => taskApi.cancel(task.id));
    if (res.ok) {
      toast('success', '已取消');
      fetch();
    }
  };

  const openEditAssignee = () => {
    if (!task) return;
    setAssigneeForm(task.assignee_principal_id || 0);
    setShowEditAssignee(true);
  };

  const handleUpdateAssignee = async () => {
    if (!task) return;
    setSavingAssignee(true);
    const res = await apiCall(() => taskApi.updateAssignee(task.id, assigneeForm));
    setSavingAssignee(false);
    if (res.ok) {
      toast('success', assigneeForm === 0 ? '已清空执行人' : '执行人已更新');
      setShowEditAssignee(false);
      fetch();
    }
  };

  const openEditReviewers = () => {
    setReviewersForm({
      ids: reviewers,
      required: task?.required_approvals ?? 0,
    });
    setShowEditReviewers(true);
  };

  const toggleEditReviewer = (pid: number) => {
    setReviewersForm((f) => {
      const has = f.ids.includes(pid);
      const next = has ? f.ids.filter((x) => x !== pid) : [...f.ids, pid];
      let req = f.required;
      if (next.length === 0) req = 0;
      else if (req <= 0) req = 1;
      else if (req > next.length) req = next.length;
      return { ids: next, required: req };
    });
  };

  const handleUpdateReviewers = async () => {
    if (!task) return;
    setSavingReviewers(true);
    const res = await apiCall(() =>
      taskApi.updateReviewers(task.id, reviewersForm.ids, reviewersForm.required),
    );
    setSavingReviewers(false);
    if (res.ok) {
      toast('success', '审批人已更新');
      setShowEditReviewers(false);
      fetch();
    }
  };

  if (!taskID) return <div className="p-6">Invalid task id</div>;
  if (loading && !detail) {
    return (
      <div className="p-6">
        <div className="h-6 bg-[#eeede8] rounded w-1/3 animate-pulse" />
      </div>
    );
  }
  if (!detail || !task) {
    return (
      <div className="p-6 text-center text-text-muted">
        <p className="text-[13px]">任务不存在或无访问权限</p>
      </div>
    );
  }

  const meta = getTaskStatusMeta(task.status);
  const StatusIcon = meta.icon;
  const assignee = task.assignee_principal_id
    ? byPrincipalID.get(task.assignee_principal_id)
    : null;
  const creator = byPrincipalID.get(task.created_by_principal_id);

  // 生命周期 action 按钮 —— 同时可能有多个可用
  const canClaim = iAmAssignee && task.status === 'open';
  const canSubmit =
    iAmAssignee &&
    (task.status === 'in_progress' || task.status === 'revision_requested');
  const canReview = iAmReviewer && task.status === 'submitted' && latestSubmission;
  const canCancel =
    (iAmCreator || iAmAssignee) &&
    ['open', 'in_progress', 'revision_requested'].includes(task.status);
  // 变更 assignee / reviewers:creator 或 channel owner 可改
  const hasEditPerm = iAmCreator || iAmChannelOwner;
  const canEditAssignee =
    hasEditPerm && !['approved', 'rejected', 'cancelled'].includes(task.status);
  const canEditReviewers =
    hasEditPerm && ['open', 'in_progress'].includes(task.status);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <button
            onClick={() => navigate(-1)}
            className="mt-1 p-1 text-text-muted hover:text-[#2383e2] rounded"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <StatusIcon
            className={clsx('w-5 h-5 mt-0.5 shrink-0', meta.textColor)}
            strokeWidth={1.8}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-text-primary">
                {task.title}
              </h2>
              <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
              {task.is_lightweight && (
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-[#eef5ff] text-[#2383e2] border border-[#d0e3ff]">
                  轻量任务
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted">
              <button
                onClick={() => navigate(`/org/channels/${task.channel_id}`)}
                className="flex items-center gap-1 hover:text-[#2383e2]"
              >
                <Hash className="w-3 h-3" />
                来自 channel #{task.channel_id}
              </button>
              <span>
                {formatRelativeWithAbsSeconds(
                  Math.floor(new Date(task.created_at).getTime() / 1000),
                )}{' '}
                创建
              </span>
              {!task.is_lightweight && (
                <span>
                  产物格式:{task.output_spec_kind}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {canClaim && (
          <Button
            icon={<PlayCircle className="w-3.5 h-3.5" />}
            onClick={handleClaim}
          >
            认领任务
          </Button>
        )}
        {canSubmit && (
          <Button
            icon={<Send className="w-3.5 h-3.5" />}
            onClick={() => setShowSubmit(true)}
          >
            提交产物
          </Button>
        )}
        {canReview && (
          <Button
            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
            onClick={() => setShowReview(true)}
          >
            审批
          </Button>
        )}
        {canEditAssignee && (
          <Button
            variant="secondary"
            icon={<UserCog className="w-3.5 h-3.5" />}
            onClick={openEditAssignee}
          >
            改执行人
          </Button>
        )}
        {canEditReviewers && (
          <Button
            variant="secondary"
            icon={<UsersIcon className="w-3.5 h-3.5" />}
            onClick={openEditReviewers}
          >
            改审批人
          </Button>
        )}
        {canCancel && (
          <Button
            variant="danger"
            icon={<Ban className="w-3.5 h-3.5" />}
            onClick={handleCancel}
          >
            取消任务
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main column: description + submissions + reviews */}
        <div className="lg:col-span-2 space-y-4">
          {task.description && (
            <GlassCard>
              <h3 className="text-[13px] font-medium text-text-secondary mb-2">描述</h3>
              <div className="prose prose-sm max-w-none text-text-primary">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.description}</ReactMarkdown>
              </div>
            </GlassCard>
          )}

          <GlassCard>
            <h3 className="text-[13px] font-medium text-text-secondary mb-3 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" strokeWidth={1.8} />
              时间线
            </h3>
            <div className="space-y-3">
              {/* 创建 */}
              {(() => {
                const viaPid = task.created_via_principal_id || 0;
                const via = viaPid > 0 ? byPrincipalID.get(viaPid) : undefined;
                const creatorName = creator?.displayName || '有人';
                const title = via
                  ? `${creatorName} 通过 ${via.displayName} 派发了这个任务`
                  : `${creatorName} 创建了这个任务`;
                return (
                  <TimelineItem
                    tone="neutral"
                    icon={<Sparkles className="w-3 h-3" />}
                    title={title}
                    at={task.created_at}
                  />
                );
              })()}
              {/* 提交 + 审批穿插按时间排 */}
              {submissions.map((s) => {
                const submitter = byPrincipalID.get(s.submitter_principal_id);
                return (
                  <div key={`sub-${s.id}`} className="space-y-2">
                    <TimelineItem
                      tone="blue"
                      icon={<Send className="w-3 h-3" />}
                      title={`${submitter?.displayName || '有人'} 提交了产物`}
                      subtitle={s.inline_summary}
                      at={s.created_at}
                    />
                    {/* 该提交对应的 reviews */}
                    {reviews
                      .filter((r) => r.submission_id === s.id)
                      .map((r) => {
                        const reviewer = byPrincipalID.get(r.reviewer_principal_id);
                        const [tone, text, Icon] =
                          r.decision === 'approved'
                            ? (['green', '通过', CheckCircle2] as const)
                            : r.decision === 'request_changes'
                              ? (['amber', '要求修改', AlertTriangle] as const)
                              : (['red', '驳回', XCircle] as const);
                        return (
                          <div key={`rev-${r.id}`} className="pl-6">
                            <TimelineItem
                              tone={tone}
                              icon={<Icon className="w-3 h-3" />}
                              title={`${reviewer?.displayName || '审批人'} · ${text}`}
                              subtitle={r.comment}
                              at={r.created_at}
                            />
                          </div>
                        );
                      })}
                  </div>
                );
              })}
              {task.closed_at && (
                <TimelineItem
                  tone={
                    task.status === 'approved'
                      ? 'green'
                      : task.status === 'rejected'
                        ? 'red'
                        : 'neutral'
                  }
                  icon={<StatusIcon className="w-3 h-3" />}
                  title={`任务${meta.label}`}
                  at={task.closed_at}
                />
              )}
            </div>
          </GlassCard>

          {latestSubmission && (
            <GlassCard>
              <h3 className="text-[13px] font-medium text-text-secondary mb-2">
                {latestSubmission.content_kind === 'none' ? '最新完成情况' : '最新提交的产物'}
              </h3>
              {latestSubmission.content_kind === 'none' ? (
                latestSubmission.inline_summary ? (
                  <div className="prose prose-sm max-w-none text-text-primary whitespace-pre-wrap">
                    {latestSubmission.inline_summary}
                  </div>
                ) : (
                  <p className="text-[12px] text-text-muted italic">无完成情况描述。</p>
                )
              ) : (
                <>
                  <p className="text-[11px] text-text-muted mb-2">
                    OSS key:{' '}
                    <code className="bg-[#f4f3ef] px-1.5 py-0.5 rounded text-[10px]">
                      {latestSubmission.oss_key}
                    </code>{' '}
                    · {latestSubmission.byte_size} B
                  </p>
                  {latestSubmission.inline_summary && (
                    <div className="prose prose-sm max-w-none text-text-primary">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {latestSubmission.inline_summary}
                      </ReactMarkdown>
                    </div>
                  )}
                  <p className="text-[11px] text-text-muted mt-2 italic">
                    产物完整内容需通过 OSS 代下载(当前 UI 暂未实现预览)。
                  </p>
                </>
              )}
            </GlassCard>
          )}
        </div>

        {/* Sidebar: participants */}
        <div className="space-y-4">
          <GlassCard>
            <h3 className="text-[13px] font-medium text-text-secondary mb-2">参与者</h3>
            <div className="space-y-2.5">
              <ParticipantRow label="执行人" entry={assignee} myPid={myPid} />
              <ParticipantRow label="创建人" entry={creator} myPid={myPid} />
              {task.created_via_principal_id ? (
                <ParticipantRow
                  label="代派 agent"
                  entry={byPrincipalID.get(task.created_via_principal_id) || null}
                  myPid={myPid}
                />
              ) : (
                <div>
                  <p className="text-[11px] text-text-muted mb-1.5">派发方式</p>
                  <p className="text-[12px] text-text-secondary italic">手动创建</p>
                </div>
              )}
              <div>
                <p className="text-[11px] text-text-muted mb-1.5">
                  审批人({reviewers.length})
                </p>
                {reviewers.length === 0 ? (
                  <p className="text-[12px] text-text-muted italic">未指定</p>
                ) : (
                  <div className="space-y-1.5">
                    {reviewers.map((pid) => (
                      <ParticipantRow
                        key={pid}
                        label=""
                        entry={byPrincipalID.get(pid) || null}
                        myPid={myPid}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="pt-2 border-t border-[#f0efe9] text-[11px] text-text-muted">
                所需通过:{task.required_approvals}
              </div>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Submit Modal */}
      <Modal
        open={showSubmit}
        onClose={() => setShowSubmit(false)}
        title={task.is_lightweight ? '完成任务' : '提交产物'}
        size="lg"
      >
        <div className="space-y-4">
          {task.is_lightweight ? (
            <div>
              <label className="block text-[13px] text-text-secondary mb-1">
                完成情况描述(必填,≤ 512 字)
              </label>
              <textarea
                value={submitForm.summary}
                onChange={(e) => setSubmitForm({ ...submitForm, summary: e.target.value })}
                rows={6}
                maxLength={512}
                placeholder="简述做了什么 / 结论 / 关键链接。审批人会看这段决定是否通过。"
                className="w-full px-3 py-2 text-[13px] rounded border border-[#e3e2dc] bg-white text-text-primary focus:outline-none focus:border-[#2383e2] resize-none"
              />
              <div className="text-[11px] text-text-muted mt-1">
                {submitForm.summary.length} / 512
              </div>
            </div>
          ) : (
            <>
              <Input
                label="摘要(可选,审批页一眼看要点)"
                value={submitForm.summary}
                onChange={(e) => setSubmitForm({ ...submitForm, summary: e.target.value })}
              />
              <div>
                <label className="block text-[13px] text-text-secondary mb-1">
                  产物正文({task.output_spec_kind})
                </label>
                <textarea
                  value={submitForm.content}
                  onChange={(e) => setSubmitForm({ ...submitForm, content: e.target.value })}
                  rows={14}
                  placeholder="# 产物标题&#10;&#10;正文 markdown…"
                  className="w-full px-3 py-2 text-[13px] font-mono rounded border border-[#e3e2dc] bg-white text-text-primary focus:outline-none focus:border-[#2383e2] resize-none"
                />
              </div>
            </>
          )}
          <p className="text-[11px] text-text-muted bg-[#f4f3ef] px-2 py-1.5 rounded">
            提交后任务进入"待审批"。如果被驳回(request_changes),可以再次提交新版本。
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowSubmit(false)}>
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              loading={submitting}
              disabled={task.is_lightweight ? !submitForm.summary.trim() : !submitForm.content.trim()}
            >
              提交
            </Button>
          </div>
        </div>
      </Modal>

      {/* Review Modal */}
      <Modal open={showReview} onClose={() => setShowReview(false)} title="审批产物">
        <div className="space-y-4">
          <div>
            <label className="block text-[13px] text-text-secondary mb-2">决议</label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'approved', label: '通过', tone: 'green', icon: CheckCircle2 },
                  { value: 'request_changes', label: '要求修改', tone: 'amber', icon: AlertTriangle },
                  { value: 'rejected', label: '驳回', tone: 'red', icon: XCircle },
                ] as const
              ).map((opt) => {
                const isSel = reviewForm.decision === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReviewForm({ ...reviewForm, decision: opt.value })}
                    className={clsx(
                      'flex items-center justify-center gap-1.5 py-2 rounded border text-[13px]',
                      isSel
                        ? opt.tone === 'green'
                          ? 'border-[#448361] bg-[#448361]/[0.08] text-[#448361] font-medium'
                          : opt.tone === 'amber'
                            ? 'border-[#cb912f] bg-[#cb912f]/[0.08] text-[#cb912f] font-medium'
                            : 'border-[#d44c47] bg-[#d44c47]/[0.08] text-[#d44c47] font-medium'
                        : 'border-[#e3e2dc] text-text-secondary hover:bg-[#f4f3ef]',
                    )}
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.8} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">
              评论(可选,request_changes 建议写明要改什么)
            </label>
            <textarea
              value={reviewForm.comment}
              onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 text-[13px] rounded border border-[#e3e2dc] bg-white focus:outline-none focus:border-[#2383e2] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowReview(false)}>
              取消
            </Button>
            <Button onClick={handleReview} loading={reviewing}>
              提交审批
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Assignee Modal */}
      <Modal open={showEditAssignee} onClose={() => setShowEditAssignee(false)} title="变更执行人">
        <div className="space-y-4">
          <p className="text-[12px] text-text-muted">
            把任务的执行人改为下列成员之一,或留空(未指派)。
          </p>
          <div className="rounded border border-[#e3e2dc] bg-white max-h-[260px] overflow-y-auto">
            <label
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-[#f0efe9]',
                assigneeForm === 0 ? 'bg-[#2383e2]/[0.06]' : 'hover:bg-[#f4f3ef]',
              )}
            >
              <input
                type="radio"
                name="assignee"
                checked={assigneeForm === 0}
                onChange={() => setAssigneeForm(0)}
                className="shrink-0"
              />
              <span className="text-[13px] text-text-muted italic">— 清空(回到待认领)—</span>
            </label>
            {channelMembers.map((m) => {
              const entry = byPrincipalID.get(m.principal_id);
              const active = assigneeForm === m.principal_id;
              return (
                <label
                  key={m.principal_id}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-[#f0efe9] last:border-b-0',
                    active ? 'bg-[#2383e2]/[0.06]' : 'hover:bg-[#f4f3ef]',
                  )}
                >
                  <input
                    type="radio"
                    name="assignee"
                    checked={active}
                    onChange={() => setAssigneeForm(m.principal_id)}
                    className="shrink-0"
                  />
                  {entry?.kind === 'agent' ? (
                    entry.isGlobalAgent ? (
                      <Globe2 className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                    ) : (
                      <Bot className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                    )
                  ) : (
                    <UserCircle2 className="w-3.5 h-3.5 text-text-muted" strokeWidth={1.8} />
                  )}
                  <span className="text-[13px] text-text-primary flex-1 truncate">
                    {entry?.displayName || `principal#${m.principal_id}`}
                  </span>
                  {m.principal_id === task.assignee_principal_id && (
                    <span className="text-[10px] text-text-muted">(当前)</span>
                  )}
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowEditAssignee(false)}>
              取消
            </Button>
            <Button
              onClick={handleUpdateAssignee}
              loading={savingAssignee}
              disabled={assigneeForm === (task.assignee_principal_id || 0)}
            >
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Reviewers Modal */}
      <Modal
        open={showEditReviewers}
        onClose={() => setShowEditReviewers(false)}
        title="变更审批人"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-[12px] text-text-muted">
            选择审批人(多选);留空则任务提交后直接完成,无需审批。
          </p>
          <div className="rounded border border-[#e3e2dc] bg-white max-h-[240px] overflow-y-auto">
            {channelMembers.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-text-muted italic">channel 暂无成员</p>
            ) : (
              channelMembers.map((m) => {
                const entry = byPrincipalID.get(m.principal_id);
                const checked = reviewersForm.ids.includes(m.principal_id);
                return (
                  <label
                    key={m.principal_id}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-[#f0efe9] last:border-b-0',
                      checked ? 'bg-[#2383e2]/[0.06]' : 'hover:bg-[#f4f3ef]',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEditReviewer(m.principal_id)}
                      className="shrink-0"
                    />
                    {entry?.kind === 'agent' ? (
                      entry.isGlobalAgent ? (
                        <Globe2 className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                      ) : (
                        <Bot className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                      )
                    ) : (
                      <UserCircle2 className="w-3.5 h-3.5 text-text-muted" strokeWidth={1.8} />
                    )}
                    <span className="text-[13px] text-text-primary flex-1 truncate">
                      {entry?.displayName || `principal#${m.principal_id}`}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          {reviewersForm.ids.length > 0 && (
            <div>
              <label className="block text-[13px] text-text-secondary mb-1">
                所需通过数({reviewersForm.ids.length} 位审批人中)
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {Array.from({ length: reviewersForm.ids.length }, (_, i) => i + 1).map((n) => {
                  const active = reviewersForm.required === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setReviewersForm({ ...reviewersForm, required: n })}
                      className={clsx(
                        'px-2.5 py-1 text-[12px] rounded border transition-colors',
                        active
                          ? 'border-[#2383e2] bg-[#2383e2]/[0.08] text-[#2383e2] font-medium'
                          : 'border-[#e3e2dc] text-text-secondary hover:bg-[#f4f3ef]',
                      )}
                    >
                      {n === reviewersForm.ids.length ? `全部 ${n}` : `${n} 位`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <p className="text-[11px] text-text-muted bg-[#f4f3ef] px-2 py-1.5 rounded">
            说明:变更审批人会清空旧的 reviewer 列表,已经投过的 review 记录保留在审计里。
            当前判定以新 reviewer 列表 + `required_approvals` 为准。
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowEditReviewers(false)}>
              取消
            </Button>
            <Button onClick={handleUpdateReviewers} loading={savingReviewers}>
              保存
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

interface TimelineItemProps {
  tone: 'neutral' | 'blue' | 'green' | 'amber' | 'red';
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  at: string;
}

function TimelineItem({ tone, icon, title, subtitle, at }: TimelineItemProps) {
  const toneStyle = {
    neutral: 'bg-[#eeede8] text-text-secondary',
    blue: 'bg-[#2383e2]/10 text-[#2383e2]',
    green: 'bg-[#448361]/15 text-[#448361]',
    amber: 'bg-[#cb912f]/15 text-[#cb912f]',
    red: 'bg-[#d44c47]/15 text-[#d44c47]',
  }[tone];
  return (
    <div className="flex items-start gap-2">
      <div
        className={clsx(
          'mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0',
          toneStyle,
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-text-primary">{title}</p>
        {subtitle && (
          <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-2">{subtitle}</p>
        )}
        <p className="text-[11px] text-text-muted mt-0.5">
          {formatRelativeWithAbsSeconds(Math.floor(new Date(at).getTime() / 1000))}
        </p>
      </div>
    </div>
  );
}

interface ParticipantRowProps {
  label: string;
  entry:
    | {
        principalId: number;
        kind: 'user' | 'agent';
        displayName: string;
        secondary?: string;
        avatarUrl?: string;
        isGlobalAgent?: boolean;
      }
    | null
    | undefined;
  myPid: number;
}

function ParticipantRow({ label, entry, myPid }: ParticipantRowProps) {
  if (!entry) {
    return (
      <div>
        {label && <p className="text-[11px] text-text-muted mb-1.5">{label}</p>}
        <p className="text-[12px] text-text-muted italic">未指派</p>
      </div>
    );
  }
  const isMe = entry.principalId === myPid;
  return (
    <div>
      {label && <p className="text-[11px] text-text-muted mb-1.5">{label}</p>}
      <div className="flex items-center gap-2">
        {entry.kind === 'agent' ? (
          <div className="w-6 h-6 rounded-full bg-[#2383e2]/10 flex items-center justify-center shrink-0">
            {entry.isGlobalAgent ? (
              <Globe2 className="w-3 h-3 text-[#2383e2]" strokeWidth={1.8} />
            ) : (
              <Bot className="w-3 h-3 text-[#2383e2]" strokeWidth={1.8} />
            )}
          </div>
        ) : entry.avatarUrl ? (
          <UserAvatar
            avatarUrl={entry.avatarUrl}
            fallback={entry.displayName}
            size="xs"
            tone="muted"
          />
        ) : (
          <UserCircle2 className="w-5 h-5 text-text-muted shrink-0" strokeWidth={1.8} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-text-primary truncate">
              {entry.displayName}
            </span>
            {isMe && (
              <span className="text-[9px] px-1 rounded bg-[#2383e2]/10 text-[#2383e2]">
                是我
              </span>
            )}
          </div>
          {entry.secondary && (
            <p className="text-[10px] text-text-muted truncate">{entry.secondary}</p>
          )}
        </div>
      </div>
    </div>
  );
}
