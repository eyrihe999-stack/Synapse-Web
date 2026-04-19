import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Pencil,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  CircleSlash,
  RotateCcw,
  User as UserIcon,
  Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { DocumentTabs } from '@/components/ui/DocumentTabs';
import { useOrgStore } from '@/store/org';
import {
  DOCUMENT_ACCEPT_ATTR,
  DOCUMENT_ALLOWED_EXTENSIONS,
  DOCUMENT_MAX_FILE_SIZE,
  DOCUMENT_MAX_TITLE_LENGTH,
  DOCUMENT_PRECHECK_BATCH,
  collectDocumentFiles,
  documentApi,
  downloadDocument,
  guessDocumentMIME,
  sha256HexOfFile,
} from '@/api/document';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { toast } from '@/components/ui/Toast';
import { formatBytes, formatTs } from '@/lib/format';
import type {
  DocumentResponse,
  PrecheckAction,
  PrecheckReasonCode,
  PrecheckResultEntry,
  SearchMode,
} from '@/types/api';

const PAGE_SIZE = 20;
const SEMANTIC_TOP_K = 20;

// 不同模式的 debounce:semantic 每次打 Azure embedding 花钱又慢,拉长间隔避免打字抖动触发的连续请求。
const FUZZY_DEBOUNCE_MS = 300;
const SEMANTIC_DEBOUNCE_MS = 700;

const PERM_READ = 'document.read';
const PERM_WRITE = 'document.write';
const PERM_DELETE = 'document.delete';

