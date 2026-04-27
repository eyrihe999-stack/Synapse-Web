// AgentsPage agent 网关的档案管理页。
//
// 功能:
//   - 列表:org 下所有 agent(在线状态 / enabled / 最近上线 / 创建者)
//   - 创建:display_name 表单 → 弹窗展示一次性 apikey + agent_id
//   - 详情展开:查看时间戳 + 创建者 + 完整 agent_id
//   - 编辑:改 display_name / 一键启停
//   - Rotate key:生成新 key 踢当前连接,新 key 一次性展示
//   - 删除:确认后硬删 + 踢连接
//
// 权限(后端兜底,前端只是按钮可见性策略):
//   - owner / 该 agent 创建者 → 显示全部写操作按钮
//   - 其它成员 → 只读(看到按钮点了也会被 403 拒)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrgStore } from '@/store/org';
import { useAuthStore } from '@/store/auth';
import { agentApi } from '@/api/agent';
import { memberApi } from '@/api/org';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { toast } from '@/components/ui/Toast';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import type {
  AgentResponse,
  AgentKind,
  CreateAgentRequest,
  UpdateAgentRequest,
} from '@/types/api';
import {
  Bot,
  Plus,
  Trash2,
  RotateCw,
  Copy,
  Check,
  Power,
  PowerOff,
  Circle,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Crown,
  Edit3,
  Server,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';

// AGENT_KIND_META 每种 agent kind 的展示元信息。新增 kind 时在这里加一项。
const AGENT_KIND_META: Record<AgentKind, { label: string; icon: typeof Server }> = {
  system: { label: '系统 Agent', icon: Server },
  user: { label: '用户 Agent', icon: UserIcon },
};

// TOP_ORCHESTRATOR_AGENT_ID 顶级 agent 的固定 agent_id,和后端
// internal/agents/const.go:TopOrchestratorAgentID 对齐。
// 所有 org 列出的 agent 中都会包含这一条(全局 agent,org_id='0')。
const TOP_ORCHESTRATOR_AGENT_ID = 'synapse-top-orchestrator';

// AgentGroup UI 分组:顶级 / 系统 / 用户。
type AgentGroup = 'top' | 'system' | 'user';

// AGENT_GROUP_META 每组的展示元信息;分组头部依此渲染标题 + 图标 + 说明。
const AGENT_GROUP_META: Record<AgentGroup, { label: string; icon: typeof Server; hint: string }> = {
  top: {
    label: '顶级 Agent',
    icon: Sparkles,
    hint: '平台级全局 orchestrator,所有 channel 都能 @ 到它',
  },
  system: {
    label: '系统 Agent',
    icon: Server,
    hint: '服务 / 自动化流程接入,apikey 身份',
  },
  user: {
    label: '个人 Agent',
    icon: UserIcon,
    hint: 'JWT 身份,成员自建,代表个人发起调用',
  },
};

// classifyAgent 按 agent_id + kind 把 agent 归到展示分组。
// 顶级判断优先:agent_id 匹配常量即视为顶级(否则会被吸进 system 组)。
function classifyAgent(a: AgentResponse): AgentGroup {
  if (a.agent_id === TOP_ORCHESTRATOR_AGENT_ID) return 'top';
  if (a.kind === 'system') return 'system';
  return 'user';
}

export function AgentsPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const ownerId = currentOrg?.org.owner_user_id;
  const me = useAuthStore((s) => s.user);
  const isOrgOwner = !!me && !!ownerId && me.id === ownerId;

  const [agents, setAgents] = useState<AgentResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<AgentResponse | null>(null);
  // 我在当前 org 的 role slug(owner/admin/member)。null = 还没拉到 / 不是成员。
  // 用途:判断能否渲染创建按钮(后端同时兜底,前端只做 UX 遮挡)。
  const [myRoleSlug, setMyRoleSlug] = useState<string | null>(null);
  // rotate / create 成功后展示一次性 apikey 用
  const [secretReveal, setSecretReveal] = useState<{
    title: string;
    agent: AgentResponse;
    apikey: string;
  } | null>(null);

  const canCreate =
    isOrgOwner || myRoleSlug === 'owner' || myRoleSlug === 'admin';

  // 把 agents 按 分组(顶级 / 系统 / 个人)拆桶,组内保持 API 返回顺序(通常按 id / 创建时间)。
  // 顺序固定 top → system → user 以呼应 UI 头部标注。
  const grouped = useMemo(() => {
    const buckets: Record<AgentGroup, AgentResponse[]> = { top: [], system: [], user: [] };
    for (const a of agents) {
      buckets[classifyAgent(a)].push(a);
    }
    return buckets;
  }, [agents]);

  // 决定渲染顺序 —— 空桶不画头部,避免空标题挡视线。
  const groupOrder: AgentGroup[] = ['top', 'system', 'user'];
  const visibleGroups = groupOrder.filter((g) => grouped[g].length > 0);

  const fetchAgents = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const res = await agentApi.list(slug, 0, 200);
      setAgents(res.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // 拉一次成员列表,找自己那条,取 role.slug。拉不到不致命 —— 默认当 member 处理,
  // 创建按钮隐藏,如确有权限可改用 API 直接调(后端兜底)。
  const fetchMyRole = useCallback(async () => {
    if (!slug || !me) {
      setMyRoleSlug(null);
      return;
    }
    try {
      const res = await memberApi.list(slug, 1, 200);
      const mine = res.data.result?.items.find((m) => m.user_id === me.id);
      setMyRoleSlug(mine?.role.slug ?? null);
    } catch {
      setMyRoleSlug(null);
    }
  }, [slug, me]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    fetchMyRole();
  }, [fetchMyRole]);

  const toggleExpand = (agentID: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(agentID)) next.delete(agentID);
      else next.add(agentID);
      return next;
    });
  };

  const canManage = (a: AgentResponse) =>
    isOrgOwner || (!!me && a.created_by_uid === me.id);

  const toggleEnabled = async (a: AgentResponse) => {
    if (!slug) return;
    const next = !a.enabled;
    const res = await apiCall(
      () => agentApi.update(slug, a.agent_id, { enabled: next }),
      { success: next ? 'Agent 已启用' : 'Agent 已禁用(当前连接被踢)' },
    );
    if (res.ok) fetchAgents();
  };

  const rotateKey = async (a: AgentResponse) => {
    if (!slug) return;
    if (!confirm(`轮转「${a.display_name}」的 API Key?\n旧 key 立即失效,当前连接会被踢。`))
      return;
    const res = await apiCall(() => agentApi.rotateKey(slug, a.agent_id), {
      success: 'API Key 已轮转',
    });
    if (res.ok && res.data) {
      setSecretReveal({
        title: '新 API Key',
        agent: res.data.agent,
        apikey: res.data.apikey,
      });
      fetchAgents();
    }
  };

  const removeAgent = async (a: AgentResponse) => {
    if (!slug) return;
    if (!confirm(`确定删除「${a.display_name}」?\n删除后记录不可恢复,当前连接会被踢。`)) return;
    const res = await apiCall(() => agentApi.remove(slug, a.agent_id), {
      success: 'Agent 已删除',
    });
    if (res.ok) fetchAgents();
  };

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agents" />
        <GlassCard>
          <div className="py-8 text-center">
            <Bot className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">请先选择组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        subtitle={
          <span>
            {currentOrg?.org.display_name} ·{' '}
            <span className="font-medium text-text-primary">{agents.length}</span> 个 Agent
          </span>
        }
        loading={loading}
        onRefresh={fetchAgents}
        action={
          canCreate ? (
            <Button onClick={() => setShowCreate(true)} icon={<Plus className="h-3.5 w-3.5" />}>
              新建 Agent
            </Button>
          ) : undefined
        }
      />

      <GlassCard>
        {agents.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">
            {loading ? '加载中...' : '暂无 Agent —— 点右上角新建'}
          </p>
        ) : (
          <div className="space-y-0">
            {visibleGroups.map((group, groupIdx) => {
              const meta = AGENT_GROUP_META[group];
              const GroupIcon = meta.icon;
              const isLastGroup = groupIdx === visibleGroups.length - 1;
              return (
                <div key={group} className={isLastGroup ? '' : 'pb-1 mb-1'}>
                  {/* 分组头:小号带图标,不强抢视觉 */}
                  <div className="flex items-center gap-2 px-1 pt-1 pb-2 border-b border-border-default">
                    <GroupIcon className="h-3.5 w-3.5 text-text-secondary" strokeWidth={1.6} />
                    <span className="text-[12px] font-medium text-text-primary">
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-text-muted">· {grouped[group].length}</span>
                    <span className="text-[11px] text-text-muted ml-1">{meta.hint}</span>
                  </div>
                  {grouped[group].map((a) => {
                    const isExpanded = expanded.has(a.agent_id);
                    const writable = canManage(a);
                    const isCreator = !!me && a.created_by_uid === me.id;
                    return (
                      <div
                        key={a.agent_id}
                        className="border-b border-border-default last:border-0 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => toggleExpand(a.agent_id)}
                            className="p-0.5 text-text-muted hover:text-text-primary cursor-pointer"
                            title={isExpanded ? '收起详情' : '展开详情'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <div className="h-8 w-8 rounded-md bg-accent/[0.08] flex items-center justify-center shrink-0">
                            <Bot className="h-4 w-4 text-accent" strokeWidth={1.6} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-medium text-text-primary truncate max-w-[260px]">
                                {a.display_name}
                              </span>
                              <KindBadge kind={a.kind} />
                              <OnlineBadge online={a.online} />
                              {!a.enabled && (
                                <span className="flex items-center gap-1 text-[10px] text-text-muted bg-bg-secondary px-1.5 py-[1px] rounded">
                                  <PowerOff className="h-2.5 w-2.5" />
                                  已禁用
                                </span>
                              )}
                              {isCreator && (
                                <span className="flex items-center gap-1 text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
                                  <Crown className="h-2.5 w-2.5" />
                                  你创建
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-text-muted flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono truncate max-w-[260px]" title={a.agent_id}>
                                {a.agent_id}
                              </span>
                              <span>·</span>
                              <span>最近上线 {a.last_seen_at ? formatRelativeWithAbsSeconds(a.last_seen_at) : '从未'}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <CopyButton value={a.agent_id} label="复制 Agent ID" />
                            {writable && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditTarget(a)}
                                  icon={<Edit3 className="h-3 w-3" />}
                                >
                                  编辑
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleEnabled(a)}
                                  icon={
                                    a.enabled ? (
                                      <PowerOff className="h-3 w-3" />
                                    ) : (
                                      <Power className="h-3 w-3" />
                                    )
                                  }
                                  title={a.enabled ? '禁用后会踢当前连接' : '启用后可重新接入'}
                                >
                                  {a.enabled ? '禁用' : '启用'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => rotateKey(a)}
                                  icon={<RotateCw className="h-3 w-3" />}
                                >
                                  轮转 Key
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeAgent(a)}
                                  icon={<Trash2 className="h-3 w-3" />}
                                >
                                  删除
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        {isExpanded && <AgentDetailsInline agent={a} />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <p className="text-[11px] text-text-muted px-1">
        Agent 用 <code className="px-1 py-px rounded bg-bg-secondary">agent_id + apikey</code> 通过
        WS 接入 <code className="px-1 py-px rounded bg-bg-secondary">/api/v1/agent/ws</code>。
        apikey 只在创建 / 轮转时出现一次,丢失只能重新轮转。
        禁用 / 轮转 / 删除会立即踢掉当前活跃连接。
      </p>

      <CreateAgentModal
        open={showCreate}
        slug={slug}
        onCancel={() => setShowCreate(false)}
        onCreated={(reveal) => {
          setShowCreate(false);
          setSecretReveal({
            title: '新 Agent 已创建',
            agent: reveal.agent,
            apikey: reveal.apikey,
          });
          fetchAgents();
        }}
      />

      <EditAgentModal
        agent={editTarget}
        slug={slug}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          fetchAgents();
        }}
      />

      <SecretRevealModal
        open={!!secretReveal}
        title={secretReveal?.title ?? ''}
        agent={secretReveal?.agent ?? null}
        apikey={secretReveal?.apikey ?? ''}
        onClose={() => setSecretReveal(null)}
      />
    </div>
  );
}

// ─── 子组件 ─────────────────────────────────────────────────────────────────

// KindBadge 显示 agent 类型徽章。未来加新 kind 时仅需在 AGENT_KIND_META 里追加。
function KindBadge({ kind }: { kind: AgentKind }) {
  const meta = AGENT_KIND_META[kind];
  // 兜底:未知 kind(比如后端将来加了 KindBadge 还没更新前端时),原样显示 raw 字符串
  if (!meta) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-text-muted bg-bg-secondary px-1.5 py-[1px] rounded font-mono">
        {kind}
      </span>
    );
  }
  const Icon = meta.icon;
  return (
    <span className="flex items-center gap-1 text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
      <Icon className="h-2.5 w-2.5" strokeWidth={1.8} />
      {meta.label}
    </span>
  );
}

function OnlineBadge({ online }: { online: boolean }) {
  if (online) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-[#448361] bg-[#448361]/[0.1] px-1.5 py-[1px] rounded">
        <Circle className="h-1.5 w-1.5 fill-[#448361] stroke-none" />
        在线
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-text-muted bg-bg-secondary px-1.5 py-[1px] rounded">
      <Circle className="h-1.5 w-1.5 fill-text-muted stroke-none" />
      离线
    </span>
  );
}

function AgentDetailsInline({ agent }: { agent: AgentResponse }) {
  return (
    <div className="mt-2 ml-8 pl-3 border-l-2 border-border-default text-[11px] text-text-secondary space-y-1">
      <DetailRow label="Agent ID" value={agent.agent_id} mono />
      <DetailRow label="内部 ID" value={agent.id} mono />
      <DetailRow label="创建于" value={formatRelativeWithAbsSeconds(agent.created_at)} />
      <DetailRow label="更新于" value={formatRelativeWithAbsSeconds(agent.updated_at)} />
      <DetailRow
        label="最近上线"
        value={agent.last_seen_at ? formatRelativeWithAbsSeconds(agent.last_seen_at) : '从未'}
      />
      <DetailRow
        label="最近轮转"
        value={agent.rotated_at ? formatRelativeWithAbsSeconds(agent.rotated_at) : '从未'}
      />
      <DetailRow label="创建者 UID" value={agent.created_by_uid} mono />
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-text-muted shrink-0 w-20">{label}</span>
      <span
        className={`text-text-primary truncate ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('error', '复制失败,请手动选中');
    }
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      title={label}
    >
      {copied ? '已复制' : '复制'}
    </Button>
  );
}

function CreateAgentModal({
  open,
  slug,
  onCancel,
  onCreated,
}: {
  open: boolean;
  slug: string;
  onCancel: () => void;
  onCreated: (reveal: { agent: AgentResponse; apikey: string }) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  // reset on open(open false→true 时清空输入,避让 react-hooks/set-state-in-effect)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDisplayName('');
  }

  const submit = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast('error', '请填写显示名称');
      return;
    }
    setLoading(true);
    const body: CreateAgentRequest = { display_name: trimmed };
    const res = await apiCall(() => agentApi.create(slug, body));
    setLoading(false);
    if (res.ok && res.data) {
      onCreated({ agent: res.data.agent, apikey: res.data.apikey });
    }
  };

  return (
    <Modal open={open} onClose={onCancel} title="新建 Agent">
      <div className="space-y-3">
        <div>
          <label className="text-[12px] text-text-secondary mb-1 block">显示名称</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="比如:KB 写入机器人 / 爬虫节点 01"
            maxLength={128}
            autoFocus
            className="w-full px-3 py-1.5 text-[13px] rounded-md border border-border-default bg-white focus:outline-none focus:border-accent/[0.5]"
          />
          <p className="text-[11px] text-text-muted mt-1">
            最多 128 字符,仅作管理 UI 显示用。系统会自动分配 agent_id + apikey,创建成功后一次性展示。
          </p>
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

function EditAgentModal({
  agent,
  slug,
  onClose,
  onSaved,
}: {
  agent: AgentResponse | null;
  slug: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  // agent 由 null 变非 null 时同步输入框
  const [prevAgentId, setPrevAgentId] = useState<string | null>(null);
  const currentId = agent?.agent_id ?? null;
  if (currentId !== prevAgentId) {
    setPrevAgentId(currentId);
    setDisplayName(agent?.display_name ?? '');
  }

  if (!agent) return null;

  const submit = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast('error', '请填写显示名称');
      return;
    }
    if (trimmed === agent.display_name) {
      onClose();
      return;
    }
    setLoading(true);
    const body: UpdateAgentRequest = { display_name: trimmed };
    const res = await apiCall(() => agentApi.update(slug, agent.agent_id, body), {
      success: '已更新',
    });
    setLoading(false);
    if (res.ok) onSaved();
  };

  return (
    <Modal open={!!agent} onClose={onClose} title={`编辑 · ${agent.display_name}`}>
      <div className="space-y-3">
        <div>
          <label className="text-[12px] text-text-secondary mb-1 block">显示名称</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={128}
            autoFocus
            className="w-full px-3 py-1.5 text-[13px] rounded-md border border-border-default bg-white focus:outline-none focus:border-accent/[0.5]"
          />
        </div>
        <p className="text-[11px] text-text-muted">
          启停 / 轮转 key / 删除请回到列表点对应按钮 —— 这些操作会踢当前连接,单独确认。
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button onClick={submit} loading={loading}>
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// SecretRevealModal Create / Rotate 成功后展示一次性 apikey 的弹窗。
// 用户必须手动复制并关闭 —— 关闭后 apikey 不再可获取。
function SecretRevealModal({
  open,
  title,
  agent,
  apikey,
  onClose,
}: {
  open: boolean;
  title: string;
  agent: AgentResponse | null;
  apikey: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setCopied(false);
  }

  if (!agent) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apikey);
      setCopied(true);
      toast('success', 'API Key 已复制到剪贴板');
    } catch {
      toast('error', '复制失败,请手动选中');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        <div className="flex items-start gap-3 bg-[#d99e35]/[0.08] border border-[#d99e35]/[0.3] rounded-md px-3 py-2.5">
          <KeyRound className="h-4 w-4 text-[#b87a13] shrink-0 mt-0.5" />
          <div className="text-[12px] text-[#6e4d16]">
            <p className="font-medium">这是你唯一能看到 API Key 的时机</p>
            <p className="mt-0.5 text-[#6e4d16]/80">
              关闭本弹窗后,服务端不保留明文副本,丢失只能轮转生成新的。
              请立即复制并存入 agent 的配置 / 环境变量。
            </p>
          </div>
        </div>

        <div>
          <label className="text-[12px] text-text-secondary mb-1 block">Agent ID</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={agent.agent_id}
              className="flex-1 px-3 py-1.5 text-[12px] font-mono rounded-md border border-border-default bg-bg-secondary text-text-primary"
              onFocus={(e) => e.target.select()}
            />
            <CopyButton value={agent.agent_id} label="复制 Agent ID" />
          </div>
        </div>

        <div>
          <label className="text-[12px] text-text-secondary mb-1 block">API Key</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={apikey}
              className="flex-1 px-3 py-1.5 text-[12px] font-mono rounded-md border border-border-default bg-bg-secondary text-text-primary"
              onFocus={(e) => e.target.select()}
            />
            <Button
              onClick={copy}
              icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            >
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>我已保存好</Button>
        </div>
      </div>
    </Modal>
  );
}
