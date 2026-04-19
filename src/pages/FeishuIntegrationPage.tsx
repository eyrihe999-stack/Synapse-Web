import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Link2,
  CheckCircle2,
  Unplug,
  RefreshCw,
  DownloadCloud,
  Settings,
  Copy,
  Check,
  Trash2,
  AlertCircle,
  X,
  ArrowLeft,
  History,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useOrgStore } from '@/store/org';
import { integrationApi, parseFeishuCallback } from '@/api/integration';
import { asyncJobApi, isTerminalStatus, AsyncJobKinds } from '@/api/asyncjob';
import { apiCall } from '@/lib/api-helpers';
import { formatTs } from '@/lib/format';
import type {
  AsyncJobResponse,
  FeishuConfigResponse,
  FeishuStatusResponse,
  FeishuSyncFailedItem,
  FeishuSyncResult,
} from '@/types/api';

/** 后端 PermIntegrationManage 权限点字面量,和 internal/organization/const.go 对齐。 */
const PERM_INTEGRATION_MANAGE = 'integration.manage';

/**
 * 飞书集成详情页 —— 集成列表 (/org/integrations) 中"飞书 Lark"那张卡片点进来的详情。
 *
 * 这页承担:
 *   - admin 填 / 修改应用凭证
 *   - 成员 OAuth 连接 / 断开自己的飞书账号
 *   - 一键导入 + 进度 / 失败 / 部分失败三类横幅
 *
 * URL 查询参数契约(来自后端 callback handler 的 302 回跳,frontend_redirect_url 指向本页):
 *   ?feishu=success           授权成功
 *   ?feishu=error&reason=xx   授权失败,reason 见下方 REASON_MESSAGES
 * 读到后 toast 一下,然后清掉 query 参数,避免用户刷新页面反复弹 toast。
 */
export function FeishuIntegrationPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const [params, setParams] = useSearchParams();

  // 处理 OAuth 回调结果 toast。只在首次 load 时消费 query 参数,之后清掉。
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    const result = parseFeishuCallback(params.toString());
    if (!result) return;
    consumedRef.current = true;
    if (result.status === 'success') {
      toast('success', '已成功连接飞书账号');
    } else {
      toast('error', `飞书授权失败:${reasonText(result.reason)}`);
    }
    // 清掉 query 防刷新重复弹窗。
    params.delete('feishu');
    params.delete('reason');
    setParams(params, { replace: true });
  }, [params, setParams]);

  if (!slug) {
    return (
      <GlassCard>
        <div className="py-8 text-center text-[13px] text-text-muted">请先选择一个组织</div>
      </GlassCard>
    );
  }

  // 读当前用户在此 org 的权限列表,用来决定是否展示 admin config 编辑能力。
  // 没有权限也能看 config 的只读状态(是否已配置、redirect_uri),否则普通成员连"为什么连不上"都搞不清。
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
          title="飞书 Lark"
          subtitle="把飞书云文档 / 知识库同步到当前组织的 Synapse 知识库"
        />
      </div>
      <FeishuCardGroup slug={slug} canManage={canManage} />
    </div>
  );
}

// ─── Feishu group:admin config card + user OAuth card ────────────────────────

/**
 * 飞书集成的完整区块。由两张卡片组成:
 *   1. AppConfigCard:org 级应用凭证(admin 填)。未配置时 user card disable。
 *   2. FeishuCard:当前用户的 OAuth 授权 + 一键导入。
 *
 * 拆两层:
 *   - 父组件持有 "config 是否已 ready" 状态,避免每张卡各自轮询
 *   - config 变更后(保存 / 删除)刷新 user card 状态(权限可能变化,重新判断可连接性)
 */
function FeishuCardGroup({ slug, canManage }: { slug: string; canManage: boolean }) {
  const [config, setConfig] = useState<FeishuConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configReloadKey, setConfigReloadKey] = useState(0);
  // historyTick 每次同步任务进入终态或手动刷新时 +1 → 让 SyncHistoryCard 重新拉列表。
  // 不用 zustand / context —— 就两层组件,props 链接最直接。
  const [historyTick, setHistoryTick] = useState(0);
  const bumpHistory = useCallback(() => setHistoryTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiCall(() => integrationApi.feishuConfigGet(slug));
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

  return (
    <div className="space-y-4">
      <AppConfigCard
        slug={slug}
        config={config}
        loading={configLoading}
        canManage={canManage}
        onSaved={refreshConfig}
      />
      <FeishuCard
        slug={slug}
        appConfigured={config?.configured === true}
        onSyncFinished={bumpHistory}
      />
      <SyncHistoryCard slug={slug} reloadKey={historyTick} />
    </div>
  );
}

