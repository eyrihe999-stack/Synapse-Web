// SourcesPage 知识源管理(M2 + M3)。
//
// Source 是权限承载者:每个 doc 必属于一个 source,visibility / ACL 都挂在 source 上。
// 当前阶段只 manual_upload kind(每个 user 在每个 org 下 lazy 创建一个)。
//
// 功能:
//   - 列出 org 下所有 source(kind / owner / visibility 一览)
//   - 改 visibility(owner-only,服务端校验)
//   - 管理 ACL:列、加(group/user → read/write)、改 permission、撤销
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrgStore } from '@/store/org';
import { useAuthStore } from '@/store/auth';
import { sourceApi, type SourceListScope } from '@/api/source';
import { groupApi } from '@/api/permission';
import { memberApi } from '@/api/org';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { toast } from '@/components/ui/Toast';
import { formatRelativeWithAbs } from '@/lib/format';
import type {
  CreateSourceRequest,
  SourceResponse,
  SourceVisibility,
  SourceACLEntry,
  ACLPermission,
  ACLSubjectType,
  PermissionGroup,
  MemberResponse,
} from '@/types/api';
import {
  KeySquare,
  Globe,
  Users,
  Lock as LockIcon,
  Settings2,
  Trash2,
  Plus,
  Crown,
  FolderPlus,
} from 'lucide-react';

const VISIBILITY_LABEL: Record<SourceVisibility, string> = {
  org: '全 org 可读',
  group: '按 ACL 授权',
  private: '仅 owner',
};

const VISIBILITY_ICON: Record<SourceVisibility, typeof Globe> = {
  org: Globe,
  group: Users,
  private: LockIcon,
};

