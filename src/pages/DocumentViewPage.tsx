import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, User as UserIcon, Clock, FileText } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
  type HighlighterGeneric,
} from 'shiki';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrgStore } from '@/store/org';
import { documentApi, downloadDocument, fetchDocumentContent } from '@/api/document';
import { getErrorMessage } from '@/lib/api-helpers';
import { formatBytes, formatTs } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { DocumentResponse } from '@/types/api';

const PERM_READ = 'document.read';
const SHIKI_THEME: BundledTheme = 'github-light';

// 预装载的语言:覆盖你语料里架构文档 + PRD + 测试报告常见栈。
// 不在这里的 language-xxx 会 fallback 到无高亮的 <pre><code>,不会报错。
// 保持短小避免 @shikijs/rehype 那种"加载 200 种语言"的炸 bundle 问题。
const SHIKI_LANGS: BundledLanguage[] = [
  'go', 'typescript', 'javascript', 'tsx', 'jsx',
  'json', 'yaml', 'toml', 'sql',
  'bash', 'shell',
  'markdown', 'html', 'css',
  'dockerfile', 'python', 'rust', 'java',
];

// 单例 highlighter:所有 view 页共用一份,避免重复 init。
// 第一次进入 view 页时懒加载,后续 0 开销。
let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [SHIKI_THEME],
      langs: SHIKI_LANGS,
    });
  }
  return highlighterPromise;
}

function isMarkdownMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return m === 'text/markdown' || m === 'text/x-markdown' || m.endsWith('+markdown');
}

export function DocumentViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const perms = currentOrg?.my_role.permissions ?? [];
  const canRead = perms.includes(PERM_READ);

  const [doc, setDoc] = useState<DocumentResponse | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [highlighter, setHighlighter] = useState<HighlighterGeneric<BundledLanguage, BundledTheme> | null>(null);

  // 提前 fire-and-forget 初始化 highlighter,和 meta/content 请求并发,不阻塞首屏。
  useEffect(() => {
    let stale = false;
    getHighlighter().then((h) => { if (!stale) setHighlighter(h); });
    return () => { stale = true; };
  }, []);

  useEffect(() => {
    if (!slug || !id || !canRead) return;
    let stale = false;
    setLoading(true);
    setError(null);
    Promise.all([
      documentApi.get(slug, id).then((r) => r.data.result),
      fetchDocumentContent(slug, id),
    ]).then(
      ([metaRes, text]) => {
        if (stale) return;
        setDoc(metaRes ?? null);
        setContent(text);
        setLoading(false);
      },
      (err) => {
        if (stale) return;
        setError(getErrorMessage(err));
        setLoading(false);
      },
    );
    return () => { stale = true; };
  }, [slug, id, canRead]);

  // components.code 做的事:
  //   - inline code(单个 `foo`):无 className,保持原样交回默认 <code>。
  //   - block code(```lang\nsrc\n```):按 language-xxx 用 shiki 同步渲染,未加载的语言 fallback 到纯 <pre>。
  //
  // children 是 React 的 ReactNode,把它 String 化再喂给 shiki。trim 尾部换行避免生成一个空行。
  const mdComponents = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match?.[1];
      const src = String(children ?? '').replace(/\n$/, '');

      // inline code:没有 language- 前缀,原样输出。
      if (!lang) {
        return <code className={className} {...props}>{children}</code>;
      }

      // block code:highlighter 没 ready 或语言未加载 → 纯 pre 兜底。
      if (!highlighter || !SHIKI_LANGS.includes(lang as BundledLanguage)) {
        return <pre><code className={className}>{src}</code></pre>;
      }

      let html: string;
      try {
        html = highlighter.codeToHtml(src, { lang: lang as BundledLanguage, theme: SHIKI_THEME });
      } catch {
        return <pre><code className={className}>{src}</code></pre>;
      }
      // shiki 返回的是完整 <pre><code> HTML,直接 innerHTML 注入。
      return <div className="shiki-block" dangerouslySetInnerHTML={{ __html: html }} />;
    },
  }), [highlighter]);

  const handleDownload = async () => {
    if (!slug || !doc || downloading) return;
    setDownloading(true);
    try {
      await downloadDocument(slug, doc);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="文档查看" />
        <GlassCard><div className="p-8 text-center text-text-muted">请先选择一个组织。</div></GlassCard>
      </div>
    );
  }
  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader title="文档查看" />
        <GlassCard><div className="p-8 text-center text-text-muted">没有查看文档的权限。</div></GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => navigate('/org/documents')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>返回列表</span>
        </Button>
        {doc && (
          <Button variant="secondary" onClick={handleDownload} disabled={downloading}>
            <Download className="h-3.5 w-3.5" />
            <span>{downloading ? '下载中…' : '下载原文'}</span>
          </Button>
        )}
      </div>

      {loading && (
        <GlassCard><div className="p-8 text-center text-text-muted">加载中…</div></GlassCard>
      )}

      {error && !loading && (
        <GlassCard>
          <div className="p-8 text-center space-y-2">
            <div className="text-text-primary">{error}</div>
            <div className="text-[12px] text-text-muted">ID: {id}</div>
          </div>
        </GlassCard>
      )}

      {doc && !loading && !error && (
        <>
          <GlassCard>
            <div className="p-4 space-y-2">
              <h1 className="text-[18px] font-semibold text-text-primary break-words">{doc.title}</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-muted">
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />{doc.file_name}
                </span>
                <span className="inline-flex items-center gap-1">
                  <UserIcon className="h-3.5 w-3.5" />{doc.uploader_display_name || `uid:${doc.uploader_id}`}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />{formatTs(doc.updated_at)}
                </span>
                <span>{formatBytes(doc.size_bytes)}</span>
                <span className="font-mono text-[11px]">#{doc.id}</span>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <div className="p-5">
              {isMarkdownMime(doc.mime_type) ? (
                <div className="markdown-body text-[14px] leading-relaxed text-text-primary">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {content}
                  </ReactMarkdown>
                </div>
              ) : (
                <pre className="text-[13px] leading-relaxed text-text-primary whitespace-pre-wrap break-words font-mono">
                  {content}
                </pre>
              )}
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );
}
