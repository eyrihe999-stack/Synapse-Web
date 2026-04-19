/**
 * 片段检索(chunk-level semantic search)。
 *
 * 和 DocumentsPage 的关系:
 *   - DocumentsPage:文档管理 + 文档级搜索(fuzzy / semantic),结果是"一篇文档"。
 *   - 本页:纯搜索工具,结果是"一段原文命中",不包含文档 CRUD 能力。
 *
 * 设计取向:搜索即消费。用户输入问题 → 直接看到命中段落的 content,不必下载 OSS 原文。
 * 同一文档的多个 chunk 都会独立成行;按 similarity 降序排列。
 *
 * 与能力探测:
 *   - 需要 PermDocumentRead 权限,无权限时整页 gate。
 *   - 需要后端 semantic 索引三元齐备(复用 getUploadConfig 的 semantic_search_enabled);
 *     未启用时显示明确的"索引未配置"提示,搜索框置灰。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  FileSearch,
  FileText,
  X,
  ExternalLink,
  Sparkles,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { DocumentTabs } from '@/components/ui/DocumentTabs';
import { toast } from '@/components/ui/Toast';
import { useOrgStore } from '@/store/org';
import { documentApi, downloadDocument } from '@/api/document';
import { getErrorMessage } from '@/lib/api-helpers';
import type { ChunkSearchResult, DocumentSource } from '@/types/api';

/** 服务端 MaxSemanticTopK = 50;超过会被 clamp 回默认值。 */
const TOP_K_CHOICES = [10, 20, 50] as const;
const DEFAULT_TOP_K = 20;

/** 输入防抖。片段检索每次命中都要打 Azure embedding,和语义搜索同一档位。 */
const DEBOUNCE_MS = 700;

/** 单段预览截断阈值。超过此长度显示"展开/收起"按钮。 */
const PREVIEW_CHAR_LIMIT = 500;

const PERM_READ = 'document.read';

