// AuditLogPage 审计日志查看(M6 落地)。
//
// 服务端按 caller 是否有 audit.read_all 决定 scope:
//   - 'all'  → 看全 org 的事件
//   - 'self' → 强制 actor=self,只看自己作为操作者的事件
//
// 过滤(可选):actor / action(精确) / action_prefix / target_type / before_id 分页。
// 行展开:before / after / metadata 原始 JSON;同时提供"人类语言"描述。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrgStore } from '@/store/org';
import { auditApi } from '@/api/permission';
import { groupApi } from '@/api/permission';
import { memberApi, roleApi } from '@/api/org';
import { getErrorMessage } from '@/lib/api-helpers';
import { toast } from '@/components/ui/Toast';
import { formatRelativeWithAbs } from '@/lib/format';
import type {
  AuditLogRow,
  AuditScope,
  PermissionGroup,
  MemberResponse,
  RoleResponse,
} from '@/types/api';
import {
  History,
  ChevronDown,
  ChevronUp,
  Filter,
  X,
  Globe,
  User as UserIcon,
} from 'lucide-react';

// 常见 action 前缀,用作过滤下拉
const ACTION_PREFIXES = [
  { value: '', label: '全部' },
  { value: 'group.', label: '权限组' },
  { value: 'source.', label: '知识源 / ACL' },
  { value: 'member.', label: '成员变更' },
  { value: 'role.', label: '角色变更' },
];

const TARGET_TYPES = [
  { value: '', label: '全部' },
  { value: 'group', label: 'group' },
  { value: 'group_member', label: 'group_member' },
  { value: 'source', label: 'source' },
  { value: 'source_acl', label: 'source_acl' },
  { value: 'org_member', label: 'org_member' },
  { value: 'role', label: 'role' },
];

interface Filter {
  actor_user_id?: string;
  action?: string;
  action_prefix?: string;
  target_type?: string;
}

