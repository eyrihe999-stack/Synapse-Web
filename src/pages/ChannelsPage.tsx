// ChannelsPage 跨项目的 channel 扁平列表,按项目分组。
//
// 后端目前没有 "/v2/users/me/channels"(list by principal 只在 service 层),
// 这里走 project list → foreach 拉 channel 的模式。小 org 下 OK,项目数量巨大时
// 再考虑让后端加一个扁平接口。
//
// 每张卡片显示 channel 名 / purpose / 状态;点击进 ChannelDetailPage。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessagesSquare, FolderGit2, Hash, Plus, ArrowUpRight, Archive } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { projectApi } from '@/api/project';
import { channelApi } from '@/api/channel';
import { useOrgStore } from '@/store/org';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import { getAccent } from '@/lib/accentColor';
import type { ProjectResponse, ChannelResponse } from '@/types/api';

interface Grouped {
  project: ProjectResponse;
  channels: ChannelResponse[];
}

export function ChannelsPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const navigate = useNavigate();

  const [groups, setGroups] = useState<Grouped[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState<ProjectResponse | null>(null);
  const [form, setForm] = useState({ name: '', purpose: '' });
  const [creating, setCreating] = useState(false);
  // 全局"显示已归档"toggle:默认关 —— 日常视图只看进行中的项目 / channel;
  // 打开后连同"archived 项目" + "archived channel"一并展示,归档 channel 点进去
  // 只能看历史,后端挡住发消息。
  const [showArchived, setShowArchived] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const pRes = await projectApi.list(Number(currentOrg.org.id));
      const allProjects = pRes.data.result ?? [];
      const projects = showArchived ? allProjects : allProjects.filter((p) => !p.archived_at);
      const results = await Promise.all(
        projects.map(async (p) => {
          try {
            const cRes = await projectApi.listChannels(p.id);
            const allChannels = cRes.data.result ?? [];
            const channels = showArchived
              ? allChannels
              : allChannels.filter((c) => c.status === 'open');
            return { project: p, channels };
          } catch {
            return { project: p, channels: [] };
          }
        }),
      );
      setGroups(results);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [currentOrg, showArchived]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const totalChannels = useMemo(
    () => groups.reduce((sum, g) => sum + g.channels.length, 0),
    [groups],
  );

  const handleCreate = async () => {
    if (!showCreate || !form.name.trim()) return;
    setCreating(true);
    const res = await apiCall(() =>
      channelApi.create({
        project_id: showCreate.id,
        name: form.name.trim(),
        purpose: form.purpose.trim() || undefined,
      }),
    );
    setCreating(false);
    if (res.ok) {
      toast('success', 'Channel 已创建,顶级 agent 已自动加入');
      setShowCreate(null);
      setForm({ name: '', purpose: '' });
      fetchAll();
    }
  };

  if (!currentOrg) {
    return (
      <div className="p-6 text-center text-text-muted">
        <MessagesSquare className="mx-auto h-8 w-8 mb-2" strokeWidth={1.5} />
        <p className="text-[13px]">请先在顶部选择一个组织</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Channel"
        subtitle={`${currentOrg.org.display_name} · ${totalChannels} 个 channel · ${groups.length} 个项目`}
        loading={loading}
        onRefresh={fetchAll}
      />

      <div className="flex items-center justify-end">
        <Button
          variant={showArchived ? 'secondary' : 'ghost'}
          size="sm"
          icon={<Archive className="w-3.5 h-3.5" />}
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? '隐藏已归档' : '显示已归档'}
        </Button>
      </div>

      {loading && groups.length === 0 ? (
        <GlassCard>
          <div className="h-2 bg-[#eeede8] rounded animate-pulse" />
        </GlassCard>
      ) : groups.length === 0 ? (
        <GlassCard>
          <div className="py-8 text-center text-text-muted">
            <FolderGit2 className="mx-auto h-8 w-8 mb-2" strokeWidth={1.5} />
            <p className="text-[13px]">这个组织还没有项目</p>
            <Button
              variant="ghost"
              onClick={() => navigate('/org/projects')}
              className="mt-3"
            >
              去新建项目
            </Button>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.project.id}>
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2">
                  <FolderGit2 className="w-3.5 h-3.5 text-text-muted" strokeWidth={1.6} />
                  <button
                    onClick={() => navigate(`/org/projects/${g.project.id}`)}
                    className="text-[12px] text-text-secondary hover:text-[#2383e2] font-medium"
                  >
                    {g.project.name}
                  </button>
                  {g.project.archived_at && <StatusChip tone="neutral">已归档</StatusChip>}
                  <span className="text-[11px] text-text-muted">· {g.channels.length}</span>
                </div>
                {/* 已归档项目下不允许新建 channel(后端 ErrProjectArchived),UI 同步隐藏入口 */}
                {!g.project.archived_at && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCreate(g.project)}
                    icon={<Plus className="w-3.5 h-3.5" />}
                  >
                    新建 channel
                  </Button>
                )}
              </div>
              {g.channels.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#e3e2dc] py-6 flex flex-col items-center gap-2">
                  <p className="text-[12px] text-text-muted">该项目下还没有 channel</p>
                  <Button
                    size="sm"
                    onClick={() => setShowCreate(g.project)}
                    icon={<Plus className="w-3.5 h-3.5" />}
                  >
                    新建第一个 channel
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {g.channels.map((c) => (
                    <ChannelCard
                      key={c.id}
                      channel={c}
                      onOpen={() => navigate(`/org/channels/${c.id}`)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <Modal
        open={!!showCreate}
        onClose={() => setShowCreate(null)}
        title={`在 ${showCreate?.name} 下新建 channel`}
      >
        <div className="space-y-4">
          <Input
            label="Channel 名称"
            placeholder="例如:bug-triage / release-v2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">用途(可选)</label>
            <textarea
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              rows={3}
              placeholder="告诉成员这个 channel 讨论什么"
              className="w-full px-3 py-2 text-[13px] rounded border border-[#e3e2dc] bg-white text-text-primary focus:outline-none focus:border-[#2383e2] resize-none"
            />
          </div>
          <p className="text-[11px] text-text-muted bg-[#f4f3ef] px-2 py-1.5 rounded">
            创建后,顶级系统 agent(Synapse)会自动作为成员加入 —— 被 @ 时能响应。
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(null)}>
              取消
            </Button>
            <Button onClick={handleCreate} loading={creating} disabled={!form.name.trim()}>
              创建
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── ChannelCard ────────────────────────────────────────────────────────────
//
// 卡片风格:左侧 3px 色带(按 channel.id 稳定取色)+ 方块 Hash icon +
// hover 微抬 + metadata 行。
interface ChannelCardProps {
  channel: ChannelResponse;
  onOpen: () => void;
}

function ChannelCard({ channel: c, onOpen }: ChannelCardProps) {
  const accent = getAccent(c.id);
  return (
    <div
      onClick={onOpen}
      className="group relative overflow-hidden rounded-lg border border-[#e8e7e3] bg-white cursor-pointer transition-all duration-150 hover:-translate-y-0.5 flex"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 6px 16px ${accent.glow}, 0 1px 2px rgba(0,0,0,0.03)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)';
      }}
    >
      {/* 左侧 3px 色带 */}
      <div className="w-[3px] shrink-0" style={{ background: accent.solid }} />
      <div className="flex-1 p-3.5 min-w-0">
        <div className="flex items-start gap-2.5">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
            style={{ background: accent.tintBg, color: accent.tintFg }}
          >
            <Hash className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[14px] font-medium text-text-primary truncate group-hover:text-[#2383e2] transition-colors">
                {c.name}
              </h3>
              {c.status === 'archived' && <StatusChip tone="neutral">已归档</StatusChip>}
            </div>
            {c.purpose ? (
              <p className="mt-0.5 text-[12px] text-text-secondary line-clamp-2 leading-relaxed">
                {c.purpose}
              </p>
            ) : (
              <p className="mt-0.5 text-[12px] text-text-muted italic">无说明</p>
            )}
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted">
              <span>
                {formatRelativeWithAbsSeconds(
                  Math.floor(new Date(c.created_at).getTime() / 1000),
                )}
              </span>
            </div>
          </div>
          <ArrowUpRight
            className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            strokeWidth={1.8}
          />
        </div>
      </div>
    </div>
  );
}
