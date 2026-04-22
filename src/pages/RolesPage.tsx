import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { PermissionMatrix } from '@/components/perm/PermissionMatrix';
import { useOrgStore } from '@/store/org';
import { useAuthStore } from '@/store/auth';
import { roleApi, memberApi } from '@/api/org';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { toast } from '@/components/ui/Toast';
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  type Permission,
  type RoleResponse,
} from '@/types/api';
import {
  Shield,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  Lock,
  LockKeyhole,
  KeyRound,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// 前端侧的 slug 格式预校验,拒绝明显非法的输入,减少一次 API 往返。
// 后端正则:^[a-z][a-z0-9-]{1,31}$
const ROLE_SLUG_RE = /^[a-z][a-z0-9-]{1,31}$/;
const SYSTEM_ROLE_SLUGS = new Set(['owner', 'admin', 'member']);
const MAX_CUSTOM_ROLES = 20;

export function RolesPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const me = useAuthStore((s) => s.user);

  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<RoleResponse | null>(null);
  // M5:系统角色的 permissions 编辑只走独立端点(role.manage_system),拆出独立 modal
  const [editingSystemPerms, setEditingSystemPerms] = useState<RoleResponse | null>(null);
  // 展开显示权限详情的 role slug 集合。多选,用户可以同时展开多个。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 当前 user 在本 org 里的 role slug(通过 memberApi 查自己那条),用于"只能看子集权限"的门禁。
  const [myRoleSlug, setMyRoleSlug] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const res = await roleApi.list(slug);
      setRoles(res.data.result ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  // 拉 org 成员列表找到自己的那一条,取 role.slug。size=500 覆盖绝大多数组织;
  // 暂不做分页翻查 —— 如果未来有千人组织再补 /members/me 接口。
  useEffect(() => {
    if (!slug || !me?.id) return;
    let cancelled = false;
    memberApi
      .list(slug, 1, 500)
      .then((res) => {
        if (cancelled) return;
        const items = res.data.result?.items ?? [];
        const mine = items.find((m) => m.user_id === me.id);
        setMyRoleSlug(mine?.role.slug ?? null);
      })
      .catch(() => {
        if (!cancelled) setMyRoleSlug(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, me?.id]);

  // 按 owner → admin → member → 其他系统 → 自定义 排序;同层按 display_name 稳定排序。
  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => {
      const oa = roleOrder(a);
      const ob = roleOrder(b);
      if (oa !== ob) return oa - ob;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [roles]);

  // 我的权限集(从 roles 里匹配 myRoleSlug;首屏还未拉到 → 视作空集,不泄露任何非空权限)。
  const myPermissions = useMemo(() => {
    const r = sortedRoles.find((x) => x.slug === myRoleSlug);
    return new Set(r?.permissions ?? []);
  }, [sortedRoles, myRoleSlug]);

  // 判断某 role 的 permissions 是否 ⊆ 我的权限。自己这一条永远可看。
  // 空权限角色(如默认 member)所有人都能看(空集是任何集合的子集)。
  const canViewPerms = useCallback(
    (role: RoleResponse) => {
      if (role.slug === myRoleSlug) return true;
      return role.permissions.every((p) => myPermissions.has(p));
    },
    [myPermissions, myRoleSlug],
  );

  const toggleExpanded = (roleSlug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(roleSlug)) next.delete(roleSlug);
      else next.add(roleSlug);
      return next;
    });
  };

  const deleteRole = async (role: RoleResponse) => {
    if (!slug) return;
    if (!confirm(`确定删除角色「${role.display_name}」?\n如果还有成员挂在该角色上会被拒绝。`)) return;
    const res = await apiCall(() => roleApi.delete(slug, role.slug), {
      success: '角色已删除',
    });
    if (res.ok) fetchRoles();
  };

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="角色" />
        <GlassCard>
          <div className="py-8 text-center">
            <Shield className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">请先选择组织</p>
            <p className="text-[12px] text-text-muted">在顶部选择组织上下文后管理角色</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  const customRoles = roles.filter((r) => !r.is_system);
  const customFull = customRoles.length >= MAX_CUSTOM_ROLES;

  return (
    <div className="space-y-6">
      <PageHeader
        title="角色"
        subtitle={`${currentOrg?.org.display_name} · ${roles.length} 个角色(自定义 ${customRoles.length}/${MAX_CUSTOM_ROLES})`}
        loading={loading}
        onRefresh={fetchRoles}
        action={
          <Button
            onClick={() => setShowCreate(true)}
            disabled={customFull}
            icon={<Plus className="h-3.5 w-3.5" />}
            title={customFull ? '已达到自定义角色上限' : undefined}
          >
            创建角色
          </Button>
        }
      />

      <GlassCard>
        {sortedRoles.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">
            {loading ? '加载中...' : '暂无角色'}
          </p>
        ) : (
          <div className="space-y-0">
            {sortedRoles.map((r) => {
              const isOpen = expanded.has(r.slug);
              const canView = canViewPerms(r);
              return (
                <div
                  key={r.slug}
                  className="border-b border-border-default last:border-0"
                >
                  <div className="flex items-center gap-3 py-3">
                    <button
                      onClick={() => toggleExpanded(r.slug)}
                      className="text-text-muted hover:text-accent cursor-pointer p-0.5 shrink-0"
                      title={isOpen ? '收起' : '展开查看权限'}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <div className="h-8 w-8 rounded-md bg-accent/[0.08] flex items-center justify-center shrink-0">
                      {r.is_system ? (
                        <ShieldCheck className="h-4 w-4 text-accent" strokeWidth={1.6} />
                      ) : (
                        <Shield className="h-4 w-4 text-text-secondary" strokeWidth={1.6} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-text-primary">
                          {r.display_name}
                        </span>
                        {r.is_system && (
                          <span className="flex items-center gap-1 text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
                            <Lock className="h-2.5 w-2.5" /> 系统
                          </span>
                        )}
                        <span className="text-[10px] text-text-muted bg-bg-secondary px-1.5 py-[1px] rounded">
                          {r.permissions.length} 项权限
                        </span>
                        {r.slug === myRoleSlug && (
                          <span className="text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
                            我的角色
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-text-muted font-mono">{r.slug}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {r.is_system ? (
                        // 系统角色:不可改 display_name,只能 owner 改 permissions(独立端点)
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingSystemPerms(r)}
                          icon={<KeyRound className="h-3 w-3" />}
                          title="编辑权限位(需 role.manage_system 权限,默认仅 owner)"
                        >
                          权限
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(r)}
                            icon={<Pencil className="h-3 w-3" />}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteRole(r)}
                            icon={<Trash2 className="h-3 w-3" />}
                          >
                            删除
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <RolePermissionDetail role={r} canView={canView} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <p className="text-[11px] text-text-muted px-1">
        系统角色(owner / admin / member)由后端自动创建,不可改名 / 删除;权限位仅 owner 可改。
        自定义角色最多 20 个,删除前需先把挂该角色的成员迁到其他角色。
        创建/修改时配置的 permissions 必须是你自己拥有的子集(否则后端会拒)。
      </p>

      <CreateRoleModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        slug={slug}
        existingSlugs={new Set(roles.map((r) => r.slug))}
        onCreated={fetchRoles}
      />

      <EditRoleModal
        role={editing}
        onClose={() => setEditing(null)}
        slug={slug}
        onUpdated={fetchRoles}
      />

      <EditSystemRolePermsModal
        role={editingSystemPerms}
        onClose={() => setEditingSystemPerms(null)}
        slug={slug}
        onUpdated={fetchRoles}
      />
    </div>
  );
}

// roleOrder 给角色列表排序:owner → admin → member → 其他系统 → 自定义。
// owner/admin/member 置顶方便日常使用(最常看到的先显示);自定义排在后面因为量大,按名字字典序。
function roleOrder(r: RoleResponse): number {
  if (r.slug === 'owner') return 0;
  if (r.slug === 'admin') return 1;
  if (r.slug === 'member') return 2;
  if (r.is_system) return 3;
  return 4;
}

// RolePermissionDetail 展开态下的权限详情面板。
// canView=false 时显示"无权查看"的锁面板(避免低权限用户通过展开看到 owner 的权限细节)。
function RolePermissionDetail({
  role,
  canView,
}: {
  role: RoleResponse;
  canView: boolean;
}) {
  if (!canView) {
    return (
      <div className="ml-10 mb-3 px-3 py-3 rounded-md bg-bg-secondary/40 border border-border-default text-[12px] text-text-muted flex items-center gap-2">
        <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
        <span>
          当前账号权限不足以查看「{role.display_name}」的具体权限位
          （只能查看自己及权限子集的角色）。
        </span>
      </div>
    );
  }

  const owned = new Set(role.permissions);
  const hasAny = role.permissions.length > 0;

  return (
    <div className="ml-10 mb-3 px-3 py-3 rounded-md bg-bg-secondary/40 border border-border-default">
      {!hasAny ? (
        <p className="text-[12px] text-text-muted">无任何权限位(常态角色,仅用于组织成员基础身份)。</p>
      ) : (
        <div className="space-y-3">
          {PERMISSION_GROUPS.map((group) => {
            // 只渲染组内至少命中一条的分组,减少视觉噪声
            const hit = group.perms.filter((p) => owned.has(p));
            if (hit.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="text-[11px] font-medium text-text-secondary mb-1">
                  {group.label}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {hit.map((p) => (
                    <span
                      key={p}
                      className="text-[11px] px-2 py-[2px] rounded bg-accent/[0.06] text-accent border border-accent/20 font-mono"
                      title={p}
                    >
                      {PERMISSION_LABELS[p as Permission] ?? p}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {/* 未归类的权限位兜底(如果后端加新 perm 但前端 PERMISSION_GROUPS 没同步,仍显示出来) */}
          {(() => {
            const classified = new Set(PERMISSION_GROUPS.flatMap((g) => g.perms));
            const rest = role.permissions.filter((p) => !classified.has(p as Permission));
            if (rest.length === 0) return null;
            return (
              <div>
                <div className="text-[11px] font-medium text-text-secondary mb-1">其他</div>
                <div className="flex flex-wrap gap-1.5">
                  {rest.map((p) => (
                    <span
                      key={p}
                      className="text-[11px] px-2 py-[2px] rounded bg-bg-secondary text-text-muted border border-border-default font-mono"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function CreateRoleModal({
  open,
  onClose,
  slug,
  existingSlugs,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  existingSlugs: Set<string>;
  onCreated: () => void;
}) {
  const [roleSlug, setRoleSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  // "reset on prop change":open false→true 时清空 form;避开 react-hooks/set-state-in-effect
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setRoleSlug('');
      setDisplayName('');
      setPermissions([]);
    }
  }

  const slugError = (() => {
    if (!roleSlug) return null;
    if (SYSTEM_ROLE_SLUGS.has(roleSlug)) return '不能使用系统保留 slug(owner/admin/member)';
    if (!ROLE_SLUG_RE.test(roleSlug)) return '格式不合法(小写字母开头,2-32 字符,仅允许字母/数字/连字符)';
    if (existingSlugs.has(roleSlug)) return '该 slug 已被占用';
    return null;
  })();

  const canSubmit = !!roleSlug && !!displayName && !slugError;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    const res = await apiCall(
      () =>
        roleApi.create(slug, {
          slug: roleSlug,
          display_name: displayName,
          permissions,
        }),
      { success: '角色创建成功' },
    );
    if (res.ok) {
      onCreated();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="创建角色" size="lg">
      <div className="space-y-3">
        <div className="space-y-1">
          <Input
            label="Slug(唯一标识)"
            value={roleSlug}
            onChange={(e) => setRoleSlug(e.target.value.toLowerCase())}
            placeholder="designer(小写字母、数字、连字符)"
          />
          {slugError && <p className="text-[11px] text-accent-red">{slugError}</p>}
        </div>
        <Input
          label="显示名称"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="设计师"
        />
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-2">
            权限位(可选)
          </label>
          <PermissionMatrix value={permissions} onChange={setPermissions} />
        </div>
        <p className="text-[11px] text-text-muted">
          所选权限必须是你自己的子集;后端校验失败会拒。可不勾,创建后再编辑。
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

function EditRoleModal({
  role,
  onClose,
  slug,
  onUpdated,
}: {
  role: RoleResponse | null;
  onClose: () => void;
  slug: string;
  onUpdated: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  // "reset on prop change":role 引用变化时同步 form 初值
  const [prevRole, setPrevRole] = useState<RoleResponse | null>(role);
  if (role !== prevRole) {
    setPrevRole(role);
    if (role) {
      setDisplayName(role.display_name);
      setPermissions(role.permissions as Permission[]);
    }
  }

  if (!role) return null;

  const nameChanged = displayName !== role.display_name;
  const permsChanged = !sameSet(permissions, role.permissions);
  const canSubmit = !!displayName && (nameChanged || permsChanged);

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    const res = await apiCall(
      () =>
        roleApi.update(slug, role.slug, {
          display_name: nameChanged ? displayName : undefined,
          permissions: permsChanged ? permissions : undefined,
        }),
      { success: '角色已更新' },
    );
    if (res.ok) {
      onUpdated();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Modal open={!!role} onClose={onClose} title="编辑角色" size="lg">
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="block text-[12px] font-medium text-text-secondary">Slug</label>
          <div className="text-[13px] text-text-muted font-mono px-3 py-2 rounded-md bg-bg-secondary border border-border-default">
            {role.slug}
          </div>
          <p className="text-[11px] text-text-muted">Slug 创建后不可修改</p>
        </div>
        <Input
          label="显示名称"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <div>
          <label className="block text-[12px] font-medium text-text-secondary mb-2">
            权限位
          </label>
          <PermissionMatrix value={permissions} onChange={setPermissions} />
        </div>
        <p className="text-[11px] text-text-muted">
          仅可勾选你自己拥有的权限;超出会被后端拒(400 ceiling)。
        </p>
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

// EditSystemRolePermsModal 系统角色 permissions 编辑专用 modal。
//
// 后端走独立端点 PATCH /roles/:slug/permissions(role.manage_system 权限,默认 owner 才有)。
// 不允许改 display_name(系统角色锁死)。
function EditSystemRolePermsModal({
  role,
  onClose,
  slug,
  onUpdated,
}: {
  role: RoleResponse | null;
  onClose: () => void;
  slug: string;
  onUpdated: () => void;
}) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  // "reset on prop change":role 引用变化时同步 permissions 初值
  const [prevRole, setPrevRole] = useState<RoleResponse | null>(role);
  if (role !== prevRole) {
    setPrevRole(role);
    if (role) setPermissions(role.permissions as Permission[]);
  }

  if (!role) return null;

  const changed = !sameSet(permissions, role.permissions);

  const submit = async () => {
    if (!changed) return;
    setLoading(true);
    const res = await apiCall(
      () => roleApi.updatePermissions(slug, role.slug, { permissions }),
      { success: '系统角色权限已更新' },
    );
    if (res.ok) {
      onUpdated();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Modal open={!!role} onClose={onClose} title={`编辑权限位 · ${role.display_name}`} size="lg">
      <div className="space-y-3">
        <div className="text-[12px] text-accent bg-accent/[0.06] border border-accent/20 rounded-md px-3 py-2">
          这是系统角色「{role.slug}」的权限编辑。需要 <code className="font-mono">role.manage_system</code> 权限(默认仅 owner 可)。
          owner 自己的权限若改残会影响后续操作,请谨慎。
        </div>
        <PermissionMatrix value={permissions} onChange={setPermissions} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} loading={loading} disabled={!changed}>
            保存权限
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// sameSet 比较两个 string 数组作为集合是否相等。用于 modal 判断"是否有变化"。
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}
