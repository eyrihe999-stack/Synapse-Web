import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrgStore } from '@/store/org';
import { useAgentStore } from '@/store/agent';
import { publishApi } from '@/api/agent';
import { apiCall } from '@/lib/api-helpers';
import { toast } from '@/components/ui/Toast';
import { getErrorMessage } from '@/lib/api-helpers';
import { formatTs } from '@/lib/format';
import type { PublishResponse, AgentResponse, AgentType } from '@/types/api';
import { Send, Plus, CheckCircle, XCircle, RotateCcw, Bot, Clock, User as UserIcon, FileText } from 'lucide-react';

const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  chat: '对话',
  tool: '工具',
};

const REVOKE_REASON_LABELS: Record<string, string> = {
  author_removed: '作者被移出组织',
  member_left: '成员离开组织',
  admin_banned: '管理员封禁',
  author_unpublished: '作者主动撤销',
  org_dissolved: '组织已解散',
};

const STATUS_TABS = [
  { label: '全部', value: '' },
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已拒绝', value: 'rejected' },
  { label: '已撤销', value: 'revoked' },
];

export function PublishesPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const myPermissions = currentOrg?.my_role.permissions ?? [];

  const canPublish = myPermissions.includes('agent.publish');
  const canReview = myPermissions.includes('agent.review');

  const [publishes, setPublishes] = useState<PublishResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [showSubmit, setShowSubmit] = useState(false);
  const [showReject, setShowReject] = useState<PublishResponse | null>(null);

  const fetchPublishes = async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const res = await publishApi.list(slug, { status: statusFilter || undefined, page: 1, size: 100 });
      setPublishes(res.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPublishes(); }, [slug, statusFilter]);

  const approve = async (id: string) => {
    if (!slug) return;
    const result = await apiCall(
      () => publishApi.approve(slug, id),
      { success: '已通过' },
    );
    if (result) fetchPublishes();
  };

  const revoke = async (id: string) => {
    if (!slug || !confirm('确定要撤销此发布记录吗？')) return;
    const result = await apiCall(
      () => publishApi.revoke(slug, id),
      { success: '已撤销' },
    );
    if (result) fetchPublishes();
  };

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agent 发布" />
        <GlassCard>
          <div className="py-8 text-center">
            <Send className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">请先在顶部选择一个组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent 发布"
        subtitle={`${currentOrg.org.display_name} · 管理 Agent 发布与审核`}
        loading={loading}
        onRefresh={fetchPublishes}
        action={
          canPublish ? (
            <Button onClick={() => setShowSubmit(true)} icon={<Plus className="h-3.5 w-3.5" />}>发布 Agent</Button>
          ) : undefined
        }
      />

      {/* Status filter tabs */}
      <div className="flex gap-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
              statusFilter === tab.value
                ? 'bg-accent/[0.08] text-accent'
                : 'text-text-muted hover:bg-[#eeede8] hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-[13px] text-text-muted py-6 text-center">加载中...</p>
      ) : publishes.length === 0 ? (
        <GlassCard>
          <div className="py-8 text-center">
            <Send className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">暂无发布记录</p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {publishes.map((p) => (
            <GlassCard key={p.id}>
              {/* Row 1: Agent info + Status + Actions */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                    {p.agent_icon_url ? (
                      <img src={p.agent_icon_url} alt="" className="h-6 w-6 rounded" />
                    ) : (
                      <Bot className="h-5 w-5 text-accent" strokeWidth={1.6} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-medium text-text-primary">{p.agent_display_name || `Agent #${p.agent_id}`}</p>
                      {p.agent_type && <StatusBadge status={p.agent_type} />}
                      <StatusBadge status={p.status} />
                      {p.agent_version && <span className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-[#f1f1ef] border border-[#e3e2dc]">{p.agent_version}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {p.agent_slug && <span className="text-[11px] text-text-muted font-mono">{p.agent_slug}</span>}
                      {p.agent_updated_at && <span className="text-[10px] text-text-muted">Agent 更新于 {formatTs(p.agent_updated_at)}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {canReview && p.status === 'pending' && (
                    <>
                      <Button size="sm" onClick={() => approve(p.id)} icon={<CheckCircle className="h-3 w-3" />}>
                        通过
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setShowReject(p)} icon={<XCircle className="h-3 w-3" />}>
                        拒绝
                      </Button>
                    </>
                  )}
                  {(p.status === 'pending' || p.status === 'approved') && (
                    <Button size="sm" variant="ghost" onClick={() => revoke(p.id)} icon={<RotateCcw className="h-3 w-3" />}>
                      撤销
                    </Button>
                  )}
                </div>
              </div>

              {/* Row 2: Description */}
              {p.agent_description && (
                <p className="text-[12px] text-text-secondary mt-2 ml-[52px] line-clamp-2">{p.agent_description}</p>
              )}

              {/* Row 3: Meta info */}
              <div className="flex items-center gap-4 mt-2.5 ml-[52px] flex-wrap text-[11px] text-text-muted">
                <span className="inline-flex items-center gap-1" title="提交者">
                  <UserIcon className="h-3 w-3 shrink-0" />
                  {p.submitted_by_display_name || `用户 ${p.submitted_by_user_id}`}
                </span>
                {p.reviewed_by_user_id && (
                  <span className="inline-flex items-center gap-1" title="审核者">
                    <CheckCircle className="h-3 w-3 shrink-0" />
                    {p.reviewed_by_display_name || `用户 ${p.reviewed_by_user_id}`}
                    {p.reviewed_at ? ` · ${formatTs(p.reviewed_at)}` : ''} 审核
                  </span>
                )}
                {p.agent_context_mode && <StatusBadge status={p.agent_context_mode} />}
                <span className="inline-flex items-center gap-1 ml-auto" title="提交时间">
                  <Clock className="h-3 w-3 shrink-0" />
                  {formatTs(p.created_at)}
                </span>
              </div>

              {/* Row 4: Tags */}
              {p.agent_tags && p.agent_tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 ml-[52px]">
                  {p.agent_tags.map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/[0.06] text-accent border border-accent/10 font-mono">{t}</span>
                  ))}
                </div>
              )}

              {/* Row 5: Notes / Revoke reason (if any) */}
              {(p.review_note || p.revoked_reason) && (
                <div className="mt-2 ml-[52px] space-y-1">
                  {p.review_note && (
                    <div className="flex items-start gap-1.5 text-[11px]">
                      <FileText className="h-3 w-3 shrink-0 text-text-muted mt-0.5" />
                      <span className="text-text-secondary">{p.review_note}</span>
                    </div>
                  )}
                  {p.revoked_reason && (
                    <div className="flex items-start gap-1.5 text-[11px]">
                      <RotateCcw className="h-3 w-3 shrink-0 text-text-muted mt-0.5" />
                      <span className="text-text-secondary">
                        {REVOKE_REASON_LABELS[p.revoked_reason] ?? p.revoked_reason}
                        {p.revoked_at ? ` · ${formatTs(p.revoked_at)}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      )}

      <SubmitPublishModal
        open={showSubmit}
        onClose={() => setShowSubmit(false)}
        slug={slug}
        onDone={fetchPublishes}
      />
      {showReject && (
        <RejectPublishModal
          publish={showReject}
          slug={slug}
          onClose={() => setShowReject(null)}
          onDone={fetchPublishes}
        />
      )}
    </div>
  );
}

// ── Submit Publish Modal ──

function SubmitPublishModal({ open, onClose, slug, onDone }: {
  open: boolean; onClose: () => void; slug: string; onDone: () => void;
}) {
  const { agents, fetchMyAgents } = useAgentStore();
  const [selectedId, setSelectedId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (open) fetchMyAgents(); }, [open, fetchMyAgents]);

  const selectedAgent = agents.find((a) => a.id === selectedId);

  const submit = async () => {
    if (!selectedId) return;
    setLoading(true);
    const result = await apiCall(
      () => publishApi.submit(slug, { agent_id: selectedId, note: note || undefined }),
      { success: '已提交发布请求' },
    );
    if (result) {
      onClose();
      onDone();
      setSelectedId('');
      setNote('');
    }
    setLoading(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="发布 Agent 到组织">
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="block text-[12px] font-medium text-text-secondary">选择 Agent</label>
          {agents.length === 0 ? (
            <p className="text-[12px] text-text-muted py-2">你还没有创建任何 Agent，请先前往「我的 Agent」创建。</p>
          ) : (
            <div className="max-h-56 overflow-auto border border-border-default rounded-md p-1.5 space-y-1">
              {agents.filter((a) => a.status === 'active').map((ag) => (
                <label
                  key={ag.id}
                  className={`flex items-center gap-2.5 cursor-pointer py-2 px-2.5 rounded-md transition-colors ${
                    selectedId === ag.id ? 'bg-accent/[0.06] border border-accent/20' : 'hover:bg-[#f1f1ef] border border-transparent'
                  }`}
                >
                  <input
                    type="radio"
                    name="agent_select"
                    checked={selectedId === ag.id}
                    onChange={() => setSelectedId(ag.id)}
                    className="accent-accent shrink-0"
                  />
                  <div className="h-8 w-8 rounded-md bg-accent/[0.06] flex items-center justify-center shrink-0">
                    {ag.icon_url ? (
                      <img src={ag.icon_url} alt="" className="h-4 w-4 rounded" />
                    ) : (
                      <Bot className="h-4 w-4 text-accent" strokeWidth={1.6} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-text-primary truncate">{ag.display_name}</span>
                      <StatusBadge status={ag.agent_type} />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-text-muted font-mono">{ag.slug}</span>
                      <StatusBadge status={ag.context_mode} />
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Selected agent preview */}
        {selectedAgent && (
          <div className="rounded-md bg-[#fbfaf8] border border-border-default p-3">
            <p className="text-[11px] text-text-muted mb-1.5">即将发布</p>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-accent/[0.06] flex items-center justify-center shrink-0">
                {selectedAgent.icon_url ? (
                  <img src={selectedAgent.icon_url} alt="" className="h-4 w-4 rounded" />
                ) : (
                  <Bot className="h-3.5 w-3.5 text-accent" strokeWidth={1.6} />
                )}
              </div>
              <div>
                <p className="text-[13px] font-medium text-text-primary">{selectedAgent.display_name}</p>
                {selectedAgent.description && (
                  <p className="text-[11px] text-text-muted line-clamp-1 mt-0.5">{selectedAgent.description}</p>
                )}
              </div>
            </div>
          </div>
        )}

        <Input
          label="备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="发布说明"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={submit} loading={loading} disabled={!selectedId}>提交</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Reject Publish Modal ──

function RejectPublishModal({ publish, slug, onClose, onDone }: {
  publish: PublishResponse; slug: string; onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const result = await apiCall(
      () => publishApi.reject(slug, publish.id, { note: note || undefined }),
      { success: '已拒绝' },
    );
    if (result) {
      onClose();
      onDone();
    }
    setLoading(false);
  };

  return (
    <Modal open={true} onClose={onClose} title="拒绝发布请求">
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-3 rounded-md bg-[#fbfaf8] border border-border-default">
          <div className="h-9 w-9 rounded-md bg-accent/[0.06] flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-accent" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-[13px] font-medium text-text-primary">{publish.agent_display_name || `Agent #${publish.agent_id}`}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {publish.agent_type && <StatusBadge status={publish.agent_type} />}
              {publish.agent_slug && <span className="text-[10px] text-text-muted font-mono">{publish.agent_slug}</span>}
            </div>
          </div>
        </div>
        <Input
          label="拒绝原因（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="请说明拒绝原因"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={submit} loading={loading}>确认拒绝</Button>
        </div>
      </div>
    </Modal>
  );
}
