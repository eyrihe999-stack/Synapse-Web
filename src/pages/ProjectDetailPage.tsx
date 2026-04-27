// ProjectDetailPage 项目详情 —— 基础信息 + channel / version 双 tab。
//
// 路由:/org/projects/:id
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FolderGit2,
  ArrowLeft,
  Hash,
  Plus,
  GitBranch,
  Archive,
} from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { projectApi } from '@/api/project';
import { channelApi } from '@/api/channel';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import type {
  ProjectResponse,
  ChannelResponse,
  VersionResponse,
} from '@/types/api';

type TabKey = 'channels' | 'versions';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const projectID = id ? Number(id) : 0;
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [channels, setChannels] = useState<ChannelResponse[]>([]);
  const [versions, setVersions] = useState<VersionResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('channels');

  const [showCreateCh, setShowCreateCh] = useState(false);
  const [chForm, setChForm] = useState({ name: '', purpose: '' });
  const [chSaving, setChSaving] = useState(false);

  const [showCreateVer, setShowCreateVer] = useState(false);
  const [verForm, setVerForm] = useState({ name: '', status: 'planned' });
  const [verSaving, setVerSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!projectID) return;
    setLoading(true);
    const [pRes, cRes, vRes] = await Promise.all([
      apiCall(() => projectApi.get(projectID)),
      apiCall(() => projectApi.listChannels(projectID)),
      apiCall(() => projectApi.listVersions(projectID)),
    ]);
    setLoading(false);
    if (pRes.ok && pRes.data) setProject(pRes.data);
    if (cRes.ok && cRes.data) setChannels(cRes.data);
    if (vRes.ok && vRes.data) setVersions(vRes.data);
  }, [projectID]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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

  const createVersion = async () => {
    if (!verForm.name.trim()) return;
    setVerSaving(true);
    const res = await apiCall(() =>
      projectApi.createVersion(projectID, {
        name: verForm.name.trim(),
        status: verForm.status,
      }),
    );
    setVerSaving(false);
    if (res.ok) {
      toast('success', 'Version 已创建');
      setShowCreateVer(false);
      setVerForm({ name: '', status: 'planned' });
      fetchAll();
    }
  };

  const archive = async () => {
    if (!project) return;
    if (!confirm(`归档项目「${project.name}」?`)) return;
    const res = await apiCall(() => projectApi.archive(project.id));
    if (res.ok) {
      toast('success', '已归档');
      fetchAll();
    }
  };

  if (!projectID) return <div className="p-6">Invalid project id</div>;

  if (loading && !project) {
    return (
      <div className="p-6">
        <div className="h-6 bg-[#eeede8] rounded w-1/3 animate-pulse" />
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
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <button
            onClick={() => navigate('/org/projects')}
            className="mt-1 p-1 text-text-muted hover:text-[#2383e2] rounded"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <FolderGit2 className="w-5 h-5 text-text-muted mt-0.5 shrink-0" strokeWidth={1.6} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
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
              创建
            </p>
          </div>
        </div>
        {!project.archived_at && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Archive className="w-3.5 h-3.5" />}
            onClick={archive}
          >
            归档
          </Button>
        )}
      </div>

      <Tabs
        tabs={[
          { key: 'channels' as TabKey, label: 'Channel', icon: Hash, badge: channels.length },
          { key: 'versions' as TabKey, label: 'Version', icon: GitBranch, badge: versions.length },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'channels' ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            {!project.archived_at && (
              <Button
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setShowCreateCh(true)}
              >
                新建 channel
              </Button>
            )}
          </div>
          {channels.length === 0 ? (
            <GlassCard>
              <div className="py-6 text-center text-text-muted">
                <Hash className="mx-auto w-6 h-6 mb-2" strokeWidth={1.5} />
                <p className="text-[13px]">这个项目下还没有 channel</p>
              </div>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {channels.map((c) => (
                <GlassCard key={c.id} className="cursor-pointer group" hover>
                  <div
                    onClick={() => navigate(`/org/channels/${c.id}`)}
                    className="flex items-start gap-2"
                  >
                    <Hash
                      className="w-4 h-4 text-[#2383e2] mt-0.5 shrink-0"
                      strokeWidth={1.8}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[14px] font-medium text-text-primary truncate group-hover:text-[#2383e2]">
                          {c.name}
                        </h3>
                        {c.status === 'archived' && <StatusChip tone="neutral">已归档</StatusChip>}
                      </div>
                      {c.purpose && (
                        <p className="mt-0.5 text-[12px] text-text-secondary line-clamp-2">
                          {c.purpose}
                        </p>
                      )}
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            {!project.archived_at && (
              <Button
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setShowCreateVer(true)}
              >
                新建 version
              </Button>
            )}
          </div>
          {versions.length === 0 ? (
            <GlassCard>
              <div className="py-6 text-center text-text-muted">
                <GitBranch className="mx-auto w-6 h-6 mb-2" strokeWidth={1.5} />
                <p className="text-[13px]">还没有 version</p>
                <p className="text-[11px] mt-1">Version 是项目的里程碑 / 发布点标签</p>
              </div>
            </GlassCard>
          ) : (
            <div className="rounded-md border border-[#e8e7e3] bg-white">
              {versions.map((v, idx) => (
                <div
                  key={v.id}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2',
                    idx > 0 && 'border-t border-[#f0efe9]',
                  )}
                >
                  <GitBranch className="w-4 h-4 text-text-muted" strokeWidth={1.8} />
                  <div className="flex-1">
                    <p className="text-[13px] font-medium text-text-primary">{v.name}</p>
                    <p className="text-[11px] text-text-muted">
                      {v.target_date
                        ? `目标 ${new Date(v.target_date).toLocaleDateString('zh-CN')}`
                        : '无目标日期'}
                    </p>
                  </div>
                  <StatusChip tone="blue">{v.status}</StatusChip>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
            <Button variant="secondary" onClick={() => setShowCreateCh(false)}>
              取消
            </Button>
            <Button onClick={createChannel} loading={chSaving} disabled={!chForm.name.trim()}>
              创建
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={showCreateVer} onClose={() => setShowCreateVer(false)} title="新建 version">
        <div className="space-y-4">
          <Input
            label="名称"
            placeholder="v1.0 / 2026-Q2 / sprint-5"
            value={verForm.name}
            onChange={(e) => setVerForm({ ...verForm, name: e.target.value })}
            autoFocus
          />
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">状态</label>
            <select
              value={verForm.status}
              onChange={(e) => setVerForm({ ...verForm, status: e.target.value })}
              className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white"
            >
              <option value="planned">计划中</option>
              <option value="in_progress">进行中</option>
              <option value="released">已发布</option>
              <option value="archived">已归档</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateVer(false)}>
              取消
            </Button>
            <Button onClick={createVersion} loading={verSaving} disabled={!verForm.name.trim()}>
              创建
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
