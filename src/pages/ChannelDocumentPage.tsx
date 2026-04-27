// ChannelDocumentPage 共享文档(PR #9')详情 + 编辑独立页。
//
// 路由:/org/channels/:id/documents/:doc_id
//
// 状态机:
//   - view 态(默认)        :可看不可改;"开始编辑"按钮触发 acquire_lock
//   - edit 态(持锁)         :可改;每 60s 心跳;"保存" + "完成编辑" 按钮
//   - locked-by-other 态     :显示"X 编辑中,Y:ZZ 过期";owner 可强制解锁
//   - archived 态            :全 read-only;隐藏所有写按钮
//
// 自动行为:
//   - 进入 edit 态后启 setInterval(60_000) 心跳;失败提示"锁丢失"并退回 view
//   - 卸载页面 / cleanup:持锁则 best-effort release(避免按 Tab 关闭后锁占满 10min)
//   - 同一窗口刷新页面:beforeunload 也尝试 release(navigator.sendBeacon 兜底)
//
// 不做(MVP):
//   - 实时多人光标 / OT
//   - 跨终端锁继承
//   - 编辑器内的 find/replace 高级功能
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, FileText, Edit3, Save, CheckCircle2, Lock, Unlock, History,
  Trash2, AlertTriangle, RefreshCw, Hash, Eye,
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// rehype-raw / @shikijs/rehype 暂下线 —— 之前一接入页面就白屏(浏览器 console 报错未确认)。
// 恢复 minimal 渲染先让页面能用,后续单独排查后再开。
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { ChannelDocumentEditor } from '@/components/channel/ChannelDocumentEditor';
import { useChannelAttachmentUpload } from '@/hooks/useChannelAttachmentUpload';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { AuthImage } from '@/components/ui/AuthImage';
import { channelApi } from '@/api/channel';
import { useAuthStore } from '@/store/auth';
import { useOrgPrincipals } from '@/hooks/useOrgPrincipals';
import { useOrgStore } from '@/store/org';
import { apiCall } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import { loadDraft, saveDraft, clearDraft } from '@/lib/channel-doc-draft';
import type {
  ChannelDocumentResponse,
  ChannelDocumentVersionResponse,
  ChannelMemberResponse,
} from '@/types/api';

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

type Mode = 'view' | 'edit';

