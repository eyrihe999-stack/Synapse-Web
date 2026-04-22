// GroupsPage 权限组管理(M1 落地)。
//
// 功能:
//   - 列出当前 org 下所有权限组(成员数 + owner)
//   - 创建组(任何成员可)
//   - 改名 / 删组(后端校验组 owner-only)
//   - 管理成员(查看 / 加 / 踢;目标 user 必须是 org 成员)
//
// 后端硬规则:
//   - owner 不能被踢出自己的组(只能删组)
//   - 加成员前后端校验目标在 org 内
import { useCallback, useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { UserIdentity } from '@/components/ui/UserIdentity';
import { useOrgStore } from '@/store/org';
import { useAuthStore } from '@/store/auth';
import { groupApi } from '@/api/permission';
import { memberApi } from '@/api/org';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { toast } from '@/components/ui/Toast';
import { formatRelativeWithAbs } from '@/lib/format';
import type {
  PermissionGroup,
  GroupMemberEntry,
  MemberResponse,
} from '@/types/api';
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  UserPlus,
  UserMinus,
  Crown,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';

const MAX_GROUP_NAME = 64;

// GroupScope:列表范围
//   mine — 我加入的组(包括我创建的;走 /groups/mine,不分页)
//   all  — 全 org 的组(走 /groups,分页)
//
// "全 org" 模式主要给 owner / admin 用,普通成员看 mine 即可。
// ACL 授权下拉永远列全 org,与本切换无关。
type GroupScope = 'mine' | 'all';

export function GroupsPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const me = useAuthStore((s) => s.user);

  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<PermissionGroup | null>(null);
  const [managingMembers, setManagingMembers] = useState<PermissionGroup | null>(null);
  // scope=mine(默认):只列我加入或我创建的组;all:列 org 全部组(管理 / 审计视图)
  const [scope, setScope] = useState<GroupScope>('mine');

  // ── 内联"展开看成员"状态:
  //   expanded: 已展开的 group.id 集合
  //   membersByGroup: 懒加载的成员缓存(折叠后保留,再展开不重复拉)
  //   loadingIds: 正在加载的 group.id 集合,渲染 spinner 用
  //   profileById: org 成员的展示信息(display_name/avatar),页面首次进入拉一次
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [membersByGroup, setMembersByGroup] = useState<Record<string, GroupMemberEntry[]>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [profileById, setProfileById] = useState<Map<string, MemberResponse>>(new Map());

  const fetchGroups = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      if (scope === 'mine') {
        // /groups/mine 返回的是数组(不分页),后端只列 caller 加入的组
        const res = await groupApi.listMine(slug);
        setGroups(res.data.result ?? []);
      } else {
        const res = await groupApi.list(slug, 1, 100);
        setGroups(res.data.result?.items ?? []);
      }
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug, scope]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // 切 org / 切 scope 时清空展开态和成员缓存,避免跨组织错位
  useEffect(() => {
    setExpanded(new Set());
    setMembersByGroup({});
    setLoadingIds(new Set());
  }, [slug, scope]);

  // 拉 org 全员一次,用于"展开成员"时 join 出名字 / 头像。失败降级成只显示 user_id。
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    memberApi
      .list(slug, 1, 500)
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, MemberResponse>();
        for (const m of res.data.result?.items ?? []) map.set(m.user_id, m);
        setProfileById(map);
      })
      .catch(() => {
        if (!cancelled) setProfileById(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // 展开 / 收起某个组;首次展开时懒加载成员。
  const toggleExpanded = useCallback(
    async (groupId: string) => {
      const isOpen = expanded.has(groupId);
      if (isOpen) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
        return;
      }
      setExpanded((prev) => new Set(prev).add(groupId));
      // 已缓存过就不重复拉(刷新 modal 操作后会通过 fetchGroups 触发 scope 的 effect 清缓存)
      if (membersByGroup[groupId]) return;
      setLoadingIds((prev) => new Set(prev).add(groupId));
      try {
        const res = await groupApi.listMembers(slug!, groupId, 1, 200);
        setMembersByGroup((prev) => ({
          ...prev,
          [groupId]: res.data.result?.items ?? [],
        }));
      } catch (err) {
        toast('error', `加载成员失败:${getErrorMessage(err)}`);
      } finally {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
      }
    },
    [expanded, membersByGroup, slug],
  );

  const deleteGroup = async (g: PermissionGroup) => {
    if (!slug) return;
    if (!confirm(`确定删除权限组「${g.name}」?\n会同时清空所有成员关系。`)) return;
    const res = await apiCall(() => groupApi.delete(slug, g.id), { success: '权限组已删除' });
    if (res.ok) fetchGroups();
  };

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="权限组" />
        <GlassCard>
          <div className="py-8 text-center">
            <Users className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">请先选择组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="权限组"
        subtitle={
          <span>
            {currentOrg?.org.display_name} ·{' '}
            <span className="font-medium text-text-primary">{groups.length}</span> 个
            {scope === 'mine' ? '我加入的' : '全 org'}权限组
          </span>
        }
        loading={loading}
        onRefresh={fetchGroups}
        action={
          <Button onClick={() => setShowCreate(true)} icon={<Plus className="h-3.5 w-3.5" />}>
            创建权限组
          </Button>
        }
      />

      <GroupScopeToggle value={scope} onChange={setScope} />

      <GlassCard>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">
            {loading ? '加载中...' : '暂无权限组,点击右上方新建。'}
          </p>
        ) : (
          <div className="space-y-0">
            {groups.map((g) => {
              const isOwner = me?.id === g.owner_user_id;
              const isOpen = expanded.has(g.id);
              const loadingMembers = loadingIds.has(g.id);
              const cached = membersByGroup[g.id];
              return (
                <div
                  key={g.id}
                  className="border-b border-border-default last:border-0"
                >
                  <div className="flex items-center gap-3 py-3">
                    <button
                      onClick={() => toggleExpanded(g.id)}
                      className="text-text-muted hover:text-accent cursor-pointer p-0.5 shrink-0"
                      title={isOpen ? '收起' : '展开查看成员'}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <div className="h-8 w-8 rounded-md bg-accent/[0.08] flex items-center justify-center shrink-0">
                      <Users className="h-4 w-4 text-accent" strokeWidth={1.6} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-text-primary">{g.name}</span>
                        {isOwner && (
                          <span className="flex items-center gap-1 text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
                            <Crown className="h-2.5 w-2.5" /> 你创建的
                          </span>
                        )}
                        <span className="text-[10px] text-text-muted bg-bg-secondary px-1.5 py-[1px] rounded">
                          {g.member_count} 个成员
                        </span>
                      </div>
                      <p className="text-[11px] text-text-muted">
                        创建于 {formatRelativeWithAbs(g.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setManagingMembers(g)}
                        icon={<UserPlus className="h-3 w-3" />}
                      >
                        成员
                      </Button>
                      {isOwner && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(g)}
                            icon={<Pencil className="h-3 w-3" />}
                          >
                            改名
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteGroup(g)}
                            icon={<Trash2 className="h-3 w-3" />}
                          >
                            删除
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <GroupMembersInline
                      ownerUserId={g.owner_user_id}
                      members={cached}
                      loading={loadingMembers}
                      profileById={profileById}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <p className="text-[11px] text-text-muted px-1">
        权限组用于授权 ACL —— 把组的 id 配在某个知识源的 ACL 里,组内所有成员就拿到对应权限。
        组的改名 / 删组 / 管成员仅由组创建者(owner)操作;owner 自己不能被踢出。
      </p>

      <CreateGroupModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        slug={slug}
        existingNames={new Set(groups.map((g) => g.name))}
        onCreated={fetchGroups}
      />

      <RenameGroupModal
        group={editing}
        onClose={() => setEditing(null)}
        slug={slug}
        existingNames={new Set(groups.map((g) => g.name))}
        onUpdated={fetchGroups}
      />

      <ManageMembersModal
        group={managingMembers}
        onClose={() => {
          const closed = managingMembers;
          setManagingMembers(null);
          fetchGroups(); // 关闭后刷新主列表的 member_count
          // 失效这个组的成员缓存:如果它还处于展开态,重新拉一次保证内联视图与 modal 编辑后同步
          if (closed && slug) {
            setMembersByGroup((prev) => {
              const next = { ...prev };
              delete next[closed.id];
              return next;
            });
            if (expanded.has(closed.id)) {
              setLoadingIds((prev) => new Set(prev).add(closed.id));
              groupApi
                .listMembers(slug, closed.id, 1, 200)
                .then((res) => {
                  setMembersByGroup((prev) => ({
                    ...prev,
                    [closed.id]: res.data.result?.items ?? [],
                  }));
                })
                .catch(() => {
                  /* 失败不阻塞,用户可手动收起再展开重试 */
                })
                .finally(() => {
                  setLoadingIds((prev) => {
                    const next = new Set(prev);
                    next.delete(closed.id);
                    return next;
                  });
                });
            }
          }
        }}
        slug={slug}
      />
    </div>
  );
}

// GroupMembersInline 展开态下的组成员面板。
// members=undefined 表示首次展开还没拿到数据(会和 loading 一起显示);
// members=[] 表示拉回来就是空组(显示"暂无成员")。
// profileById 提供 display_name/email/avatar 的 join;拿不到就退化展示 user_id。
function GroupMembersInline({
  ownerUserId,
  members,
  loading,
  profileById,
}: {
  ownerUserId: string;
  members: GroupMemberEntry[] | undefined;
  loading: boolean;
  profileById: Map<string, MemberResponse>;
}) {
  if (loading || members === undefined) {
    return (
      <div className="ml-10 mb-3 px-3 py-3 rounded-md bg-bg-secondary/40 border border-border-default text-[12px] text-text-muted flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>加载成员…</span>
      </div>
    );
  }
  if (members.length === 0) {
    return (
      <div className="ml-10 mb-3 px-3 py-3 rounded-md bg-bg-secondary/40 border border-border-default text-[12px] text-text-muted">
        暂无成员(包含 owner 在内都为空是异常状态,可能组刚被清理)
      </div>
    );
  }
  return (
    <div className="ml-10 mb-3 rounded-md bg-bg-secondary/40 border border-border-default divide-y divide-border-default max-h-64 overflow-auto">
      {members.map((m) => {
        const profile = profileById.get(m.user_id);
        const isOwner = m.user_id === ownerUserId;
        return (
          <div key={m.user_id} className="px-3 py-2">
            <UserIdentity
              avatarUrl={profile?.avatar_url}
              displayName={profile?.display_name}
              email={profile?.email}
              userId={m.user_id}
              secondary="email"
              badges={
                isOwner ? (
                  <span className="flex items-center gap-1 text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
                    <Crown className="h-2.5 w-2.5" /> owner
                  </span>
                ) : null
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function CreateGroupModal({
  open,
  onClose,
  slug,
  existingNames,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  existingNames: Set<string>;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  // "reset on prop change":open false→true 清空输入,避开 react-hooks/set-state-in-effect
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setName('');
  }

  const trimmed = name.trim();
  const error =
    !trimmed
      ? null
      : trimmed.length > MAX_GROUP_NAME
        ? `名称最长 ${MAX_GROUP_NAME} 字符`
        : existingNames.has(trimmed)
          ? '该名称已被占用'
          : null;
  const canSubmit = !!trimmed && !error;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    const res = await apiCall(() => groupApi.create(slug, { name: trimmed }), {
      success: '权限组创建成功',
    });
    if (res.ok) {
      onCreated();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="创建权限组">
      <div className="space-y-3">
        <div className="space-y-1">
          <Input
            label="组名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="比如:产品组"
          />
          {error && <p className="text-[11px] text-accent-red">{error}</p>}
        </div>
        <p className="text-[11px] text-text-muted">
          创建后你自动成为组 owner 并加入成员列表。后续可在 ACL 里用此组授权资源。
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} loading={loading} disabled={!canSubmit}>
            创建
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RenameGroupModal({
  group,
  onClose,
  slug,
  existingNames,
  onUpdated,
}: {
  group: PermissionGroup | null;
  onClose: () => void;
  slug: string;
  existingNames: Set<string>;
  onUpdated: () => void;
}) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  // "reset on prop change":group 引用变化时同步 name 初值
  const [prevGroup, setPrevGroup] = useState<PermissionGroup | null>(group);
  if (group !== prevGroup) {
    setPrevGroup(group);
    if (group) setName(group.name);
  }

  if (!group) return null;

  const trimmed = name.trim();
  const error =
    !trimmed
      ? null
      : trimmed.length > MAX_GROUP_NAME
        ? `名称最长 ${MAX_GROUP_NAME} 字符`
        : trimmed !== group.name && existingNames.has(trimmed)
          ? '该名称已被占用'
          : null;
  const canSubmit = !!trimmed && !error && trimmed !== group.name;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    const res = await apiCall(
      () => groupApi.update(slug, group.id, { name: trimmed }),
      { success: '权限组已改名' },
    );
    if (res.ok) {
      onUpdated();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Modal open={!!group} onClose={onClose} title="改名权限组">
      <div className="space-y-3">
        <div className="space-y-1">
          <Input label="新组名" value={name} onChange={(e) => setName(e.target.value)} />
          {error && <p className="text-[11px] text-accent-red">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} loading={loading} disabled={!canSubmit}>
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ManageMembersModal 组成员管理
//
// 加载组成员 + org 全员,UI 把"已在组"和"可加入"拆成两栏。
// 加 / 踢成功后局部刷新两栏(避免重新打开 modal)。
function ManageMembersModal({
  group,
  onClose,
  slug,
}: {
  group: PermissionGroup | null;
  onClose: () => void;
  slug: string;
}) {
  const me = useAuthStore((s) => s.user);
  const [members, setMembers] = useState<GroupMemberEntry[]>([]);
  const [orgMembers, setOrgMembers] = useState<MemberResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!group) return;
    setLoading(true);
    try {
      const [groupRes, orgRes] = await Promise.all([
        groupApi.listMembers(slug, group.id, 1, 200),
        memberApi.list(slug, 1, 200),
      ]);
      setMembers(groupRes.data.result?.items ?? []);
      setOrgMembers(orgRes.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug, group]);

  useEffect(() => {
    if (group) fetchAll();
  }, [group, fetchAll]);

  if (!group) return null;

  const memberIds = new Set(members.map((m) => m.user_id));
  const candidates = orgMembers.filter((m) => !memberIds.has(m.user_id));

  // 取 org 内 user 的展示信息,member 列表 join 用
  const profileById = new Map<string, MemberResponse>();
  for (const m of orgMembers) profileById.set(m.user_id, m);

  const isOwner = me?.id === group.owner_user_id;

  const addMember = async (userId: string) => {
    setBusyUserId(userId);
    const res = await apiCall(() => groupApi.addMember(slug, group.id, { user_id: userId }), {
      success: '成员已加入',
    });
    if (res.ok) await fetchAll();
    setBusyUserId(null);
  };

  const removeMember = async (userId: string) => {
    if (userId === group.owner_user_id) {
      toast('error', '不能把组 owner 移出组(请删组或转让)');
      return;
    }
    setBusyUserId(userId);
    const res = await apiCall(
      () => groupApi.removeMember(slug, group.id, userId),
      { success: '成员已移除' },
    );
    if (res.ok) await fetchAll();
    setBusyUserId(null);
  };

  return (
    <Modal open={!!group} onClose={onClose} title={`成员管理 · ${group.name}`} size="lg">
      <div className="space-y-4">
        {/* 已在组 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] font-medium text-text-secondary">
              组内成员({members.length})
            </h4>
            {!isOwner && (
              <span className="text-[10px] text-text-muted">仅组 owner 可加 / 踢成员</span>
            )}
          </div>
          {members.length === 0 ? (
            <p className="text-[12px] text-text-muted py-3 text-center bg-bg-secondary rounded-md">
              暂无成员
            </p>
          ) : (
            <div className="border border-border-default rounded-md divide-y divide-border-default">
              {members.map((mem) => {
                const profile = profileById.get(mem.user_id);
                const isGroupOwner = mem.user_id === group.owner_user_id;
                const canRemove = isOwner && !isGroupOwner;
                return (
                  <div key={mem.user_id} className="px-3 py-2">
                    <UserIdentity
                      avatarUrl={profile?.avatar_url}
                      displayName={profile?.display_name}
                      email={profile?.email}
                      userId={mem.user_id}
                      secondary="email"
                      badges={
                        isGroupOwner ? (
                          <span className="flex items-center gap-1 text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
                            <Crown className="h-2.5 w-2.5" /> owner
                          </span>
                        ) : null
                      }
                      trailing={
                        canRemove ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMember(mem.user_id)}
                            loading={busyUserId === mem.user_id}
                            icon={<UserMinus className="h-3 w-3" />}
                          >
                            移除
                          </Button>
                        ) : null
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 可加入 */}
        {isOwner && (
          <div>
            <h4 className="text-[12px] font-medium text-text-secondary mb-2">
              可加入(org 其他成员,{candidates.length})
            </h4>
            {candidates.length === 0 ? (
              <p className="text-[12px] text-text-muted py-3 text-center bg-bg-secondary rounded-md">
                所有 org 成员都已加入此组
              </p>
            ) : (
              <div className="border border-border-default rounded-md divide-y divide-border-default max-h-64 overflow-auto">
                {candidates.map((m) => (
                  <div key={m.user_id} className="px-3 py-2">
                    <UserIdentity
                      avatarUrl={m.avatar_url}
                      displayName={m.display_name}
                      email={m.email}
                      userId={m.user_id}
                      secondary="email"
                      trailing={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => addMember(m.user_id)}
                          loading={busyUserId === m.user_id}
                          icon={<UserPlus className="h-3 w-3" />}
                        >
                          加入
                        </Button>
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading && <p className="text-[12px] text-text-muted text-center">加载中...</p>}

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// GroupScopeToggle 列表范围切换:mine(默认,只看我加入的)/ all(全 org,管理视图)。
function GroupScopeToggle({
  value,
  onChange,
}: {
  value: GroupScope;
  onChange: (next: GroupScope) => void;
}) {
  const options: Array<{ value: GroupScope; label: string; hint: string }> = [
    { value: 'mine', label: '我加入的', hint: '我创建的 + 加入的组' },
    { value: 'all', label: '全 org', hint: '展示组织内所有组(管理 / 审计视图)' },
  ];
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-md border border-border-default bg-bg-secondary p-0.5">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`text-[12px] px-2.5 py-1 rounded cursor-pointer transition-colors ${
                active
                  ? 'bg-white text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
              title={opt.hint}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <span className="text-[11px] text-text-muted">
        {value === 'mine'
          ? '只展示和你相关的;ACL 授权下拉仍可选 org 内任意组'
          : '展示组织内所有组,适合管理 / 审计场景'}
      </span>
    </div>
  );
}
