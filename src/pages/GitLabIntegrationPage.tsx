import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GitBranch,
  CheckCircle2,
  Unplug,
  ExternalLink,
  ArrowLeft,
  KeyRound,
  Settings,
  Trash2,
  DownloadCloud,
  RefreshCw,
  AlertCircle,
  X,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  FolderGit2,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useOrgStore } from '@/store/org';
import { integrationApi } from '@/api/integration';
import { codeApi } from '@/api/code';
import { asyncJobApi, isTerminalStatus } from '@/api/asyncjob';
import { apiCall } from '@/lib/api-helpers';
import { formatTs } from '@/lib/format';
import type {
  AsyncJobResponse,
  CodeRepoSummary,
  CodeSyncFailedItem,
  CodeSyncResult,
  GitLabConfigResponse,
  GitLabStatusResponse,
} from '@/types/api';

/** 后端 PermIntegrationManage 权限点字面量,和 FeishuIntegrationPage 对齐。 */
const PERM_INTEGRATION_MANAGE = 'integration.manage';

/**
 * GitLab 集成详情页。
 *
 * 两层组合:
 *   1. InstanceConfigCard:org 级实例配置(admin 填 base_url),未配置时 user card disable
 *   2. GitLabCard:当前用户贴 PAT 连接 GitLab + 一键同步代码
 *
 * 和飞书的差异:PAT 模式无 OAuth 跳转;同步目标是 code_* 表(repo + 函数级 chunks),不是 documents。
 */
export function GitLabIntegrationPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;

  if (!slug) {
    return (
      <GlassCard>
        <div className="py-8 text-center text-[13px] text-text-muted">请先选择一个组织</div>
      </GlassCard>
    );
  }

  const perms = currentOrg.my_role.permissions ?? [];
  const canManage = perms.includes(PERM_INTEGRATION_MANAGE);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/org/integrations"
          className="inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-accent transition mb-2"
        >
          <ArrowLeft className="h-3 w-3" />
          返回集成列表
        </Link>
        <PageHeader
          title="GitLab"
          subtitle="把 GitLab 仓库中的 Markdown 文档同步到当前组织的 Synapse 知识库"
        />
      </div>
      <GitLabCardGroup slug={slug} canManage={canManage} />
    </div>
  );
}

/**
 * 配置 + 连接两张卡的组合。父组件持 config 状态,子组件按需消费。
 * config 变更(保存 / 删除)触发重新拉一次,让 GitLabCard 立刻感知 instanceConfigured 变化。
 */
function GitLabCardGroup({ slug, canManage }: { slug: string; canManage: boolean }) {
  const [config, setConfig] = useState<GitLabConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configReloadKey, setConfigReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiCall(() => integrationApi.gitlabConfigGet(slug));
      if (cancelled) return;
      setConfig(res);
      setConfigLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug, configReloadKey]);

  const refreshConfig = useCallback(() => {
    setConfigLoading(true);
    setConfigReloadKey((k) => k + 1);
  }, []);

  // reposReloadKey 递增让 SyncedReposCard 重新拉:
  //   - 首次挂载时(key=0)
  //   - 每次同步 job 终态时(GitLabCard 调 onSyncFinished → bump)
  // 不跟 status 的刷新耦合 —— status 只关心当前 user 的连接状态,repo 列表是 org 维度。
  const [reposReloadKey, setReposReloadKey] = useState(0);
  const bumpReposReload = useCallback(() => setReposReloadKey((k) => k + 1), []);

  return (
    <div className="space-y-4">
      <InstanceConfigCard
        slug={slug}
        config={config}
        loading={configLoading}
        canManage={canManage}
        onSaved={refreshConfig}
      />
      <GitLabCard
        slug={slug}
        instanceConfigured={config?.configured === true}
        instanceBaseURL={config?.base_url ?? ''}
        onSyncFinished={bumpReposReload}
      />
      <SyncedReposCard slug={slug} reloadKey={reposReloadKey} />
    </div>
  );
}

