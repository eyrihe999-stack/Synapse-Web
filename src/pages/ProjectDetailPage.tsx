// ProjectDetailPage 项目详情页 — 5 tab 调度 + 创建 / 编辑 modal 集中管理。
//
// 路由:/org/projects/:id
//
// PM 模型层级:Project → Initiative + Version⊥Workstream → Task。
// Initiative ⊥ Version 是正交两维(不是层级),Workstream 是网格交点上的颗粒。
// Roadmap tab 把这张网格画出来;Initiatives / Versions / Channels / KB 各自分 tab。
//
// 本文件只做调度 + 公共 state(form / modal / data fetch),具体 tab 渲染拆到
// ./project/*Tab.tsx 子组件;helpers 放 ./project/helpers.ts。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FolderGit2, ArrowLeft, Hash, GitBranch, Archive, Target, LayoutGrid, Bot,
  RefreshCw, Database,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { projectApi } from '@/api/project';
import { channelApi } from '@/api/channel';
import { apiCall } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import type {
  ProjectResponse, ChannelResponse, VersionResponse,
  InitiativeResponse, WorkstreamResponse, ProjectRoadmapResponse,
} from '@/types/api';
import { ChannelsTab } from './project/ChannelsTab';
import { InitiativesTab } from './project/InitiativesTab';
import { VersionsTab } from './project/VersionsTab';
import { RoadmapTab } from './project/RoadmapTab';
import { KBRefsTab } from './project/KBRefsTab';

