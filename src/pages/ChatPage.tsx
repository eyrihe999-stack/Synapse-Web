import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrgStore } from '@/store/org';
import { useChatStore } from '@/store/chat';
import { publishApi } from '@/api/agent';
import { toast } from '@/components/ui/Toast';
import { getErrorMessage } from '@/lib/api-helpers';
import { formatTs } from '@/lib/format';
import type { PublishResponse } from '@/types/api';
import {
  MessageSquare,
  Send,
  Square,
  Plus,
  Trash2,
  Bot,
  User,
  ArrowRight,
} from 'lucide-react';

const AGENT_TYPE_LABELS: Record<string, string> = {
  chat: '对话',
  tool: '工具',
};

export function ChatPage() {
  const { ownerUid, agentSlug } = useParams<{ ownerUid: string; agentSlug: string }>();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="对话" />
        <GlassCard>
          <div className="py-8 text-center">
            <MessageSquare className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">请先在顶部选择一个组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  if (!ownerUid || !agentSlug) {
    return <AgentPicker slug={slug} />;
  }

  return <ChatInterface slug={slug} ownerUid={ownerUid} agentSlug={agentSlug} />;
}

// ── Agent Picker ──

function AgentPicker({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [publishes, setPublishes] = useState<PublishResponse[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    publishApi.list(slug, { status: 'approved', page: 1, size: 100 })
      .then((res) => setPublishes(res.data.result?.items ?? []))
      .catch((err) => toast('error', getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="space-y-6">
      <PageHeader title="对话" subtitle="选择一个 Agent 开始对话" loading={loading} />

      {loading ? (
        <p className="text-[13px] text-text-muted py-6 text-center">加载中...</p>
      ) : publishes.length === 0 ? (
        <GlassCard>
          <div className="py-8 text-center">
            <Bot className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">暂无可用 Agent</p>
            <p className="text-[12px] text-text-muted">当前组织还没有已通过审核的 Agent</p>
          </div>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {publishes.map((p) => (
            <GlassCard
              key={p.id}
              hover
              className="cursor-pointer group"
            >
              <div
                onClick={() => navigate(`/org/chat/${p.agent_owner_uid}/${p.agent_slug}`)}
              >
                {/* Header: Icon + Name + Badges */}
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
                    {p.agent_icon_url ? (
                      <img src={p.agent_icon_url} alt="" className="h-6 w-6 rounded" />
                    ) : (
                      <Bot className="h-5 w-5 text-accent" strokeWidth={1.6} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-text-primary truncate">{p.agent_display_name || `Agent #${p.agent_id}`}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {p.agent_type && <StatusBadge status={p.agent_type} />}
                      {p.agent_context_mode && <StatusBadge status={p.agent_context_mode} />}
                      {p.agent_version && <span className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-[#f1f1ef] border border-[#e3e2dc]">{p.agent_version}</span>}
                      {p.agent_slug && <span className="text-[10px] text-text-muted font-mono truncate">{p.agent_slug}</span>}
                    </div>
                  </div>
                </div>

                {/* Description */}
                {p.agent_description && (
                  <p className="text-[12px] text-text-secondary mt-2 line-clamp-2">{p.agent_description}</p>
                )}

                {/* Tags */}
                {p.agent_tags && p.agent_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.agent_tags.map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/[0.06] text-accent border border-accent/10 font-mono">{t}</span>
                    ))}
                  </div>
                )}

                {/* Footer: CTA */}
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border-default">
                  <span className="text-[11px] text-text-muted">
                    更新于 {formatTs(p.agent_updated_at ?? p.created_at)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[12px] text-accent font-medium group-hover:translate-x-0.5 transition-transform">
                    开始{AGENT_TYPE_LABELS[p.agent_type ?? ''] ?? '交互'}
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chat Interface ──

function ChatInterface({ slug, ownerUid, agentSlug }: { slug: string; ownerUid: string; agentSlug: string }) {
  const {
    currentSessionId,
    messages,
    streaming,
    streamingContent,
    sessions,
    sessionsLoading,
    fetchSessions,
    loadSession,
    sendMessage,
    cancelStream,
    clearChat,
    deleteSession,
  } = useChatStore();

  const [useStream, setUseStream] = useState(true);

  useEffect(() => {
    fetchSessions(slug, ownerUid, agentSlug);
    return () => { clearChat(); };
  }, [slug, ownerUid, agentSlug]);

  const startNewChat = () => {
    clearChat();
  };

  const selectSession = (sessionId: string) => {
    loadSession(slug, sessionId);
  };

  const handleDeleteSession = (sessionId: string) => {
    if (!confirm('确定要删除此会话吗？')) return;
    deleteSession(slug, sessionId);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={`对话 — ${agentSlug}`}
        subtitle={`Owner: ${ownerUid}`}
      />

      <div className="flex gap-4" style={{ height: 'calc(100vh - 200px)' }}>
        {/* Session Sidebar */}
        <div className="w-56 shrink-0 flex flex-col bg-[#fbfaf8] border border-border-default rounded-lg overflow-hidden">
          <div className="p-2 border-b border-border-default">
            <Button size="sm" className="w-full" onClick={startNewChat} icon={<Plus className="h-3 w-3" />}>
              新对话
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-1.5 space-y-0.5">
            {sessionsLoading ? (
              <p className="text-[11px] text-text-muted text-center py-4">加载中...</p>
            ) : sessions.length === 0 ? (
              <p className="text-[11px] text-text-muted text-center py-4">暂无会话</p>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.session_id}
                  className={`group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer text-[12px] transition-colors ${
                    currentSessionId === s.session_id
                      ? 'bg-accent/[0.08] text-accent'
                      : 'text-text-secondary hover:bg-[#eeede8]'
                  }`}
                  onClick={() => selectSession(s.session_id)}
                >
                  <span className="flex-1 truncate">{s.title || '新对话'}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.session_id); }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red transition-all p-0.5"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col border border-border-default rounded-lg overflow-hidden bg-white">
          {/* Messages */}
          <ChatMessages
            messages={messages}
            streaming={streaming}
            streamingContent={streamingContent}
          />

          {/* Input */}
          <ChatInput
            slug={slug}
            ownerUid={ownerUid}
            agentSlug={agentSlug}
            streaming={streaming}
            useStream={useStream}
            onToggleStream={setUseStream}
            onSend={(msg) => sendMessage(slug, ownerUid, agentSlug, msg, useStream)}
            onCancel={cancelStream}
          />
        </div>
      </div>
    </div>
  );
}

// ── Chat Messages ──

function ChatMessages({ messages, streaming, streamingContent }: {
  messages: { role: string; content: string }[];
  streaming: boolean;
  streamingContent: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
      {messages.length === 0 && !streaming && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <MessageSquare className="h-10 w-10 text-text-muted mx-auto mb-3" strokeWidth={1} />
            <p className="text-[14px] text-text-muted">发送消息开始对话</p>
          </div>
        </div>
      )}

      {messages.map((msg, i) => (
        <MessageBubble key={i} role={msg.role} content={msg.content} />
      ))}

      {streaming && streamingContent && (
        <MessageBubble role="assistant" content={streamingContent} streaming />
      )}

      <div ref={endRef} />
    </div>
  );
}

function MessageBubble({ role, content, streaming }: { role: string; content: string; streaming?: boolean }) {
  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex items-start gap-2 max-w-[75%] ${isUser ? 'flex-row-reverse' : ''}`}>
        <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${
          isUser ? 'bg-accent/[0.08]' : 'bg-[#f1f1ef]'
        }`}>
          {isUser
            ? <User className="h-3.5 w-3.5 text-accent" strokeWidth={1.6} />
            : <Bot className="h-3.5 w-3.5 text-text-secondary" strokeWidth={1.6} />
          }
        </div>
        <div className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
          isUser
            ? 'bg-accent/[0.08] text-text-primary'
            : 'bg-[#f8f7f5] text-text-primary border border-border-default'
        }`}>
          <div className="whitespace-pre-wrap break-words">{content}</div>
          {streaming && (
            <span className="inline-block w-1.5 h-4 bg-accent/60 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Chat Input ──

function ChatInput({ slug, ownerUid, agentSlug, streaming, useStream, onToggleStream, onSend, onCancel }: {
  slug: string;
  ownerUid: string;
  agentSlug: string;
  streaming: boolean;
  useStream: boolean;
  onToggleStream: (v: boolean) => void;
  onSend: (message: string) => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || streaming) return;
    setInput('');
    onSend(msg);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  return (
    <div className="border-t border-border-default px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Shift+Enter 换行)"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border-default bg-[#fbfaf8] px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 transition-colors"
          style={{ minHeight: '38px', maxHeight: '160px' }}
          disabled={streaming}
        />
        {streaming ? (
          <Button size="sm" variant="secondary" onClick={onCancel} icon={<Square className="h-3 w-3" />}>
            停止
          </Button>
        ) : (
          <Button size="sm" onClick={handleSend} disabled={!input.trim()} icon={<Send className="h-3 w-3" />}>
            发送
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-text-muted">
          <input
            type="checkbox"
            checked={useStream}
            onChange={(e) => onToggleStream(e.target.checked)}
            className="accent-accent h-3 w-3"
          />
          流式响应
        </label>
      </div>
    </div>
  );
}