function GitLabCard({
  slug,
  instanceConfigured,
  instanceBaseURL,
  onSyncFinished,
}: {
  slug: string;
  instanceConfigured: boolean;
  instanceBaseURL: string;
  /** 一轮 sync job 进入终态时触发,用于通知同页面的"已同步仓库"卡片刷新。 */
  onSyncFinished?: () => void;
}) {
  const [status, setStatus] = useState<GitLabStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 活跃同步任务 —— 存 job_id 触发下面的轮询 effect;job 快照单独存,用于渲染进度/横幅。
  const [syncJobId, setSyncJobId] = useState<number | null>(null);
  const [syncJob, setSyncJob] = useState<AsyncJobResponse | null>(null);
  const [starting, setStarting] = useState(false);

  // 首次挂载 + slug 变 + 用户点刷新 都走这一条 effect,携带 cancelled 守卫防旧结果覆盖新状态。
  // 跨页面恢复:active_sync_job_id 存在 → 立即接上轮询;last_failed / last_partial 存在 → 拉一次详情塞 syncJob state 让横幅常驻。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiCall(() => integrationApi.gitlabStatus(slug));
      if (cancelled) return;
      setStatus(res);
      setLoading(false);
      if (!res) return;
      if (res.active_sync_job_id && syncJobId === null) {
        setSyncJobId(res.active_sync_job_id);
        return;
      }
      // 没活跃任务 → 看最近一次是否需要展示横幅。后端保证 failed / partial 互斥,至多一个非空。
      const lastAttentionId = res.last_failed_sync_job_id ?? res.last_partial_sync_job_id;
      if (lastAttentionId && syncJobId === null) {
        const snapshot = await apiCall(() => asyncJobApi.get(lastAttentionId));
        if (cancelled) return;
        if (snapshot) setSyncJob(snapshot);
      }
    })();
    return () => { cancelled = true; };
    // syncJobId 不进依赖 —— 否则终态时 setSyncJobId(null) 会触发 status 重查形成短路环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, reloadKey]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  // 活跃 job 轮询。每 1.5s 拉一次;进入终态停止 + 终态 toast(全成功)/ 不 toast(有失败,让横幅常驻)。
  useEffect(() => {
    if (syncJobId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const snapshot = await apiCall(() => asyncJobApi.get(syncJobId));
      if (cancelled) return;
      if (!snapshot) {
        // 404 / 网络失败:停止轮询。apiCall 已 toast。
        setSyncJobId(null);
        return;
      }
      setSyncJob(snapshot);
      if (isTerminalStatus(snapshot.status)) {
        if (snapshot.status === 'succeeded') {
          const r = snapshot.result as CodeSyncResult | undefined;
          const filesChanged = r?.files_changed ?? 0;
          const chunksCreated = r?.chunks_created ?? 0;
          const hasFailures = (r?.repos_failed ?? 0) > 0 || (r?.failed_files?.length ?? 0) > 0;
          if (!hasFailures) {
            toast('success', `GitLab 同步完成:${filesChanged} 个文件 / ${chunksCreated} 个代码片段`);
          }
          // 有失败走 PartialSuccessBanner,不 toast。
          refresh(); // 拉回最新 last_sync_at
        }
        // failed 整体挂由 SyncFailureBanner 常驻展示,不 toast。
        onSyncFinished?.(); // 成功/失败都通知父组件刷新"已同步仓库"列表(失败也可能有部分 repo 成功入库)
        setSyncJobId(null);
        return;
      }
      timer = setTimeout(tick, 1500);
    };
    // 立即拉一次,避免用户点按钮后有"空白期"。
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [syncJobId, refresh, onSyncFinished]);

  const disconnect = async () => {
    const ok = await apiCall(() => integrationApi.gitlabDisconnect(slug), { success: '已断开 GitLab' });
    setConfirmDisconnect(false);
    if (ok !== null) refresh();
  };

  const startSync = async () => {
    setStarting(true);
    const res = await apiCall(() => integrationApi.gitlabSync(slug));
    setStarting(false);
    if (!res) return;
    if (res.already_running) {
      toast('success', '同步已在进行中,显示当前进度');
    }
    setSyncJob(null); // 清掉上轮终态,让 UI 从"进行中"起步
    setSyncJobId(res.job_id);
  };

  const syncing = syncJobId !== null;

  return (
    <GlassCard>
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
          <GitBranch className="h-5 w-5 text-accent" strokeWidth={1.6} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[15px] font-medium text-text-primary">GitLab</h3>
            {status?.connected && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                已连接
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-muted mb-3">
            使用 Personal Access Token 连接 GitLab。Token 的权限范围决定了 Synapse 能访问哪些仓库,
            请至少勾选 <code className="px-1 rounded bg-text-primary/[0.06]">read_api</code> 和
            <code className="px-1 rounded bg-text-primary/[0.06]"> read_repository</code> 两个 scope。
          </p>

          {loading ? (
            <p className="text-[12px] text-text-muted">加载中...</p>
          ) : !instanceConfigured ? (
            <div className="text-[12px] text-amber-700 bg-amber-50 rounded px-3 py-2">
              当前组织尚未配置 GitLab 实例地址,管理员需要先在上方"GitLab 实例配置"里填 base_url。
            </div>
          ) : status?.connected ? (
            <ConnectedDetail
              status={status}
              onDisconnect={() => setConfirmDisconnect(true)}
              onRefresh={refresh}
              onSync={startSync}
              onDismissFailure={() => setSyncJob(null)}
              syncing={syncing}
              starting={starting}
              syncJob={syncJob}
            />
          ) : (
            <ConnectForm slug={slug} baseURL={instanceBaseURL} onConnected={refresh} />
          )}
        </div>
      </div>

      <Modal open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="断开 GitLab?">
        <p className="text-[13px] text-text-secondary mb-4">
          断开后 Synapse 将无法再用你的 Token 访问 GitLab。
          为安全起见,建议同时到 GitLab Settings → Access Tokens 手动撤销该 Token。
          已同步进来的代码不受影响。
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>取消</Button>
          <Button variant="danger" onClick={disconnect}>确认断开</Button>
        </div>
      </Modal>
    </GlassCard>
  );
}

/**
 * 从 API base_url(.../api/v4)推导出 PAT 创建页链接。
 * GitLab 用户在 `{host}/-/user_settings/personal_access_tokens` 管理 token,
 * 和 /api/v4 同域但不同路径,所以要剥掉 API 段再拼。
 */
function derivePATUrl(baseURL: string): string {
  if (!baseURL) return 'https://gitlab.com/-/user_settings/personal_access_tokens';
  // 去掉 /api/vN 段(N 是 4 / 3 以备将来)
  const host = baseURL.replace(/\/api\/v\d+\/?$/, '');
  return `${host}/-/user_settings/personal_access_tokens`;
}

function ConnectForm({
  slug,
  baseURL,
  onConnected,
}: {
  slug: string;
  baseURL: string;
  onConnected: () => void;
}) {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const patURL = derivePATUrl(baseURL);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      toast('error', '请先粘贴 Personal Access Token');
      return;
    }
    setSubmitting(true);
    const res = await apiCall(
      () => integrationApi.gitlabConnect(slug, { token: trimmed }),
      { success: '已连接 GitLab' },
    );
    setSubmitting(false);
    if (res) {
      setToken('');
      onConnected();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-[12px] text-text-secondary mb-1">Personal Access Token</label>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
          autoComplete="off"
        />
        <p className="text-[11px] text-text-muted mt-1">
          到
          <a
            href={patURL}
            target="_blank"
            rel="noreferrer"
            className="mx-1 text-accent hover:underline inline-flex items-center gap-0.5"
          >
            GitLab Access Tokens
            <ExternalLink className="h-3 w-3" strokeWidth={1.6} />
          </a>
          创建新的 PAT。
        </p>
      </div>
      <Button
        type="submit"
        disabled={submitting || !token.trim()}
        icon={<KeyRound className="h-3.5 w-3.5" />}
      >
        {submitting ? '验证中...' : '连接 GitLab'}
      </Button>
    </form>
  );
}

