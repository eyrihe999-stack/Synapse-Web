import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useOrgStore } from '@/store/org';
import { useAuthStore } from '@/store/auth';
import { memberApi, roleApi, invitationApi } from '@/api/org';
import { toast } from '@/components/ui/Toast';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import type {
  MemberResponse,
  RoleResponse,
  RoleSummary,
  InviteCandidate,
  InviteSearchType,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { UserIdentity } from '@/components/ui/UserIdentity';
import {
  Users,
  UserMinus,
  LogOut,
  Crown,
  MailPlus,
  Loader2,
  Clock,
  Activity,
  ShieldAlert,
  MailWarning,
} from 'lucide-react';
import { formatRelativeTs, formatRelativeWithAbs, formatTs } from '@/lib/format';

export function MembersPage() {
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
  const currentUser = useAuthStore((s) => s.user);
  const slug = currentOrg?.org.slug;
  const ownerId = currentOrg?.org.owner_user_id;
  const isOwner = !!currentUser && !!ownerId && currentUser.id === ownerId;

  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!slug) return;
    setLoadingMembers(true);
    try {
      const res = await memberApi.list(slug);
      setMembers(res.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoadingMembers(false);
    }
  }, [slug]);

  const fetchRoles = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await roleApi.list(slug);
      setRoles(res.data.result ?? []);
    } catch {
      // 角色拉不到不致命 —— 成员列表仍然能显示 role 标签(带在 member 响应里)
    }
  }, [slug]);

  const refreshAll = useCallback(() => {
    fetchMembers();
    fetchRoles();
  }, [fetchMembers, fetchRoles]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const removeMember = async (userId: string, name: string) => {
    if (!slug || !confirm(`确定要移除成员「${name || userId}」吗？`)) return;
    setRemovingId(userId);
    try {
      await memberApi.remove(slug, userId);
      toast('success', '成员已移除');
      fetchMembers();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setRemovingId(null);
    }
  };

  const leaveOrg = async () => {
    if (!slug || !confirm('确定要退出当前组织吗？')) return;
    setLeaving(true);
    try {
      await memberApi.leave(slug);
      toast('success', '已退出组织');
      await fetchOrgs();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLeaving(false);
    }
  };

  const changeRole = async (userId: string, newRoleSlug: string) => {
    if (!slug) return;
    setAssigningId(userId);
    try {
      await memberApi.assignRole(slug, userId, { role_slug: newRoleSlug });
      toast('success', '角色已更新');
      fetchMembers();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setAssigningId(null);
    }
  };

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="成员管理" />
        <GlassCard>
          <div className="py-8 text-center">
            <Users className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">请先选择组织</p>
            <p className="text-[12px] text-text-muted">在顶部选择组织上下文后查看成员</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  // 改角色下拉里能选的角色 —— 屏蔽 owner(只能通过转让产生,当前无此接口)
  const assignableRoles = roles.filter((r) => r.slug !== 'owner');

  return (
    <div className="space-y-6">
      <PageHeader
        title="成员管理"
        subtitle={`${currentOrg?.org.display_name} · ${members.length} 人`}
        loading={loadingMembers}
        onRefresh={refreshAll}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={() => setShowInvite(true)}
              icon={<MailPlus className="h-3.5 w-3.5" />}
            >
              邀请成员
            </Button>
            {!isOwner && (
              <Button
                variant="secondary"
                onClick={leaveOrg}
                loading={leaving}
                icon={<LogOut className="h-3.5 w-3.5" />}
              >
                退出组织
              </Button>
            )}
          </div>
        }
      />

      {/* 成员列表 */}
      <GlassCard>
        {members.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">暂无成员</p>
        ) : (
          <div className="space-y-0">
            {members.map((m) => {
              const isThisOwner = !!ownerId && m.user_id === ownerId;
              const isMe = !!currentUser && m.user_id === currentUser.id;
              // 能被 owner 改角色的条件:调用方是 owner、目标不是 owner、目标不是自己
              const canChangeRole = isOwner && !isThisOwner && !isMe;

              // 用户状态徽章:status=2 banned / status=3 deleted / email_verified_at=null 未验证。
              // deleted 用户理论上不会出现在成员列表(删除时已退出 org),保留兜底展示。
              const isBanned = m.status === 2;
              const isDeleted = m.status === 3;
              const isUnverified =
                m.email_verified_at === null || m.email_verified_at === undefined;
              // 有 email 才有"未验证"一说;拿不到 email(users 表 JOIN 缺失)时不展示该徽章
              const showUnverified = !!m.email && isUnverified && !isBanned && !isDeleted;

              return (
                <div
                  key={m.user_id}
                  className="flex items-center gap-4 py-3.5 border-b border-border-default last:border-0"
                >
                  <UserIdentity
                    avatarUrl={m.avatar_url}
                    displayName={m.display_name}
                    email={m.email}
                    userId={m.user_id}
                    secondary="email_and_id"
                    size="md"
                    className="flex-1"
                    avatarTone={isBanned || isDeleted ? 'muted' : 'accent'}
                    badges={
                      <>
                        {isThisOwner && (
                          <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-[1px] rounded">
                            <Crown className="h-2.5 w-2.5" /> Owner
                          </span>
                        )}
                        {isMe && (
                          <span className="text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
                            你
                          </span>
                        )}
                        {isBanned && (
                          <span className="flex items-center gap-1 text-[10px] text-accent-red bg-accent-red/[0.08] px-1.5 py-[1px] rounded">
                            <ShieldAlert className="h-2.5 w-2.5" /> 已封禁
                          </span>
                        )}
                        {isDeleted && (
                          <span className="text-[10px] text-text-muted bg-bg-secondary px-1.5 py-[1px] rounded">
                            已注销
                          </span>
                        )}
                        {showUnverified && (
                          <span
                            className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-[1px] rounded"
                            title="该成员还未验证邮箱"
                          >
                            <MailWarning className="h-2.5 w-2.5" /> 未验证
                          </span>
                        )}
                      </>
                    }
                  />

                  {/* 角色标签 / 角色选择器 */}
                  <div className="shrink-0">
                    {canChangeRole && assignableRoles.length > 0 ? (
                      <select
                        value={m.role.slug}
                        disabled={assigningId === m.user_id}
                        onChange={(e) => {
                          if (e.target.value !== m.role.slug) {
                            changeRole(m.user_id, e.target.value);
                          }
                        }}
                        className="text-[11px] text-text-secondary bg-bg-secondary border border-border-default rounded px-2 py-[3px] cursor-pointer hover:border-accent/40 focus:outline-none focus:border-accent/40 disabled:opacity-60"
                      >
                        {assignableRoles.map((r) => (
                          <option key={r.slug} value={r.slug}>
                            {r.display_name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <RoleTag role={m.role} />
                    )}
                  </div>

                  {/* 右侧 meta:最近活跃(若有)+ 加入时间 */}
                  <div className="shrink-0 w-44 text-[11px] text-text-muted text-right space-y-0.5">
                    {m.last_login_at != null ? (
                      <div
                        className="flex items-center gap-1.5 justify-end"
                        title={`最近登录 ${formatTs(m.last_login_at, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                      >
                        <Activity className="h-3 w-3" strokeWidth={1.6} />
                        <span className="truncate">活跃 {formatRelativeTs(m.last_login_at)}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 justify-end opacity-60">
                        <Activity className="h-3 w-3" strokeWidth={1.6} />
                        <span className="truncate">从未登录</span>
                      </div>
                    )}
                    <div
                      className="flex items-center gap-1.5 justify-end"
                      title={`加入时间 ${formatTs(m.joined_at)}`}
                    >
                      <Clock className="h-3 w-3" strokeWidth={1.6} />
                      <span className="truncate">加入 {formatRelativeWithAbs(m.joined_at)}</span>
                    </div>
                  </div>

                  {isOwner && !isThisOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMember(m.user_id, m.display_name || '')}
                      loading={removingId === m.user_id}
                      icon={<UserMinus className="h-3 w-3" />}
                    >
                      移除
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        slug={slug}
        roles={assignableRoles}
        onInvited={() => {
          // 发出邀请后跳"我的邀请"→发件箱,让邀请人直接看到刚发出的条目
          navigate('/user/invitations?tab=sent');
        }}
      />
    </div>
  );
}

function RoleTag({ role }: { role: RoleSummary }) {
  // 三种系统角色颜色区分:owner 黄、admin 紫、member 中性灰;自定义角色统一中性色。
  const cls = (() => {
    if (!role.is_system) return 'text-text-secondary bg-bg-secondary';
    switch (role.slug) {
      case 'owner':
        return 'text-amber-700 bg-amber-50';
      case 'admin':
        return 'text-purple-700 bg-purple-50';
      default:
        return 'text-text-secondary bg-bg-secondary';
    }
  })();
  return (
    <span className={`text-[11px] ${cls} px-2 py-[2px] rounded`}>
      {role.display_name || role.slug}
    </span>
  );
}

// InviteModal 邀请成员对话框。
//
// 流程:搜索用户 → 点击选中 → 选角色 → 发送邀请。
// 不支持邀请未注册用户 —— 必须从搜索结果里选现存 user。
//
// 搜索支持三种类型(用户在 UI 上明示选择),由后端按 type 分三路查:
//   - 邮箱     精确(LOWER)    用于准确邀请已知邮箱的人
//   - 昵称     模糊 LIKE      找不清邮箱时用名字查
//   - 用户 ID  精确           客服场景知道对方 ID 时用
function InviteModal({
  open,
  onClose,
  slug,
  roles,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  roles: RoleResponse[];
  onInvited: () => void;
}) {
  const [searchType, setSearchType] = useState<InviteSearchType>('email');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<InviteCandidate[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<InviteCandidate | null>(null);
  // 默认选 member(系统角色),没有再回退 roles[0]
  const [roleSlug, setRoleSlug] = useState('member');
  const [submitLoading, setSubmitLoading] = useState(false);

  // 打开时重置。关闭后不清空 —— 避免 Modal 关闭动画期间看到内容跳变
  useEffect(() => {
    if (open) {
      setSearchType('email');
      setQuery('');
      setCandidates(null);
      setSearchError(null);
      setSelected(null);
      const defaultRole = roles.find((r) => r.slug === 'member')?.slug ?? roles[0]?.slug ?? '';
      setRoleSlug(defaultRole);
    }
  }, [open, roles]);

  // 切换 type 时清搜索状态 —— query 按新类型的规则可能已经失效
  const onChangeSearchType = (t: InviteSearchType) => {
    setSearchType(t);
    setQuery('');
    setCandidates(null);
    setSearchError(null);
  };

  // 前端最小阈值:只是 debounce 门槛,后端会再校验一遍。
  //   email  至少含一个 @ 且前后都有字符 → 粗过滤掉"才敲两个字母"的无谓请求
  //   name   字符数 >=2
  //   user_id 纯数字 >=1 字符
  const isQueryReady = (t: InviteSearchType, q: string): boolean => {
    const trimmed = q.trim();
    if (t === 'email') {
      // 粗过滤:含 @ 且前后非空。后端用 mail.ParseAddress 严格校验。
      const at = trimmed.indexOf('@');
      return at > 0 && at < trimmed.length - 1;
    }
    if (t === 'user_id') return /^\d+$/.test(trimmed);
    // name
    return [...trimmed].length >= 2;
  };

  // debounce 搜索。query / type 任一变化触发。
  // email / user_id 稍慢(用户在手打完整值),name 稍快(看到结果随查)。
  useEffect(() => {
    if (!open || selected) return;
    const trimmed = query.trim();
    if (trimmed === '') {
      setCandidates(null);
      setSearchError(null);
      return;
    }
    if (!isQueryReady(searchType, trimmed)) {
      setCandidates(null);
      setSearchError(null);
      return;
    }
    const delay = searchType === 'name' ? 300 : 500;
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const res = await invitationApi.searchCandidates(slug, searchType, trimmed);
        // 业务错误码(比如 q 不合法)走失败分支
        if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
          setSearchError(res.data.message || '搜索失败');
          setCandidates([]);
          return;
        }
        setCandidates(res.data.result?.items ?? []);
      } catch (err) {
        setSearchError(getErrorMessage(err));
        setCandidates([]);
      } finally {
        setSearchLoading(false);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [open, selected, slug, searchType, query]);

  const submit = async () => {
    if (!selected) return;
    setSubmitLoading(true);
    const res = await apiCall(
      () => invitationApi.create(slug, { email: selected.email, role_slug: roleSlug }),
      { success: '邀请已发送' },
    );
    if (res.ok) {
      onInvited();
      onClose();
    }
    setSubmitLoading(false);
  };

  const searchPlaceholder = {
    email: '输入完整邮箱(精确匹配)',
    name: '输入昵称关键词(模糊匹配,至少 2 字符)',
    user_id: '输入用户 ID(精确匹配)',
  }[searchType];

  const searchHint = {
    email: '按邮箱精确查找:必须和用户注册邮箱完全一致',
    name: '按昵称模糊查找:包含关键词的用户都会出现',
    user_id: '按用户 ID 精确查找:输入对方的数字 ID',
  }[searchType];

  return (
    <Modal open={open} onClose={onClose} title="邀请成员">
      <div className="space-y-4">
        {selected ? (
          <SelectedCandidateCard
            candidate={selected}
            onClear={() => {
              setSelected(null);
              setQuery('');
              setCandidates(null);
              setSearchError(null);
            }}
          />
        ) : (
          <>
            {/* 搜索类型切换 */}
            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-text-secondary">
                搜索方式
              </label>
              <div className="flex rounded-md border border-border-default overflow-hidden">
                {(
                  [
                    { key: 'email', label: '邮箱' },
                    { key: 'name', label: '昵称' },
                    { key: 'user_id', label: '用户 ID' },
                  ] as { key: InviteSearchType; label: string }[]
                ).map((opt, idx) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onChangeSearchType(opt.key)}
                    className={clsx(
                      'flex-1 px-3 py-1.5 text-[12px] transition-colors cursor-pointer',
                      idx > 0 && 'border-l border-border-default',
                      searchType === opt.key
                        ? 'bg-accent/[0.08] text-accent font-medium'
                        : 'bg-white text-text-secondary hover:bg-bg-secondary',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-muted">{searchHint}</p>
            </div>

            {/* 搜索框 */}
            <Input
              label="搜索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              type={searchType === 'email' ? 'email' : 'text'}
              autoComplete="off"
            />

            {/* 结果列表 */}
            <CandidatesList
              query={query}
              searchType={searchType}
              loading={searchLoading}
              error={searchError}
              candidates={candidates}
              onSelect={(c) => setSelected(c)}
            />
          </>
        )}

        {/* 只有选中候选后才展示角色下拉 + 发送按钮 */}
        {selected && (
          <div className="space-y-1">
            <label className="block text-[12px] font-medium text-text-secondary">角色</label>
            <select
              value={roleSlug}
              onChange={(e) => setRoleSlug(e.target.value)}
              className="w-full rounded-md border border-border-default bg-white px-3 py-2 text-[14px] text-text-primary focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all cursor-pointer"
            >
              {roles.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.display_name}
                  {r.is_system ? '' : ' (自定义)'}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={submit}
            loading={submitLoading}
            disabled={!selected || !roleSlug}
          >
            发送邀请
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// SelectedCandidateCard 选中候选后顶部的"已选中"摘要卡片。
// 点"重新选择"清空 selected 回到搜索态。
function SelectedCandidateCard({
  candidate,
  onClear,
}: {
  candidate: InviteCandidate;
  onClear: () => void;
}) {
  return (
    <div className="rounded-md border border-accent/30 bg-accent/[0.06] px-3 py-3">
      <UserIdentity
        avatarUrl={candidate.avatar_url}
        displayName={candidate.display_name}
        email={candidate.email}
        userId={candidate.user_id}
        secondary="email_and_id"
        size="md"
        trailing={
          <button
            type="button"
            onClick={onClear}
            className="text-[12px] text-accent hover:underline cursor-pointer shrink-0"
          >
            重新选择
          </button>
        }
      />
    </div>
  );
}

// CandidatesList 搜索结果列表。
// 已是成员 / 已 pending 的候选灰掉并禁用点击,并显示状态徽章。
function CandidatesList({
  query,
  searchType,
  loading,
  error,
  candidates,
  onSelect,
}: {
  query: string;
  searchType: InviteSearchType;
  loading: boolean;
  error: string | null;
  candidates: InviteCandidate[] | null;
  onSelect: (c: InviteCandidate) => void;
}) {
  const trimmed = query.trim();

  // 尚未输入 / 输入不达标的提示
  if (!trimmed || candidates === null) {
    return (
      <p className="text-[12px] text-text-muted px-1 py-2">
        {searchType === 'name'
          ? '开始输入昵称关键词(至少 2 字符)以搜索用户'
          : searchType === 'email'
            ? '输入完整邮箱开始搜索'
            : '输入用户 ID 开始搜索'}
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-[12px] text-text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        搜索中...
      </div>
    );
  }

  if (error) {
    return <p className="text-[12px] text-accent-red px-1 py-2">{error}</p>;
  }

  if (candidates.length === 0) {
    const emptyMsg =
      searchType === 'email'
        ? `未找到邮箱为 ${trimmed} 的用户。只能邀请已注册 Synapse 的用户。`
        : searchType === 'user_id'
          ? `未找到 ID 为 ${trimmed} 的用户。`
          : '未找到匹配昵称的用户。';
    return <p className="text-[12px] text-text-muted px-1 py-2">{emptyMsg}</p>;
  }

  return (
    <div className="space-y-0 max-h-[320px] overflow-y-auto -mx-1 px-1">
      <p className="text-[11px] text-text-muted pb-1">
        {candidates.length} 个匹配
      </p>
      {candidates.map((c) => {
        const disabled = c.is_member || c.has_pending_invite;
        const disabledReason = c.is_member
          ? '已是成员'
          : c.has_pending_invite
            ? '已发出邀请'
            : null;
        return (
          <button
            key={c.user_id}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onSelect(c)}
            className={clsx(
              'flex w-full py-2 px-2 -mx-2 rounded text-left transition-colors',
              disabled
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:bg-bg-secondary cursor-pointer',
            )}
          >
            <UserIdentity
              avatarUrl={c.avatar_url}
              displayName={c.display_name}
              email={c.email}
              userId={c.user_id}
              secondary="email_and_id"
              size="sm"
              avatarTone={disabled ? 'muted' : 'accent'}
              className="flex-1"
              badges={
                disabledReason && (
                  <span
                    className={clsx(
                      'text-[10px] px-1.5 py-[1px] rounded',
                      c.is_member
                        ? 'text-text-secondary bg-bg-secondary'
                        : 'text-amber-700 bg-amber-50',
                    )}
                  >
                    {disabledReason}
                  </span>
                )
              }
            />
          </button>
        );
      })}
    </div>
  );
}