export function ChannelDocumentPage() {
  const { id, doc_id } = useParams<{ id: string; doc_id: string }>();
  const channelId = id ? Number(id) : 0;
  const docId = doc_id ? Number(doc_id) : 0;
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const { byPrincipalID } = useOrgPrincipals(currentOrg?.org.slug);
  const myPrincipalId = me ? Number(me.principal_id) : 0;

  // ── 远程数据 ──
  const [doc, setDoc] = useState<ChannelDocumentResponse | null>(null);
  const [members, setMembers] = useState<ChannelMemberResponse[]>([]);
  const [archived, setArchived] = useState(false);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState(''); // 用于 dirty 检测
  const [loading, setLoading] = useState(false);

  // ── 编辑状态机 ──
  const [mode, setMode] = useState<Mode>('view');
  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [editSummary, setEditSummary] = useState('');
  const [showVersions, setShowVersions] = useState(false);

  // ── 图片粘贴 / 拖拽上传(只在 md 编辑态启用)──
  const { uploadImage } = useChannelAttachmentUpload(channelId);

  // ── 预览侧 debounce ──
  // 编辑时每键一次 setContent 会触发整个 ReactMarkdown 子树重 parse + render,
  // 长文档 / 含 <AuthImage> 时表现为"闪烁"。debounce 让用户停顿 ~250ms 才刷新预览,
  // 编辑器侧仍即时响应不受影响。
  const debouncedContent = useDebouncedValue(content, 250);

  // 心跳 interval ref;cleanup 时清
  const heartbeatRef = useRef<number | null>(null);
  // 持锁标志(给 beforeunload / cleanup 用,避免依赖 doc.lock 异步快照)
  const heldLockRef = useRef(false);

  // ── 数据加载 ──

  const fetchDoc = useCallback(async () => {
    if (!channelId || !docId) return;
    setLoading(true);
    const [docRes, contentRes, channelRes] = await Promise.all([
      apiCall(() => channelApi.getDocument(channelId, docId)),
      apiCall(() => channelApi.getDocumentContent(channelId, docId)),
      apiCall(() => channelApi.get(channelId)),
    ]);
    setLoading(false);

    if (docRes.ok && docRes.data) setDoc(docRes.data);
    if (channelRes.ok && channelRes.data) {
      setArchived(channelRes.data.status === 'archived');
    }
    if (contentRes.ok && contentRes.data) {
      const serverContent = contentRes.data.content;
      const serverVersion = (docRes.ok ? docRes.data?.current_version : '') ?? '';
      // 草稿恢复:baseVersion 匹配则用本地草稿;不匹配则丢弃
      const draft = myPrincipalId ? loadDraft(docId, myPrincipalId) : null;
      if (draft && draft.baseVersion === serverVersion && draft.content !== serverContent) {
        setContent(draft.content);
        setOriginalContent(serverContent); // dirty 检测仍以服务器版为基准
        const ts = new Date(draft.updatedAt);
        const hh = String(ts.getHours()).padStart(2, '0');
        const mm = String(ts.getMinutes()).padStart(2, '0');
        toast('success', `已恢复 ${hh}:${mm} 的未保存改动`);
      } else {
        if (draft && draft.baseVersion !== serverVersion) {
          // 服务器版本变了 —— 丢弃旧草稿,避免悄悄覆盖别人的改动
          clearDraft(docId, myPrincipalId);
          toast('error', '服务器有新版,本地草稿已丢弃');
        }
        setContent(serverContent);
        setOriginalContent(serverContent);
      }
    }
  }, [channelId, docId, myPrincipalId]);

  const fetchMembers = useCallback(async () => {
    if (!channelId) return;
    const res = await apiCall(() => channelApi.listMembers(channelId));
    if (res.ok) setMembers(res.data ?? []);
  }, [channelId]);

  useEffect(() => {
    fetchDoc();
    fetchMembers();
  }, [fetchDoc, fetchMembers]);

  // ── 角色判定 ──

  const myRole = useMemo(() => {
    if (!myPrincipalId) return null;
    return members.find((m) => m.principal_id === myPrincipalId)?.role ?? null;
  }, [members, myPrincipalId]);

  const isChannelOwner = myRole === 'owner';
  const isMember = myRole !== null;
  const canDelete = isChannelOwner || (doc?.created_by_principal_id === myPrincipalId);

  // ── 锁状态推导 ──

  const lock = doc?.lock;
  const now = useNowTick(mode === 'edit' || (lock != null)); // 仅有锁/编辑时 tick
  const lockExpiresMs = lock ? new Date(lock.expires_at).getTime() : 0;
  const lockExpired = lock ? lockExpiresMs <= now : true;
  const lockHeldByMe = lock != null && lock.held_by_principal_id === myPrincipalId && !lockExpired;
  const lockHeldByOther = lock != null && lock.held_by_principal_id !== myPrincipalId && !lockExpired;
  const dirty = mode === 'edit' && content !== originalContent;

  // ── 草稿节流写 ──
  // 用户在编辑态、内容真有改动 → 1s 节流写 localStorage;
  // 浏览器意外刷新 / 关闭 / 切窗后回来,fetchDoc 会按 baseVersion 校验后恢复。
  useEffect(() => {
    if (!dirty || !doc || !myPrincipalId) return;
    const handle = window.setTimeout(() => {
      saveDraft(doc.id, myPrincipalId, {
        baseVersion: doc.current_version || '',
        content,
        updatedAt: Date.now(),
      });
    }, 1000);
    return () => window.clearTimeout(handle);
  }, [dirty, content, doc, myPrincipalId]);

  // ── 心跳 ──

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatRef.current = window.setInterval(async () => {
      const res = await apiCall(() => channelApi.heartbeatDocumentLock(channelId, docId));
      if (!res.ok) {
        // 锁丢失:停心跳 + 退编辑态 + 提示
        stopHeartbeat();
        heldLockRef.current = false;
        setMode('view');
        toast('error', '锁已失效,请重新进入编辑');
        fetchDoc();
        return;
      }
      // 心跳成功 —— 把新 expires_at 写回,LockBar 倒计时才会跟着滑动
      if (res.data?.lock) {
        const newLock = res.data.lock;
        setDoc((d) => (d ? { ...d, lock: newLock } : d));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, [channelId, docId, stopHeartbeat, fetchDoc]);

  // ── 锁操作 ──

  const acquireLock = async () => {
    const res = await apiCall(() => channelApi.acquireDocumentLock(channelId, docId));
    if (!res.ok || !res.data) return;
    if (res.data.lock.acquired) {
      heldLockRef.current = true;
      setDoc((d) => (d ? { ...d, lock: res.data!.lock } : d));
      setMode('edit');
      startHeartbeat();
      toast('success', '已获得编辑锁,记得完成后释放');
    } else {
      // 别人持锁,展示
      const holderName = byPrincipalID.get(res.data.lock.held_by_principal_id)?.displayName
        || `principal#${res.data.lock.held_by_principal_id}`;
      toast('error', `${holderName} 正在编辑,无法获得锁`);
      setDoc((d) => (d ? { ...d, lock: res.data!.lock } : d));
    }
  };

  const releaseLock = useCallback(async (silent: boolean) => {
    stopHeartbeat();
    heldLockRef.current = false;
    const res = await apiCall(() => channelApi.releaseDocumentLock(channelId, docId));
    if (res.ok && !silent) toast('success', '已释放编辑锁');
    setMode('view');
    // 释放锁 = 用户显式放弃编辑权;同时清掉本地草稿,避免下次进来恢复出"我已经放弃"的内容
    if (myPrincipalId) clearDraft(docId, myPrincipalId);
    if (!silent) fetchDoc();
  }, [channelId, docId, stopHeartbeat, fetchDoc, myPrincipalId]);

  const forceReleaseLock = async () => {
    const holder = lock ? byPrincipalID.get(lock.held_by_principal_id)?.displayName : '当前持锁人';
    if (!confirm(`强制解锁?\n${holder} 的未保存改动会丢失。`)) return;
    const res = await apiCall(
      () => channelApi.forceReleaseDocumentLock(channelId, docId),
      { success: '已强制解锁' },
    );
    if (res.ok) fetchDoc();
  };

  // ── 保存 ──

  const openSaveModal = () => {
    if (!dirty) {
      toast('success', '内容未改动');
      return;
    }
    setEditSummary('');
    setShowSaveModal(true);
  };

  const submitSave = async () => {
    setSaving(true);
    const res = await apiCall(() =>
      channelApi.saveDocumentVersion(channelId, docId, {
        content,
        edit_summary: editSummary.trim() || undefined,
      }),
    );
    setSaving(false);
    setShowSaveModal(false);
    if (!res.ok || !res.data) return;
    if (!res.data.created) {
      // 同 hash 已有,后端短路返已存在版本。前端把 originalContent 同步成当前 content,
      // 让 dirty 回 false / 保存按钮变灰 / 草稿清掉 —— UX 自洽,不再误导用户重复点。
      toast('success', `内容已存在(v${res.data.version.version.slice(0, 7)}),未生成新版`);
      setOriginalContent(content);
      if (myPrincipalId) clearDraft(docId, myPrincipalId);
      return;
    }
    toast('success', `已保存 v${res.data.version.version.slice(0, 7)}`);
    setOriginalContent(content);
    // 保存成功 = 内容已落服务器,清掉本地草稿
    if (myPrincipalId) clearDraft(docId, myPrincipalId);
    // 刷新 doc(current_version 等已更新);保留编辑态(用户可能继续改)
    setDoc((d) => (d ? { ...d, ...res.data!.document, lock: d.lock } : d));
  };

  // ── 删除 ──

  const deleteDoc = async () => {
    if (!doc) return;
    if (!confirm(`删除共享文档「${doc.title}」?\n版本历史会保留作审计,但列表里看不到了。`)) return;
    const res = await apiCall(
      () => channelApi.deleteDocument(channelId, docId),
      { success: '已删除' },
    );
    if (res.ok) navigate(`/org/channels/${channelId}?tab=documents`);
  };

  // ── cleanup:只停心跳,不主动 release ──
  //
  // 锁所有权完全靠"完成编辑"按钮显式释放;路由切换 / F5 / 关 tab 都不动锁,
  // 让 TTL 10min 自然过期。这样语义干净:用户去看参考资料 → 回来续锁继续编辑;
  // 暴力关页面 → 别人 ≤10min 后能抢/owner 立即强制解锁。
  useEffect(() => {
    return () => {
      stopHeartbeat();
    };
  }, [stopHeartbeat]);

  // ── 渲染 ──

  if (!channelId || !docId) {
    return <div className="p-6 text-center text-text-muted">无效的文档链接</div>;
  }

  if (loading && !doc) {
    return (
      <div className="p-6">
        <div className="h-6 bg-[#eeede8] rounded w-1/3 animate-pulse mb-3" />
        <div className="h-4 bg-[#eeede8] rounded w-2/3 animate-pulse" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="p-6 text-center text-text-muted">
        <FileText className="mx-auto h-8 w-8 mb-2" strokeWidth={1.5} />
        <p className="text-[13px]">无法加载此文档(已删除或无权限)</p>
        <Button
          variant="ghost"
          onClick={() => navigate(`/org/channels/${channelId}?tab=documents`)}
          className="mt-3"
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
        >
          返回 channel
        </Button>
      </div>
    );
  }

  const updatedByName = byPrincipalID.get(doc.updated_by_principal_id)?.displayName
    || `principal#${doc.updated_by_principal_id}`;
  const lockHolderName = lock
    ? byPrincipalID.get(lock.held_by_principal_id)?.displayName
      || `principal#${lock.held_by_principal_id}`
    : null;

  return (
    // 整页放宽:大屏不再被 max-w-7xl(1280px)居中收窄,改成 1800px 上限,
    // 配合下面 view 模式全宽预览,大屏左右终于不留白。
    <div className="p-6 space-y-3 max-w-[1800px] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <button
            onClick={() => navigate(`/org/channels/${channelId}?tab=documents`)}
            className="mt-1 p-1 text-text-muted hover:text-[#2383e2] rounded"
            title="返回 channel"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <FileText className="w-5 h-5 text-[#2383e2] mt-0.5 shrink-0" strokeWidth={1.8} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-text-primary truncate">{doc.title}</h2>
              <span className="text-[11px] text-text-muted font-mono">#{doc.id}</span>
              <StatusChip tone="neutral">
                {doc.content_kind === 'md' ? 'Markdown' : '纯文本'}
              </StatusChip>
              {doc.current_version && (
                <span className="text-[11px] text-text-muted font-mono flex items-center gap-0.5">
                  <Hash className="w-3 h-3" />
                  {doc.current_version.slice(0, 7)}
                </span>
              )}
              {archived && <StatusChip tone="neutral">channel 已归档</StatusChip>}
              {dirty && <StatusChip tone="amber">未保存</StatusChip>}
            </div>
            <p className="text-[11px] text-text-muted mt-0.5">
              {updatedByName} 更新于{' '}
              {formatRelativeWithAbsSeconds(Math.floor(new Date(doc.updated_at).getTime() / 1000))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={fetchDoc}
            title="刷新"
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<History className="w-3.5 h-3.5" />}
            onClick={() => setShowVersions(true)}
          >
            历史
          </Button>
          {canDelete && !archived && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={deleteDoc}
            >
              删除
            </Button>
          )}
        </div>
      </div>

      {/* LockBar */}
      <LockBar
        archived={archived}
        isMember={isMember}
        isChannelOwner={isChannelOwner}
        mode={mode}
        lock={lock}
        lockExpired={lockExpired}
        lockHeldByMe={lockHeldByMe}
        lockHeldByOther={lockHeldByOther}
        lockHolderName={lockHolderName}
        now={now}
        dirty={dirty}
        saving={saving}
        onAcquire={acquireLock}
        onSave={openSaveModal}
        onRelease={() => releaseLock(false)}
        onForceRelease={forceReleaseLock}
      />

      {/* Editor / Preview
        *
        * 布局规则:
        *   - md + view 模式:**全宽预览**,不显示编辑器(view 时只读源码视图基本无用)
        *   - md + edit 模式:左右分屏(编辑器 + 预览)
        *   - text:始终单栏编辑器(没预览必要)
        *
        * 渲染插件:
        *   - remark-gfm:GFM 表格 / 删除线 / 任务列表 / footnote
        *   - rehype-raw:允许 markdown 内嵌 HTML(<details> / <img width=...> 等)
        *   - rehype-shiki:代码块语法高亮(github-light 主题,和整体 UI 调一致)
        *
        * 字号:prose-base(默认 16px)代替 prose-sm —— 长文档阅读体感舒适。
        */}
      <GlassCard className="p-0 overflow-hidden">
        {doc.content_kind === 'md' ? (
          mode === 'edit' ? (
            // 编辑态:左右分屏。预览侧实时跟随 content。
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-[#e8e7e3]">
              <div className="min-h-[60vh]">
                <ChannelDocumentEditor
                  value={content}
                  onChange={setContent}
                  readOnly={false}
                  contentKind="md"
                  placeholder="开始写 Markdown…(可直接粘贴 / 拖拽图片)"
                  height="60vh"
                  onUploadImage={uploadImage}
                />
              </div>
              <div className="min-h-[60vh] max-h-[80vh] overflow-auto bg-[#fafaf7]">
                <MarkdownPreview content={debouncedContent} />
              </div>
            </div>
          ) : (
            // 查看态:全宽预览(直接用 content;view 态 content 只在 fetchDoc 时变,无需 debounce)。
            <div className="min-h-[60vh] bg-[#fafaf7]">
              <MarkdownPreview content={content} />
            </div>
          )
        ) : (
          <ChannelDocumentEditor
            value={content}
            onChange={setContent}
            readOnly={mode !== 'edit'}
            contentKind="text"
            placeholder="纯文本…"
            height="60vh"
          />
        )}
      </GlassCard>

      {/* Save Modal */}
      <Modal open={showSaveModal} onClose={() => setShowSaveModal(false)} title="保存新版本">
        <div className="space-y-4">
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">本次改动备注(可选)</label>
            <input
              autoFocus
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving) {
                  e.preventDefault();
                  submitSave();
                }
              }}
              placeholder="例如:补充部署步骤 / 修正参数说明"
              className="w-full px-3 py-2 text-[13px] border border-[#e3e2dc] rounded focus:border-[#2383e2] outline-none"
              maxLength={255}
            />
            <p className="text-[11px] text-text-muted mt-1">最多 255 字</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowSaveModal(false)}>取消</Button>
            <Button onClick={submitSave} loading={saving}>保存</Button>
          </div>
        </div>
      </Modal>

      {/* Versions Drawer */}
      {showVersions && (
        <VersionsDrawer
          channelId={channelId}
          docId={docId}
          principalDirByID={byPrincipalID}
          onClose={() => setShowVersions(false)}
        />
      )}
    </div>
  );
}

