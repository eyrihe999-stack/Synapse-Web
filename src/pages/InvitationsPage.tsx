import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useOrgStore } from '@/store/org';
import { invitationApi } from '@/api/org';
import { toast } from '@/components/ui/Toast';
import { getErrorMessage } from '@/lib/api-helpers';
import type { InvitationResponse } from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Inbox, Check, X, Ban, Filter, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { formatTs } from '@/lib/format';

type Tab = 'received' | 'sent';
const STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'accepted', label: '已接受' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'expired', label: '已过期' },
  { value: 'revoked', label: '已撤销' },
];

/** 标签-值对, 用于邀请卡片的详情行 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] text-text-muted shrink-0">{label}</span>
      <span className="text-[12px] text-text-secondary">{children}</span>
    </div>
  );
}

export function InvitationsPage() {
  const [tab, setTab] = useState<Tab>('received');

  return (
    <div className="space-y-6">
      <PageHeader title="邀请管理" subtitle="查看和处理组织邀请" />

      <div className="flex gap-1 border-b border-border-default">
        {([['received', '收到的邀请'], ['sent', '发出的邀请']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors cursor-pointer',
              tab === key
                ? 'border-accent text-accent'
                : 'border-transparent text-text-muted hover:text-text-secondary',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'received' ? <ReceivedInvitations /> : <SentInvitations />}
    </div>
  );
}

function StatusFilter({ value, onChange, loading, onRefresh }: { value: string; onChange: (v: string) => void; loading?: boolean; onRefresh?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-text-muted" />
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={clsx(
                'px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer',
                value === opt.value
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent/[0.06] transition-colors cursor-pointer disabled:opacity-40"
          title="刷新"
        >
          <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
        </button>
      )}
    </div>
  );
}

// ── 收到的邀请 ──────────────────────────────────────────────

function ReceivedInvitations() {
  const [invitations, setInvitations] = useState<InvitationResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const fetchOrgs = useOrgStore((s) => s.fetchOrgs);

  const fetchList = async (status = statusFilter) => {
    setLoading(true);
    try {
      const res = await invitationApi.listMine(1, 50, status);
      setInvitations(res.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, [statusFilter]);

  const accept = async (id: string) => {
    setActioningId(id);
    try {
      await invitationApi.accept(id);
      toast('success', '已接受邀请');
      fetchList();
      fetchOrgs();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setActioningId(null);
    }
  };

  const reject = async (id: string) => {
    setActioningId(id);
    try {
      await invitationApi.reject(id);
      toast('success', '已拒绝邀请');
      fetchList();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="space-y-3">
      <StatusFilter value={statusFilter} onChange={setStatusFilter} loading={loading} onRefresh={() => fetchList()} />

      {loading ? (
        <p className="text-[13px] text-text-muted py-6 text-center">加载中...</p>
      ) : invitations.length === 0 ? (
        <GlassCard>
          <div className="py-8 text-center">
            <Inbox className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">
              {statusFilter ? '该状态下暂无邀请' : '暂无收到的邀请'}
            </p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {invitations.map((inv) => (
            <GlassCard key={inv.id}>
              {/* 头部: 组织名 + 状态 + 操作 */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-text-primary">
                      {inv.org_display_name || inv.org_slug}
                    </span>
                    <StatusBadge status={inv.status} />
                    {inv.type === 'ownership_transfer' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-amber/10 text-accent-amber font-medium">所有权转让</span>
                    )}
                  </div>
                  {inv.org_description && (
                    <p className="text-[11px] text-text-muted mt-1 line-clamp-1">{inv.org_description}</p>
                  )}
                </div>
                {inv.status === 'pending' && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => accept(inv.id)} loading={actioningId === inv.id} disabled={!!actioningId} icon={<Check className="h-3 w-3" />}>接受</Button>
                    <Button variant="ghost" size="sm" onClick={() => reject(inv.id)} loading={actioningId === inv.id} disabled={!!actioningId} icon={<X className="h-3 w-3" />}>拒绝</Button>
                  </div>
                )}
              </div>

              {/* 详情网格 */}
              <div className="mt-2.5 pt-2.5 border-t border-border-default/50 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                <Field label="组织负责人">{inv.org_owner_name || '—'}</Field>
                <Field label="组织成员">{inv.org_member_count != null ? `${inv.org_member_count} 人` : '—'}</Field>
                <Field label="邀请角色">{inv.role?.display_name ?? '—'}</Field>
                <Field label="邀请人">
                  {inv.inviter_name || '未知'}
                  {inv.inviter_email && <span className="text-text-muted ml-1">({inv.inviter_email})</span>}
                </Field>
                <Field label="发送时间">{formatTs(inv.created_at)}</Field>
                {inv.expires_at > 0 && (
                  <Field label="过期时间">{formatTs(inv.expires_at)}</Field>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 发出的邀请 ──────────────────────────────────────────────

function SentInvitations() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const [invitations, setInvitations] = useState<InvitationResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchList = async (status = statusFilter) => {
    if (!slug) return;
    setLoading(true);
    try {
      const res = await invitationApi.listByOrg(slug, 1, 50, status);
      setInvitations(res.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, [slug, statusFilter]);

  const revoke = async (id: string) => {
    if (!slug || !confirm('确定要撤销该邀请吗？')) return;
    setRevokingId(id);
    try {
      await invitationApi.revoke(slug, id);
      toast('success', '邀请已撤销');
      fetchList();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setRevokingId(null);
    }
  };

  if (!slug) {
    return (
      <GlassCard>
        <div className="py-8 text-center">
          <Inbox className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
          <p className="text-[13px] text-text-muted">请先在顶部选择一个组织</p>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3">
      <StatusFilter value={statusFilter} onChange={setStatusFilter} loading={loading} onRefresh={() => fetchList()} />

      {loading ? (
        <p className="text-[13px] text-text-muted py-6 text-center">加载中...</p>
      ) : invitations.length === 0 ? (
        <GlassCard>
          <div className="py-8 text-center">
            <Inbox className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">
              {statusFilter ? '该状态下暂无邀请' : '暂无发出的邀请'}
            </p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {invitations.map((inv) => (
            <GlassCard key={inv.id}>
              {/* 头部: 被邀请人 + 状态 + 操作 */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-text-primary">
                      {inv.invitee_name || `用户 ${inv.invitee_user_id}`}
                    </span>
                    {inv.invitee_email && (
                      <span className="text-[12px] text-text-muted">{inv.invitee_email}</span>
                    )}
                    <StatusBadge status={inv.status} />
                    {inv.type === 'ownership_transfer' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-amber/10 text-accent-amber font-medium">所有权转让</span>
                    )}
                  </div>
                </div>
                {inv.status === 'pending' && (
                  <div className="shrink-0">
                    <Button variant="danger" size="sm" onClick={() => revoke(inv.id)} loading={revokingId === inv.id} disabled={!!revokingId} icon={<Ban className="h-3 w-3" />}>撤销</Button>
                  </div>
                )}
              </div>

              {/* 详情网格 */}
              <div className="mt-2.5 pt-2.5 border-t border-border-default/50 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                <Field label="邀请人">
                  {inv.inviter_name || '未知'}
                  {inv.inviter_email && <span className="text-text-muted ml-1">({inv.inviter_email})</span>}
                </Field>
                <Field label="邀请角色">{inv.role?.display_name ?? '—'}</Field>
                <Field label="发送时间">{formatTs(inv.created_at)}</Field>
                {inv.expires_at > 0 && (
                  <Field label="过期时间">{formatTs(inv.expires_at)}</Field>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