export function AuditLogPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;

  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [scope, setScope] = useState<AuditScope>('self');
  const [nextBeforeId, setNextBeforeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>({});
  const [showFilter, setShowFilter] = useState(false);

  // 元数据:用户 / 权限组 / 角色映射,用于渲染时把 user_id / group_id 翻译成可读名字
  const [memberMap, setMemberMap] = useState<Map<string, MemberResponse>>(new Map());
  const [groupMap, setGroupMap] = useState<Map<string, PermissionGroup>>(new Map());
  const [roleMap, setRoleMap] = useState<Map<string, RoleResponse>>(new Map());

  const load = useCallback(
    async (cursor?: string) => {
      if (!slug) return;
      setLoading(true);
      try {
        const params = {
          ...filter,
          before_id: cursor,
          limit: 30,
        };
        // 清掉空字符串字段(axios 会带空字符串 query,后端正则可能误匹配)
        for (const k of Object.keys(params) as (keyof typeof params)[]) {
          if (params[k] === '' || params[k] == null) delete params[k];
        }
        const res = await auditApi.list(slug, params);
        const data = res.data.result;
        if (data) {
          setScope(data.scope);
          if (cursor) setItems((prev) => [...prev, ...data.items]);
          else setItems(data.items);
          setNextBeforeId(data.next_before_id ?? null);
        }
      } catch (err) {
        toast('error', getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [slug, filter],
  );

  // 元数据一次性加载
  const loadMeta = useCallback(async () => {
    if (!slug) return;
    try {
      const [memRes, grpRes, roleRes] = await Promise.all([
        memberApi.list(slug, 1, 200),
        groupApi.list(slug, 1, 200),
        roleApi.list(slug),
      ]);
      const mm = new Map<string, MemberResponse>();
      for (const m of memRes.data.result?.items ?? []) mm.set(m.user_id, m);
      setMemberMap(mm);
      const gm = new Map<string, PermissionGroup>();
      for (const g of grpRes.data.result?.items ?? []) gm.set(g.id, g);
      setGroupMap(gm);
      const rm = new Map<string, RoleResponse>();
      for (const r of roleRes.data.result ?? []) rm.set(String(r.created_at), r); // 占位
      // role 没有 id 字段返出来,只能用 slug 做 key —— audit 行的 role_id 是数字,无法直接 join
      // 我们在 metadata 里有 role_slug 时优先用之;否则展示 #role_id
      const rmBySlug = new Map<string, RoleResponse>();
      for (const r of roleRes.data.result ?? []) rmBySlug.set(r.slug, r);
      setRoleMap(rmBySlug);
    } catch {
      // 元数据失败不阻塞主流程
    }
  }, [slug]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="审计日志" />
        <GlassCard>
          <div className="py-8 text-center">
            <History className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">请先选择组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  const hasActiveFilter = !!(
    filter.actor_user_id ||
    filter.action ||
    filter.action_prefix ||
    filter.target_type
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="审计日志"
        subtitle={<ScopeBadge scope={scope} />}
        loading={loading}
        onRefresh={() => load()}
        action={
          <Button
            variant="ghost"
            onClick={() => setShowFilter((v) => !v)}
            icon={<Filter className="h-3.5 w-3.5" />}
          >
            {hasActiveFilter ? `过滤(${countFilters(filter)})` : '过滤'}
          </Button>
        }
      />

      {showFilter && (
        <GlassCard>
          <FilterPanel
            value={filter}
            onChange={(f) => setFilter(f)}
            onClear={() => setFilter({})}
          />
        </GlassCard>
      )}

      <GlassCard>
        {items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">
            {loading ? '加载中...' : hasActiveFilter ? '无匹配审计行' : '暂无审计记录'}
          </p>
        ) : (
          <div className="space-y-0">
            {items.map((row) => (
              <AuditRow
                key={row.id}
                row={row}
                memberMap={memberMap}
                groupMap={groupMap}
                roleMap={roleMap}
              />
            ))}
          </div>
        )}
      </GlassCard>

      {nextBeforeId && (
        <div className="text-center">
          <Button
            variant="secondary"
            onClick={() => load(nextBeforeId)}
            loading={loading}
          >
            加载更多
          </Button>
        </div>
      )}

      <p className="text-[11px] text-text-muted px-1">
        审计日志记录所有权限相关变更(权限组、source ACL、成员变更、角色变更)。
        {scope === 'self'
          ? ' 当前为自查模式,只能看到你作为操作者的记录;管理员可看到全 org。'
          : ' 当前为全 org 视图(基于你的权限)。'}
      </p>
    </div>
  );
}

function countFilters(f: Filter): number {
  return [f.actor_user_id, f.action, f.action_prefix, f.target_type].filter(Boolean).length;
}

function ScopeBadge({ scope }: { scope: AuditScope }) {
  if (scope === 'all') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
        <Globe className="h-2.5 w-2.5" /> 全 org 视图
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary bg-bg-secondary px-1.5 py-[1px] rounded">
      <UserIcon className="h-2.5 w-2.5" /> 自查模式
    </span>
  );
}

function FilterPanel({
  value,
  onChange,
  onClear,
}: {
  value: Filter;
  onChange: (f: Filter) => void;
  onClear: () => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className="block text-[11px] font-medium text-text-muted mb-1">
          操作者 user_id
        </label>
        <Input
          placeholder="精确匹配"
          value={value.actor_user_id ?? ''}
          onChange={(e) => onChange({ ...value, actor_user_id: e.target.value || undefined })}
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-text-muted mb-1">
          Action(精确)
        </label>
        <Input
          placeholder="如 member.role_change"
          value={value.action ?? ''}
          onChange={(e) => onChange({ ...value, action: e.target.value || undefined })}
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-text-muted mb-1">
          Action 前缀
        </label>
        <select
          value={value.action_prefix ?? ''}
          onChange={(e) =>
            onChange({ ...value, action_prefix: e.target.value || undefined })
          }
          className="w-full text-[13px] px-3 py-2 rounded-md border border-border-default bg-white"
        >
          {ACTION_PREFIXES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-text-muted mb-1">
          目标类型
        </label>
        <select
          value={value.target_type ?? ''}
          onChange={(e) =>
            onChange({ ...value, target_type: e.target.value || undefined })
          }
          className="w-full text-[13px] px-3 py-2 rounded-md border border-border-default bg-white"
        >
          {TARGET_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          icon={<X className="h-3 w-3" />}
        >
          清空过滤
        </Button>
      </div>
    </div>
  );
}

function AuditRow({
  row,
  memberMap,
  groupMap,
  roleMap,
}: {
  row: AuditLogRow;
  memberMap: Map<string, MemberResponse>;
  groupMap: Map<string, PermissionGroup>;
  roleMap: Map<string, RoleResponse>;
}) {
  const [expanded, setExpanded] = useState(false);

  const actor = memberMap.get(row.actor_user_id);
  const actorName = row.actor_user_id === '0'
    ? '系统'
    : actor?.display_name || actor?.email || `#${row.actor_user_id}`;

  const description = describeAction(row, memberMap, groupMap, roleMap);

  return (
    <div className="border-b border-border-default last:border-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left flex items-start gap-3 py-3 cursor-pointer hover:bg-bg-hover/50 px-2 -mx-2 rounded"
      >
        <div className="h-6 w-6 mt-0.5 rounded bg-bg-secondary text-text-muted flex items-center justify-center shrink-0">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-mono text-accent bg-accent/[0.06] px-1.5 py-[1px] rounded">
              {row.action}
            </span>
            <span className="text-[12px] text-text-secondary">由 {actorName}</span>
          </div>
          <p className="text-[12px] text-text-primary mt-1 leading-snug">{description}</p>
          <p className="text-[11px] text-text-muted mt-0.5">
            {formatRelativeWithAbs(row.created_at)}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="pl-9 pr-2 pb-3 space-y-2">
          {row.metadata && Object.keys(row.metadata).length > 0 && (
            <JsonBlock label="metadata" value={row.metadata} />
          )}
          {row.before && Object.keys(row.before).length > 0 && (
            <JsonBlock label="before" value={row.before} />
          )}
          {row.after && Object.keys(row.after).length > 0 && (
            <JsonBlock label="after" value={row.after} />
          )}
          <div className="text-[10px] text-text-muted font-mono">
            audit#{row.id} · target {row.target_type}#{row.target_id}
          </div>
        </div>
      )}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-[10px] font-mono text-text-muted mb-0.5">{label}</div>
      <pre className="text-[11px] font-mono bg-bg-secondary px-2 py-1.5 rounded border border-border-default overflow-x-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// describeAction 把审计行渲染成中文描述。常见 action 走自定义模板,其他 fallback 显示 action 字面量。
function describeAction(
  row: AuditLogRow,
  memberMap: Map<string, MemberResponse>,
  groupMap: Map<string, PermissionGroup>,
  roleMap: Map<string, RoleResponse>,
): string {
  const meta = row.metadata ?? {};
  const before = row.before ?? {};
  const after = row.after ?? {};

  const userName = (uid: unknown): string => {
    if (uid == null) return '?';
    const id = String(uid);
    const m = memberMap.get(id);
    return m?.display_name || m?.email || `用户#${id}`;
  };
  const groupName = (gid: unknown): string => {
    if (gid == null) return '?';
    const g = groupMap.get(String(gid));
    return g ? `「${g.name}」` : `组#${gid}`;
  };
  const roleNameById = (rid: unknown): string => {
    if (rid == null) return '?';
    // role_id is numeric and we can't easily look it up by id from RoleResponse
    // metadata sometimes has role_slug alongside; fall back to #id otherwise
    return `角色#${rid}`;
  };

  switch (row.action) {
    case 'group.create':
      return `创建权限组${after.name ? `「${after.name}」` : ''}`;
    case 'group.rename':
      return `把权限组${before.name ? `「${before.name}」` : ''}改名为${after.name ? `「${after.name}」` : ''}`;
    case 'group.delete':
      return `删除权限组${before.name ? `「${before.name}」` : ''}`;
    case 'group.member_add':
      return `把 ${userName(meta.user_id)} 加入权限组${groupName(meta.group_id)}`;
    case 'group.member_remove':
      return `把 ${userName(meta.user_id)} 移出权限组${groupName(meta.group_id)}`;

    case 'source.create':
      return `创建知识源 #${after.id ?? row.target_id}`;
    case 'source.visibility_change':
      return `把知识源 #${row.target_id} 可见性从 ${before.visibility} 改为 ${after.visibility}`;
    case 'source.acl_grant': {
      const sub = meta.subject_type === 'group'
        ? `权限组${groupName(meta.subject_id)}`
        : userName(meta.subject_id);
      return `授权 ${sub} 对知识源 #${meta.resource_id} 的 ${meta.permission} 权限`;
    }
    case 'source.acl_update':
      return `把知识源 #${meta.resource_id} 上的 ACL 从 ${meta.old_permission} 改为 ${meta.new_permission}`;
    case 'source.acl_revoke': {
      const sub = meta.subject_type === 'group'
        ? `权限组${groupName(meta.subject_id)}`
        : userName(meta.subject_id);
      return `撤销 ${sub} 对知识源 #${meta.resource_id} 的 ${meta.permission} 权限`;
    }

    case 'member.add':
      return `${userName(after.user_id)} 加入了组织(以角色 ${roleNameById(after.role_id)})`;
    case 'member.remove':
      return `${userName(meta.user_id ?? before.user_id)} 离开了组织`;
    case 'member.role_change':
      return `把 ${userName(after.user_id ?? before.user_id)} 的角色从 ${roleNameById(meta.old_role_id)} 改为 ${roleNameById(meta.new_role_id)}`;

    case 'role.create':
      return `创建角色「${after.display_name}」(${after.slug})`;
    case 'role.update':
      return `把角色「${before.display_name}」改名为「${after.display_name}」`;
    case 'role.permissions_change': {
      const slug = (meta.role_slug as string | undefined) ?? '?';
      const role = roleMap.get(slug);
      const beforeCount = Array.isArray(before.permissions) ? before.permissions.length : 0;
      const afterCount = Array.isArray(after.permissions) ? after.permissions.length : 0;
      return `修改角色${role ? `「${role.display_name}」` : `「${slug}」`}权限位(从 ${beforeCount} 项到 ${afterCount} 项)${meta.is_system ? ' · 系统角色' : ''}`;
    }
    case 'role.delete':
      return `删除自定义角色「${before.display_name}」`;

    default:
      return `${row.action} → ${row.target_type}#${row.target_id}`;
  }
}