function ConnectedDetail({
  status,
  onDisconnect,
  onRefresh,
  onSync,
  onDismissFailure,
  syncing,
  starting,
  syncJob,
}: {
  status: GitLabStatusResponse;
  onDisconnect: () => void;
  onRefresh: () => void;
  onSync: () => void;
  onDismissFailure: () => void;
  syncing: boolean;
  starting: boolean;
  syncJob: AsyncJobResponse | null;
}) {
  // 横幅触发条件(和飞书页对齐):
  //   - failed:整体挂掉(如 PAT 无效 / embed 致命错)→ SyncFailureBanner + 重试
  //   - succeeded + 有 repo/file 失败 → PartialSuccessBanner(琥珀)+ 可展开明细
  const syncResult = syncJob?.result as CodeSyncResult | undefined;
  const showFailure = !syncing && syncJob?.status === 'failed';
  const hasFailures =
    (syncResult?.repos_failed ?? 0) > 0 || (syncResult?.failed_files?.length ?? 0) > 0;
  const showPartial = !syncing && syncJob?.status === 'succeeded' && hasFailures;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {status.avatar_url && (
          <img
            src={status.avatar_url}
            alt={status.username ?? 'avatar'}
            className="h-10 w-10 rounded-full bg-text-primary/[0.04]"
          />
        )}
        <div className="min-w-0">
          <div className="text-[13px] text-text-primary font-medium truncate">
            {status.name ?? status.username}
            {status.username && status.name && status.name !== status.username && (
              <span className="ml-1.5 text-text-muted font-normal">@{status.username}</span>
            )}
          </div>
          {status.email && (
            <div className="text-[12px] text-text-muted truncate">{status.email}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {status.user_id != null && (
          <>
            <span className="text-text-muted">GitLab User ID</span>
            <span className="text-text-secondary">{status.user_id}</span>
          </>
        )}
        {status.connected_at != null && (
          <>
            <span className="text-text-muted">连接时间</span>
            <span className="text-text-secondary">{formatTs(status.connected_at)}</span>
          </>
        )}
        <span className="text-text-muted">上次同步</span>
        <span className="text-text-secondary">
          {status.last_sync_at
            ? formatTs(status.last_sync_at)
            : <span className="text-text-muted">等待首次同步</span>}
        </span>
      </div>

      {status.web_url && (
        <a
          href={status.web_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
        >
          在 GitLab 查看
          <ExternalLink className="h-3 w-3" strokeWidth={1.6} />
        </a>
      )}

      {syncing && <SyncProgress job={syncJob} />}

      {showFailure && syncJob && (
        <SyncFailureBanner
          job={syncJob}
          onRetry={() => { onDismissFailure(); onSync(); }}
          onDismiss={onDismissFailure}
          retryDisabled={starting}
        />
      )}

      {showPartial && syncResult && (
        <PartialSuccessBanner result={syncResult} onDismiss={onDismissFailure} />
      )}

      <div className="pt-2 border-t border-text-primary/[0.06] flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onSync}
          disabled={syncing || starting}
          icon={<DownloadCloud className="h-3 w-3" />}
        >
          {starting ? '启动中...' : syncing ? '同步中...' : '一键同步代码'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onRefresh} icon={<RefreshCw className="h-3 w-3" />}>
          刷新状态
        </Button>
        <Button variant="ghost" size="sm" onClick={onDisconnect} icon={<Unplug className="h-3.5 w-3.5" />} disabled={syncing}>
          断开连接
        </Button>
      </div>
    </div>
  );
}

/**
 * 活跃同步任务的进度展示。
 *
 * 后端走两阶段:
 *  Phase 1:扫描所有 repo + 每个 repo 文件树,算出"要处理的文件总数" → SetTotal
 *  Phase 2:按文件粒度 fetch+embed+persist,每完成一个 Inc(1,0)
 *
 * 所以 ProgressTotal=0 对应 Phase 1(扫描中,文案 "正在扫描...");
 * ProgressTotal>0 对应 Phase 2,进度以文件为单位平滑推进。
 * 未变的文件(blob_sha 同)在 Phase 1 就被排除,不计入 total —— 分母是"实际工作量"。
 */
function SyncProgress({ job }: { job: AsyncJobResponse | null }) {
  if (!job) {
    return (
      <div className="rounded bg-accent/[0.04] px-3 py-2 text-[12px] text-text-muted">
        正在启动同步...
      </div>
    );
  }
  const { progress_total: total, progress_done: done, progress_failed: failed } = job;
  const unknownTotal = total === 0;
  const pct = unknownTotal ? 0 : Math.min(100, Math.round(((done + failed) / total) * 100));

  return (
    <div className="rounded bg-accent/[0.04] px-3 py-2 space-y-1.5">
      <div className="flex justify-between text-[12px]">
        <span className="text-text-secondary">
          {unknownTotal ? '正在扫描 GitLab 仓库与文件列表...' : `已处理 ${done + failed} / ${total} 个文件`}
        </span>
        {!unknownTotal && <span className="text-text-muted">{pct}%</span>}
      </div>
      <div className="h-1 w-full bg-accent/[0.08] rounded overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: unknownTotal ? '25%' : `${pct}%` }}
        />
      </div>
      {failed > 0 && (
        <div className="text-[11px] text-red-500">{failed} 个文件处理失败</div>
      )}
    </div>
  );
}

/**
 * 同步整体失败横幅。常驻直到用户点"重试"或"关闭"。
 *
 * 典型触发:PAT 无效 / embedding 配置错 / PG 不可达。这些都是"需要人工介入"的错,
 * 用横幅(带重试按钮)比一闪而过的 toast 更不易被错过。
 */
function SyncFailureBanner({
  job,
  onRetry,
  onDismiss,
  retryDisabled,
}: {
  job: AsyncJobResponse;
  onRetry: () => void;
  onDismiss: () => void;
  retryDisabled: boolean;
}) {
  const errMsg = job.error?.trim() || '未知错误';
  return (
    <div className="rounded bg-red-50 border border-red-100 px-3 py-2 space-y-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" strokeWidth={2} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-red-700">GitLab 同步失败</div>
          <div className="text-[11px] text-red-600 mt-0.5 break-all">{errMsg}</div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-red-400 hover:text-red-600 transition p-0.5"
          title="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex gap-2 pl-6">
        <Button
          variant="primary"
          size="sm"
          onClick={onRetry}
          disabled={retryDisabled}
          icon={<RefreshCw className="h-3 w-3" />}
        >
          重试同步
        </Button>
      </div>
    </div>
  );
}

/**
 * 部分失败横幅 —— 整体成功但个别 repo / 文件挂。琥珀色(warning)区别于红色 failure。
 *
 * 不给"重试"按钮:下次一键同步会按 (repo_id, path, blob_sha) 自动比对跳过已同步的 + 重试未同步的,
 * 但这里失败的多半是"token 权限不够访问某 project"或"单文件 fetch 临时挂",重跑是否解决看情况,
 * 由用户读明细后自行决定。
 */
function PartialSuccessBanner({
  result,
  onDismiss,
}: {
  result: CodeSyncResult;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const failedRepos = result.failed_repos ?? [];
  const failedFiles = result.failed_files ?? [];
  const totalFailed = failedRepos.length + failedFiles.length;
  const MAX_VISIBLE = 10;

  return (
    <div className="rounded bg-amber-50 border border-amber-100 px-3 py-2 space-y-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" strokeWidth={2} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-amber-700">
            同步完成,但有 {totalFailed} 项失败
          </div>
          <div className="text-[11px] text-amber-600 mt-0.5">
            仓库 {result.repos_synced}/{result.repos_total} 成功 · 文件变更 {result.files_changed}
            {result.files_deleted > 0 && ` · 清理 ${result.files_deleted}`}
            {result.chunks_created > 0 && ` · 生成 ${result.chunks_created} 个代码片段`}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-amber-400 hover:text-amber-600 transition p-0.5"
          title="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="pl-6 space-y-1">
        {totalFailed > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900 transition underline-offset-2 hover:underline"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
              {expanded ? '收起' : '展开'}失败明细 ({totalFailed} 项)
            </button>
            {expanded && (
              <FailedItemList
                repos={failedRepos}
                files={failedFiles}
                maxVisible={MAX_VISIBLE}
              />
            )}
          </>
        ) : (
          <div className="text-[11px] text-amber-700">
            本次任务未记录失败明细 —— 重新同步一次即可看到每项的失败原因。
          </div>
        )}
      </div>
    </div>
  );
}

/** 失败条目展开列表。仓库级和文件级用分隔条分开显示,各自截到 maxVisible 条。 */
function FailedItemList({
  repos,
  files,
  maxVisible,
}: {
  repos: CodeSyncFailedItem[];
  files: CodeSyncFailedItem[];
  maxVisible: number;
}) {
  return (
    <div className="space-y-2 max-h-48 overflow-auto">
      {repos.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-amber-800 uppercase tracking-wide">
            仓库级失败({repos.length})
          </div>
          {repos.slice(0, maxVisible).map((item, i) => (
            <div key={`repo-${item.ref}-${i}`} className="text-[11px] text-amber-800 bg-white/40 rounded px-2 py-1">
              <div className="font-mono truncate" title={item.ref}>{item.ref}</div>
              <div className="text-amber-700 break-all">{item.error}</div>
            </div>
          ))}
          {repos.length > maxVisible && (
            <div className="text-[11px] text-amber-600 pl-2">
              还有 {repos.length - maxVisible} 条仓库级失败未显示
            </div>
          )}
        </div>
      )}
      {files.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-amber-800 uppercase tracking-wide">
            文件级失败({files.length})
          </div>
          {files.slice(0, maxVisible).map((item, i) => (
            <div key={`file-${item.ref}-${i}`} className="text-[11px] text-amber-800 bg-white/40 rounded px-2 py-1">
              <div className="font-mono truncate" title={item.ref}>{item.ref}</div>
              <div className="text-amber-700 break-all">{item.error}</div>
            </div>
          ))}
          {files.length > maxVisible && (
            <div className="text-[11px] text-amber-600 pl-2">
              还有 {files.length - maxVisible} 条文件级失败未显示
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Admin: GitLab instance config card ─────────────────────────────────────

/**
 * GitLab 实例配置卡片(admin 视角)。
 *
 * 状态机和 FeishuIntegrationPage.AppConfigCard 对齐:
 *   - 未配置 + 有权限 → 默认展开表单
 *   - 未配置 + 无权限 → 提示联系管理员
 *   - 已配置 → 展示 base_url + (admin 可修改 / 清除)
 *
 * 和飞书不同:
 *   - 没有 app_secret 这种密钥,base_url 公开,GET 直接回传明文
 *   - 不展示 redirect_uri(PAT 模式无 OAuth 回调)
 */
function InstanceConfigCard({
  slug,
  config,
  loading,
  canManage,
  onSaved,
}: {
  slug: string;
  config: GitLabConfigResponse | null;
  loading: boolean;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [baseURL, setBaseURL] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 未配置且有权限 → 默认展开表单。
  useEffect(() => {
    if (!loading && !config?.configured && canManage) {
      setEditing(true);
    }
  }, [loading, config?.configured, canManage]);

  const startEdit = () => {
    setBaseURL(config?.base_url ?? '');
    setInsecure(config?.insecure_skip_verify ?? false);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setBaseURL('');
    setInsecure(false);
  };

  const save = async () => {
    const trimmed = baseURL.trim();
    if (!trimmed) {
      toast('error', 'base_url 必填');
      return;
    }
    if (!trimmed.includes('/api/v')) {
      toast('error', 'base_url 必须以 /api/v4 结尾(后端强校验)');
      return;
    }
    setSaving(true);
    const res = await apiCall(
      () => integrationApi.gitlabConfigPut(slug, { base_url: trimmed, insecure_skip_verify: insecure }),
      { success: 'GitLab 实例配置已保存' },
    );
    setSaving(false);
    if (res) {
      setEditing(false);
      setBaseURL('');
      setInsecure(false);
      onSaved();
    }
  };

  const doDelete = async () => {
    const res = await apiCall(() => integrationApi.gitlabConfigDelete(slug), { success: '已清除 GitLab 实例配置' });
    setConfirmDelete(false);
    if (res) onSaved();
  };

  return (
    <GlassCard>
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
          <Settings className="h-5 w-5 text-accent" strokeWidth={1.6} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[15px] font-medium text-text-primary">GitLab 实例配置</h3>
            {config?.configured && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                已配置
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-muted mb-3">
            每个组织自己选择要连接的 GitLab 实例(SaaS gitlab.com / 企业自建)。
            base_url 必须以 <code className="px-1 rounded bg-text-primary/[0.06]">/api/v4</code> 结尾,
            例如 <code className="px-1 rounded bg-text-primary/[0.06]">https://gitlab.com/api/v4</code>。
          </p>

          {loading ? (
            <p className="text-[12px] text-text-muted">加载中...</p>
          ) : editing && canManage ? (
            <ConfigEditForm
              baseURL={baseURL}
              setBaseURL={setBaseURL}
              insecure={insecure}
              setInsecure={setInsecure}
              saving={saving}
              onSave={save}
              onCancel={config?.configured ? cancel : undefined}
            />
          ) : (
            <ConfigViewMode
              config={config}
              canManage={canManage}
              onEdit={startEdit}
              onDelete={() => setConfirmDelete(true)}
            />
          )}
        </div>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="清除 GitLab 实例配置?">
        <p className="text-[13px] text-text-secondary mb-4">
          清除后组织成员将无法再用 PAT 连接 / 同步 GitLab。
          已存的 PAT 记录不会自动清除,重新填入 base_url 后可继续使用(前提是原 PAT 仍有效且仍对应同一实例)。
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button>
          <Button variant="danger" onClick={doDelete}>确认清除</Button>
        </div>
      </Modal>
    </GlassCard>
  );
}

function ConfigEditForm({
  baseURL,
  setBaseURL,
  insecure,
  setInsecure,
  saving,
  onSave,
  onCancel,
}: {
  baseURL: string;
  setBaseURL: (v: string) => void;
  insecure: boolean;
  setInsecure: (v: boolean) => void;
  saving: boolean;
  onSave: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="space-y-3">
      <Input
        label="Base URL"
        placeholder="https://gitlab.com/api/v4"
        value={baseURL}
        onChange={(e) => setBaseURL(e.target.value)}
      />
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 accent-accent"
          checked={insecure}
          onChange={(e) => setInsecure(e.target.checked)}
        />
        <span className="text-[12px] text-text-secondary">
          跳过 TLS 证书校验
          <span className="ml-1 text-text-muted text-[11px]">
            (仅在内网自签证书场景启用;公网 / 企业 CA 都不要勾)
          </span>
        </span>
      </label>
      <div className="flex gap-2 pt-1">
        <Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>取消</Button>
        )}
      </div>
    </div>
  );
}

function ConfigViewMode({
  config,
  canManage,
  onEdit,
  onDelete,
}: {
  config: GitLabConfigResponse | null;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!config?.configured) {
    return (
      <div className="space-y-2">
        <div className="text-[12px] text-text-muted">当前组织尚未配置 GitLab 实例。</div>
        {canManage ? (
          <Button variant="primary" size="sm" onClick={onEdit} icon={<Settings className="h-3 w-3" />}>
            立即配置
          </Button>
        ) : (
          <div className="text-[11px] text-text-muted">需要组织管理员配置后才能使用。</div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        <dt className="text-text-muted">Base URL</dt>
        <dd className="text-text-primary font-mono text-[11px] break-all">{config.base_url}</dd>
        <dt className="text-text-muted">TLS 校验</dt>
        <dd className="text-text-primary">
          {config.insecure_skip_verify ? (
            <span className="text-amber-600">已跳过(自签证书模式)</span>
          ) : (
            '正常'
          )}
        </dd>
        {config.updated_at && (
          <>
            <dt className="text-text-muted">更新时间</dt>
            <dd className="text-text-primary">
              {formatTs(config.updated_at, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </dd>
          </>
        )}
      </dl>
      {canManage && (
        <div className="flex gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onEdit} icon={<Settings className="h-3 w-3" />}>
            修改配置
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} icon={<Trash2 className="h-3 w-3" />}>
            清除
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Synced repos card ──────────────────────────────────────────────────────

/**
 * "已同步的仓库"概览卡片。
 *
 * 数据来源:GET /api/v2/orgs/:slug/code/repositories
 *   - 聚合视图,一次 SQL 拿齐 repo + file count + chunk count + failed count
 *   - 任何 org 成员都能看(后端不强制 integration.manage 权限)
 *   - 同步 job 进入终态时父组件 bump reloadKey → 自动重拉
 *
 * UI 取舍:不放代码内容预览、不做 chunk 明细视图 —— 点 path 跳 GitLab 看更合适。
 * 这个卡片只做"有没有同步到 + 量有多少 + 什么时候同步的"三件事。
 */
function SyncedReposCard({ slug, reloadKey }: { slug: string; reloadKey: number }) {
  const [repos, setRepos] = useState<CodeRepoSummary[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await apiCall(() => codeApi.listRepositories(slug));
      if (cancelled) return;
      setRepos(res?.repositories ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug, reloadKey]);

  return (
    <GlassCard>
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
          <FolderGit2 className="h-5 w-5 text-accent" strokeWidth={1.6} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-medium text-text-primary mb-1">已同步的仓库</h3>
          <p className="text-[12px] text-text-muted mb-3">
            当前组织同步进 Synapse 的代码仓库概览。文件数 / 代码片段数反映已索引的量。
          </p>

          {loading ? (
            <p className="text-[12px] text-text-muted">加载中...</p>
          ) : repos && repos.length > 0 ? (
            <RepoTable repos={repos} />
          ) : (
            <p className="text-[12px] text-text-muted">
              还没有仓库同步进来 —— 点上方"一键同步代码"开始。
            </p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

/** 已同步仓库的表格视图。简单 CSS grid,不引表格组件。 */
function RepoTable({ repos }: { repos: CodeRepoSummary[] }) {
  return (
    <div className="text-[12px]">
      <div className="grid grid-cols-[minmax(0,2fr)_auto_auto_auto] gap-x-4 gap-y-1 pb-1.5 mb-1 border-b border-text-primary/[0.06] text-[11px] text-text-muted uppercase tracking-wide">
        <span>仓库</span>
        <span className="text-right">文件</span>
        <span className="text-right">代码片段</span>
        <span className="text-right">上次同步</span>
      </div>
      <div className="divide-y divide-text-primary/[0.04]">
        {repos.map((r) => (
          <RepoRow key={r.id} repo={r} />
        ))}
      </div>
    </div>
  );
}

/** 单行:路径(可跳 GitLab)、默认分支、聚合数字、最近同步时间;失败数 > 0 时标琥珀。 */
function RepoRow({ repo }: { repo: CodeRepoSummary }) {
  const nameCell = repo.web_url ? (
    <a
      href={repo.web_url}
      target="_blank"
      rel="noreferrer"
      className="text-accent hover:underline inline-flex items-center gap-1 min-w-0"
      title={repo.path_with_namespace}
    >
      <span className="truncate">{repo.path_with_namespace}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" strokeWidth={1.6} />
    </a>
  ) : (
    <span className="text-text-primary truncate" title={repo.path_with_namespace}>
      {repo.path_with_namespace}
    </span>
  );

  return (
    <div className="grid grid-cols-[minmax(0,2fr)_auto_auto_auto] gap-x-4 gap-y-0.5 py-1.5 items-center">
      <div className="min-w-0 flex items-center gap-2">
        {nameCell}
        <span className="text-[10px] font-mono text-text-muted bg-text-primary/[0.04] rounded px-1 py-0.5 shrink-0">
          {repo.default_branch}
        </span>
        {repo.archived && (
          <span className="text-[10px] text-amber-700 bg-amber-50 rounded px-1 py-0.5 shrink-0">
            archived
          </span>
        )}
      </div>
      <div className="text-right tabular-nums text-text-secondary">
        {repo.file_count.toLocaleString()}
      </div>
      <div className="text-right tabular-nums">
        <span className="text-text-secondary">{repo.chunk_count.toLocaleString()}</span>
        {repo.failed_chunk_count > 0 && (
          <span
            className="ml-1.5 text-[11px] text-amber-700 bg-amber-50 rounded px-1 py-0.5"
            title={`${repo.failed_chunk_count} 个代码片段索引失败(embed 错误)`}
          >
            {repo.failed_chunk_count} 失败
          </span>
        )}
      </div>
      <div className="text-right text-text-muted">
        {repo.last_synced_at
          ? formatTs(repo.last_synced_at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '—'}
      </div>
    </div>
  );
}