export function DocumentsPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const perms = currentOrg?.my_role.permissions ?? [];
  const canRead = perms.includes(PERM_READ);
  const canWrite = perms.includes(PERM_WRITE);
  const canDelete = perms.includes(PERM_DELETE);

  const [docs, setDocs] = useState<DocumentResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [renaming, setRenaming] = useState<DocumentResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 搜索:searchInput 即时绑定输入框,debounce 后落地到 appliedQuery;真正发请求的是 appliedQuery。
  // debounce 时长随 searchMode 变化(见 FUZZY/SEMANTIC_DEBOUNCE_MS)。
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('fuzzy');
  // 语义搜索能力探测:服务端 indexing 三元齐备才为 true;未启用时禁用"语义"切换。
  const [semanticEnabled, setSemanticEnabled] = useState(false);

  // 并发保护:fetch 发起时标记一个 epoch,返回时若不是最新 epoch 就丢弃结果,防止列表闪回旧数据。
  const fetchSeqRef = useRef(0);

  const fetchDocs = useCallback(async (targetPage: number) => {
    if (!slug) return;
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const q = appliedQuery.trim();
      // semantic 分支:空 query 直接清空,不打 embed;只发 top_k,不发 page/size。
      // fuzzy 分支:页参数走分页,空 q 返全量。
      const res =
        searchMode === 'semantic'
          ? (q
              ? await documentApi.list(slug, { mode: 'semantic', q, top_k: SEMANTIC_TOP_K })
              : null)
          : await documentApi.list(slug, {
              mode: 'fuzzy',
              page: targetPage,
              size: PAGE_SIZE,
              ...(q ? { q } : {}),
            });
      if (seq !== fetchSeqRef.current) return;
      if (!res) {
        // semantic 空 query 的本地短路
        setDocs([]);
        setTotal(0);
        setPage(1);
        return;
      }
      const body = res.data;
      if (body.code && body.code !== 200) {
        toast('error', body.message || '加载失败');
        return;
      }
      setDocs(body.result?.items ?? []);
      setTotal(body.result?.total ?? 0);
      setPage(body.result?.page ?? targetPage);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      toast('error', getErrorMessage(err));
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [slug, appliedQuery, searchMode]);

  // 输入框防抖:semantic 模式下 debounce 更长,减少 Azure 调用。
  useEffect(() => {
    const delay = searchMode === 'semantic' ? SEMANTIC_DEBOUNCE_MS : FUZZY_DEBOUNCE_MS;
    const id = setTimeout(() => setAppliedQuery(searchInput.trim()), delay);
    return () => clearTimeout(id);
  }, [searchInput, searchMode]);

  // slug / 权限 / 搜索词 / 模式切换都回到第 1 页重查。
  useEffect(() => {
    if (slug && canRead) {
      fetchDocs(1);
    } else {
      setDocs([]);
      setTotal(0);
      setPage(1);
    }
  }, [slug, canRead, fetchDocs]);

  // 挂载时探测语义搜索能力。orgCtx 中间件会根据 slug 注入,slug 变时复查。
  useEffect(() => {
    if (!slug || !canRead) {
      setSemanticEnabled(false);
      return;
    }
    let stale = false;
    documentApi.getUploadConfig(slug).then(
      (r) => {
        if (stale) return;
        setSemanticEnabled(!!r.data.result?.semantic_search_enabled);
      },
      () => {
        if (stale) return;
        setSemanticEnabled(false);
      },
    );
    return () => { stale = true; };
  }, [slug, canRead]);

  // 语义能力掉线时自动回到 fuzzy,避免卡在灰态 UI。
  useEffect(() => {
    if (!semanticEnabled && searchMode === 'semantic') {
      setSearchMode('fuzzy');
    }
  }, [semanticEnabled, searchMode]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleDownload = async (doc: DocumentResponse) => {
    if (busyId === doc.id) return;
    setBusyId(doc.id);
    try {
      await downloadDocument(slug!, doc);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setBusyId((cur) => (cur === doc.id ? null : cur));
    }
  };

  const handleDelete = async (doc: DocumentResponse) => {
    if (busyId === doc.id) return;
    if (!confirm(`确定要删除文档「${doc.title}」吗？此操作不可撤销。`)) return;
    setBusyId(doc.id);
    const result = await apiCall(
      () => documentApi.delete(slug!, doc.id),
      { success: '文档已删除' },
    );
    setBusyId((cur) => (cur === doc.id ? null : cur));
    if (result !== null) {
      // 如果当前页删空了且不是首页,退回一页。
      const nextPage = docs.length === 1 && page > 1 ? page - 1 : page;
      fetchDocs(nextPage);
    }
  };

  // 无 org:提示选择。
  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="文档" />
        <GlassCard>
          <div className="py-8 text-center">
            <FileText className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">请先在顶部选择一个组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  // 无读权限:不发请求,直接提示。
  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader title="文档" subtitle={currentOrg!.org.display_name} />
        <GlassCard>
          <div className="py-8 text-center">
            <FileText className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">你所在角色没有文档读取权限</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="文档"
        subtitle={`${currentOrg!.org.display_name} · 组织知识库文档`}
        loading={loading}
        onRefresh={() => fetchDocs(page)}
        action={
          canWrite ? (
            <Button onClick={() => setShowUpload(true)} icon={<Upload className="h-3.5 w-3.5" />}>
              上传文档
            </Button>
          ) : undefined
        }
      />

      <DocumentTabs />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={searchMode === 'semantic' ? '描述你想找的内容' : '按标题、文件名或 ID 搜索'}
            maxLength={128}
            className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border-default bg-white text-[13px] text-text-primary placeholder:text-text-muted shadow-sm focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all duration-100"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary cursor-pointer p-0.5"
              title="清除"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 模糊 / 语义 切换。semanticEnabled=false 时"语义"按钮置灰并给 tooltip 解释。 */}
        <div className="inline-flex rounded-md border border-border-default bg-white overflow-hidden shrink-0 shadow-sm">
          <button
            type="button"
            onClick={() => setSearchMode('fuzzy')}
            className={`px-2.5 py-1.5 text-[12px] transition-colors ${
              searchMode === 'fuzzy'
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-[#f5f5f3]'
            }`}
            title="按文件名/标题字面匹配"
          >
            模糊
          </button>
          <button
            type="button"
            disabled={!semanticEnabled}
            onClick={() => semanticEnabled && setSearchMode('semantic')}
            className={`px-2.5 py-1.5 text-[12px] transition-colors border-l border-border-default ${
              searchMode === 'semantic'
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-[#f5f5f3]'
            } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:bg-white`}
            title={
              semanticEnabled
                ? '按向量相似度搜索(文档内容语义)'
                : '服务端未启用索引,语义搜索不可用'
            }
          >
            语义
          </button>
        </div>
      </div>

      {loading && docs.length === 0 ? (
        <p className="text-[13px] text-text-muted py-8 text-center">
          {searchMode === 'semantic' ? '正在做语义检索...' : '加载中...'}
        </p>
      ) : docs.length === 0 ? (
        <GlassCard>
          <div className="py-8 text-center">
            <FileText className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            {searchMode === 'semantic' ? (
              appliedQuery ? (
                <>
                  <p className="text-[14px] text-text-secondary mb-1">没有语义相近的文档</p>
                  <p className="text-[12px] text-text-muted">
                    没找到和「{appliedQuery}」内容相似的文档;可以换关键词或切到模糊模式
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[14px] text-text-secondary mb-1">语义搜索</p>
                  <p className="text-[12px] text-text-muted">
                    输入一段描述,按文档内容相似度返回最相关的文档
                  </p>
                </>
              )
            ) : appliedQuery ? (
              <>
                <p className="text-[14px] text-text-secondary mb-1">没有匹配的文档</p>
                <p className="text-[12px] text-text-muted">
                  没有找到标题或文件名包含「{appliedQuery}」的文档
                </p>
              </>
            ) : (
              <>
                <p className="text-[14px] text-text-secondary mb-1">暂无文档</p>
                {canWrite && (
                  <p className="text-[12px] text-text-muted">点击上方按钮上传第一份文档</p>
                )}
              </>
            )}
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <GlassCard key={doc.id} hover>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="h-5 w-5 text-accent" strokeWidth={1.6} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/org/documents/${doc.id}/view`}
                        className="text-[14px] font-medium text-text-primary truncate hover:text-accent cursor-pointer"
                        title="在线查看"
                      >
                        {doc.title}
                      </Link>
                      <span className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-[#f1f1ef] border border-[#e3e2dc]">
                        {doc.mime_type}
                      </span>
                      {/* similarity 仅 semantic 搜索路径下存在。>=0.7 绿、>=0.4 橙、否则灰,让用户直觉判断"这 60% 是真相关还是矬子里拔将军"。 */}
                      {typeof doc.similarity === 'number' && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                            doc.similarity >= 0.7
                              ? 'text-[#448361] bg-[#e8f1ea] border-[#c0d7c5]'
                              : doc.similarity >= 0.4
                                ? 'text-[#cb912f] bg-[#fbf2df] border-[#eadfbe]'
                                : 'text-text-muted bg-[#f1f1ef] border-[#e3e2dc]'
                          }`}
                        >
                          相关度 {Math.round(doc.similarity * 100)}%
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-muted font-mono truncate mt-0.5">{doc.file_name}</p>
                    {doc.matched_snippet && (
                      <p className="text-[11px] text-text-secondary mt-1.5 line-clamp-2 italic border-l-2 border-border-default pl-2 whitespace-pre-wrap">
                        {doc.matched_snippet}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px] text-text-muted">
                      <span className="inline-flex items-center gap-1" title="上传者">
                        <UserIcon className="h-3 w-3 shrink-0" />
                        {doc.uploader_display_name || `用户 #${doc.uploader_id}`}
                      </span>
                      <span>{formatBytes(doc.size_bytes)}</span>
                      <span>上传于 {formatTs(doc.created_at)}</span>
                      {doc.updated_at && doc.updated_at !== doc.created_at && (
                        <span>更新于 {formatTs(doc.updated_at)}</span>
                      )}
                      <span className="font-mono">#{doc.id}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Link
                    to={`/org/documents/${doc.id}/view`}
                    className="text-text-muted hover:text-accent transition-colors cursor-pointer p-1.5"
                    title="查看"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    onClick={() => handleDownload(doc)}
                    disabled={busyId === doc.id}
                    className="text-text-muted hover:text-accent transition-colors cursor-pointer p-1.5 disabled:opacity-40"
                    title="下载"
                  >
                    {busyId === doc.id ? (
                      <span className="h-3.5 w-3.5 block border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {canWrite && (
                    <button
                      onClick={() => setRenaming(doc)}
                      disabled={busyId === doc.id}
                      className="text-text-muted hover:text-accent transition-colors cursor-pointer p-1.5 disabled:opacity-40"
                      title="重命名"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(doc)}
                      disabled={busyId === doc.id}
                      className="text-text-muted hover:text-accent-red transition-colors cursor-pointer p-1.5 disabled:opacity-40"
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* 底栏:fuzzy 模式显示"共 N 条 · 第 X/Y 页"+ 翻页按钮;semantic 模式只显示命中数 + 提示最多 topK。 */}
      {searchMode === 'semantic' && docs.length > 0 && (
        <p className="text-[12px] text-text-muted pt-2 text-center">
          找到 {total} 篇相关文档(最多展示 {SEMANTIC_TOP_K} 篇,按相关度降序)
        </p>
      )}
      {searchMode === 'fuzzy' && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-[12px] text-text-muted">
            共 {total} 条 · 第 {page} / {totalPages} 页
          </p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1 || loading}
              onClick={() => fetchDocs(page - 1)}
              icon={<ChevronLeft className="h-3.5 w-3.5" />}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= totalPages || loading}
              onClick={() => fetchDocs(page + 1)}
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {canWrite && (
        <UploadDocumentModal
          open={showUpload}
          onClose={() => setShowUpload(false)}
          slug={slug}
          onDone={() => fetchDocs(1)}
        />
      )}
      {renaming && canWrite && (
        <RenameDocumentModal
          doc={renaming}
          slug={slug}
          onClose={() => setRenaming(null)}
          onDone={() => fetchDocs(page)}
        />
      )}
    </div>
  );
}

