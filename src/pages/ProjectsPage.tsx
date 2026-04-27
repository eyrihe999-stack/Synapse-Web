// ProjectsPage 当前 org 下的项目列表 + 创建 + 归档。
//
// 项目是 channel / version 的容器;本页只列项目本身,点击进 ProjectDetailPage
// 看里头的 channel / version。不支持编辑 name(后端暂无接口),只支持归档。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderGit2, Plus, Archive, ArrowUpRight } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/Toast';
import { projectApi } from '@/api/project';
import { useOrgStore } from '@/store/org';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import { getAccent, pickInitial } from '@/lib/accentColor';
import type { ProjectResponse } from '@/types/api';

type Filter = 'open' | 'archived' | 'all';

export function ProjectsPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);

  const fetchProjects = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const res = await projectApi.list(Number(currentOrg.org.id));
      setProjects(res.data.result ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [currentOrg]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filter === 'all') return true;
      if (filter === 'archived') return !!p.archived_at;
      return !p.archived_at;
    });
  }, [projects, filter]);

  const handleCreate = async () => {
    if (!currentOrg || !form.name.trim()) return;
    setCreating(true);
    const res = await apiCall(() =>
      projectApi.create({
        org_id: Number(currentOrg.org.id),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
      }),
    );
    setCreating(false);
    if (res.ok) {
      toast('success', '项目已创建');
      setShowCreate(false);
      setForm({ name: '', description: '' });
      fetchProjects();
    }
  };

  const handleArchive = async (p: ProjectResponse) => {
    if (!confirm(`归档项目「${p.name}」?归档后不能再新建 channel,已有 channel 仍可查看。`)) return;
    const res = await apiCall(() => projectApi.archive(p.id));
    if (res.ok) {
      toast('success', '已归档');
      fetchProjects();
    }
  };

  if (!currentOrg) {
    return (
      <div className="p-6 text-center text-text-muted">
        <FolderGit2 className="mx-auto h-8 w-8 mb-2" strokeWidth={1.5} />
        <p className="text-[13px]">请先在顶部选择一个组织</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="项目"
        subtitle={`${currentOrg.org.display_name} · ${filtered.length} 个项目`}
        loading={loading}
        onRefresh={fetchProjects}
        action={
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
            新建项目
          </Button>
        }
      />

      <Tabs
        variant="segmented"
        tabs={[
          { key: 'open' as Filter, label: '进行中' },
          { key: 'archived' as Filter, label: '已归档' },
          { key: 'all' as Filter, label: '全部' },
        ]}
        activeKey={filter}
        onChange={setFilter}
      />

      {loading && projects.length === 0 ? (
        <GlassCard>
          <div className="h-2 bg-[#eeede8] rounded animate-pulse" />
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard>
          <div className="py-8 text-center text-text-muted">
            <FolderGit2 className="mx-auto h-8 w-8 mb-2" strokeWidth={1.5} />
            <p className="text-[13px]">
              {filter === 'archived' ? '没有已归档项目' : '还没有项目'}
            </p>
            {filter !== 'archived' && (
              <p className="text-[11px] mt-1">
                项目承载 channel 和 version。点"新建项目"开始。
              </p>
            )}
          </div>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={() => navigate(`/org/projects/${p.id}`)}
              onArchive={() => handleArchive(p)}
            />
          ))}
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="新建项目"
        size="md"
      >
        <div className="space-y-4">
          <Input
            label="项目名称"
            placeholder="例如:Synapse"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">描述(可选)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="项目简介,帮助成员理解项目目标"
              className="w-full px-3 py-2 text-[13px] rounded border border-[#e3e2dc] bg-white text-text-primary focus:outline-none focus:border-[#2383e2] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
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

// ─── ProjectCard ─────────────────────────────────────────────────────────────
//
// 视觉:顶部 3px accent bar(颜色按 project.id hash 取色)+ 圆底字母 icon +
// hover 抬起 shadow + 右下角 archive 按钮(hover 时出现)。
// 整张卡片 clickable,打开详情页;archive 按钮 stopPropagation 避免触发跳转。
interface ProjectCardProps {
  project: ProjectResponse;
  onOpen: () => void;
  onArchive: () => void;
}

function ProjectCard({ project: p, onOpen, onArchive }: ProjectCardProps) {
  const accent = getAccent(p.id);
  return (
    <div
      onClick={onOpen}
      className="group relative overflow-hidden rounded-lg border border-[#e8e7e3] bg-white cursor-pointer transition-all duration-150 hover:-translate-y-0.5"
      style={{
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 6px 16px ${accent.glow}, 0 1px 2px rgba(0,0,0,0.03)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)';
      }}
    >
      {/* 顶部 accent bar */}
      <div className="h-[3px] w-full" style={{ background: accent.solid }} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* 圆底首字母 icon */}
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-semibold text-[15px]"
            style={{ background: accent.tintBg, color: accent.tintFg }}
          >
            {pickInitial(p.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-medium text-text-primary truncate group-hover:text-[#2383e2] transition-colors">
                {p.name}
              </h3>
              {p.archived_at && <StatusChip tone="neutral">已归档</StatusChip>}
            </div>
            {p.description ? (
              <p className="mt-1 text-[12px] text-text-secondary line-clamp-2 leading-relaxed">
                {p.description}
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-text-muted italic">无描述</p>
            )}
          </div>
          <ArrowUpRight
            className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
            strokeWidth={1.8}
          />
        </div>
        <div className="mt-3 pt-2.5 border-t border-[#f0efe9] flex items-center justify-between text-[11px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <FolderGit2 className="w-3 h-3" strokeWidth={1.5} />
            {formatRelativeWithAbsSeconds(
              Math.floor(new Date(p.created_at).getTime() / 1000),
            )}
          </span>
          {!p.archived_at && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onArchive();
              }}
              className="flex items-center gap-1 text-text-muted hover:text-[#d44c47] opacity-0 group-hover:opacity-100 transition-opacity"
              title="归档"
            >
              <Archive className="w-3 h-3" strokeWidth={1.6} />
              归档
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

