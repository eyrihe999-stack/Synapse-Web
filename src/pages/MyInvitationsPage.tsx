// MyInvitationsPage 登录用户的邀请中心 (/user/invitations)。
//
// 双 tab:
//   - 我收到的  → /v2/invitations/mine   (按 email 匹配,被邀请人视角)
//   - 我发出的  → /v2/invitations/sent   (按 inviter_user_id 聚合,跨 org 发件箱)
//
// 每个 tab 各自带 status 过滤(全部/待处理/已接受/已拒绝/已过期/已撤销)。
// 后端懒过期:返全量或过 pending 时,过期 pending 会就地降级成 expired。
//
// 动作:
//   - 收到的 + pending      → 接受 / 拒绝
//   - 发出的 + pending      → 重发 / 撤销
//   - 其他状态              → 只展示,不操作
//
// 当前 tab 通过 URL query `?tab=received|sent` 记忆;MembersPage 发完邀请后
// navigate('/user/invitations?tab=sent') 让邀请人直接看到刚发出的条目。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Mail,
  MailCheck,
  Building2,
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  X,
  Loader2,
  Inbox,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { UserAvatar } from '@/components/ui/UserIdentity';
import { toast } from '@/components/ui/Toast';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { formatTs, formatRelativeTs, formatRelativeWithAbs } from '@/lib/format';
import { invitationApi } from '@/api/org';
import { useOrgStore } from '@/store/org';
import type {
  MyInvitationResponse,
  SentInvitationResponse,
  InvitationStatus,
} from '@/types/api';

type TabKey = 'received' | 'sent';
type StatusFilterKey = 'all' | InvitationStatus;

const STATUS_FILTERS: { key: StatusFilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理' },
  { key: 'accepted', label: '已接受' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'expired', label: '已过期' },
  { key: 'revoked', label: '已撤销' },
];

export function MyInvitationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
  const selectOrg = useOrgStore((s) => s.selectOrg);

  const tab: TabKey = searchParams.get('tab') === 'sent' ? 'sent' : 'received';
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>('all');

  const [received, setReceived] = useState<MyInvitationResponse[] | null>(null);
  const [sent, setSent] = useState<SentInvitationResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  // 单条操作态:`${id}-${action}` 粒度,避免整页 loading 不直观
  const [busy, setBusy] = useState<string | null>(null);

  // 切换 tab 回到 all,避免一个 tab 选 pending 后切到另一个 tab 列表为空误以为无数据
  const switchTab = (next: TabKey) => {
    setStatusFilter('all');
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'received') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', next);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const apiStatus: InvitationStatus | undefined =
    statusFilter === 'all' ? undefined : statusFilter;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'received') {
        const res = await invitationApi.listMine(apiStatus);
        setReceived(res.data.result?.items ?? []);
      } else {
        const res = await invitationApi.listSent(apiStatus);
        setSent(res.data.result?.items ?? []);
      }
    } catch (err) {
      toast('error', getErrorMessage(err));
      if (tab === 'received') setReceived([]);
      else setSent([]);
    } finally {
      setLoading(false);
    }
  }, [tab, apiStatus]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // ── Received 操作 ──
  const accept = async (inv: MyInvitationResponse) => {
    setBusy(`${inv.id}-accept`);
    const res = await apiCall(() => invitationApi.acceptById(inv.id), {
      success: `已加入 ${inv.org_display_name}`,
    });
    if (res.ok && res.data) {
      await fetchOrgs();
      selectOrg(res.data.org_slug);
      navigate('/org/members', { replace: true });
      return;
    }
    setBusy(null);
  };

  const reject = async (inv: MyInvitationResponse) => {
    if (!confirm(`拒绝来自 ${inv.org_display_name} 的邀请?`)) return;
    setBusy(`${inv.id}-reject`);
    const res = await apiCall(() => invitationApi.rejectById(inv.id), {
      success: '邀请已拒绝',
    });
    if (res.ok) {
      // 重新拉一遍,让"已拒绝"能出现在状态过滤里
      fetchList();
    }
    setBusy(null);
  };

  // ── Sent 操作 ──
  const resend = async (inv: SentInvitationResponse) => {
    setBusy(`${inv.id}-resend`);
    const res = await apiCall(
      () => invitationApi.resend(inv.org_slug, inv.id),
      { success: '邀请已重发(老链接已失效)' },
    );
    if (res.ok) fetchList();
    setBusy(null);
  };

  const revoke = async (inv: SentInvitationResponse) => {
    if (!confirm(`撤销对 ${inv.email} 的邀请?`)) return;
    setBusy(`${inv.id}-revoke`);
    const res = await apiCall(
      () => invitationApi.revoke(inv.org_slug, inv.id),
      { success: '邀请已撤销' },
    );
    if (res.ok) fetchList();
    setBusy(null);
  };

  const items: (MyInvitationResponse | SentInvitationResponse)[] | null =
    tab === 'received' ? received : sent;
  const isEmpty = !loading && items !== null && items.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="我的邀请"
        subtitle={tab === 'received' ? '别人邀请你加入的组织' : '你发给别人的邀请'}
        loading={loading}
        onRefresh={fetchList}
      />

      {/* Tab 切换 */}
      <div className="flex rounded-md border border-border-default overflow-hidden bg-white w-fit">
        <TabButton
          active={tab === 'received'}
          onClick={() => switchTab('received')}
          icon={<Inbox className="h-3.5 w-3.5" />}
          label="我收到的"
        />
        <TabButton
          active={tab === 'sent'}
          onClick={() => switchTab('sent')}
          icon={<MailCheck className="h-3.5 w-3.5" />}
          label="我发出的"
        />
      </div>

      {/* 状态过滤 */}
      <div className="flex flex-wrap gap-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={clsx(
              'px-2.5 py-1 text-[12px] rounded-md border transition-colors cursor-pointer',
              statusFilter === f.key
                ? 'bg-accent/[0.08] border-accent/30 text-accent font-medium'
                : 'bg-white border-border-default text-text-secondary hover:bg-bg-secondary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <GlassCard>
        {loading && items === null ? (
          <div className="flex items-center justify-center py-10 text-[13px] text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : isEmpty ? (
          <EmptyState tab={tab} statusFilter={statusFilter} />
        ) : tab === 'received' ? (
          <ReceivedList
            items={(items ?? []) as MyInvitationResponse[]}
            busy={busy}
            onAccept={accept}
            onReject={reject}
          />
        ) : (
          <SentList
            items={(items ?? []) as SentInvitationResponse[]}
            busy={busy}
            onResend={resend}
            onRevoke={revoke}
          />
        )}
      </GlassCard>
    </div>
  );
}

