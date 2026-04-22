// DocumentDetailPage 文档详情独立子页。
//
// 路由:/org/knowledge/docs/:id
// 独立于 KnowledgePage tabs 之外 —— 详情页聚焦阅读,不要 tab 切换干扰。
// 顶部栏:返回 · 文档标题 · 删除。Body:元数据 / 原文 两个 tab。
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Trash2, History, RotateCcw, Check, KeySquare } from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { toast } from '@/components/ui/Toast';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { formatBytes, formatTs } from '@/lib/format';
import { useOrgStore } from '@/store/org';
import { documentApi } from '@/api/document';
import type { GetDocResponse, DocumentVersionResponse } from '@/types/api';

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;

  const [data, setData] = useState<GetDocResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'meta' | 'content' | 'versions'>('content');

  // 当前"正在看哪个版本"。undefined = 跟随 doc.version(当前最新);
  // 设成某个历史 hash 后,原文 tab 会带 version=<hash> 拉历史内容。
  const [selectedVersion, setSelectedVersion] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!slug || !id) return;
    let cancelled = false;
    setLoading(true);
    documentApi
      .get(slug, id)
      .then((res) => {
        if (!cancelled) setData(res.data.result ?? null);
      })
      .catch((err) => {
        if (!cancelled) toast('error', getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, id]);

  const handleDelete = useCallback(async () => {
    if (!slug || !id || !data) return;
    const label = data.doc.title || data.doc.file_name;
    if (!confirm(`确定要删除文档「${label}」吗？关联的向量 chunks 会一并删除。`)) return;
    const res = await apiCall(() => documentApi.remove(slug, id), { success: '文档已删除' });
    if (res.ok) navigate('/org/knowledge/docs');
  }, [slug, id, data, navigate]);

  if (!slug) {
    return (
      <GlassCard>
        <p className="py-8 text-center text-[13px] text-text-muted">请先选择组织</p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部栏:返回 + 标题 + 删除 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => navigate('/org/knowledge/docs')}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[18px] font-semibold text-text-primary">
            {data?.doc.title || data?.doc.file_name || (loading ? '加载中...' : '文档')}
          </h1>
          {data && (
            <div className="flex items-center gap-3 mt-0.5">
              <p className="truncate font-mono text-[12px] text-text-muted">{data.doc.file_name}</p>
              {data.doc.knowledge_source_id && data.doc.knowledge_source_id !== '0' && (
                <Link
                  to="/org/sources"
                  className="flex items-center gap-1 text-[11px] text-accent bg-accent/[0.06] px-1.5 py-[1px] rounded hover:bg-accent/[0.12] cursor-pointer shrink-0"
                  title="跳到知识源管理 · 此 doc 所属的 source 决定了它的 visibility 和 ACL"
                >
                  <KeySquare className="h-2.5 w-2.5" />
                  知识源 #{data.doc.knowledge_source_id}
                </Link>
              )}
            </div>
          )}
        </div>
        {data && (
          <Button variant="danger" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
            删除
          </Button>
        )}
      </div>

      {loading ? (
        <GlassCard>
          <div className="flex items-center justify-center py-10 text-[13px] text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中...
          </div>
        </GlassCard>
      ) : !data ? (
        <GlassCard>
          <p className="py-8 text-center text-[13px] text-text-muted">文档不存在或已被删除</p>
        </GlassCard>
      ) : (
        <GlassCard>
          <div className="space-y-3">
            <div className="flex gap-1 border-b border-border-default">
              <TabButton active={view === 'content'} onClick={() => setView('content')}>
                原文
              </TabButton>
              <TabButton active={view === 'versions'} onClick={() => setView('versions')}>
                版本历史
              </TabButton>
              <TabButton active={view === 'meta'} onClick={() => setView('meta')}>
                元数据
              </TabButton>
            </div>
            {view === 'meta' ? (
              <div className="space-y-2">
                <DetailRow label="标题" value={data.doc.title || '—'} />
                <DetailRow label="文件名" value={data.doc.file_name} mono />
                <DetailRow label="Provider" value={data.doc.provider} mono />
                <DetailRow label="MIME" value={data.doc.mime_type || '—'} mono />
                <DetailRow label="版本" value={data.doc.version || '—'} mono />
                <DetailRow label="大小" value={formatBytes(data.doc.content_byte_size)} />
                <DetailRow
                  label="Chunks"
                  value={`${data.chunks_indexed} 已索引 / ${data.chunks_failed} 失败 / ${data.doc.chunk_count} 总计`}
                />
                <DetailRow label="上传时间" value={formatTs(data.doc.created_at)} />
                <DetailRow label="更新时间" value={formatTs(data.doc.updated_at)} />
                <DetailRow
                  label="所属知识源"
                  value={
                    data.doc.knowledge_source_id && data.doc.knowledge_source_id !== '0'
                      ? `#${data.doc.knowledge_source_id}(到「知识源」页面管理 visibility / ACL)`
                      : '— (历史 doc,可重跑 migration 回填)'
                  }
                />
              </div>
            ) : view === 'versions' ? (
              <VersionsTab
                slug={slug}
                docId={data.doc.id}
                currentVersion={data.doc.version}
                selectedVersion={selectedVersion}
                onSelect={(hash) => {
                  // 点某条版本 → 记下 + 切到"原文" tab 自动拉该版本内容。
                  // 选当前版本 hash 时把 selectedVersion 置 undefined,视觉上等同于"跟随最新"。
                  setSelectedVersion(hash === data.doc.version ? undefined : hash);
                  setView('content');
                }}
              />
            ) : (
              <div className="space-y-3">
                {selectedVersion && selectedVersion !== data.doc.version && (
                  <HistoricalVersionBanner
                    onReset={() => setSelectedVersion(undefined)}
                    hash={selectedVersion}
                  />
                )}
                <DocumentContentView
                  slug={slug}
                  docId={data.doc.id}
                  version={selectedVersion ?? data.doc.version}
                />
              </div>
            )}
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// HistoricalVersionBanner 顶部提示条,用户切到非当前版本时显示。
// 一眼让用户知道"我在看旧的"并给一键回到最新的按钮。
function HistoricalVersionBanner({ hash, onReset }: { hash: string; onReset: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2">
      <History className="h-3.5 w-3.5 text-amber-700 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-amber-900">
          正在查看历史版本 <span className="font-mono">{hash.slice(0, 8)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="flex items-center gap-1 rounded text-[11px] text-amber-900 hover:underline cursor-pointer"
      >
        <RotateCcw className="h-3 w-3" />
        回到当前版本
      </button>
    </div>
  );
}

// VersionsTab 版本列表。切到此 tab 时才拉 /versions,避免无谓请求。
// 版本数量受 OSS.MaxVersionsPerDocument 约束(默认 10),不做分页。
function VersionsTab({
  slug,
  docId,
  currentVersion,
  selectedVersion,
  onSelect,
}: {
  slug: string;
  docId: string;
  currentVersion: string;
  selectedVersion: string | undefined;
  onSelect: (hash: string) => void;
}) {
  const [versions, setVersions] = useState<DocumentVersionResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    documentApi
      .listVersions(slug, docId)
      .then((res) => {
        if (!cancelled) setVersions(res.data.result?.items ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, docId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-[13px] text-text-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载版本列表...
      </div>
    );
  }
  if (error) {
    return <p className="py-4 text-center text-[13px] text-red-500">版本列表加载失败:{error}</p>;
  }
  if (!versions || versions.length === 0) {
    return <p className="py-6 text-center text-[13px] text-text-muted">没有版本记录</p>;
  }

  // "正在查看"判定:
  //   - selectedVersion 未设 → 跟随当前,高亮 is_current 那条
  //   - selectedVersion 已设 → 高亮匹配的那条
  const activeHash = selectedVersion ?? currentVersion;

  return (
    <div className="space-y-0">
      <p className="text-[11px] text-text-muted pb-2">
        共 {versions.length} 个版本(最新在上)。点任意版本查看对应的原文内容。
      </p>
      {versions.map((v) => {
        const isActive = v.version_hash === activeHash;
        return (
          <button
            key={v.version_hash}
            type="button"
            onClick={() => onSelect(v.version_hash)}
            className={clsx(
              'flex w-full items-center gap-3 py-2.5 px-2 -mx-2 border-b border-border-default last:border-0 text-left transition-colors cursor-pointer rounded',
              isActive ? 'bg-accent/[0.06]' : 'hover:bg-bg-secondary',
            )}
          >
            <div
              className={clsx(
                'h-7 w-7 rounded-md flex items-center justify-center shrink-0',
                v.is_current ? 'bg-accent/[0.12]' : 'bg-bg-secondary',
              )}
            >
              {v.is_current ? (
                <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2} />
              ) : (
                <History className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.6} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-medium text-text-primary">
                  {formatTs(v.created_at)}
                </span>
                {v.is_current && (
                  <span className="text-[10px] text-accent bg-accent/[0.08] px-1.5 py-[1px] rounded">
                    当前版本
                  </span>
                )}
                {isActive && !v.is_current && (
                  <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-[1px] rounded">
                    查看中
                  </span>
                )}
              </div>
              <p
                className="text-[11px] text-text-muted font-mono truncate"
                title={v.version_hash}
              >
                {v.version_hash.slice(0, 16)}… · {formatBytes(v.file_size)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 text-[12px] font-medium border-b-2 -mb-px transition-colors cursor-pointer',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center py-1.5 border-b border-border-default last:border-0">
      <span className="text-[12px] text-text-muted w-24 shrink-0">{label}</span>
      <span className={clsx('text-[13px] text-text-primary', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

// DocumentContentView 原文懒加载 —— 切到"原文" tab 才拉 /content。
// version 用于 URL 携带 sha256,命中后端 immutable cache。
function DocumentContentView({
  slug,
  docId,
  version,
}: {
  slug: string;
  docId: string;
  version?: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    documentApi
      .getContent(slug, docId, version)
      .then((res) => {
        if (!cancelled) setContent(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, docId, version]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-[13px] text-text-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载原文中...
      </div>
    );
  }
  if (error) {
    return <p className="py-4 text-center text-[13px] text-red-500">原文加载失败:{error}</p>;
  }
  if (!content) {
    return <p className="py-4 text-center text-[13px] text-text-muted">—</p>;
  }
  return (
    <div className="rounded border border-border-default bg-bg-primary px-4 py-3">
      <div className="text-[13px] leading-relaxed text-text-primary">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

// markdownComponents 不走 @tailwindcss/typography(未装),给每个标签配明确的 Tailwind 类。
const markdownComponents = {
  h1: (props: React.ComponentProps<'h1'>) => (
    <h1 className="mt-4 mb-3 text-[20px] font-semibold text-text-primary" {...props} />
  ),
  h2: (props: React.ComponentProps<'h2'>) => (
    <h2 className="mt-4 mb-2 text-[17px] font-semibold text-text-primary" {...props} />
  ),
  h3: (props: React.ComponentProps<'h3'>) => (
    <h3 className="mt-3 mb-2 text-[15px] font-semibold text-text-primary" {...props} />
  ),
  h4: (props: React.ComponentProps<'h4'>) => (
    <h4 className="mt-3 mb-1.5 text-[13px] font-semibold text-text-primary" {...props} />
  ),
  p: (props: React.ComponentProps<'p'>) => <p className="my-2" {...props} />,
  ul: (props: React.ComponentProps<'ul'>) => (
    <ul className="my-2 pl-5 list-disc space-y-1" {...props} />
  ),
  ol: (props: React.ComponentProps<'ol'>) => (
    <ol className="my-2 pl-5 list-decimal space-y-1" {...props} />
  ),
  li: (props: React.ComponentProps<'li'>) => <li className="leading-relaxed" {...props} />,
  a: (props: React.ComponentProps<'a'>) => (
    <a
      className="text-accent underline decoration-accent/30 hover:decoration-accent"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  blockquote: (props: React.ComponentProps<'blockquote'>) => (
    <blockquote
      className="my-3 border-l-2 border-border-default pl-3 italic text-text-muted"
      {...props}
    />
  ),
  code: ({
    className,
    children,
    ...rest
  }: React.ComponentProps<'code'> & { inline?: boolean }) => {
    const isBlock = /language-/.test(className ?? '');
    if (isBlock) {
      return (
        <code className={clsx('font-mono text-[12px]', className)} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-bg-secondary px-1 py-0.5 font-mono text-[12px] text-text-primary"
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre: (props: React.ComponentProps<'pre'>) => (
    <pre
      className="my-3 overflow-x-auto rounded border border-border-default bg-bg-secondary p-3 text-[12px]"
      {...props}
    />
  ),
  hr: (props: React.ComponentProps<'hr'>) => (
    <hr className="my-4 border-border-default" {...props} />
  ),
  table: (props: React.ComponentProps<'table'>) => (
    <div className="my-3 overflow-x-auto">
      <table
        className="w-full border-collapse border border-border-default text-[12px]"
        {...props}
      />
    </div>
  ),
  th: (props: React.ComponentProps<'th'>) => (
    <th
      className="border border-border-default bg-bg-secondary px-2 py-1 text-left font-semibold"
      {...props}
    />
  ),
  td: (props: React.ComponentProps<'td'>) => (
    <td className="border border-border-default px-2 py-1" {...props} />
  ),
  strong: (props: React.ComponentProps<'strong'>) => (
    <strong className="font-semibold text-text-primary" {...props} />
  ),
  em: (props: React.ComponentProps<'em'>) => <em className="italic" {...props} />,
  img: (props: React.ComponentProps<'img'>) => (
    <img className="my-3 max-w-full rounded border border-border-default" {...props} />
  ),
};