// ── Upload Modal (Batch) ────────────────────────────────────────────────────

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  slug: string;
  onDone: () => void;
}

// 'prechecking':正在本地算 hash + 服务端 precheck。
// 'pending':已过 precheck,待上传;实际是否上传由 selected 决定。
// 'skipped':不会上传;具体原因看 precheck.action(local_validation / duplicate / reject)。
type ItemStatus = 'prechecking' | 'pending' | 'uploading' | 'success' | 'error' | 'skipped' | 'canceled';

// 本地 reject 是 hard-fail 的 PrecheckAction 超集,前端内部用 'local_validation' 区分。
type EffectiveAction = PrecheckAction | 'local_validation';

interface PrecheckState {
  action: EffectiveAction;
  reasonCode?: PrecheckReasonCode;
  /** 仅 duplicate 时存在,指向 hash 命中的那条已存在文档。 */
  existing?: DocumentResponse;
  /** 仅 overwrite 时存在,所有同名候选(≥1 条),让用户选覆盖目标或选择新建。 */
  existingList?: DocumentResponse[];
  /** 本地或远端返回的附加错误文本(一般给本地拒绝/网络失败用)。 */
  message?: string;
}

interface QueueItem {
  id: string;
  file: File;
  relPath: string;
  status: ItemStatus;
  progress: number;
  error?: string;
  /** 用户勾选框;仅对 status='pending' 的项有意义。 */
  selected?: boolean;
  /** 预检结果;prechecking 中 undefined,完成后填。 */
  precheck?: PrecheckState;
  /** overwrite 分支的用户选择:number = 覆盖该 doc_id;undefined = 作为新文档上传(默认值,安全选)。 */
  targetDocId?: string;
}