// ── Tab 按钮 ──
function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 text-[13px] transition-colors cursor-pointer',
        active
          ? 'bg-accent/[0.08] text-accent font-medium'
          : 'text-text-secondary hover:bg-bg-secondary',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Empty state ──
function EmptyState({
  tab,
  statusFilter,
}: {
  tab: TabKey;
  statusFilter: StatusFilterKey;
}) {
  const Icon = tab === 'received' ? Mail : MailCheck;
  const primary =
    statusFilter !== 'all'
      ? `暂无${STATUS_FILTERS.find((s) => s.key === statusFilter)?.label ?? ''}的邀请`
      : tab === 'received'
        ? '暂无收到的邀请'
        : '暂无发出的邀请';
  const secondary =
    tab === 'received'
      ? '有新邀请时会自动出现在这里。你也可以直接点击邮件里的链接接受。'
      : '在"成员"页邀请他人加入你的组织,记录会出现在这里。';
  return (
    <div className="py-10 text-center">
      <Icon className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
      <p className="text-[14px] text-text-secondary mb-1">{primary}</p>
      <p className="text-[12px] text-text-muted">{secondary}</p>
    </div>
  );
}

// ── 收到的列表 ──
function ReceivedList({
  items,
  busy,
  onAccept,
  onReject,
}: {
  items: MyInvitationResponse[];
  busy: string | null;
  onAccept: (inv: MyInvitationResponse) => void;
  onReject: (inv: MyInvitationResponse) => void;
}) {
  return (
    <div className="space-y-0">
      {items.map((inv) => {
        const isPending = inv.status === 'pending';
        const expired = inv.status === 'expired';
        return (
          <div
            key={inv.id}
            className="py-4 border-b border-border-default last:border-0"
          >
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-md bg-accent/[0.08] flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5 text-accent" strokeWidth={1.6} />
              </div>
              <div className="flex-1 min-w-0 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-text-primary truncate">
                      {inv.org_display_name}
                    </p>
                    <p className="text-[11px] text-text-muted font-mono truncate">
                      {inv.org_slug}
                    </p>
                  </div>
                  <StatusBadge status={inv.status} />
                </div>

                {/* 邀请人卡 —— 有头像占位和名字,突出"是谁邀请的" */}
                <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                  <span className="text-text-muted shrink-0">邀请人:</span>
                  <UserAvatar fallback={inv.inviter_name} size="xs" tone="muted" />
                  <span className="text-text-primary font-medium truncate">
                    {inv.inviter_name || '—'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  <MetaRow
                    icon={Shield}
                    label="分配角色"
                    value={`${inv.role.display_name}${inv.role.is_system ? '' : ' (自定义)'}`}
                  />
                  <MetaRow
                    icon={Clock}
                    label="邀请发出"
                    value={formatRelativeWithAbs(inv.created_at)}
                  />
                  <MetaRow
                    icon={Clock}
                    label={isPending ? '过期倒计时' : expired ? '已过期于' : '过期时间'}
                    value={
                      isPending
                        ? `${formatRelativeTs(inv.expires_at)} · ${formatTs(inv.expires_at)}`
                        : formatTs(inv.expires_at)
                    }
                    highlight={isPending}
                  />
                </div>

                {isPending && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => onAccept(inv)}
                      loading={busy === `${inv.id}-accept`}
                      disabled={busy !== null && busy !== `${inv.id}-accept`}
                      icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    >
                      接受
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onReject(inv)}
                      loading={busy === `${inv.id}-reject`}
                      disabled={busy !== null && busy !== `${inv.id}-reject`}
                      icon={<XCircle className="h-3.5 w-3.5" />}
                    >
                      拒绝
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 发出的列表 ──
function SentList({
  items,
  busy,
  onResend,
  onRevoke,
}: {
  items: SentInvitationResponse[];
  busy: string | null;
  onResend: (inv: SentInvitationResponse) => void;
  onRevoke: (inv: SentInvitationResponse) => void;
}) {
  return (
    <div className="space-y-0">
      {items.map((inv) => {
        const isPending = inv.status === 'pending';
        const expired = inv.status === 'expired';
        return (
          <div
            key={inv.id}
            className="py-4 border-b border-border-default last:border-0"
          >
            <div className="flex items-start gap-3">
              {/* 被邀请方用字母头像(未注册用户没有资料,降级展示邮箱首字母)*/}
              <UserAvatar fallback={inv.email} size="md" tone="warn" />
              <div className="flex-1 min-w-0 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-text-muted shrink-0" strokeWidth={1.6} />
                      <p className="text-[15px] font-semibold text-text-primary truncate">
                        {inv.email}
                      </p>
                    </div>
                    <p className="text-[11px] text-text-muted mt-0.5 flex items-center gap-1">
                      <Building2 className="h-3 w-3 shrink-0" strokeWidth={1.6} />
                      邀请加入 <span className="text-text-secondary font-medium">{inv.org_display_name}</span>
                      <span className="font-mono opacity-70">({inv.org_slug})</span>
                    </p>
                  </div>
                  <StatusBadge status={inv.status} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  <MetaRow
                    icon={Shield}
                    label="分配角色"
                    value={`${inv.role.display_name}${inv.role.is_system ? '' : ' (自定义)'}`}
                  />
                  <MetaRow
                    icon={Clock}
                    label="邀请发出"
                    value={formatRelativeWithAbs(inv.created_at)}
                  />
                  <MetaRow
                    icon={Clock}
                    label={isPending ? '过期倒计时' : expired ? '已过期于' : '过期时间'}
                    value={
                      isPending
                        ? `${formatRelativeTs(inv.expires_at)} · ${formatTs(inv.expires_at)}`
                        : formatTs(inv.expires_at)
                    }
                    highlight={isPending}
                  />
                </div>

                {isPending && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onResend(inv)}
                      loading={busy === `${inv.id}-resend`}
                      disabled={busy !== null && busy !== `${inv.id}-resend`}
                      icon={<Send className="h-3.5 w-3.5" />}
                    >
                      重发
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRevoke(inv)}
                      loading={busy === `${inv.id}-revoke`}
                      disabled={busy !== null && busy !== `${inv.id}-revoke`}
                      icon={<X className="h-3.5 w-3.5" />}
                    >
                      撤销
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 状态徽章:五种状态区分颜色,pending 用 accent 高亮 ──
function StatusBadge({ status }: { status: InvitationStatus }) {
  const spec = useMemo(() => {
    switch (status) {
      case 'pending':
        return { label: '待处理', cls: 'text-accent bg-accent/[0.08]' };
      case 'accepted':
        return { label: '已接受', cls: 'text-[#448361] bg-[#448361]/[0.1]' };
      case 'rejected':
        return { label: '已拒绝', cls: 'text-accent-red bg-accent-red/[0.1]' };
      case 'expired':
        return { label: '已过期', cls: 'text-text-secondary bg-bg-secondary' };
      case 'revoked':
        return { label: '已撤销', cls: 'text-text-secondary bg-bg-secondary' };
      default:
        return { label: status, cls: 'text-text-secondary bg-bg-secondary' };
    }
  }, [status]);
  return (
    <span
      className={clsx(
        'shrink-0 text-[11px] px-2 py-[2px] rounded font-medium',
        spec.cls,
      )}
    >
      {spec.label}
    </span>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  // highlight=true 时值用 accent 色标注,给 pending 邀请的过期倒计时用
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-text-muted shrink-0" strokeWidth={1.6} />
      <span className="text-[12px] text-text-muted w-20 shrink-0">{label}</span>
      <span
        className={clsx(
          'text-[12px] truncate',
          highlight ? 'text-accent font-medium' : 'text-text-primary',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
