// KnowledgeCodeTab 知识库 → 代码 tab。
//
// 功能:
//   - 列出 org 下所有 kind=gitlab_repo 的 sources(同步源元数据 + 状态)
//   - org owner 可接入新 GitLab 仓库 / 触发重新同步 / 删除同步源
//   - 创建后弹 modal 一次展示 webhook URL + secret + 配置说明
//
// 权限:
//   - 创建 / 删除 / 重新同步 后端挂 RequirePerm('integration.gitlab.manage'),默认仅 org owner
//   - 前端按 currentOrg.owner_user_id === me.id 简单判断显示按钮(过保守不会过宽松)
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  Code2,
  GitBranch,
  RefreshCw,
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { formatRelativeWithAbs } from '@/lib/format';
import { useOrgStore } from '@/store/org';
import { useAuthStore } from '@/store/auth';
import { sourceApi } from '@/api/source';
import type {
  CreateGitLabSourceRequest,
  CreateGitLabSourceResponse,
  GitLabSyncStatusResponse,
  SourceResponse,
  SourceVisibility,
} from '@/types/api';

// 后端 last_sync_status 取值 → 中文标签 + 徽章配色。
// '' / 'never' 都视作"从未同步"(后端 SyncStatusNever 是空串)。
const SYNC_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warn' | 'danger' }
> = {
  '': { label: '从未同步', tone: 'neutral' },
  never: { label: '从未同步', tone: 'neutral' },
  running: { label: '同步中', tone: 'info' },
  succeeded: { label: '已同步', tone: 'success' },
  auth_failed: { label: '凭据失效', tone: 'danger' },
  failed: { label: '同步失败', tone: 'warn' },
};

const TONE_CLASS: Record<string, string> = {
  neutral: 'bg-bg-secondary text-text-muted',
  info: 'bg-blue-50 text-blue-600',
  success: 'bg-green-50 text-green-600',
  warn: 'bg-orange-50 text-orange-600',
  danger: 'bg-red-50 text-red-600',
};

export function KnowledgeCodeTab() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const me = useAuthStore((s) => s.user);
  const isOrgOwner =
    !!me && !!currentOrg && me.id === currentOrg.org.owner_user_id;

  const [sources, setSources] = useState<SourceResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  // 创建成功后展示一次 webhook secret;关闭后置 null
  const [created, setCreated] = useState<CreateGitLabSourceResponse | null>(null);

  const fetchSources = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      // scope=all 让 owner 看到全 org 的 GitLab 同步源,不被 ACL 隐藏。
      const res = await sourceApi.list(slug, 1, 100, 'gitlab_repo', 'all');
      setSources(res.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const triggerResync = async (src: SourceResponse) => {
    if (!slug) return;
    setResyncingId(src.id);
    const res = await apiCall(() => sourceApi.triggerGitLabResync(slug, src.id), {
      success: '已触发重新同步',
    });
    setResyncingId(null);
    if (res.ok) fetchSources();
  };

  const removeSource = async (src: SourceResponse) => {
    if (!slug) return;
    const label = src.name || src.external_ref || src.id;
    if (
      !confirm(
        `确定删除 GitLab 同步源「${label}」?\n` +
          `该 source 下所有索引文档会被一并删除,GitLab 侧的 webhook 配置也将失效。`,
      )
    )
      return;
    const res = await apiCall(() => sourceApi.removeGitLab(slug, src.id), {
      success: '同步源已删除',
    });
    if (res.ok) fetchSources();
  };

  if (!slug) return null;

  return (
    <div className="space-y-4">
      {/* 顶部操作栏:接入按钮(owner 可见)+ 列表标题 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-text-primary flex items-center gap-2">
            <Code2 className="h-4 w-4 text-accent" strokeWidth={1.6} />
            GitLab 仓库
          </h2>
          <p className="text-[12px] text-text-muted mt-0.5">
            {sources.length === 0
              ? '尚未接入任何 GitLab 仓库'
              : `已接入 ${sources.length} 个仓库 · push 后增量同步`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchSources}
            icon={
              <RefreshCw
                className={clsx('h-3 w-3', loading && 'animate-spin')}
              />
            }
            disabled={loading}
          >
            刷新
          </Button>
          {isOrgOwner && (
            <Button
              onClick={() => setShowCreate(true)}
              icon={<Plus className="h-3.5 w-3.5" />}
              size="sm"
            >
              接入仓库
            </Button>
          )}
        </div>
      </div>

      {/* 列表 */}
      {sources.length === 0 ? (
        <GlassCard>
          <div className="py-10 text-center">
            <Code2
              className="h-8 w-8 text-text-muted mx-auto mb-3"
              strokeWidth={1.2}
            />
            <p className="text-[14px] text-text-secondary mb-1">
              {loading ? '加载中...' : '还没有接入任何 GitLab 仓库'}
            </p>
            {isOrgOwner && !loading && (
              <p className="text-[12px] text-text-muted">
                点击右上「接入仓库」开始
              </p>
            )}
            {!isOrgOwner && !loading && (
              <p className="text-[12px] text-text-muted">
                需要 org owner 在此接入
              </p>
            )}
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {sources.map((src) => (
            <GitLabSourceCard
              key={src.id}
              slug={slug}
              src={src}
              isOrgOwner={isOrgOwner}
              triggeringResync={resyncingId === src.id}
              onResyncRequest={() => triggerResync(src)}
              onRemove={() => removeSource(src)}
              onSyncFinish={fetchSources}
            />
          ))}
        </div>
      )}

      {/* 接入仓库 modal */}
      <CreateGitLabSourceModal
        open={showCreate}
        slug={slug}
        onCancel={() => setShowCreate(false)}
        onCreated={(resp) => {
          setShowCreate(false);
          setCreated(resp);
          fetchSources();
        }}
      />

      {/* 创建成功后一次性展示 webhook secret */}
      <WebhookSecretModal
        data={created}
        onClose={() => setCreated(null)}
      />
    </div>
  );
}

