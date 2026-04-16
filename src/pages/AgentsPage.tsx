import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAgentStore } from '@/store/agent';
import { agentApi } from '@/api/agent';
import { apiCall } from '@/lib/api-helpers';
import { toast } from '@/components/ui/Toast';
import { getErrorMessage } from '@/lib/api-helpers';
import { formatTs } from '@/lib/format';
import type { AgentResponse, AgentType, CreateAgentRequest, UpdateAgentRequest } from '@/types/api';
import { Plus, Bot, Trash2, Pencil, Globe, Lock, Clock, Hash, MessageSquare, Wrench, Link, Shield, Layers } from 'lucide-react';

/** Agent 类型显示标签 */
const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  chat: '对话',
  tool: '工具',
};

export function AgentsPage() {
  const { agents, loading, fetchMyAgents } = useAgentStore();
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentResponse | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentResponse | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { fetchMyAgents(); }, [fetchMyAgents]);

  const deleteAgent = async (ag: AgentResponse) => {
    if (!confirm(`确定要删除 Agent「${ag.display_name}」吗？此操作不可撤销。`)) return;
    setDeletingId(ag.id);
    try {
      await agentApi.delete(ag.id);
      toast('success', 'Agent 已删除');
      fetchMyAgents();
      if (selectedAgent?.id === ag.id) setSelectedAgent(null);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="我的 Agent"
        subtitle="管理你创建的 Agent"
        loading={loading}
        onRefresh={fetchMyAgents}
        action={<Button onClick={() => setShowCreate(true)} icon={<Plus className="h-3.5 w-3.5" />}>创建 Agent</Button>}
      />

      {loading && agents.length === 0 ? (
        <p className="text-[13px] text-text-muted py-8 text-center">加载中...</p>
      ) : agents.length === 0 ? (
        <GlassCard>
          <div className="py-8 text-center">
            <Bot className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">暂无 Agent</p>
            <p className="text-[12px] text-text-muted">点击上方按钮创建你的第一个 Agent</p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {agents.map((ag) => (
            <GlassCard
              key={ag.id}
              hover
              className={selectedAgent?.id === ag.id ? 'aug-card-cyan' : ''}
            >
              <div
                className="cursor-pointer"
                onClick={() => setSelectedAgent(selectedAgent?.id === ag.id ? null : ag)}
              >
                {/* Row 1: Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
                      {ag.icon_url ? (
                        <img src={ag.icon_url} alt="" className="h-6 w-6 rounded" />
                      ) : (
                        <Bot className="h-5 w-5 text-accent" strokeWidth={1.6} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[14px] font-medium text-text-primary truncate">{ag.display_name}</p>
                        <StatusBadge status={ag.agent_type} />
                        <StatusBadge status={ag.status} />
                        <StatusBadge status={ag.context_mode} />
                        <span className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-[#f1f1ef] border border-[#e3e2dc]">{ag.version}</span>
                      </div>
                      <p className="text-[11px] text-text-muted font-mono truncate mt-0.5">{ag.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setEditingAgent(ag)}
                      className="text-text-muted hover:text-accent transition-colors cursor-pointer p-1.5"
                      title="编辑"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteAgent(ag)}
                      disabled={deletingId === ag.id}
                      className="text-text-muted hover:text-accent-red transition-colors cursor-pointer p-1.5 disabled:opacity-50"
                      title="删除"
                    >
                      {deletingId === ag.id
                        ? <span className="h-3.5 w-3.5 block border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Row 2: Description */}
                {ag.description && (
                  <p className="text-[12px] text-text-secondary mt-2 ml-[52px] line-clamp-2">{ag.description}</p>
                )}

                {/* Row 3: Meta info */}
                <div className="flex items-center gap-4 mt-2.5 ml-[52px] flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title="端点地址">
                    <Link className="h-3 w-3 shrink-0" />
                    <span className="font-mono truncate max-w-[200px]">{ag.endpoint_url.replace(/^https?:\/\//, '')}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title="超时时间">
                    <Clock className="h-3 w-3 shrink-0" />
                    {ag.timeout_seconds}s
                  </span>
                  {ag.context_mode === 'stateless' && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title="最大上下文轮数">
                      <Layers className="h-3 w-3 shrink-0" />
                      {ag.max_context_rounds} 轮
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title="认证令牌">
                    <Shield className="h-3 w-3 shrink-0" />
                    {ag.has_auth_token ? '已配置' : '未配置'}
                  </span>
                  <span className="text-[11px] text-text-muted ml-auto">{formatTs(ag.created_at)}</span>
                </div>

                {/* Row 4: Tags */}
                {ag.tags && ag.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 ml-[52px]">
                    {ag.tags.map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/[0.06] text-accent border border-accent/10 font-mono">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {selectedAgent && <AgentDetail agent={selectedAgent} />}

      <CreateAgentModal open={showCreate} onClose={() => setShowCreate(false)} />
      {editingAgent && (
        <EditAgentModal agent={editingAgent} onClose={() => setEditingAgent(null)} />
      )}
    </div>
  );
}

// ── Agent Detail ──

function AgentDetail({ agent: ag }: { agent: AgentResponse }) {
  return (
    <GlassCard>
      <h4 className="text-[13px] font-semibold text-text-primary mb-4">Agent 详情</h4>
      <div className="space-y-2">
        <InfoRow label="Slug" value={ag.slug} mono />
        <InfoRow label="显示名称" value={ag.display_name} />
        <InfoRow label="类型" value={AGENT_TYPE_LABELS[ag.agent_type] ?? ag.agent_type} />
        <InfoRow label="版本" value={ag.version} mono />
        <InfoRow label="描述" value={ag.description || '—'} />
        <InfoRow label="端点 URL" value={ag.endpoint_url} mono />
        <InfoRow label="上下文模式" value={ag.context_mode === 'stateless' ? '无状态（平台管理历史）' : '有状态（Agent 自管理）'} />
        <InfoRow label="最大上下文轮数" value={String(ag.max_context_rounds)} />
        <InfoRow label="超时时间" value={`${ag.timeout_seconds} 秒`} />
        <InfoRow label="认证令牌" value={ag.has_auth_token ? '已配置' : '未配置'} />
        {ag.tags && ag.tags.length > 0 && (
          <div className="flex items-center py-2 border-b border-border-default">
            <span className="text-[12px] text-text-muted w-28 shrink-0">标签</span>
            <div className="flex flex-wrap gap-1">
              {ag.tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/[0.06] text-accent border border-accent/10 font-mono">{t}</span>
              ))}
            </div>
          </div>
        )}
        <InfoRow label="创建时间" value={formatTs(ag.created_at)} />
        <InfoRow label="更新时间" value={formatTs(ag.updated_at)} />
      </div>
    </GlassCard>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center py-2 border-b border-border-default last:border-0">
      <span className="text-[12px] text-text-muted w-28 shrink-0">{label}</span>
      <span className={`text-[13px] text-text-primary ${mono ? 'font-mono text-[12px]' : ''} break-all`}>{value}</span>
    </div>
  );
}

// ── Create Agent Modal ──

function CreateAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<CreateAgentRequest>({
    slug: '',
    display_name: '',
    description: '',
    agent_type: 'chat',
    version: '0.1.0',
    endpoint_url: '',
    context_mode: 'stateless',
    max_context_rounds: 20,
    auth_token: '',
    timeout_seconds: 30,
    icon_url: '',
    tags: [],
  });
  const [tagsInput, setTagsInput] = useState('');
  const [loading, setLoading] = useState(false);
  const fetchMyAgents = useAgentStore((s) => s.fetchMyAgents);

  const update = <K extends keyof CreateAgentRequest>(key: K, val: CreateAgentRequest[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const submit = async () => {
    setLoading(true);
    const data: CreateAgentRequest = {
      ...form,
      tags: tagsInput ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      auth_token: form.auth_token || undefined,
      icon_url: form.icon_url || undefined,
      description: form.description || undefined,
    };
    const result = await apiCall(
      () => agentApi.create(data),
      { success: 'Agent 创建成功' },
    );
    if (result) {
      await fetchMyAgents();
      onClose();
      setForm({ slug: '', display_name: '', description: '', agent_type: 'chat', version: '0.1.0', endpoint_url: '', context_mode: 'stateless', max_context_rounds: 20, auth_token: '', timeout_seconds: 30, icon_url: '', tags: [] });
      setTagsInput('');
    }
    setLoading(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="创建 Agent">
      <div className="space-y-3">
        <Input
          label="Slug（唯一标识）"
          value={form.slug}
          onChange={(e) => update('slug', e.target.value)}
          placeholder="my-agent（小写字母、数字、连字符，3-64 位）"
        />
        <Input
          label="显示名称"
          value={form.display_name}
          onChange={(e) => update('display_name', e.target.value)}
          placeholder="我的 Agent"
        />
        <Input
          label="描述（可选）"
          value={form.description ?? ''}
          onChange={(e) => update('description', e.target.value)}
          placeholder="Agent 功能描述"
        />
        <div className="space-y-1">
          <label className="block text-[12px] font-medium text-text-secondary">Agent 类型</label>
          <div className="flex gap-3">
            {(Object.entries(AGENT_TYPE_LABELS) as [AgentType, string][]).map(([type_, label]) => (
              <label key={type_} className="flex items-center gap-1.5 cursor-pointer text-[12px] text-text-secondary">
                <input
                  type="radio"
                  name="agent_type"
                  checked={form.agent_type === type_}
                  onChange={() => update('agent_type', type_)}
                  className="accent-accent"
                />
                {type_ === 'chat' ? <MessageSquare className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                {label}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-text-muted">对话型：多轮交互，用户驱动对话；工具型：自包含任务，给指令出结果</p>
        </div>
        <Input
          label="版本号"
          value={form.version ?? '0.1.0'}
          onChange={(e) => update('version', e.target.value)}
          placeholder="0.1.0"
        />
        <Input
          label="端点 URL"
          value={form.endpoint_url}
          onChange={(e) => update('endpoint_url', e.target.value)}
          placeholder="https://your-agent.example.com/chat"
        />
        <div className="space-y-1">
          <label className="block text-[12px] font-medium text-text-secondary">上下文模式</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-text-secondary">
              <input type="radio" name="context_mode" checked={form.context_mode === 'stateless'} onChange={() => update('context_mode', 'stateless')} className="accent-accent" />
              无状态（平台管理历史）
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-text-secondary">
              <input type="radio" name="context_mode" checked={form.context_mode === 'stateful'} onChange={() => update('context_mode', 'stateful')} className="accent-accent" />
              有状态（Agent 自管理）
            </label>
          </div>
        </div>
        {form.context_mode === 'stateless' && (
          <Input
            label="最大上下文轮数（1-100）"
            type="number"
            value={String(form.max_context_rounds ?? 20)}
            onChange={(e) => update('max_context_rounds', Number(e.target.value))}
          />
        )}
        <Input
          label="超时时间（秒，5-300）"
          type="number"
          value={String(form.timeout_seconds ?? 30)}
          onChange={(e) => update('timeout_seconds', Number(e.target.value))}
        />
        <Input
          label="认证令牌（可选）"
          type="password"
          value={form.auth_token ?? ''}
          onChange={(e) => update('auth_token', e.target.value)}
          placeholder="Bearer Token"
        />
        <Input
          label="图标 URL（可选）"
          value={form.icon_url ?? ''}
          onChange={(e) => update('icon_url', e.target.value)}
          placeholder="https://example.com/icon.png"
        />
        <Input
          label="标签（可选，逗号分隔）"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="chat, assistant, tools"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={submit} loading={loading} disabled={!form.slug || !form.display_name || !form.endpoint_url}>创建</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit Agent Modal ──

function EditAgentModal({ agent: ag, onClose }: { agent: AgentResponse; onClose: () => void }) {
  const [form, setForm] = useState<UpdateAgentRequest>({
    display_name: ag.display_name,
    description: ag.description,
    version: ag.version,
    endpoint_url: ag.endpoint_url,
    context_mode: ag.context_mode,
    max_context_rounds: ag.max_context_rounds,
    timeout_seconds: ag.timeout_seconds,
    icon_url: ag.icon_url,
  });
  const [authToken, setAuthToken] = useState('');
  const [tagsInput, setTagsInput] = useState((ag.tags ?? []).join(', '));
  const [loading, setLoading] = useState(false);
  const fetchMyAgents = useAgentStore((s) => s.fetchMyAgents);

  const update = <K extends keyof UpdateAgentRequest>(key: K, val: UpdateAgentRequest[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const submit = async () => {
    setLoading(true);
    const data: UpdateAgentRequest = {
      ...form,
      tags: tagsInput ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      auth_token: authToken || undefined,
      icon_url: form.icon_url || undefined,
      description: form.description || undefined,
    };
    const result = await apiCall(
      () => agentApi.update(ag.id, data),
      { success: 'Agent 已更新' },
    );
    if (result) {
      await fetchMyAgents();
      onClose();
    }
    setLoading(false);
  };

  return (
    <Modal open={true} onClose={onClose} title={`编辑 Agent — ${ag.display_name}`}>
      <div className="space-y-3">
        <Input
          label="显示名称"
          value={form.display_name ?? ''}
          onChange={(e) => update('display_name', e.target.value)}
        />
        <Input
          label="描述"
          value={form.description ?? ''}
          onChange={(e) => update('description', e.target.value)}
        />
        <div className="space-y-1">
          <label className="block text-[12px] font-medium text-text-secondary">Agent 类型</label>
          <div className="flex items-center gap-2">
            <StatusBadge status={ag.agent_type} />
            <span className="text-[11px] text-text-muted">{AGENT_TYPE_LABELS[ag.agent_type] ?? ag.agent_type}（创建后不可更改）</span>
          </div>
        </div>
        <Input
          label="版本号"
          value={form.version ?? ''}
          onChange={(e) => update('version', e.target.value)}
          placeholder="1.0.0"
        />
        <Input
          label="端点 URL"
          value={form.endpoint_url ?? ''}
          onChange={(e) => update('endpoint_url', e.target.value)}
        />
        <div className="space-y-1">
          <label className="block text-[12px] font-medium text-text-secondary">上下文模式</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-text-secondary">
              <input type="radio" name="edit_context_mode" checked={form.context_mode === 'stateless'} onChange={() => update('context_mode', 'stateless')} className="accent-accent" />
              无状态
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-text-secondary">
              <input type="radio" name="edit_context_mode" checked={form.context_mode === 'stateful'} onChange={() => update('context_mode', 'stateful')} className="accent-accent" />
              有状态
            </label>
          </div>
        </div>
        {form.context_mode === 'stateless' && (
          <Input
            label="最大上下文轮数"
            type="number"
            value={String(form.max_context_rounds ?? 20)}
            onChange={(e) => update('max_context_rounds', Number(e.target.value))}
          />
        )}
        <Input
          label="超时时间（秒）"
          type="number"
          value={String(form.timeout_seconds ?? 30)}
          onChange={(e) => update('timeout_seconds', Number(e.target.value))}
        />
        <Input
          label={`认证令牌（${ag.has_auth_token ? '已配置，留空不修改' : '未配置'}）`}
          type="password"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          placeholder="留空则不修改"
        />
        <Input
          label="图标 URL"
          value={form.icon_url ?? ''}
          onChange={(e) => update('icon_url', e.target.value)}
        />
        <Input
          label="标签（逗号分隔）"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={submit} loading={loading}>保存</Button>
        </div>
      </div>
    </Modal>
  );
}