const UPLOAD_CONCURRENCY = 3;

// reason_code → 用户可读中文文案。后端只给码,前端在这里做 i18n。
// overwrite 分支的文案依赖用户选择的 targetDocId,所以这里不处理 overwrite 的具体候选名;
// overwrite 的 tag 文案由 renderOverwriteTagText 单独算。
function precheckReasonText(action: EffectiveAction, reason: PrecheckReasonCode | undefined, existing: DocumentResponse | undefined): string {
  switch (action) {
    case 'create':
      return '新增';
    case 'overwrite':
      // overwrite 的最终文案看用户选没选 target,此处给个兜底(实际渲染用 renderOverwriteTagText)。
      return '同名冲突';
    case 'duplicate':
      if (existing) {
        const who = existing.uploader_display_name || `用户 #${existing.uploader_id}`;
        return `已由 ${who} 上传过《${existing.title}》`;
      }
      return '已存在相同内容';
    case 'reject':
      switch (reason) {
        case 'file_too_large': return `超过 ${Math.round(DOCUMENT_MAX_FILE_SIZE / 1024 / 1024)}MB 上限`;
        case 'mime_unsupported': return '不支持的格式';
        case 'empty_file': return '空文件';
        case 'invalid_content_hash': return 'hash 校验失败(刷新重试)';
        default: return '被服务端拒绝';
      }
    case 'local_validation':
    default:
      return '本地校验失败';
  }
}

// renderOverwriteTagText 根据 targetDocId 给出"将覆盖 X / 作为新文档"的具体文案。
// existingList 为空时不可能走到 overwrite 分支,防御性兜底回"同名冲突"。
function renderOverwriteTagText(targetDocId: string | undefined, existingList: DocumentResponse[] | undefined): string {
  if (!existingList || existingList.length === 0) return '同名冲突';
  if (targetDocId === undefined) {
    return existingList.length > 1
      ? `作为新文档 (${existingList.length} 条同名候选)`
      : '作为新文档 (有 1 条同名)';
  }
  const target = existingList.find((d) => d.id === targetDocId);
  if (!target) return '作为新文档';
  return `将覆盖《${target.title}》`;
}