// GitLabSourceCard 单个仓库的元信息卡片。
// 信息密度优先于美观度 — owner 排查同步问题时希望一眼看到状态 + 上次 commit + 错误。
//
// 内部自带轮询:active 状态(running/queued)启 5s 一次拉 sync-status,展示进度;
// 终态 / never 时停轮询。终态时调 onSyncFinish 让外层刷新 sources 列表(更新 last_sync_status)。
function GitLabSourceCard({
  slug,
  src,
  isOrgOwner,
  triggeringResync,
  onResyncRequest,
  onRemove,
  onSyncFinish,
}: {
  slug: string;
  src: SourceResponse;
  isOrgOwner: boolean;
  triggeringResync: boolean; // 父组件正在发 resync 请求(等响应)
  onResyncRequest: () => void;
  onRemove: () => void;
  onSyncFinish: () => void;
}) {
  // syncStatus:实时进度。null = 还没拉过(刚 mount 第一次轮询)。
  const [syncStatus, setSyncStatus] = useState<GitLabSyncStatusResponse | null>(null);

  // 是否处于"活跃同步态"(正在跑或排队中)
  const isActive =
    syncStatus?.status === 'running' || syncStatus?.status === 'queued';

  // 轮询逻辑:mount 即拉一次;active 时每 5s 重拉;终态/never 停轮询。
  // 终态时调 onSyncFinish() 让父组件刷新 sources 列表(让卡片用上最新的 last_sync_*)。
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let prevStatus: string | undefined; // 检测 running/queued → 终态 的跃迁

    const poll = async () => {
      try {
        const res = await sourceApi.getGitLabSyncStatus(slug, src.id);
        if (cancelled) return;
        const next = res.data.result;
        if (!next) return;
        setSyncStatus(next);
        // running/queued → 终态:调 onSyncFinish 触发外层刷新
        if (
          (prevStatus === 'running' || prevStatus === 'queued') &&
          next.status !== 'running' &&
          next.status !== 'queued'
        ) {
          onSyncFinish();
        }
        prevStatus = next.status;
        // active 时继续轮询;否则停
        if (next.status === 'running' || next.status === 'queued') {
          timer = setTimeout(poll, 5000);
        }
      } catch {
        // 静默失败 — 5s 后再试
        if (!cancelled) timer = setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // src.updated_at 变化 → 触发重新轮询(创建后 / 父组件刷新后)
  }, [slug, src.id, src.updated_at, onSyncFinish]);

  // 状态展示来源优先级:
  //   1) 有 syncStatus 且非 never → 用它(实时,反映 running 中)
  //   2) 否则用 src.last_sync_status(终态快照)
  const effectiveStatusKey =
    syncStatus && syncStatus.status !== 'never'
      ? syncStatus.status
      : (src.last_sync_status ?? '');
  const status = SYNC_STATUS[effectiveStatusKey] ?? SYNC_STATUS.never;

  const StatusIcon =
    status.tone === 'success'
      ? CheckCircle2
      : status.tone === 'info'
        ? Loader2
        : status.tone === 'danger' || status.tone === 'warn'
          ? AlertTriangle
          : GitBranch;

  const commitShort =
    src.last_synced_commit && src.last_synced_commit.length >= 7
      ? src.last_synced_commit.slice(0, 7)
      : src.last_synced_commit;

  // 心跳健康度:active 状态下 heartbeat > 60s 没动 → runner 可能卡了。
  const heartbeatStaleSec =
    isActive && syncStatus?.heartbeat_at
      ? Math.max(0, Math.floor(Date.now() / 1000) - syncStatus.heartbeat_at)
      : 0;
  const heartbeatStale = heartbeatStaleSec > 60;

  // resync 点击守卫:active 状态下不发请求 + 提示。
  // toast 只支持 success/error 两种 tone — 用 success 表"友善提示"(避免红色 error 误导)。
  const handleResyncClick = () => {
    if (isActive) {
      toast(
        'success',
        `已有同步任务在跑(已完成 ${syncStatus?.progress_done ?? 0} 个 chunk),无需重复触发`,
      );
      return;
    }
    onResyncRequest();
  };

  return (
    <GlassCard>
      <div className="flex items-start gap-3 py-1">
        <div className="h-9 w-9 rounded-md bg-accent/[0.08] flex items-center justify-center shrink-0 mt-0.5">
          <Code2 className="h-4.5 w-4.5 text-accent" strokeWidth={1.6} />
        </div>

        <div className="flex-1 min-w-0">
          {/* 第一行:repo path + 状态徽章 + branch */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-medium text-text-primary font-mono truncate max-w-[420px]">
              {src.name || src.external_ref || `#${src.id}`}
            </span>
            <span
              className={clsx(
                'inline-flex items-center gap-1 text-[10px] px-1.5 py-[1px] rounded',
                TONE_CLASS[status.tone],
              )}
            >
              <StatusIcon
                className={clsx('h-2.5 w-2.5', status.tone === 'info' && 'animate-spin')}
              />
              {status.label}
              {/* active 状态下,在徽章里附进度数,owner 一眼看到推进 */}
              {isActive && syncStatus && (
                <span className="ml-0.5 font-mono">
                  · {syncStatus.progress_done}
                </span>
              )}
            </span>
            {src.gitlab_branch && (
              <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary bg-bg-secondary px-1.5 py-[1px] rounded font-mono">
                <GitBranch className="h-2.5 w-2.5" />
                {src.gitlab_branch}
              </span>
            )}
            {heartbeatStale && (
              <span className="inline-flex items-center gap-1 text-[10px] text-orange-700 bg-orange-50 px-1.5 py-[1px] rounded">
                <AlertTriangle className="h-2.5 w-2.5" />
                心跳 {heartbeatStaleSec}s 未更新
              </span>
            )}
          </div>

          {/* 第二行:同步元数据网格 */}
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
            <MetaItem
              label="上次同步"
              value={
                src.last_synced_at
                  ? formatRelativeWithAbs(src.last_synced_at)
                  : '—'
              }
            />
            <MetaItem
              label="commit"
              value={commitShort || '—'}
              valueClass="font-mono"
            />
            <MetaItem
              label="project_id"
              value={src.external_ref || '—'}
              valueClass="font-mono"
            />
            <MetaItem
              label="可见性"
              value={
                src.visibility === 'org'
                  ? '全 org'
                  : src.visibility === 'group'
                    ? 'ACL 授权'
                    : '仅 owner'
              }
            />
          </div>

          {/* 错误信息(若有)*/}
          {src.last_sync_error && (
            <div className="mt-2 text-[11px] text-red-600 bg-red-50 px-2 py-1.5 rounded border border-red-100 font-mono break-all">
              <span className="font-sans text-red-700 mr-1">⚠</span>
              {src.last_sync_error}
            </div>
          )}

          {/* 创建时间 */}
          <p className="mt-1.5 text-[11px] text-text-muted">
            创建于 {formatRelativeWithAbs(src.created_at)}
          </p>
        </div>

        {/* 操作 */}
        {isOrgOwner && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResyncClick}
              // active 时按钮**不禁用** —— 让用户能点(点击会 toast 提示已有任务),
              // 这比 disabled 不响应更友好(disabled 容易让用户以为按钮坏了)。
              // 仅父组件正在等响应时才 disabled(防 spam click 重复发请求)。
              disabled={triggeringResync}
              icon={
                <RefreshCw
                  className={clsx(
                    'h-3 w-3',
                    (triggeringResync || isActive) && 'animate-spin',
                  )}
                />
              }
              title={isActive ? '正在同步中,无需触发' : '重新触发全量同步'}
            >
              {isActive
                ? `同步中… ${syncStatus?.progress_done ?? 0}`
                : '重新同步'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              icon={<Trash2 className="h-3 w-3" />}
              title="删除同步源 + 索引文档"
            >
              删除
            </Button>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function MetaItem({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <p className="text-text-muted">{label}</p>
      <p className={clsx('text-text-primary truncate', valueClass)}>{value}</p>
    </div>
  );
}

// CreateGitLabSourceModal owner 接入新 GitLab 仓库。
// 字段:base_url(可选)/ pat(必填,密码)/ project_id(必填)/ branch(默认 main)/ visibility。
function CreateGitLabSourceModal({
  open,
  slug,
  onCancel,
  onCreated,
}: {
  open: boolean;
  slug: string;
  onCancel: () => void;
  onCreated: (resp: CreateGitLabSourceResponse) => void;
}) {
  const [baseURL, setBaseURL] = useState('');
  const [pat, setPat] = useState('');
  const [projectId, setProjectId] = useState('');
  const [branch, setBranch] = useState('main');
  const [visibility, setVisibility] = useState<SourceVisibility>('org');
  const [showPat, setShowPat] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // open 切换时 reset
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setBaseURL('');
      setPat('');
      setProjectId('');
      setBranch('main');
      setVisibility('org');
      setShowPat(false);
    }
  }

  const submit = async () => {
    if (!pat.trim()) {
      toast('error', '请填写 Personal Access Token');
      return;
    }
    if (!projectId.trim()) {
      toast('error', '请填写 GitLab project_id');
      return;
    }
    const body: CreateGitLabSourceRequest = {
      base_url: baseURL.trim() || undefined,
      pat: pat.trim(),
      project_id: projectId.trim(),
      branch: branch.trim() || undefined,
      visibility,
    };
    setSubmitting(true);
    const res = await apiCall(() => sourceApi.createGitLab(slug, body), {
      success: '仓库已接入,请保存 webhook secret',
    });
    setSubmitting(false);
    if (res.ok && res.data) {
      onCreated(res.data);
    }
  };

  return (
    <Modal open={open} onClose={onCancel} title="接入 GitLab 仓库" size="lg">
      <div className="space-y-3">
        <Field label="GitLab 实例 URL(自托管时填,公共 SaaS 留空)">
          <input
            type="url"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="https://gitlab.com"
            className="w-full px-3 py-2 text-[13px] rounded-md border border-border-default bg-white focus:outline-none focus:border-accent"
          />
        </Field>

        <Field
          label="Personal Access Token"
          hint="scope 至少需 read_api + read_repository"
        >
          <div className="relative">
            <input
              type={showPat ? 'text' : 'password'}
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 pr-10 text-[13px] rounded-md border border-border-default bg-white font-mono focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setShowPat((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary cursor-pointer"
              tabIndex={-1}
            >
              {showPat ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Project ID"
            hint="GitLab 项目主页上的数字 id"
          >
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="12345"
              className="w-full px-3 py-2 text-[13px] rounded-md border border-border-default bg-white font-mono focus:outline-none focus:border-accent"
            />
          </Field>

          <Field label="同步分支">
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="w-full px-3 py-2 text-[13px] rounded-md border border-border-default bg-white font-mono focus:outline-none focus:border-accent"
            />
          </Field>
        </div>

        <Field label="可见性">
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as SourceVisibility)}
            className="w-full px-3 py-2 text-[13px] rounded-md border border-border-default bg-white cursor-pointer focus:outline-none focus:border-accent"
          >
            <option value="org">全 org 可读</option>
            <option value="group">按 ACL 授权</option>
            <option value="private">仅 owner</option>
          </select>
        </Field>

        <div className="text-[11px] text-text-muted bg-bg-secondary rounded p-2 leading-relaxed">
          接入后会立即触发一次全量同步;PAT 明文存于服务端 user_integrations,
          所有同步动作以 owner(你)身份调 GitLab API。任何团队成员 push 到该分支
          都会通过 webhook 触发增量同步。
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={submitting}
            icon={submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          >
            {submitting ? '接入中…' : '接入'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[12px] text-text-secondary mb-1 block">
        {label}
        {hint && <span className="text-text-muted font-normal ml-1.5">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

// WebhookSecretModal 创建成功后一次性展示 webhook URL + secret 明文。
// 关闭后无法再获取(后端只存 hash);提示 owner 立刻拷给 GitLab UI。
function WebhookSecretModal({
  data,
  onClose,
}: {
  data: CreateGitLabSourceResponse | null;
  onClose: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  // data 切换时 reset
  const [prevData, setPrevData] = useState(data);
  if (data !== prevData) {
    setPrevData(data);
    setAcknowledged(false);
  }

  if (!data) return null;

  // URL 优先用后端给的(基于 server.public_base_url / oauth.issuer 拼,生产环境的真公网 URL)。
  // 后端没配 → fallback 用浏览器当前 origin —— 但这在本地 dev 是 localhost,GitLab 访问不到,
  // 所以下面会加红色警告提示 owner 必须替换为公网域名(ngrok / Cloudflare Tunnel 等)。
  const fromBackend = !!data.webhook_url;
  const webhookURL =
    data.webhook_url ||
    `${window.location.origin}/api/v2/webhooks/gitlab/${data.source.id}`;
  // 如果走的是 fallback 自拼,且 host 是 localhost / 127.x —— 这是本地 dev,GitLab 触不到。
  const isLocalhostFallback =
    !fromBackend &&
    /^https?:\/\/(localhost|127\.|\[::1\])/.test(window.location.origin);

  const copy = (value: string, label: string) => {
    navigator.clipboard.writeText(value).then(
      () => toast('success', `${label} 已复制`),
      () => toast('error', '复制失败,请手动选择'),
    );
  };

  return (
    <Modal open={!!data} onClose={onClose} title="保存 Webhook 配置(只显示一次)" size="lg">
      <div className="space-y-4">
        <div className="text-[12px] text-orange-700 bg-orange-50 border border-orange-100 rounded px-3 py-2 leading-relaxed">
          <strong className="font-medium">⚠ 这是唯一一次显示 webhook secret 的机会</strong>。
          关闭本对话框后无法再次查看(服务端只存 hash)。请立即按下方步骤粘到 GitLab。
        </div>

        {isLocalhostFallback && (
          <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 leading-relaxed">
            <strong className="font-medium">⚠ 检测到本地地址 — GitLab 访问不到 localhost</strong>
            。下方 Webhook URL 是按当前浏览器地址自动拼的占位值,直接粘进 GitLab 会失败。
            请把其中的 host 替换为公网可达地址(ngrok / Cloudflare Tunnel /
            正式部署域名),或者在后端配置
            <code className="font-mono mx-1 px-1 rounded bg-red-100">server.public_base_url</code>
            后由后端直接返完整 URL。
          </div>
        )}

        <CopyField
          label="Webhook URL"
          value={webhookURL}
          onCopy={() => copy(webhookURL, 'URL')}
          mono
        />
        <CopyField
          label="Secret Token"
          value={data.webhook_secret}
          onCopy={() => copy(data.webhook_secret, 'Secret')}
          mono
        />

        <div className="text-[12px] text-text-secondary bg-bg-secondary rounded p-3 space-y-1.5 leading-relaxed">
          <p className="font-medium text-text-primary">在 GitLab 配置 webhook 的步骤:</p>
          <ol className="list-decimal pl-5 space-y-1 text-text-secondary">
            <li>
              打开 GitLab 项目 →{' '}
              <span className="font-mono text-text-primary">Settings → Webhooks</span>
            </li>
            <li>
              <b>URL</b>:粘贴上方 Webhook URL
            </li>
            <li>
              <b>Secret Token</b>:粘贴上方 Secret
            </li>
            <li>
              <b>Trigger</b>:勾选 <span className="font-mono">Push events</span>(其他不要勾)
            </li>
            <li>SSL 验证按部署需要勾选</li>
            <li>保存后可点 GitLab UI 的 "Test → Push events" 立即验证</li>
          </ol>
        </div>

        {data.job_id && (
          <p className="text-[11px] text-text-muted">
            首次全量同步任务已入队(job_id:{' '}
            <span className="font-mono">{data.job_id}</span>),完成后列表会显示已同步状态。
          </p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="cursor-pointer"
            />
            我已保存 secret,可以关闭
          </label>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={onClose}
            disabled={!acknowledged}
            icon={<CheckCircle2 className="h-3 w-3" />}
          >
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CopyField({
  label,
  value,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] text-text-secondary">{label}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline cursor-pointer"
        >
          <Copy className="h-3 w-3" />
          复制
        </button>
      </div>
      <div
        className={clsx(
          'px-3 py-2 text-[12px] rounded-md border border-border-default bg-bg-secondary break-all select-all',
          mono && 'font-mono',
        )}
      >
        {value}
      </div>
    </div>
  );
}

// 占位 export,避免某些 lint 配置抱怨"无 default export"
export default KnowledgeCodeTab;

// 防止 ExternalLink 在被 lucide barrel 重导后被 unused 警报(预留给后续 commit URL 链外链)。
void ExternalLink;