// ─── Feishu card ─────────────────────────────────────────────────────────────

function FeishuCard({
  slug,
  appConfigured,
  onSyncFinished,
}: {
  slug: string;
  appConfigured: boolean;
  onSyncFinished?: () => void;
}) {
  const [status, setStatus] = useState<FeishuStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // reloadKey 用户点"刷新状态"时递增,触发下面 effect 重查;比直接 setState + 异步调用函数
  // 更契合 React 新的 set-state-in-effect 规则(effect 只做外部同步,不走 setState 回环)。
  const [reloadKey, setReloadKey] = useState(0);

  // 活跃同步任务 —— 存 job_id 触发下面的轮询 effect;job 快照单独存,用于渲染进度。
  const [syncJobId, setSyncJobId] = useState<number | null>(null);
  const [syncJob, setSyncJob] = useState<AsyncJobResponse | null>(null);
  const [starting, setStarting] = useState(false);

  // 首次挂载 + slug 变 + 用户点刷新 都走这一条 effect,携带 cancelled 守卫防旧结果覆盖新状态。
  // 还承担两件"跨页面恢复"的活:
  //   - active_sync_job_id 存在 → 立即接上轮询,继续进度条(跨导航 / 刷新不丢)
  //   - last_failed_sync_job_id 存在 → 拉一次 job 详情塞 syncJob state,让失败横幅常驻
  // 只在当前没本地 syncJobId / syncJob 时才接管,避免覆盖用户正进行中的交互。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiCall(() => integrationApi.feishuStatus(slug));
      if (cancelled) return;
      setStatus(res);
      setLoading(false);
      if (!res) return;
      if (res.active_sync_job_id && syncJobId === null) {
        setSyncJobId(res.active_sync_job_id);
        return;
      }
      // 没活跃任务 → 检查最近一次是否需要展示横幅。
      // last_failed_sync_job_id 和 last_partial_sync_job_id 在后端互斥,至多一个非空。
      const lastAttentionId =
        res.last_failed_sync_job_id ?? res.last_partial_sync_job_id;
      if (lastAttentionId && syncJobId === null) {
        const snapshot = await apiCall(() => asyncJobApi.get(lastAttentionId));
        if (cancelled) return;
        if (snapshot) setSyncJob(snapshot);
      }
    })();
    return () => { cancelled = true; };
    // syncJobId 不能进依赖 —— 否则轮询结束 setSyncJobId(null) 会触发 status 重查,
    // 形成"finish → refresh → 如果任务 restart 会立即再接上"的短路环。当前只在 slug/reloadKey
    // 变化时做"是否需要接管"的判断,语义上也够用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, reloadKey]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  // 活跃 job 轮询。每 1.5s 拉一次;进入终态停止 + 终态 toast + 成功时刷新连接状态(last_sync_at)。
  // 2s 以下让用户感觉进度"活着",超过 2s 会明显卡顿。
  useEffect(() => {
    if (syncJobId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const snapshot = await apiCall(() => asyncJobApi.get(syncJobId));
      if (cancelled) return;
      if (!snapshot) {
        // 404/网络失败:停止轮询。apiCall 已 toast。
        setSyncJobId(null);
        return;
      }
      setSyncJob(snapshot);
      if (isTerminalStatus(snapshot.status)) {
        if (snapshot.status === 'succeeded') {
          const r = snapshot.result as FeishuSyncResult | undefined;
          const synced = r?.synced ?? 0;
          const failed = r?.failed ?? 0;
          if (failed === 0) {
            toast('success', `飞书同步完成:导入 ${synced} 条文档`);
          }
          // failed > 0 时不 toast —— 下方 PartialSuccessBanner 会展示明细,
          // toast 一闪而过反而丢信息。
          refresh(); // 拉回最新 last_sync_at
        }
        // failed 场景不 toast —— 会被下面的 SyncFailureBanner 展示为常驻横幅(带重试按钮),
        // 比一闪而过的 toast 更易被看到和处理。
        onSyncFinished?.(); // 通知父组件:SyncHistoryCard 该重新拉一次列表了
        setSyncJobId(null);
        return;
      }
      timer = setTimeout(tick, 1500);
    };
    // 立即拉一次,让用户不会对"点了按钮什么都不动"感到困惑。
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [syncJobId, refresh, onSyncFinished]);

  const connect = async () => {
    setConnecting(true);
    const res = await apiCall(() => integrationApi.feishuConnect(slug));
    if (res?.auth_url) {
      // 完整跳转飞书授权页。不用 window.open 是为了 state/session 一致性更好。
      window.location.href = res.auth_url;
      return; // 不 setConnecting(false),页面马上要被替换了
    }
    setConnecting(false);
  };

  const disconnect = async () => {
    const ok = await apiCall(() => integrationApi.feishuDisconnect(slug), { success: '已断开飞书' });
    setConfirmDisconnect(false);
    if (ok !== null) {
      // apiCall 返 null 是失败(toast 已弹);不 null 视为成功。
      refresh();
    }
  };

  const startSync = async () => {
    setStarting(true);
    const res = await apiCall(() => integrationApi.feishuSync(slug));
    setStarting(false);
    if (!res) return;
    if (res.already_running) {
      toast('success', '同步已在进行中,显示当前进度');
    }
    setSyncJob(null); // 清掉上轮终态,让 UI 从"进行中 0%" 起步
    setSyncJobId(res.job_id);
  };

  const syncing = syncJobId !== null;

  return (
    <GlassCard>
      <div className="flex items-start gap-4">
        {/* Icon / brand */}
        <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
          <Link2 className="h-5 w-5 text-accent" strokeWidth={1.6} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[15px] font-medium text-text-primary">飞书 Lark</h3>
            {status?.connected && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                已连接
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-muted mb-3">
            授权后 Synapse 会以你的身份周期同步飞书云文档 / wiki 到当前组织的知识库。
            权限范围 = 你本人可见的文档,不会越权读取他人私有文档。
          </p>

          {loading ? (
            <p className="text-[12px] text-text-muted">加载中...</p>
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
              appConfigured={appConfigured}
            />
          ) : (
            <Button
              onClick={connect}
              disabled={connecting || !appConfigured}
              icon={<Link2 className="h-3.5 w-3.5" />}
            >
              {connecting ? '跳转中...' : appConfigured ? '连接飞书账号' : '请先配置飞书应用'}
            </Button>
          )}
        </div>
      </div>

      <Modal open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="断开飞书授权?">
        <p className="text-[13px] text-text-secondary mb-4">
          断开后不会删除已同步进来的文档,但停止新增 / 更新。
          重新连接需要再走一次授权流程。
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>取消</Button>
          <Button variant="danger" onClick={disconnect}>确认断开</Button>
        </div>
      </Modal>
    </GlassCard>
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
  appConfigured,
}: {
  status: FeishuStatusResponse;
  onDisconnect: () => void;
  onRefresh: () => void;
  onSync: () => void;
  onDismissFailure: () => void;
  syncing: boolean;
  starting: boolean;
  syncJob: AsyncJobResponse | null;
  appConfigured: boolean;
}) {
  // 轮询结束后 syncJobId 被置 null → syncing=false,但 syncJob 仍保留最后一次快照。
  // 两类横幅都不依赖 toast —— 用户可以慢慢看 + 决定后续动作。
  //   - failed: 整体挂掉(比如 token 过期)→ SyncFailureBanner + 重试按钮
  //   - succeeded + 有部分失败: → PartialSuccessBanner + 可展开失败列表
  const syncResult = syncJob?.result as FeishuSyncResult | undefined;
  const showFailure = !syncing && syncJob?.status === 'failed';
  const showPartial =
    !syncing &&
    syncJob?.status === 'succeeded' &&
    (syncResult?.failed ?? 0) > 0;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        {status.name && (
          <>
            <dt className="text-text-muted">飞书账号</dt>
            <dd className="text-text-primary">
              {status.name}
              {status.email && <span className="text-text-muted ml-2">{status.email}</span>}
            </dd>
          </>
        )}
        {status.open_id && (
          <>
            <dt className="text-text-muted">Open ID</dt>
            <dd className="text-text-primary font-mono text-[11px]">{status.open_id}</dd>
          </>
        )}
        <dt className="text-text-muted">授权时间</dt>
        <dd className="text-text-primary">{formatTs(status.connected_at, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</dd>
        <dt className="text-text-muted">上次同步</dt>
        <dd className="text-text-primary">
          {status.last_sync_at
            ? formatTs(status.last_sync_at, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
            : <span className="text-text-muted">等待首次同步</span>}
        </dd>
      </dl>

      {syncing && <SyncProgress job={syncJob} />}

      {showFailure && syncJob && (
        <SyncFailureBanner
          job={syncJob}
          onRetry={() => { onDismissFailure(); onSync(); }}
          onDismiss={onDismissFailure}
          retryDisabled={starting || !appConfigured}
        />
      )}

      {showPartial && syncResult && (
        <PartialSuccessBanner
          result={syncResult}
          onDismiss={onDismissFailure}
        />
      )}

      {!appConfigured && (
        <div className="text-[11px] text-amber-600 bg-amber-50 px-2 py-1 rounded">
          组织的飞书应用凭证已被清除,导入不可用。请联系管理员重新配置。
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          variant="primary"
          size="sm"
          onClick={onSync}
          disabled={syncing || starting || !appConfigured}
          icon={<DownloadCloud className="h-3 w-3" />}
        >
          {starting ? '启动中...' : syncing ? '同步中...' : '一键导入飞书文档'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onRefresh} icon={<RefreshCw className="h-3 w-3" />}>
          刷新状态
        </Button>
        <Button variant="ghost" size="sm" onClick={onDisconnect} icon={<Unplug className="h-3 w-3" />} disabled={syncing}>
          断开授权
        </Button>
      </div>
    </div>
  );
}

/**
 * 同步失败横幅。常驻在 ConnectedDetail 里,直到用户点"重试"或"关闭"。
 *
 * 设计取舍:
 *   - 为什么不用 toast:飞书同步可能 token 过期 / 网络抖 / App 凭证错配 —— 都需要用户做动作,
 *     transient toast 消息会错过。横幅提供"显式读错误 + 一键重试"的稳态。
 *   - 为什么不展示 progress_done/total:任务已终结,部分成功结果已通过 docsvc.Upload 的 dedup+
 *     source_ref upsert 安全落库,下次 sync 会自动跳过 —— 用户关心"为啥挂 + 怎么办"即可。
 *
 * 跨页面跳转不持久:syncJob 只存在 React state 里。用户离开页面再回来,横幅消失(已在后端落库,
 * 想复查得去审计日志 / async_jobs 表)。当前不值得为此改 FeishuStatus 回带最新 failed job。
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
          <div className="text-[12px] font-medium text-red-700">飞书同步失败</div>
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
 * 部分失败横幅。整体 sync 成功但个别文件导入挂掉时展示。
 *
 * 和 SyncFailureBanner 的差异:
 *   - 颜色:琥珀(warning)vs 红(error)
 *   - 不给"重试"按钮:下次一键导入会自动按 (source_ref + content_hash) upsert,重跑无害;
 *     但这里的"失败"不是 sync 层面的可重试错误(比如某份文档内容违规、权限不符),重试也白搭
 *   - 支持展开失败明细:title(有则展示)+ 错误原因
 */
function PartialSuccessBanner({
  result,
  onDismiss,
}: {
  result: FeishuSyncResult;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = result.failed_items ?? [];
  const MAX_VISIBLE = 10; // 极端情况(全组织上百份文档全挂)不把 UI 撑死

  return (
    <div className="rounded bg-amber-50 border border-amber-100 px-3 py-2 space-y-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" strokeWidth={2} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-amber-700">
            同步完成,但有 {result.failed} 条文档处理失败
          </div>
          <div className="text-[11px] text-amber-600 mt-0.5">
            成功 {result.synced} 条 / 失败 {result.failed} 条 / 总计 {result.total} 条
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
        {items.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-amber-700 hover:text-amber-900 transition underline-offset-2 hover:underline"
            >
              {expanded ? '收起' : '展开'}失败明细 ({items.length} 条)
            </button>
            {expanded && <FailedItemList items={items} maxVisible={MAX_VISIBLE} />}
          </>
        ) : (
          // failed > 0 但 items 为空 —— 通常是旧版本产出的任务(schema 还是 failed_refs);
          // 或者 runner 崩得太早还没来得及填明细。给用户一个明确信号别让他们对着数字发呆。
          <div className="text-[11px] text-amber-700">
            本次任务未记录失败明细(可能是早于本版本生成的任务)—— 重新同步一次即可看到每条的失败原因。
          </div>
        )}
      </div>
    </div>
  );
}

function FailedItemList({
  items,
  maxVisible,
}: {
  items: FeishuSyncFailedItem[];
  maxVisible: number;
}) {
  const visible = items.slice(0, maxVisible);
  const rest = items.length - visible.length;
  return (
    <div className="space-y-1 max-h-48 overflow-auto">
      {visible.map((item, i) => (
        <div key={`${item.ref}-${i}`} className="text-[11px] text-amber-800 bg-white/40 rounded px-2 py-1">
          <div className="font-medium truncate" title={item.title || item.ref}>
            {item.title || <span className="font-mono">{item.ref}</span>}
          </div>
          <div className="text-amber-700 break-all">{item.error}</div>
        </div>
      ))}
      {rest > 0 && (
        <div className="text-[11px] text-amber-600 pl-2">
          还有 {rest} 条未显示 —— 完整列表请看服务器日志
        </div>
      )}
    </div>
  );
}

// ─── Sync history card ──────────────────────────────────────────────────────

/**
 * 同步历史卡片。展示当前用户最近 N 次飞书同步任务。
 *
 * 数据来源:GET /api/v2/async-jobs?kind=integration.sync.feishu&limit=10
 * 每次新 sync 终态 → parent bump reloadKey → 本卡片重新拉列表。
 *
 * 每一行可展开看明细:
 *   - succeeded 且有失败条目 → 失败列表(复用 FailedItemList)
 *   - failed 整体挂 → 错误消息
 *   - 完美 succeeded / 其他状态 → 无展开
 */
function SyncHistoryCard({ slug: _slug, reloadKey }: { slug: string; reloadKey: number }) {
  const [jobs, setJobs] = useState<AsyncJobResponse[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await apiCall(() =>
        asyncJobApi.list(AsyncJobKinds.FeishuSync, 10),
      );
      if (cancelled) return;
      setJobs(res?.jobs ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  return (
    <GlassCard>
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
          <History className="h-5 w-5 text-accent" strokeWidth={1.6} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-medium text-text-primary mb-1">同步历史</h3>
          <p className="text-[12px] text-text-muted mb-3">
            最近 10 次飞书同步任务的状态与错误。点击展开看失败文档的明细。
          </p>
          {loading ? (
            <p className="text-[12px] text-text-muted">加载中...</p>
          ) : jobs && jobs.length > 0 ? (
            <div className="divide-y divide-border-default/40 -mx-2">
              {jobs.map((job) => (
                <SyncHistoryRow key={job.id} job={job} />
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-text-muted">还没有同步记录。</p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

/**
 * 单条历史记录行。折叠状态下显示一行概览;点击展开出失败明细或错误消息。
 */
function SyncHistoryRow({ job }: { job: AsyncJobResponse }) {
  const [expanded, setExpanded] = useState(false);
  const result = job.result as FeishuSyncResult | undefined;
  const synced = result?.synced ?? 0;
  const failed = result?.failed ?? job.progress_failed ?? 0;
  const total = result?.total ?? job.progress_total ?? 0;

  // 可展开的两种场景:
  //   1. succeeded + 有失败条目 → 展示 failed_items
  //   2. failed(整体挂)→ 展示 job.error
  const hasFailureDetails =
    (job.status === 'succeeded' && failed > 0) ||
    (job.status === 'failed' && !!job.error);

  // 用 finished_at 优先,退回 created_at(崩掉的任务 finished_at 可能为空)。
  const ts = job.finished_at ?? job.created_at;

  return (
    <div className="px-2">
      <button
        type="button"
        onClick={() => hasFailureDetails && setExpanded((v) => !v)}
        disabled={!hasFailureDetails}
        className={`w-full flex items-center gap-2 py-2 text-left ${
          hasFailureDetails ? 'hover:bg-accent/[0.04] cursor-pointer' : 'cursor-default'
        } transition rounded`}
      >
        <HistoryStatusBadge status={job.status} failed={failed} />
        <div className="flex-1 min-w-0 text-[12px]">
          <div className="text-text-primary">
            {formatTs(ts, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {job.status === 'succeeded' && (
              <span className="text-text-muted ml-2">
                导入 {synced} · 失败 {failed} · 总计 {total}
              </span>
            )}
            {job.status === 'failed' && (
              <span className="text-red-500 ml-2 truncate inline-block max-w-md align-bottom">
                {job.error || '未知错误'}
              </span>
            )}
            {job.status === 'running' && (
              <span className="text-text-muted ml-2">进行中 {job.progress_done} / {job.progress_total || '?'}</span>
            )}
          </div>
        </div>
        {hasFailureDetails && (
          expanded ? <ChevronDown className="h-3.5 w-3.5 text-text-muted" /> : <ChevronRightIcon className="h-3.5 w-3.5 text-text-muted" />
        )}
      </button>
      {expanded && hasFailureDetails && (
        <div className="pb-2 pl-6 pr-2">
          {job.status === 'failed' ? (
            <div className="rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700 break-all">
              {job.error}
            </div>
          ) : result?.failed_items && result.failed_items.length > 0 ? (
            <FailedItemList items={result.failed_items} maxVisible={15} />
          ) : (
            <div className="text-[11px] text-text-muted">本次任务未记录失败明细。</div>
          )}
        </div>
      )}
    </div>
  );
}

/** 历史行的状态小圆点 —— 只画颜色不写文字,文字展示由行本身承担。 */
function HistoryStatusBadge({ status, failed }: { status: AsyncJobResponse['status']; failed: number }) {
  const colors: Record<AsyncJobResponse['status'], string> = {
    queued: 'bg-text-muted',
    running: 'bg-accent',
    succeeded: failed > 0 ? 'bg-amber-500' : 'bg-emerald-500',
    failed: 'bg-red-500',
    canceled: 'bg-text-muted',
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${colors[status]}`}
      aria-label={status}
    />
  );
}

/**
 * 活跃同步任务的进度展示。
 * - ProgressTotal = 0 表示 Adapter.Sync 还没扫完,未知总量 → 显示"扫描中"
 * - 总量 > 0 时:进度条 + "已导入 X / Y" 文案;失败非 0 时追加红色提示
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
          {unknownTotal ? '正在扫描飞书文档列表...' : `已处理 ${done + failed} / ${total}`}
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
        <div className="text-[11px] text-red-500">{failed} 条文档处理失败</div>
      )}
    </div>
  );
}

// ─── Admin config card ───────────────────────────────────────────────────────

/**
 * 飞书应用凭证配置卡片(admin 视角)。
 *
 * 四种状态:
 *   - 加载中 → 骨架
 *   - 未配置 + 有 manage 权限 → 展开表单,提示"填 app_id/secret 并把 redirect_uri 加到飞书白名单"
 *   - 未配置 + 无权限 → 空态 + 提示"联系组织管理员配置"
 *   - 已配置 → 展示 app_id + redirect_uri + (admin 可编辑/清除)
 */
function AppConfigCard({
  slug,
  config,
  loading,
  canManage,
  onSaved,
}: {
  slug: string;
  config: FeishuConfigResponse | null;
  loading: boolean;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 未配置且有权限 → 默认展开表单,减少点击成本。
  useEffect(() => {
    if (!loading && !config?.configured && canManage) {
      setEditing(true);
    }
  }, [loading, config?.configured, canManage]);

  const startEdit = () => {
    setAppId(config?.app_id ?? '');
    setAppSecret('');
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setAppId('');
    setAppSecret('');
  };

  const save = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      toast('error', 'App ID 与 App Secret 均为必填');
      return;
    }
    setSaving(true);
    const res = await apiCall(
      () => integrationApi.feishuConfigPut(slug, { app_id: appId.trim(), app_secret: appSecret.trim() }),
      { success: '飞书应用凭证已保存' },
    );
    setSaving(false);
    if (res) {
      setEditing(false);
      setAppId('');
      setAppSecret('');
      onSaved();
    }
  };

  const doDelete = async () => {
    const res = await apiCall(() => integrationApi.feishuConfigDelete(slug), { success: '已清除飞书应用凭证' });
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
            <h3 className="text-[15px] font-medium text-text-primary">飞书应用凭证</h3>
            {config?.configured && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                已配置
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-muted mb-3">
            每个组织需要自己在飞书开放平台创建自建应用,把 App ID / App Secret 填在这里,
            并把下方的回调地址添加到飞书开发者后台的"安全配置 → 重定向 URL"白名单。
          </p>

          {loading ? (
            <p className="text-[12px] text-text-muted">加载中...</p>
          ) : editing && canManage ? (
            <ConfigEditForm
              appId={appId}
              setAppId={setAppId}
              appSecret={appSecret}
              setAppSecret={setAppSecret}
              redirectURI={config?.redirect_uri ?? ''}
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

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="清除飞书应用凭证?">
        <p className="text-[13px] text-text-secondary mb-4">
          清除后组织成员将无法连接/同步飞书。已经授权的用户的 refresh_token 不会清除,
          重新填入相同的 App ID 即可继续使用;填入不同的 App 需要所有成员重新授权。
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
  appId,
  setAppId,
  appSecret,
  setAppSecret,
  redirectURI,
  saving,
  onSave,
  onCancel,
}: {
  appId: string;
  setAppId: (v: string) => void;
  appSecret: string;
  setAppSecret: (v: string) => void;
  redirectURI: string;
  saving: boolean;
  onSave: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="space-y-3">
      <Input
        label="App ID"
        placeholder="cli_xxxxxxxxxxxxxxxx"
        value={appId}
        onChange={(e) => setAppId(e.target.value)}
      />
      <Input
        label="App Secret"
        type="password"
        placeholder="填入后保存;后端不回显,需要改动时请重新填写"
        value={appSecret}
        onChange={(e) => setAppSecret(e.target.value)}
        autoComplete="new-password"
      />
      {redirectURI && (
        <div>
          <div className="text-[12px] font-medium text-text-secondary mb-1">回调地址</div>
          <RedirectURIRow uri={redirectURI} />
          <p className="text-[11px] text-text-muted mt-1">
            复制此 URL 到飞书开放平台 → 应用详情 → 安全设置 → 重定向 URL 白名单。
          </p>
        </div>
      )}
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
  config: FeishuConfigResponse | null;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!config?.configured) {
    return (
      <div className="space-y-2">
        <div className="text-[12px] text-text-muted">当前组织尚未配置飞书应用。</div>
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
        <dt className="text-text-muted">App ID</dt>
        <dd className="text-text-primary font-mono text-[11px]">{config.app_id}</dd>
        <dt className="text-text-muted">回调地址</dt>
        <dd><RedirectURIRow uri={config.redirect_uri} /></dd>
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
            修改凭证
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} icon={<Trash2 className="h-3 w-3" />}>
            清除
          </Button>
        </div>
      )}
    </div>
  );
}

/** 可复制的 redirect_uri 行:突出展示 + 一键复制(设置到飞书白名单要用)。 */
function RedirectURIRow({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('error', '复制失败,请手动选中 URL');
    }
  };
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 truncate text-[11px] bg-accent/[0.04] px-2 py-1 rounded font-mono text-text-primary">
        {uri}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 text-text-muted hover:text-accent transition p-1"
        title="复制"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * OAuth 失败 reason 码 → 中文 toast 文案。
 * 后端 reason 取值见 internal/integration/handler/handler.go 里的 finishCallback 调用点。
 */
const REASON_MESSAGES: Record<string, string> = {
  missing_params: '回调参数缺失',
  invalid_state: '授权凭证无效',
  state_expired: '授权链接已过期,请重新点击连接',
  exchange_failed: '与飞书交换令牌失败',
};

function reasonText(reason?: string): string {
  if (!reason) return '未知原因';
  return REASON_MESSAGES[reason] ?? reason;
}