type TabKey = 'channels' | 'initiatives' | 'versions' | 'roadmap' | 'kb';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const projectID = id ? Number(id) : 0;
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [channels, setChannels] = useState<ChannelResponse[]>([]);
  const [versions, setVersions] = useState<VersionResponse[]>([]);
  // Initiatives tab 走 list initiatives 端点(返活+归档全部);用 toggle 控制是否展示已归档。
  // Roadmap 仍走 roadmap 端点(它默认过滤 archived)。
  const [allInitiatives, setAllInitiatives] = useState<InitiativeResponse[]>([]);
  const [roadmap, setRoadmap] = useState<ProjectRoadmapResponse | null>(null);
  const [showArchivedInits, setShowArchivedInits] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('roadmap');

  // ── 创建 / 编辑 modal 状态 ──
  const [showCreateCh, setShowCreateCh] = useState(false);
  const [chForm, setChForm] = useState({ name: '', purpose: '' });
  const [chSaving, setChSaving] = useState(false);

  // version modal:create / edit 双用
  const [verModal, setVerModal] = useState<
    | null
    | { mode: 'create' }
    | { mode: 'edit'; target: VersionResponse }
  >(null);
  const [verForm, setVerForm] = useState({
    name: '', status: 'planning', target_date: '', released_at: '',
  });
  const [verSaving, setVerSaving] = useState(false);

  // initiative modal:create / edit 双用
  const [initModal, setInitModal] = useState<
    | null
    | { mode: 'create' }
    | { mode: 'edit'; target: InitiativeResponse }
  >(null);
  const [initForm, setInitForm] = useState({
    name: '', description: '', target_outcome: '', status: 'planned',
  });
  const [initSaving, setInitSaving] = useState(false);

  // workstream modal:wsModalInit 是 create 模式的承载 initiative;
  // wsModalEdit 是 edit 模式的目标 ws。
  const [wsModalInit, setWsModalInit] = useState<InitiativeResponse | null>(null);
  const [wsModalEdit, setWsModalEdit] = useState<WorkstreamResponse | null>(null);
  const [wsForm, setWsForm] = useState({
    name: '', description: '', version_id: '', status: 'draft',
  });
  const [wsSaving, setWsSaving] = useState(false);

  // ── data fetch ──
  const fetchAll = useCallback(async () => {
    if (!projectID) return;
    setLoading(true);
    const [pRes, cRes, vRes, iRes, rRes] = await Promise.all([
      apiCall(() => projectApi.get(projectID)),
      apiCall(() => projectApi.listChannels(projectID)),
      apiCall(() => projectApi.listVersions(projectID)),
      apiCall(() => projectApi.listInitiatives(projectID)),
      apiCall(() => projectApi.getRoadmap(projectID)),
    ]);
    setLoading(false);
    if (pRes.ok && pRes.data) setProject(pRes.data);
    if (cRes.ok && cRes.data) setChannels(cRes.data);
    if (vRes.ok && vRes.data) setVersions(vRes.data);
    if (iRes.ok && iRes.data) setAllInitiatives(iRes.data);
    if (rRes.ok && rRes.data) setRoadmap(rRes.data);
  }, [projectID]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── 衍生数据 ──
  const consoleChannel = useMemo(
    () => channels.find((c) => c.kind === 'project_console'),
    [channels],
  );
  const regularChannels = useMemo(
    () => channels.filter((c) => c.kind !== 'project_console'),
    [channels],
  );

  // Roadmap 的 Initiative × Version 网格索引
  const wsByInitVer = useMemo(() => {
    const map = new Map<string, WorkstreamResponse[]>();
    if (!roadmap) return map;
    for (const ws of roadmap.workstreams) {
      const key = `${ws.initiative_id}:${ws.version_id ?? 'backlog'}`;
      const arr = map.get(key) ?? [];
      arr.push(ws);
      map.set(key, arr);
    }
    return map;
  }, [roadmap]);

  // Initiatives tab:initiative_id → workstreams
  const wsByInit = useMemo(() => {
    const map = new Map<number, WorkstreamResponse[]>();
    if (!roadmap) return map;
    for (const ws of roadmap.workstreams) {
      const arr = map.get(ws.initiative_id) ?? [];
      arr.push(ws);
      map.set(ws.initiative_id, arr);
    }
    return map;
  }, [roadmap]);

  // Versions tab:version_id → workstreams。
  // version_id=NULL 的 ws(真 backlog)归到 system Backlog version 那一行,
  // 这样在 Version tab 展开 Backlog 就能看到它们。
  const wsByVer = useMemo(() => {
    const map = new Map<number, WorkstreamResponse[]>();
    if (!roadmap) return map;
    const backlogSysVer = versions.find((v) => v.is_system && v.name === 'Backlog');
    for (const ws of roadmap.workstreams) {
      const vid = ws.version_id ?? backlogSysVer?.id;
      if (!vid) continue;
      const arr = map.get(vid) ?? [];
      arr.push(ws);
      map.set(vid, arr);
    }
    return map;
  }, [roadmap, versions]);

  // Initiatives tab 用 allInitiatives;按 toggle 过滤已归档。
  const visibleInits = showArchivedInits
    ? allInitiatives
    : allInitiatives.filter((i) => !i.archived_at);
  const archivedInitCount = allInitiatives.filter((i) => !!i.archived_at).length;

  // ── action handlers ──
  const createChannel = async () => {
    if (!chForm.name.trim()) return;
    setChSaving(true);
    const res = await apiCall(() =>
      channelApi.create({
        project_id: projectID,
        name: chForm.name.trim(),
        purpose: chForm.purpose.trim() || undefined,
      }),
    );
    setChSaving(false);
    if (res.ok) {
      toast('success', 'Channel 已创建');
      setShowCreateCh(false);
      setChForm({ name: '', purpose: '' });
      fetchAll();
    }
  };

  const submitVersion = async () => {
    if (!verModal) return;
    setVerSaving(true);
    let ok = false;
    if (verModal.mode === 'create') {
      if (!verForm.name.trim()) {
        setVerSaving(false);
        return;
      }
      const res = await apiCall(() =>
        projectApi.createVersion(projectID, {
          name: verForm.name.trim(),
          status: verForm.status,
          target_date: verForm.target_date
            ? new Date(verForm.target_date).toISOString()
            : undefined,
        }),
      );
      ok = res.ok;
      if (ok) toast('success', 'Version 已创建');
    } else {
      const t = verModal.target;
      const patch: Record<string, string | null> = {};
      if (verForm.status !== t.status) patch.status = verForm.status;
      const cur_td = t.target_date ? t.target_date.slice(0, 10) : '';
      if (verForm.target_date !== cur_td) {
        patch.target_date = verForm.target_date
          ? new Date(verForm.target_date).toISOString()
          : null;
      }
      const cur_ra = t.released_at ? t.released_at.slice(0, 10) : '';
      if (verForm.released_at !== cur_ra) {
        patch.released_at = verForm.released_at
          ? new Date(verForm.released_at).toISOString()
          : null;
      }
      // status='released' 但用户没填 released_at 又没改过 → 自动用 now
      if (verForm.status === 'released' && !verForm.released_at && !t.released_at) {
        patch.released_at = new Date().toISOString();
      }
      if (Object.keys(patch).length === 0) {
        toast('success', '没有改动');
        setVerSaving(false);
        setVerModal(null);
        return;
      }
      const res = await apiCall(() => projectApi.updateVersion(t.id, patch));
      ok = res.ok;
      if (ok) toast('success', 'Version 已更新');
    }
    setVerSaving(false);
    if (ok) {
      setVerModal(null);
      setVerForm({ name: '', status: 'planning', target_date: '', released_at: '' });
      fetchAll();
    }
  };

  const openCreateVersion = () => {
    setVerForm({ name: '', status: 'planning', target_date: '', released_at: '' });
    setVerModal({ mode: 'create' });
  };
  const openEditVersion = (t: VersionResponse) => {
    setVerForm({
      name: t.name,
      status: t.status,
      target_date: t.target_date ? t.target_date.slice(0, 10) : '',
      released_at: t.released_at ? t.released_at.slice(0, 10) : '',
    });
    setVerModal({ mode: 'edit', target: t });
  };

  const submitInitiative = async () => {
    if (!initModal || !initForm.name.trim()) return;
    setInitSaving(true);
    let ok = false;
    if (initModal.mode === 'create') {
      const res = await apiCall(() =>
        projectApi.createInitiative(projectID, {
          name: initForm.name.trim(),
          description: initForm.description.trim() || undefined,
          target_outcome: initForm.target_outcome.trim() || undefined,
        }),
      );
      ok = res.ok;
      if (ok) toast('success', 'Initiative 已创建');
    } else {
      const t = initModal.target;
      const patch: Record<string, string> = {};
      if (initForm.name.trim() !== t.name) patch.name = initForm.name.trim();
      if (initForm.description !== (t.description ?? ''))
        patch.description = initForm.description;
      if (initForm.target_outcome !== (t.target_outcome ?? ''))
        patch.target_outcome = initForm.target_outcome;
      if (initForm.status !== t.status) patch.status = initForm.status;
      if (Object.keys(patch).length === 0) {
        toast('success', '没有改动');
        setInitSaving(false);
        setInitModal(null);
        return;
      }
      const res = await apiCall(() => projectApi.updateInitiative(t.id, patch));
      ok = res.ok;
      if (ok) toast('success', 'Initiative 已更新');
    }
    setInitSaving(false);
    if (ok) {
      setInitModal(null);
      setInitForm({ name: '', description: '', target_outcome: '', status: 'planned' });
      fetchAll();
    }
  };

  const openCreateInitiative = () => {
    setInitForm({ name: '', description: '', target_outcome: '', status: 'planned' });
    setInitModal({ mode: 'create' });
  };
  const openEditInitiative = (t: InitiativeResponse) => {
    setInitForm({
      name: t.name,
      description: t.description ?? '',
      target_outcome: t.target_outcome ?? '',
      status: t.status,
    });
    setInitModal({ mode: 'edit', target: t });
  };

  const submitWorkstream = async () => {
    if (!wsForm.name.trim()) return;
    setWsSaving(true);
    let ok = false;
    if (wsModalInit) {
      const res = await apiCall(() =>
        projectApi.createWorkstreamInInitiative(wsModalInit.id, {
          name: wsForm.name.trim(),
          description: wsForm.description.trim() || undefined,
          version_id: wsForm.version_id ? Number(wsForm.version_id) : undefined,
        }),
      );
      ok = res.ok;
      if (ok) toast('success', 'Workstream 已创建');
    } else if (wsModalEdit) {
      const t = wsModalEdit;
      const patch: Record<string, string | number> = {};
      if (wsForm.name.trim() !== t.name) patch.name = wsForm.name.trim();
      if (wsForm.description !== (t.description ?? ''))
        patch.description = wsForm.description;
      if (wsForm.status !== t.status) patch.status = wsForm.status;
      const targetVer = wsForm.version_id ? Number(wsForm.version_id) : 0;
      const currentVer = t.version_id ?? 0;
      if (targetVer !== currentVer) patch.version_id = targetVer;
      if (Object.keys(patch).length === 0) {
        toast('success', '没有改动');
        setWsSaving(false);
        setWsModalEdit(null);
        return;
      }
      const res = await apiCall(() => projectApi.updateWorkstream(t.id, patch));
      ok = res.ok;
      if (ok) toast('success', 'Workstream 已更新');
    }
    setWsSaving(false);
    if (ok) {
      setWsModalInit(null);
      setWsModalEdit(null);
      setWsForm({ name: '', description: '', version_id: '', status: 'draft' });
      fetchAll();
    }
  };

  const openCreateWorkstream = (init: InitiativeResponse) => {
    setWsModalInit(init);
    setWsForm({ name: '', description: '', version_id: '', status: 'draft' });
  };
  const openEditWorkstream = (t: WorkstreamResponse) => {
    setWsForm({
      name: t.name,
      description: t.description ?? '',
      version_id: t.version_id ? String(t.version_id) : '',
      status: t.status,
    });
    setWsModalEdit(t);
  };

  const cancelWorkstream = async (t: WorkstreamResponse) => {
    if (!confirm(`把 Workstream「${t.name}」标记为 cancelled?(workstream 没有真正归档,这是用户能用的"取消"语义)`)) return;
    const res = await apiCall(() =>
      projectApi.updateWorkstream(t.id, { status: 'cancelled' }),
    );
    if (res.ok) {
      toast('success', '已取消');
      fetchAll();
    }
  };

  const archiveProject = async () => {
    if (!project) return;
    if (!confirm(`归档项目「${project.name}」?`)) return;
    const res = await apiCall(() => projectApi.archive(project.id));
    if (res.ok) {
      toast('success', '已归档');
      fetchAll();
    }
  };

  const archiveInitiative = async (init: InitiativeResponse) => {
    if (init.is_system) {
      toast('error', '系统 Initiative 不能归档');
      return;
    }
    if (!confirm(`归档 Initiative「${init.name}」?(下面的 workstream 必须已结束)`)) return;
    const res = await apiCall(() => projectApi.archiveInitiative(init.id));
    if (res.ok) {
      toast('success', 'Initiative 已归档');
      fetchAll();
    }
  };

  const openChannel = (channelID: number) => navigate(`/org/channels/${channelID}`);

  // ── 渲染 ──

  if (!projectID) return <div className="p-6">Invalid project id</div>;

  if (loading && !project) {
    return (
      <div className="p-6 space-y-3">
        <div className="h-6 bg-[#eeede8] rounded w-1/3 animate-pulse" />
        <div className="h-4 bg-[#eeede8] rounded w-2/3 animate-pulse" />
        <div className="h-32 bg-[#eeede8] rounded animate-pulse" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 text-center text-text-muted">
        <p className="text-[13px]">项目不存在或无访问权限</p>
        <Button
          variant="ghost"
          onClick={() => navigate('/org/projects')}
          className="mt-3"
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
        >
          返回列表
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* 顶部:项目名 + 描述 + Console 入口 + 刷新 + 归档 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <button
            onClick={() => navigate('/org/projects')}
            className="mt-1 p-1 text-text-muted hover:text-[#2383e2] rounded"
            title="返回项目列表"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <FolderGit2 className="w-5 h-5 text-text-muted mt-0.5 shrink-0" strokeWidth={1.6} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-text-primary truncate">
                {project.name}
              </h2>
              {project.archived_at && <StatusChip tone="neutral">已归档</StatusChip>}
            </div>
            {project.description && (
              <p className="text-[12px] text-text-secondary mt-0.5 max-w-2xl">
                {project.description}
              </p>
            )}
            <p className="text-[11px] text-text-muted mt-1">
              {formatRelativeWithAbsSeconds(
                Math.floor(new Date(project.created_at).getTime() / 1000),
              )}{' '}
              创建 · ID #{project.id}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />}
            onClick={fetchAll}
            disabled={loading}
            title="刷新"
          />
          {consoleChannel && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Bot className="w-3.5 h-3.5" />}
              onClick={() => openChannel(consoleChannel.id)}
            >
              进入 Console
            </Button>
          )}
          {!project.archived_at && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Archive className="w-3.5 h-3.5" />}
              onClick={archiveProject}
            >
              归档
            </Button>
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'channels' as TabKey, label: 'Channel', icon: Hash, badge: regularChannels.length },
          { key: 'initiatives' as TabKey, label: 'Initiative', icon: Target, badge: visibleInits.length },
          { key: 'versions' as TabKey, label: 'Version', icon: GitBranch, badge: versions.length },
          { key: 'roadmap' as TabKey, label: 'Roadmap', icon: LayoutGrid },
          { key: 'kb' as TabKey, label: 'KB 挂载', icon: Database },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'channels' && (
        <ChannelsTab
          channels={regularChannels}
          archived={!!project.archived_at}
          onCreate={() => setShowCreateCh(true)}
          onOpen={(c) => openChannel(c.id)}
        />
      )}

      {activeTab === 'initiatives' && (
        <InitiativesTab
          initiatives={visibleInits}
          versions={versions}
          wsByInit={wsByInit}
          archived={!!project.archived_at}
          showArchived={showArchivedInits}
          archivedCount={archivedInitCount}
          onToggleShowArchived={setShowArchivedInits}
          onCreate={openCreateInitiative}
          onEdit={openEditInitiative}
          onArchive={archiveInitiative}
          onCreateWorkstream={openCreateWorkstream}
          onEditWorkstream={openEditWorkstream}
          onCancelWorkstream={cancelWorkstream}
          onOpenChannel={openChannel}
        />
      )}

      {activeTab === 'versions' && (
        <VersionsTab
          versions={versions}
          initiatives={allInitiatives}
          wsByVer={wsByVer}
          archived={!!project.archived_at}
          onCreate={openCreateVersion}
          onEdit={openEditVersion}
          onOpenChannel={openChannel}
        />
      )}

      {activeTab === 'roadmap' && (
        <RoadmapTab
          initiatives={roadmap?.initiatives ?? []}
          versions={roadmap?.versions ?? []}
          wsByInitVer={wsByInitVer}
          wsByInit={wsByInit}
          onOpenChannel={openChannel}
        />
      )}

      {activeTab === 'kb' && (
        <KBRefsTab projectID={projectID} archived={!!project.archived_at} />
      )}

      {/* ── modals ── */}

      <Modal open={showCreateCh} onClose={() => setShowCreateCh(false)} title="新建 channel">
        <div className="space-y-4">
          <Input
            label="Channel 名称"
            value={chForm.name}
            onChange={(e) => setChForm({ ...chForm, name: e.target.value })}
            autoFocus
          />
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">用途(可选)</label>
            <textarea
              value={chForm.purpose}
              onChange={(e) => setChForm({ ...chForm, purpose: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 text-[13px] rounded border border-[#e3e2dc] bg-white focus:outline-none focus:border-[#2383e2] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateCh(false)}>取消</Button>
            <Button onClick={createChannel} loading={chSaving} disabled={!chForm.name.trim()}>
              创建
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!verModal}
        onClose={() => setVerModal(null)}
        title={
          verModal?.mode === 'edit'
            ? `编辑 Version「${verModal.target.name}」`
            : '新建 version'
        }
      >
        <div className="space-y-4">
          {verModal?.mode === 'create' ? (
            <Input
              label="名称"
              placeholder="v1.0 / 2026-Q2 / sprint-5"
              value={verForm.name}
              onChange={(e) => setVerForm({ ...verForm, name: e.target.value })}
              autoFocus
            />
          ) : (
            <p className="text-[12px] text-text-muted">
              名称(<span className="font-mono">{verForm.name}</span>)发布后不可改 — 想改名请新建 version。
            </p>
          )}
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">状态</label>
            <select
              value={verForm.status}
              onChange={(e) => setVerForm({ ...verForm, status: e.target.value })}
              className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white"
            >
              <option value="planning">计划中</option>
              <option value="active">进行中</option>
              <option value="released">已发布</option>
              <option value="cancelled">已取消</option>
            </select>
          </div>
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">目标日期(可选)</label>
            <input
              type="date"
              value={verForm.target_date}
              onChange={(e) => setVerForm({ ...verForm, target_date: e.target.value })}
              className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white"
            />
          </div>
          {verModal?.mode === 'edit' && (
            <div>
              <label className="block text-[13px] text-text-secondary mb-1">
                发布日期(选 released 状态时如不填会自动用当前时间)
              </label>
              <input
                type="date"
                value={verForm.released_at}
                onChange={(e) => setVerForm({ ...verForm, released_at: e.target.value })}
                className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setVerModal(null)}>取消</Button>
            <Button
              onClick={submitVersion}
              loading={verSaving}
              disabled={verModal?.mode === 'create' && !verForm.name.trim()}
            >
              {verModal?.mode === 'edit' ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!initModal}
        onClose={() => setInitModal(null)}
        title={initModal?.mode === 'edit' ? `编辑 Initiative「${initModal.target.name}」` : '新建 Initiative'}
      >
        <div className="space-y-4">
          <Input
            label="名称"
            placeholder="Auth 体系重构 / 移动端重构 / ..."
            value={initForm.name}
            onChange={(e) => setInitForm({ ...initForm, name: e.target.value })}
            autoFocus
          />
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">描述(可选)</label>
            <textarea
              value={initForm.description}
              onChange={(e) => setInitForm({ ...initForm, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 text-[13px] rounded border border-[#e3e2dc] bg-white focus:outline-none focus:border-[#2383e2] resize-none"
            />
          </div>
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">
              Target Outcome(可选,要达到什么结果)
            </label>
            <textarea
              value={initForm.target_outcome}
              onChange={(e) => setInitForm({ ...initForm, target_outcome: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 text-[13px] rounded border border-[#e3e2dc] bg-white focus:outline-none focus:border-[#2383e2] resize-none"
            />
          </div>
          {initModal?.mode === 'edit' && (
            <div>
              <label className="block text-[13px] text-text-secondary mb-1">状态</label>
              <select
                value={initForm.status}
                onChange={(e) => setInitForm({ ...initForm, status: e.target.value })}
                className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white"
              >
                <option value="planned">计划中(planned)</option>
                <option value="active">进行中(active)</option>
                <option value="completed">已完成(completed)</option>
                <option value="cancelled">已取消(cancelled)</option>
              </select>
              <p className="mt-1 text-[11px] text-text-muted">
                归档操作会自动把 active → completed,这里手动也可改;archive_at 由归档按钮单独触发。
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setInitModal(null)}>取消</Button>
            <Button onClick={submitInitiative} loading={initSaving} disabled={!initForm.name.trim()}>
              {initModal?.mode === 'edit' ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!wsModalInit || !!wsModalEdit}
        onClose={() => {
          setWsModalInit(null);
          setWsModalEdit(null);
        }}
        title={
          wsModalEdit
            ? `编辑 Workstream「${wsModalEdit.name}」`
            : `新建 Workstream(挂在「${wsModalInit?.name ?? ''}」下)`
        }
      >
        <div className="space-y-4">
          <Input
            label="名称"
            placeholder="API 重构 / 联调 / ..."
            value={wsForm.name}
            onChange={(e) => setWsForm({ ...wsForm, name: e.target.value })}
            autoFocus
          />
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">描述(可选)</label>
            <textarea
              value={wsForm.description}
              onChange={(e) => setWsForm({ ...wsForm, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 text-[13px] rounded border border-[#e3e2dc] bg-white focus:outline-none focus:border-[#2383e2] resize-none"
            />
          </div>
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">
              挂到 Version(可选,留空 = backlog)
            </label>
            <select
              value={wsForm.version_id}
              onChange={(e) => setWsForm({ ...wsForm, version_id: e.target.value })}
              className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white"
            >
              <option value="">— Backlog(未排期)—</option>
              {versions
                .filter((v) => v.status !== 'cancelled')
                .map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
            </select>
          </div>
          {wsModalEdit && (
            <div>
              <label className="block text-[13px] text-text-secondary mb-1">状态</label>
              <select
                value={wsForm.status}
                onChange={(e) => setWsForm({ ...wsForm, status: e.target.value })}
                className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white"
              >
                <option value="draft">草稿(draft)</option>
                <option value="active">进行中(active)</option>
                <option value="blocked">阻塞(blocked)</option>
                <option value="done">已完成(done)</option>
                <option value="cancelled">已取消(cancelled)</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setWsModalInit(null);
                setWsModalEdit(null);
              }}
            >
              取消
            </Button>
            <Button onClick={submitWorkstream} loading={wsSaving} disabled={!wsForm.name.trim()}>
              {wsModalEdit ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