export function SourcesPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const me = useAuthStore((s) => s.user);

  const [sources, setSources] = useState<SourceResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [aclSource, setAclSource] = useState<SourceResponse | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // scope=visible(默认):只看自己能读的;all:看全 org(管理 / 审计视图)
  const [scope, setScope] = useState<SourceListScope>('visible');

  const fetchSources = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const res = await sourceApi.list(slug, 1, 100, undefined, scope);
      setSources(res.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug, scope]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const changeVisibility = async (src: SourceResponse, v: SourceVisibility) => {
    if (!slug || src.visibility === v) return;
    const res = await apiCall(
      () => sourceApi.updateVisibility(slug, src.id, { visibility: v }),
      { success: '可见性已更新' },
    );
    if (res.ok) fetchSources();
  };

  // 删除 source:仅 owner 可。后端会再校验该 source 下是否还有 doc;若有,返回
  // CodeSourceHasDocuments(409210020)→ errors.ts 会提示用户先删文档。
  const removeSource = async (src: SourceResponse) => {
    if (!slug) return;
    const label = src.name || kindLabel(src.kind);
    if (!confirm(`确定删除知识源「${label}」?\n前提：该知识源下的所有文档都已被删除。`)) return;
    const res = await apiCall(() => sourceApi.remove(slug, src.id), {
      success: '知识源已删除',
    });
    if (res.ok) fetchSources();
  };

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="知识源" />
        <GlassCard>
          <div className="py-8 text-center">
            <KeySquare className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">请先选择组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="知识源"
        subtitle={
          <span>
            {currentOrg?.org.display_name} ·{' '}
            <span className="font-medium text-text-primary">{sources.length}</span> 个
            {scope === 'visible' ? '我能看到的' : '全 org'}知识源
          </span>
        }
        loading={loading}
        onRefresh={fetchSources}
        action={
          <Button
            onClick={() => setShowCreate(true)}
            icon={<FolderPlus className="h-3.5 w-3.5" />}
          >
            新建数据源
          </Button>
        }
      />

      <ScopeToggle value={scope} onChange={setScope} />

      <GlassCard>
        {sources.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">
            {loading ? '加载中...' : '暂无知识源 —— 上传第一个文档时会自动创建'}
          </p>
        ) : (
          <div className="space-y-0">
            {sources.map((src) => {
              const isOwner = me?.id === src.owner_user_id;
              const Icon = VISIBILITY_ICON[src.visibility];
              return (
                <div
                  key={src.id}
                  className="flex items-center gap-3 py-3 border-b border-border-default last:border-0"
                >
                  <div className="h-8 w-8 rounded-md bg-accent/[0.08] flex items-center justify-center shrink-0">
                    <KeySquare className="h-4 w-4 text-accent" strokeWidth={1.6} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-text-primary truncate max-w-[260px]">
                        {src.name || kindLabel(src.kind)}
                      </span>
                      <span className="text-[10px] text-text-secondary bg-bg-secondary px-1.5 py-[1px] rounded">
                        {kindLabel(src.kind)}
                      </span>
                      {isOwner && (
                        <span className="flex items-center gap-1 text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
                          <Crown className="h-2.5 w-2.5" /> 你拥有
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-[10px] text-text-secondary bg-bg-secondary px-1.5 py-[1px] rounded">
                        <Icon className="h-2.5 w-2.5" />
                        {VISIBILITY_LABEL[src.visibility]}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted">
                      <span className="font-mono">#{src.id}</span> · 创建于{' '}
                      {formatRelativeWithAbs(src.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isOwner && (
                      <select
                        value={src.visibility}
                        onChange={(e) =>
                          changeVisibility(src, e.target.value as SourceVisibility)
                        }
                        className="text-[12px] px-2 py-1 rounded-md border border-border-default bg-white text-text-primary cursor-pointer"
                      >
                        <option value="org">全 org 可读</option>
                        <option value="group">按 ACL 授权</option>
                        <option value="private">仅 owner</option>
                      </select>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAclSource(src)}
                      icon={<Settings2 className="h-3 w-3" />}
                    >
                      ACL
                    </Button>
                    {isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSource(src)}
                        icon={<Trash2 className="h-3 w-3" />}
                        title="删除知识源（需先清空下属文档）"
                      >
                        删除
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <p className="text-[11px] text-text-muted px-1">
        知识源是权限承载者:visibility 决定基础可见性,ACL 表为 group/user 单独授权 read/write。
        当 visibility=group 时,只有 ACL 命中的人能读;org/private 模式下 ACL 不生效。
        改 visibility / 管 ACL 仅 source owner 可。owner 隐式拥有所有权限,不需要给自己授权。
      </p>

      <ACLEditorModal
        source={aclSource}
        onClose={() => setAclSource(null)}
        slug={slug}
      />

      <CreateSourceModal
        open={showCreate}
        slug={slug}
        onCancel={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          fetchSources();
        }}
      />
    </div>
  );
}

// ScopeToggle 列表范围切换:visible(默认,只看自己能读)/ all(全 org,管理 / 审计视图)。
function ScopeToggle({
  value,
  onChange,
}: {
  value: SourceListScope;
  onChange: (next: SourceListScope) => void;
}) {
  const options: Array<{ value: SourceListScope; label: string; hint: string }> = [
    { value: 'visible', label: '我能看到', hint: '我拥有的 + visibility=org + ACL 命中' },
    { value: 'all', label: '全 org', hint: '不带 ACL 过滤,展示全部(管理视图)' },
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
        {value === 'visible'
          ? '当前只展示你能读的;切到"全 org"看全部(可能含你无权访问的 source 元数据)'
          : '管理视图,不做 ACL 过滤'}
      </span>
    </div>
  );
}

// CreateSourceModal 自建 kind=custom 的数据源。name 是必填,visibility 默认 org。
function CreateSourceModal({
  open,
  slug,
  onCancel,
  onCreated,
}: {
  open: boolean;
  slug: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<SourceVisibility>('org');
  const [loading, setLoading] = useState(false);
  // "reset on prop change" 模式:open 从 false → true 时清空输入,
  // 避免 useEffect 里直接 setState 被 react-hooks/set-state-in-effect 拒绝。
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName('');
      setVisibility('org');
    }
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('error', '请填写数据源名称');
      return;
    }
    setLoading(true);
    const body: CreateSourceRequest = { name: trimmed, visibility };
    const res = await apiCall(() => sourceApi.create(slug, body), {
      success: '数据源已创建',
    });
    setLoading(false);
    if (res.ok) onCreated();
  };

  return (
    <Modal open={open} onClose={onCancel} title="新建数据源">
      <div className="space-y-3">
        <div>
          <label className="text-[12px] text-text-secondary mb-1 block">名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="比如：API 文档 / 项目 A 资料"
            maxLength={128}
            autoFocus
            className="w-full px-3 py-1.5 text-[13px] rounded-md border border-border-default bg-white focus:outline-none focus:border-accent/[0.5]"
          />
          <p className="text-[11px] text-text-muted mt-1">
            同一个人不能在一个组织里建重名的数据源;最多 128 个字符。
          </p>
        </div>
        <div>
          <label className="text-[12px] text-text-secondary mb-1 block">可见性</label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as SourceVisibility)}
            className="w-full px-3 py-1.5 text-[13px] rounded-md border border-border-default bg-white cursor-pointer"
          >
            <option value="org">全 org 可读</option>
            <option value="group">按 ACL 授权（创建后去 ACL 面板配置）</option>
            <option value="private">仅 owner</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            取消
          </Button>
          <Button onClick={submit} loading={loading}>
            创建
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'manual_upload':
      return '手动上传';
    case 'custom':
      return '自建';
    default:
      return kind;
  }
}

// ACLEditorModal source ACL 管理面板。
//
// 加载:source ACL 行 + org 全员 + org 所有 group(用于 picker)。
// 编辑:加新授权(group/user),改 permission,撤销。
function ACLEditorModal({
  source,
  onClose,
  slug,
}: {
  source: SourceResponse | null;
  onClose: () => void;
  slug: string;
}) {
  const me = useAuthStore((s) => s.user);
  const [acls, setAcls] = useState<SourceACLEntry[]>([]);
  const [orgMembers, setOrgMembers] = useState<MemberResponse[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyACLId, setBusyACLId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!source) return;
    setLoading(true);
    try {
      const [aclRes, memRes, grpRes] = await Promise.all([
        sourceApi.listACL(slug, source.id),
        memberApi.list(slug, 1, 200),
        groupApi.list(slug, 1, 200),
      ]);
      setAcls(aclRes.data.result?.items ?? []);
      setOrgMembers(memRes.data.result?.items ?? []);
      setGroups(grpRes.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug, source]);

  useEffect(() => {
    if (source) fetchAll();
  }, [source, fetchAll]);

  // 注:useMemo 必须在所有早 return 之前调,否则 source 从 null → 非 null 时
  // hook 数量会变,React 报"Rendered more hooks"错误,整个 SourcesPage 白屏。
  const memberById = useMemo(() => {
    const map = new Map<string, MemberResponse>();
    for (const m of orgMembers) map.set(m.user_id, m);
    return map;
  }, [orgMembers]);

  const groupById = useMemo(() => {
    const map = new Map<string, PermissionGroup>();
    for (const g of groups) map.set(g.id, g);
    return map;
  }, [groups]);

  if (!source) return null;

  const isOwner = me?.id === source.owner_user_id;

  const togglePermission = async (acl: SourceACLEntry) => {
    if (!isOwner) return;
    const next: ACLPermission = acl.permission === 'read' ? 'write' : 'read';
    setBusyACLId(acl.id);
    const res = await apiCall(
      () => sourceApi.updateACL(slug, source.id, acl.id, { permission: next }),
      { success: 'ACL 权限已切换' },
    );
    if (res.ok) await fetchAll();
    setBusyACLId(null);
  };

  const revoke = async (acl: SourceACLEntry) => {
    if (!isOwner) return;
    if (!confirm('确定撤销该 ACL 授权?')) return;
    setBusyACLId(acl.id);
    const res = await apiCall(
      () => sourceApi.revokeACL(slug, source.id, acl.id),
      { success: 'ACL 已撤销' },
    );
    if (res.ok) await fetchAll();
    setBusyACLId(null);
  };

  return (
    <Modal
      open={!!source}
      onClose={onClose}
      title={`ACL · ${kindLabel(source.kind)} (#${source.id})`}
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-text-secondary">
            当前可见性:
            <span className="ml-1.5 px-1.5 py-[1px] rounded bg-bg-secondary text-text-primary">
              {VISIBILITY_LABEL[source.visibility]}
            </span>
            {source.visibility !== 'group' && (
              <span className="ml-2 text-text-muted">
                · 当前模式下 ACL 不生效,但仍可预先配置
              </span>
            )}
          </p>
          {isOwner && (
            <Button
              size="sm"
              onClick={() => setShowAdd(true)}
              icon={<Plus className="h-3 w-3" />}
            >
              添加授权
            </Button>
          )}
        </div>

        {loading ? (
          <p className="text-[12px] text-text-muted text-center py-3">加载中...</p>
        ) : acls.length === 0 ? (
          <p className="text-[12px] text-text-muted text-center py-6 bg-bg-secondary rounded-md">
            暂无 ACL 授权 —— {isOwner ? '点击右上方添加' : '需要 source owner 配置'}
          </p>
        ) : (
          <div className="border border-border-default rounded-md divide-y divide-border-default">
            {acls.map((acl) => {
              let label = '';
              let secondary = '';
              if (acl.subject_type === 'group') {
                const g = groupById.get(acl.subject_id);
                label = g ? `权限组「${g.name}」` : `组 #${acl.subject_id}(已删?)`;
                secondary = g ? `${g.member_count} 个成员` : '';
              } else {
                const u = memberById.get(acl.subject_id);
                label = u?.display_name || u?.email || `用户 #${acl.subject_id}`;
                secondary = u?.email ?? '';
              }
              return (
                <div key={acl.id} className="px-3 py-2 flex items-center gap-3">
                  <div className="h-7 w-7 rounded-md bg-bg-secondary flex items-center justify-center shrink-0">
                    {acl.subject_type === 'group' ? (
                      <Users className="h-3.5 w-3.5 text-text-secondary" />
                    ) : (
                      <span className="text-[10px] font-medium text-text-secondary">U</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-text-primary truncate">{label}</div>
                    <div className="text-[11px] text-text-muted truncate">
                      {secondary && <>{secondary} · </>}
                      <span className="font-mono">{acl.subject_type}#{acl.subject_id}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => togglePermission(acl)}
                    disabled={!isOwner || busyACLId === acl.id}
                    className={`text-[11px] px-2 py-[3px] rounded font-medium cursor-pointer transition-colors
                      ${acl.permission === 'write'
                        ? 'bg-accent text-white hover:bg-[#1b6ec2]'
                        : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover'}
                      disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={isOwner ? '点击切换 read↔write' : '需 source owner'}
                  >
                    {acl.permission === 'write' ? '写' : '读'}
                  </button>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(acl)}
                      loading={busyACLId === acl.id}
                      icon={<Trash2 className="h-3 w-3" />}
                    >
                      撤销
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {showAdd && (
          <AddACLForm
            source={source}
            slug={slug}
            existingACL={acls}
            groups={groups}
            members={orgMembers}
            ownerUserId={source.owner_user_id}
            onCancel={() => setShowAdd(false)}
            onAdded={async () => {
              setShowAdd(false);
              await fetchAll();
            }}
          />
        )}

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AddACLForm({
  source,
  slug,
  existingACL,
  groups,
  members,
  ownerUserId,
  onCancel,
  onAdded,
}: {
  source: SourceResponse;
  slug: string;
  existingACL: SourceACLEntry[];
  groups: PermissionGroup[];
  members: MemberResponse[];
  ownerUserId: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [subjectType, setSubjectType] = useState<ACLSubjectType>('group');
  const [subjectId, setSubjectId] = useState<string>('');
  const [permission, setPermission] = useState<ACLPermission>('read');
  const [loading, setLoading] = useState(false);

  // 已有 ACL 的 subject 不允许再添加(409 冲突预防)
  const existingSubjects = useMemo(() => {
    const set = new Set<string>();
    for (const a of existingACL) set.add(`${a.subject_type}:${a.subject_id}`);
    return set;
  }, [existingACL]);

  const groupOptions = groups.filter((g) => !existingSubjects.has(`group:${g.id}`));
  const userOptions = members.filter(
    (m) => m.user_id !== ownerUserId && !existingSubjects.has(`user:${m.user_id}`),
  );

  // 切换 subject_type 时清空 subjectId,避免上一类的选择残留
  // 用 "reset on prop/state change" 模式,避让 react-hooks/set-state-in-effect 规则。
  const [prevSubjectType, setPrevSubjectType] = useState(subjectType);
  if (subjectType !== prevSubjectType) {
    setPrevSubjectType(subjectType);
    setSubjectId('');
  }

  const submit = async () => {
    if (!subjectId) return;
    setLoading(true);
    const res = await apiCall(
      () =>
        sourceApi.grantACL(slug, source.id, {
          subject_type: subjectType,
          subject_id: subjectId,
          permission,
        }),
      { success: 'ACL 已添加' },
    );
    if (res.ok) onAdded();
    setLoading(false);
  };

  return (
    <div className="border border-border-default rounded-md p-3 bg-bg-secondary/40 space-y-2">
      <div className="text-[12px] font-medium text-text-secondary">添加 ACL 授权</div>
      <div className="grid grid-cols-3 gap-2">
        <select
          value={subjectType}
          onChange={(e) => setSubjectType(e.target.value as ACLSubjectType)}
          className="text-[12px] px-2 py-1.5 rounded-md border border-border-default bg-white"
        >
          <option value="group">权限组</option>
          <option value="user">单用户</option>
        </select>
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          className="text-[12px] px-2 py-1.5 rounded-md border border-border-default bg-white col-span-1"
        >
          <option value="">选择…</option>
          {subjectType === 'group'
            ? groupOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))
            : userOptions.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name || m.email || m.user_id}
                </option>
              ))}
        </select>
        <select
          value={permission}
          onChange={(e) => setPermission(e.target.value as ACLPermission)}
          className="text-[12px] px-2 py-1.5 rounded-md border border-border-default bg-white"
        >
          <option value="read">读</option>
          <option value="write">写</option>
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" onClick={submit} loading={loading} disabled={!subjectId}>
          添加
        </Button>
      </div>
    </div>
  );
}