// ─── MarkdownPreview ─────────────────────────────────────────────────────
//
// 共享文档的 markdown 预览渲染器,view / edit 模式共用。
//
// 插件链:remark-gfm(语法扩展)→ rehype-raw(允许内嵌 HTML)→ rehype-shiki(代码块高亮)。
// rehype-shiki 在 raw 之后:让 raw 不破坏代码块的 fence 语义。
//
// 字号 prose-base(默认 16px),配合 max-w-none 撑满容器宽度,长文档阅读舒适。
function MarkdownPreview({ content }: { content: string }) {
  if (!content) {
    return (
      <div className="p-6 text-text-muted italic flex items-center gap-1.5">
        <Eye className="w-3.5 h-3.5" />
        预览(空文档)
      </div>
    );
  }
  // 直接用 .markdown-body class(项目自有 CSS,见 src/index.css)— 不依赖 @tailwindcss/typography,
  // 也不接 shiki/rehype-raw,避免运行时初始化坑。代码块靠 .markdown-body pre 的纯 CSS 样式。
  //
  // img 自定义渲染:`![](/api/v2/...)` 走我们 attachment 端点,后端鉴权后 302 到 OSS;
  // 只允许 `/api/v2/...` 相对路径或 https 开头(防 javascript: / data: 等)。
  return (
    <div className="p-6 markdown-body text-text-primary text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // attachment URL(/api/...)走 AuthImage(带 JWT 拉 blob);
          // 外链 https 直接 <img>;其它(javascript:/data:/相对路径)拒
          img: ({ src, alt }) => {
            if (typeof src !== 'string') return null;
            if (src.startsWith('/api/')) {
              return <AuthImage src={src} alt={alt} className="my-3 max-w-full rounded border border-[#e3e2dc]" />;
            }
            if (src.startsWith('https://')) {
              return <img src={src} alt={alt} className="my-3 max-w-full rounded border border-[#e3e2dc]" />;
            }
            return <span className="text-text-muted text-xs">[image: {alt || 'invalid src'}]</span>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ─── LockBar ─────────────────────────────────────────────────────────────

function LockBar({
  archived, isMember, isChannelOwner, mode, lock, lockExpired,
  lockHeldByMe, lockHeldByOther, lockHolderName, now, dirty, saving,
  onAcquire, onSave, onRelease, onForceRelease,
}: {
  archived: boolean;
  isMember: boolean;
  isChannelOwner: boolean;
  mode: Mode;
  lock: ChannelDocumentResponse['lock'];
  lockExpired: boolean;
  lockHeldByMe: boolean;
  lockHeldByOther: boolean;
  lockHolderName: string | null;
  now: number;
  dirty: boolean;
  saving: boolean;
  onAcquire: () => void;
  onSave: () => void;
  onRelease: () => void;
  onForceRelease: () => void;
}) {
  if (archived) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#e8e7e3] bg-[#f8f7f3] text-[12px] text-text-muted">
        <Lock className="w-3.5 h-3.5" />
        Channel 已归档,文档转为只读
      </div>
    );
  }
  if (!isMember) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#e8e7e3] bg-[#f8f7f3] text-[12px] text-text-muted">
        <AlertTriangle className="w-3.5 h-3.5" />
        非 channel 成员,只能查看
      </div>
    );
  }

  if (mode === 'edit' && lockHeldByMe) {
    const remain = lock ? Math.max(0, new Date(lock.expires_at).getTime() - now) : 0;
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#c7e1ff] bg-[#f0f7ff] text-[12px] text-[#2366a8]">
        <Edit3 className="w-3.5 h-3.5" />
        <span className="flex-1">
          编辑中 · 锁 {formatRemain(remain)} 后过期(每分钟自动续约)
        </span>
        <Button
          size="sm"
          variant="primary"
          icon={<Save className="w-3.5 h-3.5" />}
          onClick={onSave}
          disabled={!dirty || saving}
        >
          保存
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          onClick={onRelease}
        >
          完成
        </Button>
      </div>
    );
  }

  if (lockHeldByOther) {
    const remain = lock ? Math.max(0, new Date(lock.expires_at).getTime() - now) : 0;
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#f0d9a6] bg-[#fdf6e6] text-[12px] text-[#9a6814]">
        <Lock className="w-3.5 h-3.5" />
        <span className="flex-1">
          <b>{lockHolderName}</b> 正在编辑 · {formatRemain(remain)} 后锁过期
        </span>
        {isChannelOwner && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Unlock className="w-3.5 h-3.5" />}
            onClick={onForceRelease}
          >
            强制解锁
          </Button>
        )}
      </div>
    );
  }

  // 无锁 / 锁已过期
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#e8e7e3] bg-white text-[12px] text-text-secondary">
      <Eye className="w-3.5 h-3.5" />
      <span className="flex-1">
        {lock && lockExpired
          ? `锁已过期(原持有人 ${lockHolderName})`
          : '当前无人编辑'}
      </span>
      <Button
        size="sm"
        variant="primary"
        icon={<Edit3 className="w-3.5 h-3.5" />}
        onClick={onAcquire}
      >
        开始编辑
      </Button>
    </div>
  );
}