export function DocumentChunksPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const perms = currentOrg?.my_role.permissions ?? [];
  const canRead = perms.includes(PERM_READ);

  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [topK, setTopK] = useState<number>(DEFAULT_TOP_K);

  const [items, setItems] = useState<ChunkSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  /** 语义索引能力探测:未启用时 UI 要明确提示用户。 */
  const [semanticEnabled, setSemanticEnabled] = useState<boolean | null>(null); // null = 探测中

  /**
   * 并发保护:新请求发起时递增 seq,返回时若不是最新 seq 就丢弃结果。
   * 防止"先发的慢请求后回来覆盖掉新请求结果"。
   */
  const fetchSeqRef = useRef(0);

  const fetchChunks = useCallback(
    async (query: string) => {
      if (!slug) return;
      const seq = ++fetchSeqRef.current;
      if (!query) {
        // 空 query 本地短路,不打后端。
        setItems([]);
        setHasSearched(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      setHasSearched(true);
      try {
        const res = await documentApi.searchChunks(slug, { q: query, top_k: topK });
        if (seq !== fetchSeqRef.current) return;
        const body = res.data;
        if (body.code && body.code !== 200) {
          toast('error', body.message || '搜索失败');
          setItems([]);
          return;
        }
        setItems(body.result?.items ?? []);
      } catch (err) {
        if (seq !== fetchSeqRef.current) return;
        toast('error', getErrorMessage(err));
        setItems([]);
      } finally {
        if (seq === fetchSeqRef.current) setLoading(false);
      }
    },
    [slug, topK],
  );

  // 输入防抖 → appliedQuery。
  useEffect(() => {
    const id = setTimeout(() => setAppliedQuery(searchInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // 真正触发请求:appliedQuery / topK / slug / 权限 变化时重查。
  useEffect(() => {
    if (!slug || !canRead || !semanticEnabled) {
      setItems([]);
      setHasSearched(false);
      return;
    }
    fetchChunks(appliedQuery);
  }, [slug, canRead, semanticEnabled, appliedQuery, fetchChunks]);

  // 探测语义索引能力。失败/关闭时页面会给明确提示。
  useEffect(() => {
    if (!slug || !canRead) {
      setSemanticEnabled(false);
      return;
    }
    let stale = false;
    setSemanticEnabled(null);
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
    return () => {
      stale = true;
    };
  }, [slug, canRead]);

  // ── 无 org / 无权限 / 能力未启用 的 gate 视图 ──

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="文档" />
        <GlassCard>
          <div className="py-8 text-center">
            <FileSearch className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">请先在顶部选择一个组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader title="文档" subtitle={currentOrg!.org.display_name} />
        <GlassCard>
          <div className="py-8 text-center">
            <FileSearch className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
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
        subtitle={`${currentOrg!.org.display_name} · 按段落级别语义搜索,直接看原文片段`}
        loading={loading}
      />

      <DocumentTabs />

      {/* 索引未启用的显式提示(不阻止输入,但输入框置灰 + 解释清楚) */}
      {semanticEnabled === false && (
        <GlassCard>
          <div className="py-6 text-center">
            <Sparkles
              className="h-8 w-8 text-text-muted mx-auto mb-3"
              strokeWidth={1.2}
            />
            <p className="text-[13px] text-text-primary font-medium">片段检索暂不可用</p>
            <p className="text-[12px] text-text-muted mt-1.5">
              服务端索引组件(pgvector / embedding provider)未完整配置,请联系运维启用。
            </p>
          </div>
        </GlassCard>
      )}

      {semanticEnabled !== false && (
        <>
          {/* 搜索栏 + topK 选择 */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="描述你想找的内容,如「如何配置 JWT 鉴权中间件」"
                maxLength={128}
                disabled={semanticEnabled === null}
                className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border-default bg-white text-[13px] text-text-primary placeholder:text-text-muted shadow-sm focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all duration-100 disabled:opacity-60 disabled:cursor-not-allowed"
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

            {/* topK 选择。改变后 useEffect 会重新请求当前 query。 */}
            <div className="inline-flex rounded-md border border-border-default bg-white overflow-hidden shrink-0 shadow-sm">
              {TOP_K_CHOICES.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTopK(k)}
                  className={`px-2.5 py-1.5 text-[12px] transition-colors border-l border-border-default first:border-l-0 ${
                    topK === k
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:text-text-primary hover:bg-[#f5f5f3]'
                  }`}
                  title={`返回 top ${k} 个相关片段`}
                >
                  top {k}
                </button>
              ))}
            </div>
          </div>

          {/* 结果区 */}
          <ChunkResults
            items={items}
            loading={loading}
            hasSearched={hasSearched}
            query={appliedQuery}
            slug={slug}
          />
        </>
      )}
    </div>
  );
}

// ─── 结果列表 ──────────────────────────────────────────────────────────────

interface ChunkResultsProps {
  items: ChunkSearchResult[];
  loading: boolean;
  hasSearched: boolean;
  query: string;
  slug: string;
}

function ChunkResults({ items, loading, hasSearched, query, slug }: ChunkResultsProps) {
  if (loading && items.length === 0) {
    return (
      <GlassCard>
        <div className="py-10 text-center">
          <div className="h-6 w-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[12px] text-text-muted">正在检索相关片段...</p>
        </div>
      </GlassCard>
    );
  }

  if (!hasSearched) {
    return (
      <GlassCard>
        <div className="py-10 text-center">
          <FileSearch className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
          <p className="text-[13px] text-text-muted">输入关键词或问题开始搜索</p>
          <p className="text-[11px] text-text-muted mt-1.5">
            搜索会直接匹配文档里的段落内容
          </p>
        </div>
      </GlassCard>
    );
  }

  if (items.length === 0) {
    return (
      <GlassCard>
        <div className="py-10 text-center">
          <FileSearch className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
          <p className="text-[13px] text-text-muted">未找到相关片段</p>
          <p className="text-[11px] text-text-muted mt-1.5">
            试试更宽泛的描述,或换一种说法
          </p>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-muted px-1">
        找到 {items.length} 个相关片段 · 按相似度降序
      </p>
      {items.map((item) => (
        <ChunkCard
          key={`${item.doc_id}-${item.chunk_idx}`}
          item={item}
          query={query}
          slug={slug}
        />
      ))}
    </div>
  );
}

// ─── 单个 chunk 卡片 ───────────────────────────────────────────────────────

interface ChunkCardProps {
  item: ChunkSearchResult;
  query: string;
  slug: string;
}

function ChunkCard({ item, query, slug }: ChunkCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const needsTruncation = item.content.length > PREVIEW_CHAR_LIMIT;
  const displayContent = useMemo(() => {
    if (!needsTruncation || expanded) return item.content;
    return item.content.slice(0, PREVIEW_CHAR_LIMIT) + '…';
  }, [item.content, needsTruncation, expanded]);

  // similarity → 百分比显示(0.87 → 87%)
  const similarityPct = Math.round(item.similarity * 100);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('error', '复制失败');
    }
  };

  const handleDownloadSource = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // item 里没有 file_name,downloadDocument 需要,用 doc_title 兜底当文件名。
      // 后端 Content-Disposition 会覆盖这里的 download 名,这只是 fallback。
      await downloadDocument(slug, { id: item.doc_id, file_name: item.doc_title });
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <GlassCard>
      <div className="p-3.5 space-y-2.5">
        {/* 头部:文档标题 + 来源徽章 + 相似度 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <FileText
              className="h-3.5 w-3.5 text-text-muted shrink-0"
              strokeWidth={1.6}
            />
            <span className="text-[13px] font-medium text-text-primary truncate">
              {item.doc_title}
            </span>
            <SourceBadge source={item.doc_source} />
            <span className="text-[11px] text-text-muted shrink-0">
              第 {item.chunk_idx + 1} 段
            </span>
          </div>
          <SimilarityBadge pct={similarityPct} />
        </div>

        {/* 片段内容 */}
        <div className="text-[13px] text-text-primary leading-relaxed whitespace-pre-wrap break-words">
          <HighlightedText text={displayContent} query={query} />
        </div>

        {/* 操作栏 */}
        <div className="flex items-center gap-1.5 pt-1 -mx-1">
          {needsTruncation && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-text-muted hover:text-text-primary hover:bg-[#eeede8] cursor-pointer"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" /> 收起
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> 展开全文
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-text-muted hover:text-text-primary hover:bg-[#eeede8] cursor-pointer"
            title="复制此片段"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-accent-green" /> 已复制
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" /> 复制
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadSource}
            disabled={downloading}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-text-muted hover:text-text-primary hover:bg-[#eeede8] cursor-pointer disabled:opacity-40 disabled:cursor-wait"
            title="下载这篇文档的原文"
          >
            <ExternalLink className="h-3 w-3" />
            {downloading ? '下载中…' : '下载原文'}
          </button>
        </div>
      </div>
    </GlassCard>
  );
}

// ─── 辅助 UI ────────────────────────────────────────────────────────────────

function SimilarityBadge({ pct }: { pct: number }) {
  // 颜色分档:>=80 绿、60-79 蓝、<60 灰
  const color =
    pct >= 80
      ? 'text-accent-green bg-accent-green/10'
      : pct >= 60
        ? 'text-accent bg-accent/10'
        : 'text-text-muted bg-[#eeede8]';
  return (
    <span
      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${color}`}
      title={`相似度 ${pct}%`}
    >
      {pct}%
    </span>
  );
}

function SourceBadge({ source }: { source: DocumentSource }) {
  // user 来源不显示徽章(默认不加噪点);只有 AI 产物才标出来。
  if (source !== 'ai-generated') return null;
  return (
    <span
      className="shrink-0 px-1.5 py-0.5 rounded text-[10px] text-accent bg-accent/10 font-medium"
      title="此文档由 AI 生成"
    >
      AI 生成
    </span>
  );
}

/**
 * 关键词高亮。简单实现:把 query 分成若干 token,在 text 里做 case-insensitive 子串匹配。
 * 语义搜索的 query 和 chunk 不一定字面匹配,所以高亮可能稀疏 —— 这是预期行为,别误以为 bug。
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const tokens = useMemo(() => {
    return query
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2) // 单字 token 噪音大,不高亮
      .slice(0, 8); // 最多 8 个,防正则爆炸
  }, [query]);

  if (tokens.length === 0) {
    return <>{text}</>;
  }

  // 构造正则。escapeRegExp 防 token 里有特殊字符时正则语义错乱。
  const pattern = new RegExp(
    `(${tokens.map(escapeRegExp).join('|')})`,
    'gi',
  );
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, idx) => {
        if (idx % 2 === 1) {
          // 捕获组:命中的 token
          return (
            <mark
              key={idx}
              className="bg-accent/20 text-text-primary rounded px-0.5"
            >
              {part}
            </mark>
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