function randomId(): string {
  // crypto.randomUUID 在所有主流浏览器的本地环境都可用;如缺席则退回时间戳+随机。
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// applyPrecheckResult 把一条 precheck 响应翻译成 item 状态 patch。
// create/overwrite → pending + 默认勾选;duplicate/reject → skipped + 不可勾选。
//
// overwrite 分支默认 targetDocId=undefined(= 作为新文档上传,安全默认,不会误删旧版本);
// 用户可在列表里点下拉改成"覆盖某条"。全局策略按钮也可一键改所有 overwrite 项。
function applyPrecheckResult(
  itemId: string,
  r: PrecheckResultEntry,
  patchItem: (id: string, patch: Partial<QueueItem>) => void,
) {
  const existing = r.existing;
  switch (r.action) {
    case 'create':
      patchItem(itemId, {
        status: 'pending',
        selected: true,
        precheck: { action: 'create', reasonCode: r.reason_code },
        targetDocId: undefined,
      });
      return;
    case 'overwrite':
      patchItem(itemId, {
        status: 'pending',
        selected: true,
        precheck: {
          action: 'overwrite',
          reasonCode: r.reason_code,
          existingList: r.existing_list ?? [],
        },
        targetDocId: undefined,
      });
      return;
    case 'duplicate':
      patchItem(itemId, {
        status: 'skipped',
        selected: false,
        precheck: { action: 'duplicate', reasonCode: r.reason_code, existing },
      });
      return;
    case 'reject':
      patchItem(itemId, {
        status: 'skipped',
        selected: false,
        error: precheckReasonText('reject', r.reason_code, existing),
        precheck: { action: 'reject', reasonCode: r.reason_code },
      });
      return;
  }
}

function UploadDocumentModal({ open, onClose, slug, onDone }: UploadModalProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  // React 不认识 webkitdirectory/directory 这两个非标准属性,用 setAttribute 手动挂上。
  useEffect(() => {
    const el = folderInputRef.current;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  }, [open]);

  const patchItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  /**
   * 顺序算 hash + 批量调 /precheck。放在 addFiles 之后异步跑,避免阻塞 UI。
   *
   * 失败降级:如果 /precheck 网络失败,把所有项置为 pending + selected=true,
   * 让用户点"开始上传"时由服务端 Upload 三分支兜底 —— precheck 只是 UX 指导。
   */
  const runPrecheck = useCallback(async (targetItems: QueueItem[]) => {
    if (targetItems.length === 0) return;

    // 顺序算 hash,避免同时把多个 10MB buffer 读进内存。
    const hashed: Array<{ item: QueueItem; hash: string }> = [];
    for (const it of targetItems) {
      try {
        const hash = await sha256HexOfFile(it.file);
        hashed.push({ item: it, hash });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'hash 计算失败';
        patchItem(it.id, {
          status: 'skipped',
          error: msg,
          precheck: { action: 'local_validation', message: msg },
        });
      }
    }
    if (hashed.length === 0) return;

    // 按后端批量上限切片,每批独立请求。
    for (let i = 0; i < hashed.length; i += DOCUMENT_PRECHECK_BATCH) {
      const chunk = hashed.slice(i, i + DOCUMENT_PRECHECK_BATCH);
      try {
        const res = await documentApi.precheck(slug, {
          files: chunk.map((h) => ({
            file_name: h.item.file.name,
            size_bytes: h.item.file.size,
            mime_type: guessDocumentMIME(h.item.file.name),
            content_hash: h.hash,
          })),
        });
        const body = res.data;
        if (body.code && body.code !== 200) {
          // 服务端报错:整批降级为"按 pending 放行",让 Upload 自己兜底。
          chunk.forEach((h) =>
            patchItem(h.item.id, { status: 'pending', selected: true, precheck: undefined }),
          );
          continue;
        }
        const results: PrecheckResultEntry[] = body.result?.results ?? [];
        results.forEach((r, idx) => applyPrecheckResult(chunk[idx].item.id, r, patchItem));
      } catch {
        // 网络错:静默降级。"不明确就放行"优于"误拦用户操作"。
        chunk.forEach((h) =>
          patchItem(h.item.id, { status: 'pending', selected: true, precheck: undefined }),
        );
      }
    }
  }, [slug, patchItem]);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    const collected = collectDocumentFiles(files);
    if (collected.length === 0) return;
    // 本地校验失败的项:直接 skipped,不参与 precheck。
    // 本地校验通过的项:prechecking,等 hash + API 回来才翻到 pending。
    const newItems: QueueItem[] = collected.map((c) => {
      if (c.rejectReason) {
        return {
          id: randomId(),
          file: c.file,
          relPath: c.relPath,
          status: 'skipped' as ItemStatus,
          progress: 0,
          error: c.rejectReason,
          precheck: { action: 'local_validation', message: c.rejectReason },
        };
      }
      return {
        id: randomId(),
        file: c.file,
        relPath: c.relPath,
        status: 'prechecking' as ItemStatus,
        progress: 0,
      };
    });
    setItems((prev) => [...prev, ...newItems]);
    // 异步跑 precheck,不阻塞 addFiles 返回。
    void runPrecheck(newItems.filter((it) => it.status === 'prechecking'));
  }, [runPrecheck]);

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const retryItem = (id: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && (it.status === 'error' || it.status === 'canceled')
          ? { ...it, status: 'pending', progress: 0, error: undefined }
          : it,
      ),
    );
  };

  const clearFinished = () => {
    setItems((prev) =>
      prev.filter((it) => it.status !== 'success' && it.status !== 'skipped'),
    );
  };

  const totals = useMemo(() => {
    const t = {
      total: items.length,
      prechecking: 0,
      pending: 0,
      uploading: 0,
      success: 0,
      error: 0,
      skipped: 0,
      canceled: 0,
      // 细分:用户视觉上关心"新建几个、覆盖几个、跳过几个"。
      // 对 action=overwrite 的项:有 targetDocId → 记 toOverwrite;否则记 toCreate(= 作为新文档)。
      // conflicts 是"有同名冲突"的总数(regardless of 用户选择),供提示文案用。
      toCreate: 0,
      toOverwrite: 0,
      duplicate: 0,
      rejected: 0,
      conflicts: 0,
      // 真正会发请求的数量(pending && selected)。
      plannedUpload: 0,
    };
    items.forEach((it) => {
      t[it.status]++;
      if (it.status === 'pending' && it.selected) t.plannedUpload++;
      const act = it.precheck?.action;
      if (it.status === 'pending' && act === 'create') t.toCreate++;
      else if (it.status === 'pending' && act === 'overwrite') {
        t.conflicts++;
        if (it.targetDocId !== undefined) t.toOverwrite++;
        else t.toCreate++;
      } else if (it.status === 'skipped' && act === 'duplicate') t.duplicate++;
      else if (it.status === 'skipped' && (act === 'reject' || act === 'local_validation')) t.rejected++;
    });
    return t;
  }, [items]);

  const startBatch = async () => {
    if (running) return;
    // 执行时冻结一份待上传快照,避免后续 setItems 改动影响分发。
    // 仅上传用户勾选的 pending 项。precheck 回来的 create/overwrite 默认 selected=true。
    const queue = items.filter((it) => it.status === 'pending' && it.selected);
    if (queue.length === 0) return;

    // Intra-batch 同名检测:precheck 只能看到 DB 里已有的冲突,本批次里多个文件同名它看不到。
    // 这里在上传前再扫一遍,如果发现 ≥2 个文件共享同一个 file_name,弹 confirm 让用户显式确认。
    // (业务允许同名并存,这里仅防"用户手滑选错一批副本"。确认后每个文件仍各走 create/overwrite 自己的选择。)
    const nameCounts = new Map<string, number>();
    for (const it of queue) {
      const n = it.file.name;
      nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
    }
    const dups = Array.from(nameCounts.entries()).filter(([, n]) => n > 1);
    if (dups.length > 0) {
      // 排序:出现次数多的排前,同名次数相同按名字字典序,展示稳定。
      dups.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const list = dups.map(([name, n]) => `  • ${name} × ${n}`).join('\n');
      const msg =
        '本批包含以下同名文件:\n\n' +
        list +
        '\n\n同名文件会作为独立文档并存(doc_id 不同)。继续上传?';
      if (!confirm(msg)) return;
    }

    const controller = new AbortController();
    batchAbortRef.current = controller;
    setRunning(true);

    let anySuccess = false;
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        if (controller.signal.aborted) return;
        const idx = cursor++;
        const item = queue[idx];

        // 每个文件一个子 controller,批量 abort 会级联下来。
        const itemCtl = new AbortController();
        const onAbort = () => itemCtl.abort();
        controller.signal.addEventListener('abort', onAbort, { once: true });

        patchItem(item.id, { status: 'uploading', progress: 0, error: undefined });
        try {
          const res = await documentApi.upload(slug, item.file, {
            signal: itemCtl.signal,
            targetDocId: item.targetDocId,
            onProgress: (pct) => patchItem(item.id, { progress: pct }),
          });
          const body = res.data;
          if (body.code && body.code !== 200) {
            patchItem(item.id, { status: 'error', error: body.message || '上传失败' });
          } else {
            patchItem(item.id, { status: 'success', progress: 100 });
            anySuccess = true;
          }
        } catch (err: unknown) {
          const e = err as { name?: string; code?: string };
          const canceled =
            controller.signal.aborted || e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED';
          patchItem(item.id, {
            status: canceled ? 'canceled' : 'error',
            error: canceled ? '已取消' : getErrorMessage(err),
          });
        } finally {
          controller.signal.removeEventListener('abort', onAbort);
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
      worker,
    );
    await Promise.all(workers);

    batchAbortRef.current = null;
    setRunning(false);
    if (anySuccess) onDone();
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  // 用户改勾选 —— 只对 pending 项有效,duplicate/reject 的 skipped 项 UI 里就不会渲染 checkbox。
  const toggleSelected = useCallback((id: string, next: boolean) => {
    patchItem(id, { selected: next });
  }, [patchItem]);

  // 单个 overwrite 项改覆盖目标。docId=undefined 表示"作为新文档上传"。
  const setTargetDocId = useCallback((id: string, docId: string | undefined) => {
    patchItem(id, { targetDocId: docId });
  }, [patchItem]);

  // 全局策略:把所有 overwrite 项一键改为"覆盖最近一条"或"全部新建"。
  // 只影响 pending + action=overwrite 的项,其他态不受影响。
  const applyGlobalOverwritePolicy = useCallback((policy: 'overwrite-latest' | 'new-all') => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.status !== 'pending') return it;
        if (it.precheck?.action !== 'overwrite') return it;
        if (policy === 'new-all') {
          return { ...it, targetDocId: undefined };
        }
        // overwrite-latest: 取 existingList[0].id (后端已按 updated_at DESC 排,首条就是最近)。
        const latest = it.precheck.existingList?.[0]?.id;
        return { ...it, targetDocId: latest };
      }),
    );
  }, []);

  const handleClose = () => {
    if (running) {
      // eslint-disable-next-line no-alert
      if (!confirm('正在上传中，确认取消并关闭?')) return;
      batchAbortRef.current?.abort();
    }
    onClose();
    // 关闭后清空,下次打开是干净状态;正在 uploading 的 setItems 落地前已 abort,不会污染。
    setItems([]);
    setRunning(false);
  };

  const handleFilePick = (list: FileList | null) => {
    addFiles(list);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFolderPick = (list: FileList | null) => {
    addFiles(list);
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={handleClose} title="上传文档">
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={running}
            icon={<Upload className="h-3.5 w-3.5" />}
          >
            选择文件
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => folderInputRef.current?.click()}
            disabled={running}
            icon={<FolderOpen className="h-3.5 w-3.5" />}
          >
            选择文件夹
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => handleFilePick(e.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFolderPick(e.target.files)}
          />
        </div>

        <p className="text-[11px] text-text-muted">
          支持 {DOCUMENT_ALLOWED_EXTENSIONS.join(' / ')}，单文件最大 {formatBytes(DOCUMENT_MAX_FILE_SIZE)}。
          文件夹会递归自动过滤不支持/过大的文件。
        </p>

        {items.length > 0 && (
          <>
            <div className="flex items-center gap-3 text-[11px] flex-wrap">
              <span className="text-text-muted">共 {totals.total}</span>
              {totals.prechecking > 0 && (
                <span className="text-text-muted">预检中 {totals.prechecking}</span>
              )}
              {totals.toCreate > 0 && <span className="text-[#3d5a80]">新增 {totals.toCreate}</span>}
              {totals.toOverwrite > 0 && <span className="text-[#cb912f]">覆盖 {totals.toOverwrite}</span>}
              {totals.duplicate > 0 && <span className="text-text-muted">已存在 {totals.duplicate}</span>}
              {totals.rejected > 0 && <span className="text-accent-red">拒收 {totals.rejected}</span>}
              {totals.uploading > 0 && <span className="text-[#cb912f]">上传中 {totals.uploading}</span>}
              {totals.success > 0 && <span className="text-[#448361]">成功 {totals.success}</span>}
              {totals.error > 0 && <span className="text-accent-red">失败 {totals.error}</span>}
              {totals.canceled > 0 && <span className="text-text-muted">已取消 {totals.canceled}</span>}
              {!running && (totals.success > 0 || totals.skipped > 0) && (
                <button
                  type="button"
                  onClick={clearFinished}
                  className="ml-auto text-text-muted hover:text-text-primary cursor-pointer underline-offset-2 hover:underline"
                >
                  清除已结束
                </button>
              )}
            </div>

            {/* 有同名冲突时显示全局策略提示 + 一键按钮;默认策略 = 作为新文档上传(安全)。 */}
            {!running && totals.conflicts > 0 && (
              <div className="text-[11px] border border-[#eadfbe] bg-[#fbf2df] rounded-md px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                <span className="text-[#8a6a1f]">
                  发现 {totals.conflicts} 个同名冲突(默认作为新文档上传)
                </span>
                <button
                  type="button"
                  onClick={() => applyGlobalOverwritePolicy('overwrite-latest')}
                  className="text-[#8a6a1f] underline-offset-2 hover:underline cursor-pointer"
                >
                  全部覆盖最近一条
                </button>
                <span className="text-[#8a6a1f]/60">·</span>
                <button
                  type="button"
                  onClick={() => applyGlobalOverwritePolicy('new-all')}
                  className="text-[#8a6a1f] underline-offset-2 hover:underline cursor-pointer"
                >
                  全部新建
                </button>
              </div>
            )}

            <div className="max-h-72 overflow-auto border border-border-default rounded-md divide-y divide-border-default bg-white">
              {items.map((it) => (
                <QueueItemRow
                  key={it.id}
                  item={it}
                  canRemove={!running || (it.status !== 'uploading' && it.status !== 'pending')}
                  canRetry={!running && (it.status === 'error' || it.status === 'canceled')}
                  canToggle={!running && it.status === 'pending' && !!it.precheck}
                  onRemove={() => removeItem(it.id)}
                  onRetry={() => retryItem(it.id)}
                  onToggleSelect={(next) => toggleSelected(it.id, next)}
                  onChangeTarget={(docId) => setTargetDocId(it.id, docId)}
                />
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={handleClose}>
            {running ? '关闭' : '关闭'}
          </Button>
          {running ? (
            <Button variant="secondary" onClick={cancelBatch}>
              中止队列
            </Button>
          ) : (
            <Button
              onClick={startBatch}
              disabled={totals.plannedUpload === 0 || totals.prechecking > 0}
              icon={<Upload className="h-3.5 w-3.5" />}
            >
              {totals.prechecking > 0
                ? `预检中 (${totals.prechecking})`
                : totals.plannedUpload > 0
                  ? `开始上传 (${totals.plannedUpload})`
                  : '开始上传'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function QueueItemRow({
  item,
  canRemove,
  canRetry,
  canToggle,
  onRemove,
  onRetry,
  onToggleSelect,
  onChangeTarget,
}: {
  item: QueueItem;
  canRemove: boolean;
  canRetry: boolean;
  canToggle: boolean;
  onRemove: () => void;
  onRetry: () => void;
  onToggleSelect: (next: boolean) => void;
  onChangeTarget: (docId: string | undefined) => void;
}) {
  const existing = item.precheck?.existing;
  const existingList = item.precheck?.existingList;
  // overwrite 分支且还没开始上传时,显示覆盖目标下拉。
  const showTargetSelect =
    item.precheck?.action === 'overwrite' &&
    existingList !== undefined &&
    existingList.length > 0 &&
    (item.status === 'pending' || item.status === 'prechecking');
  return (
    <div className="px-3 py-2 text-[12px]">
      <div className="flex items-start gap-2">
        {/* 勾选框:仅 pending + 有 precheck 结果时可切换;其他态占位一个 spacer 让缩进对齐。 */}
        {canToggle ? (
          <input
            type="checkbox"
            checked={item.selected ?? false}
            onChange={(e) => onToggleSelect(e.target.checked)}
            className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer"
            title="是否上传"
          />
        ) : (
          <div className="mt-1 h-3.5 w-3.5 shrink-0" />
        )}
        <StatusIcon status={item.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-text-primary truncate font-mono text-[11px] min-w-0">{item.relPath}</p>
            <PrecheckTag item={item} />
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-muted flex-wrap">
            <span>{formatBytes(item.file.size)}</span>
            <StatusLabel status={item.status} />
            {existing && (
              <span className="text-text-muted truncate">
                · #{existing.id}
                {existing.uploader_display_name ? ` · ${existing.uploader_display_name}` : ''}
                {existing.created_at ? ` · ${formatTs(existing.created_at)}` : ''}
              </span>
            )}
            {/* 本地 reject(没有 precheck 或 action=local_validation)才在这里单独显示 error 文案,
                其他情况 PrecheckTag 已经覆盖原因,避免重复。 */}
            {item.error && (!item.precheck || item.precheck.action === 'local_validation') && (
              <span className="text-accent-red">· {item.error}</span>
            )}
          </div>
          {showTargetSelect && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
              <span className="text-text-muted shrink-0">处理方式:</span>
              <select
                value={item.targetDocId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  onChangeTarget(v === '' ? undefined : v);
                }}
                disabled={!canToggle}
                className="text-[11px] border border-border-default rounded px-1.5 py-0.5 bg-white cursor-pointer disabled:cursor-not-allowed disabled:bg-[#f5f5f3] min-w-0 flex-1 max-w-md"
              >
                <option value="">作为新文档上传(默认)</option>
                {existingList!.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    覆盖《{d.title}》
                    {d.uploader_display_name ? ` · ${d.uploader_display_name}` : ''}
                    {d.updated_at ? ` · ${formatTs(d.updated_at)}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {item.status === 'uploading' && (
            <div className="mt-1.5 h-1 rounded-full bg-[#f1f1ef] overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-150"
                style={{ width: `${item.progress}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-text-muted hover:text-accent cursor-pointer p-1"
              title="重试"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-text-muted hover:text-accent-red cursor-pointer p-1"
              title="移除"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// PrecheckTag 渲染 precheck 后的"会发生什么"chip:新增 / 将覆盖 / 已存在 / 拒收。
// prechecking 态下 precheck 还是 undefined,不显示(主行左侧 StatusIcon 的 spinner 已经提示"进行中")。
//
// 对 overwrite 分支,根据用户 targetDocId 的选择切换颜色/文案:
//   - targetDocId 未定 → 作为新文档上传(蓝色,和 create 同风格)
//   - targetDocId 已定 → 将覆盖某条(橙色警示色)
function PrecheckTag({ item }: { item: QueueItem }) {
  const precheck = item.precheck;
  if (!precheck) return null;
  let cls = 'text-text-muted bg-[#f1f1ef] border-[#e3e2dc]';
  let text: string;
  if (precheck.action === 'overwrite') {
    text = renderOverwriteTagText(item.targetDocId, precheck.existingList);
    // 已选覆盖目标 → 橙色警示;否则(当作新文档)→ 蓝色,和 create 同风格。
    cls = item.targetDocId !== undefined
      ? 'text-[#cb912f] bg-[#fbf2df] border-[#eadfbe]'
      : 'text-[#3d5a80] bg-[#e9eef5] border-[#c5d2e2]';
  } else {
    text = precheckReasonText(precheck.action, precheck.reasonCode, precheck.existing);
    if (precheck.action === 'create') cls = 'text-[#3d5a80] bg-[#e9eef5] border-[#c5d2e2]';
    else if (precheck.action === 'duplicate') cls = 'text-text-muted bg-[#f1f1ef] border-[#e3e2dc]';
    else if (precheck.action === 'reject' || precheck.action === 'local_validation') {
      cls = 'text-accent-red bg-[#fae6e6] border-[#e9bdbd]';
    }
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${cls}`}>{text}</span>
  );
}

function StatusIcon({ status }: { status: ItemStatus }) {
  const cls = 'h-3.5 w-3.5 shrink-0 mt-0.5';
  switch (status) {
    case 'success':
      return <CheckCircle2 className={`${cls} text-[#448361]`} />;
    case 'error':
      return <AlertCircle className={`${cls} text-accent-red`} />;
    case 'uploading':
    case 'prechecking':
      // prechecking 和 uploading 用同一个 spinner,具体语义由右侧 StatusLabel + PrecheckTag 区分。
      return <span className={`${cls} inline-block border-2 border-accent border-t-transparent rounded-full animate-spin`} />;
    case 'skipped':
    case 'canceled':
      return <CircleSlash className={`${cls} text-text-muted`} />;
    case 'pending':
    default:
      return <FileText className={`${cls} text-text-muted`} strokeWidth={1.6} />;
  }
}

const STATUS_LABELS: Record<ItemStatus, string> = {
  prechecking: '预检中',
  pending: '待上传',
  uploading: '上传中',
  success: '成功',
  error: '失败',
  skipped: '已跳过',
  canceled: '已取消',
};

function StatusLabel({ status }: { status: ItemStatus }) {
  return <span className="font-mono text-[10px]">{STATUS_LABELS[status]}</span>;
}

// ── Rename Modal ────────────────────────────────────────────────────────────

interface RenameModalProps {
  doc: DocumentResponse;
  slug: string;
  onClose: () => void;
  onDone: () => void;
}

function RenameDocumentModal({ doc, slug, onClose, onDone }: RenameModalProps) {
  const [title, setTitle] = useState(doc.title);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed === '') {
      setError('标题不能为空');
      return;
    }
    if (Array.from(trimmed).length > DOCUMENT_MAX_TITLE_LENGTH) {
      setError(`标题长度超过 ${DOCUMENT_MAX_TITLE_LENGTH} 字符`);
      return;
    }
    if (trimmed === doc.title) {
      onClose();
      return;
    }
    setError(null);
    setLoading(true);
    const result = await apiCall(
      () => documentApi.updateTitle(slug, doc.id, { title: trimmed }),
      { success: '标题已更新' },
    );
    setLoading(false);
    if (result) {
      onDone();
      onClose();
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="重命名文档">
      <div className="space-y-3">
        <p className="text-[11px] text-text-muted font-mono truncate">{doc.file_name}</p>
        <Input
          label="新标题"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError(null);
          }}
          maxLength={DOCUMENT_MAX_TITLE_LENGTH}
          error={error ?? undefined}
          disabled={loading}
          autoFocus
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>取消</Button>
          <Button onClick={submit} loading={loading}>保存</Button>
        </div>
      </div>
    </Modal>
  );
}