// ─── Versions Drawer ─────────────────────────────────────────────────────

function VersionsDrawer({
  channelId, docId, principalDirByID, onClose,
}: {
  channelId: number;
  docId: number;
  principalDirByID: Map<number, { displayName: string }>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<ChannelDocumentVersionResponse[]>([]);
  const [selectedVersionID, setSelectedVersionID] = useState<number | null>(null);
  const [versionContent, setVersionContent] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await apiCall(() => channelApi.listDocumentVersions(channelId, docId));
      setLoading(false);
      if (res.ok && res.data) {
        setVersions(res.data);
        if (res.data.length > 0) {
          loadVersion(res.data[0].id);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, docId]);

  const loadVersion = async (vid: number) => {
    setSelectedVersionID(vid);
    const res = await apiCall(() => channelApi.getDocumentVersionContent(channelId, docId, vid));
    if (res.ok && res.data) setVersionContent(res.data.content);
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-white border-l border-[#e8e7e3] shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e8e7e3]">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#2383e2]" strokeWidth={1.8} />
            <h3 className="text-[14px] font-medium text-text-primary">版本历史</h3>
            <span className="text-[11px] text-text-muted">({versions.length})</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary"
            title="关闭"
          >
            ×
          </button>
        </div>
        <div className="flex-1 flex overflow-hidden">
          {/* 列表 */}
          <div className="w-72 shrink-0 border-r border-[#f0efe9] overflow-auto">
            {loading ? (
              <p className="p-4 text-[13px] text-text-muted">加载中…</p>
            ) : versions.length === 0 ? (
              <p className="p-4 text-[13px] text-text-muted">还没有任何版本</p>
            ) : (
              versions.map((v) => {
                const editorName = principalDirByID.get(v.edited_by_principal_id)?.displayName
                  || `principal#${v.edited_by_principal_id}`;
                return (
                  <button
                    key={v.id}
                    onClick={() => loadVersion(v.id)}
                    className={clsx(
                      'block w-full text-left px-3 py-2 border-b border-[#f0efe9] hover:bg-[#f8f7f3]',
                      selectedVersionID === v.id && 'bg-[#2383e2]/[0.06]',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Hash className="w-3 h-3 text-text-muted" />
                      <span className="text-[12px] font-mono text-text-secondary">
                        {v.version.slice(0, 7)}
                      </span>
                      <span className="text-[11px] text-text-muted ml-auto">
                        {formatBytes(v.byte_size)}
                      </span>
                    </div>
                    <p className="text-[12px] text-text-primary mt-0.5 truncate">
                      {v.edit_summary || <span className="text-text-muted italic">无备注</span>}
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {editorName} ·{' '}
                      {formatRelativeWithAbsSeconds(Math.floor(new Date(v.created_at).getTime() / 1000))}
                    </p>
                  </button>
                );
              })
            )}
          </div>
          {/* 内容 */}
          <div className="flex-1 overflow-auto p-4">
            {selectedVersionID ? (
              <pre className="text-[12px] text-text-primary whitespace-pre-wrap font-mono leading-relaxed">
                {versionContent}
              </pre>
            ) : (
              <p className="text-[13px] text-text-muted">选择左侧版本查看内容</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

function formatRemain(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s} 秒`;
  return `${m} 分 ${s.toString().padStart(2, '0')} 秒`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// useNowTick:每秒返一个 Date.now(),用于倒计时;enabled=false 时不 tick(省 re-render)
function useNowTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [enabled]);
  return now;
}
