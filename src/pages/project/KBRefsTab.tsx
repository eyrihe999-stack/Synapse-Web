// KBRefsTab 项目挂载的 KB(source / document)清单 + 挂载 / 卸载。
//
// 数据模型:project_kb_refs 是一条 ref 要么挂 source(粗粒度,整源)要么挂 doc(细粒度,单文档)。
// PR-A 替换了原 channel_kb_refs;同 org 的 agent / project 成员都看 project 全部 KB。
//
// 反查名字:
//   - source 一次性 list 前 200 条,缓存 id → name 映射(同 org source 总量一般 < 200)
//   - doc 量大不预拉;每条 ref 各自单查 1 次(N 次请求,但通常每 project 挂的 doc 不多)
//
// Attach modal:
//   - 模式 1:挂 source — 下拉选 visible source
//   - 模式 2:挂 document — 内嵌搜索框,debounced 搜 doc by title(documentApi.list?q=)
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database, Plus, Trash2, FolderOpen, FileText, Calendar, User, RefreshCw,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { projectApi } from '@/api/project';
import { sourceApi } from '@/api/source';
import { documentApi } from '@/api/document';
import { apiCall } from '@/lib/api-helpers';
import { useOrgStore } from '@/store/org';
import type {
  ProjectKBRefResponse, SourceResponse, DocumentDTO,
} from '@/types/api';
import { formatDateOnly } from './helpers';

interface KBRefsTabProps {
  projectID: number;
  archived: boolean; // project archived
}

export function KBRefsTab({ projectID, archived }: KBRefsTabProps) {
  const orgSlug = useOrgStore((s) => s.currentOrg?.org.slug);
  const [refs, setRefs] = useState<ProjectKBRefResponse[]>([]);
  const [sourceMap, setSourceMap] = useState<Map<string, SourceResponse>>(new Map());
  // doc 反查:lazy 单查 + 缓存
  const [docMap, setDocMap] = useState<Map<string, DocumentDTO>>(new Map());
  const [loading, setLoading] = useState(false);
  const [showAttach, setShowAttach] = useState(false);

  const fetchRefs = useCallback(async () => {
    if (!orgSlug) return;
    setLoading(true);
    const [rRes, sRes] = await Promise.all([
      apiCall(() => projectApi.listKBRefs(projectID)),
      apiCall(() => sourceApi.list(orgSlug, 1, 200)),
    ]);
    setLoading(false);
    if (rRes.ok && rRes.data) setRefs(rRes.data);
    if (sRes.ok && sRes.data) {
      const m = new Map<string, SourceResponse>();
      for (const s of sRes.data.items ?? []) m.set(s.id, s);
      setSourceMap(m);
    }
  }, [projectID, orgSlug]);

  useEffect(() => {
    fetchRefs();
  }, [fetchRefs]);

  // 异步 lazy 反查 doc 名字
  useEffect(() => {
    if (!orgSlug) return;
    const missing = refs
      .filter((r) => r.kb_document_id)
      .map((r) => String(r.kb_document_id))
      .filter((id) => !docMap.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        missing.map((id) =>
          apiCall(() => documentApi.get(orgSlug, id)).then((res) =>
            res.ok && res.data ? { id, doc: res.data.doc } : null,
          ),
        ),
      );
      if (cancelled) return;
      setDocMap((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r) next.set(r.id, r.doc);
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [refs, orgSlug, docMap]);

  const detach = async (ref: ProjectKBRefResponse) => {
    const what = ref.kb_source_id
      ? sourceMap.get(String(ref.kb_source_id))?.name ?? `Source #${ref.kb_source_id}`
      : docMap.get(String(ref.kb_document_id))?.title ?? `Document #${ref.kb_document_id}`;
    if (!confirm(`卸载「${what}」?`)) return;
    const res = await apiCall(() => projectApi.detachKBRef(ref.id));
    if (res.ok) {
      toast('success', '已卸载');
      fetchRefs();
    }
  };

  const sourceOpts = useMemo(
    () => Array.from(sourceMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [sourceMap],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-text-muted">
          {refs.length} 项 KB 挂载 · 项目下所有 agent / 成员都能读
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className={loading ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />}
            onClick={fetchRefs}
            disabled={loading}
            title="刷新"
          />
          {!archived && (
            <Button
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowAttach(true)}
            >
              挂载 KB
            </Button>
          )}
        </div>
      </div>

      {refs.length === 0 ? (
        <GlassCard>
          <div className="py-6 text-center text-text-muted">
            <Database className="mx-auto w-6 h-6 mb-2" strokeWidth={1.5} />
            <p className="text-[13px]">还没有挂载 KB</p>
            <p className="text-[11px] mt-1">
              挂上 KB 后,该 project 下所有 agent(包括 Architect)能看到这些数据,
              用于回答跨任务问题。
            </p>
          </div>
        </GlassCard>
      ) : (
        <div className="rounded-md border border-[#e8e7e3] bg-white">
          {refs.map((ref, idx) => (
            <KBRefRow
              key={ref.id}
              ref_={ref}
              source={ref.kb_source_id ? sourceMap.get(String(ref.kb_source_id)) : undefined}
              doc={ref.kb_document_id ? docMap.get(String(ref.kb_document_id)) : undefined}
              borderTop={idx > 0}
              canDetach={!archived}
              onDetach={detach}
            />
          ))}
        </div>
      )}

      <AttachModal
        open={showAttach}
        onClose={() => setShowAttach(false)}
        projectID={projectID}
        orgSlug={orgSlug}
        sourceOpts={sourceOpts}
        attachedSourceIds={new Set(refs.filter((r) => r.kb_source_id).map((r) => String(r.kb_source_id)))}
        attachedDocIds={new Set(refs.filter((r) => r.kb_document_id).map((r) => String(r.kb_document_id)))}
        onAttached={() => {
          setShowAttach(false);
          fetchRefs();
        }}
      />
    </div>
  );
}

// ── 单条 KB ref 行 ─────────────────────────────────────────────────────────

interface KBRefRowProps {
  ref_: ProjectKBRefResponse;
  source: SourceResponse | undefined;
  doc: DocumentDTO | undefined;
  borderTop: boolean;
  canDetach: boolean;
  onDetach: (ref: ProjectKBRefResponse) => void;
}

function KBRefRow({ ref_, source, doc, borderTop, canDetach, onDetach }: KBRefRowProps) {
  const isSource = !!ref_.kb_source_id;
  const Icon = isSource ? FolderOpen : FileText;
  const tone = isSource ? 'blue' : 'purple';
  const label = isSource ? 'Source' : 'Document';
  const name = isSource
    ? source?.name ?? `Source #${ref_.kb_source_id}(数据加载中或已删除)`
    : doc?.title ?? `Document #${ref_.kb_document_id}(数据加载中或已删除)`;
  const secondary = isSource
    ? source?.kind && `kind: ${source.kind}${source.visibility ? ` · ${source.visibility}` : ''}`
    : doc?.file_name && doc.file_name !== doc.title
      ? doc.file_name
      : undefined;

  return (
    <div
      className={`group flex items-start gap-3 px-3 py-2 ${borderTop ? 'border-t border-[#f0efe9]' : ''}`}
    >
      <Icon className="w-4 h-4 text-[#2383e2] mt-0.5 shrink-0" strokeWidth={1.8} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-text-primary truncate">{name}</span>
          <StatusChip tone={tone}>{label}</StatusChip>
        </div>
        {secondary && (
          <p className="text-[11px] text-text-muted mt-0.5 truncate font-mono">{secondary}</p>
        )}
        <div className="flex items-center gap-3 text-[11px] text-text-muted mt-0.5">
          <span className="inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" /> 挂载 {formatDateOnly(ref_.attached_at)}
          </span>
          <span className="inline-flex items-center gap-1">
            <User className="w-3 h-3" /> 挂载人 user#{ref_.attached_by}
          </span>
        </div>
      </div>
      {canDetach && (
        <button
          type="button"
          onClick={() => onDetach(ref_)}
          className="p-1 text-text-muted hover:text-[#d44c47] rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="卸载"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ── 挂载 modal ────────────────────────────────────────────────────────────

interface AttachModalProps {
  open: boolean;
  onClose: () => void;
  projectID: number;
  orgSlug: string | undefined;
  sourceOpts: SourceResponse[];
  attachedSourceIds: Set<string>;
  attachedDocIds: Set<string>;
  onAttached: () => void;
}

function AttachModal({
  open, onClose, projectID, orgSlug,
  sourceOpts, attachedSourceIds, attachedDocIds,
  onAttached,
}: AttachModalProps) {
  const [tab, setTab] = useState<'source' | 'doc'>('source');
  const [selectedSource, setSelectedSource] = useState('');
  const [docQuery, setDocQuery] = useState('');
  const [docResults, setDocResults] = useState<DocumentDTO[]>([]);
  const [docSearching, setDocSearching] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // doc 搜索 debounce
  useEffect(() => {
    if (tab !== 'doc' || !orgSlug) return;
    const q = docQuery.trim();
    if (!q) {
      setDocResults([]);
      return;
    }
    setDocSearching(true);
    const handle = setTimeout(async () => {
      const res = await apiCall(() => documentApi.list(orgSlug, { query: q, limit: 20 }));
      setDocSearching(false);
      if (res.ok && res.data) setDocResults(res.data.docs ?? []);
    }, 300);
    return () => clearTimeout(handle);
  }, [docQuery, tab, orgSlug]);

  const reset = () => {
    setTab('source');
    setSelectedSource('');
    setDocQuery('');
    setDocResults([]);
    setSelectedDoc('');
  };

  const submit = async () => {
    if (tab === 'source') {
      if (!selectedSource) return;
      setSaving(true);
      const res = await apiCall(() =>
        projectApi.attachKBRef(projectID, { kb_source_id: Number(selectedSource) }),
      );
      setSaving(false);
      if (res.ok) {
        toast('success', '已挂载 source');
        reset();
        onAttached();
      }
    } else {
      if (!selectedDoc) return;
      setSaving(true);
      const res = await apiCall(() =>
        projectApi.attachKBRef(projectID, { kb_document_id: Number(selectedDoc) }),
      );
      setSaving(false);
      if (res.ok) {
        toast('success', '已挂载 document');
        reset();
        onAttached();
      }
    }
  };

  const filteredSourceOpts = sourceOpts.filter(
    (s) => !attachedSourceIds.has(s.id),
  );

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="挂载 KB"
    >
      <div className="space-y-4">
        <div className="flex gap-1 p-0.5 bg-[#eeede8] rounded">
          <button
            type="button"
            onClick={() => setTab('source')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[13px] rounded transition-colors ${
              tab === 'source'
                ? 'bg-white text-text-primary shadow-sm font-medium'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" /> Source(整源)
          </button>
          <button
            type="button"
            onClick={() => setTab('doc')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[13px] rounded transition-colors ${
              tab === 'doc'
                ? 'bg-white text-text-primary shadow-sm font-medium'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Document(单文档)
          </button>
        </div>

        {tab === 'source' ? (
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">
              选择 source(只列还没挂的)
            </label>
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white"
            >
              <option value="">— 选择 source —</option>
              {filteredSourceOpts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}({s.kind} · {s.visibility})
                </option>
              ))}
            </select>
            {filteredSourceOpts.length === 0 && (
              <p className="mt-1.5 text-[11px] text-text-muted">
                {sourceOpts.length === 0
                  ? '当前 org 没有可挂的 source。先去 Sources 页建一个'
                  : '所有 source 都已挂载,没有可挂的'}
              </p>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-[13px] text-text-secondary mb-1">
              搜索 document(按标题模糊匹配)
            </label>
            <input
              type="text"
              value={docQuery}
              onChange={(e) => setDocQuery(e.target.value)}
              placeholder="输入文档标题关键词..."
              className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white focus:outline-none focus:border-[#2383e2]"
            />
            <div className="mt-2 max-h-[200px] overflow-y-auto rounded border border-[#e3e2dc] bg-white">
              {docSearching ? (
                <p className="text-[12px] text-text-muted text-center py-3">搜索中...</p>
              ) : docResults.length === 0 ? (
                <p className="text-[12px] text-text-muted text-center py-3">
                  {docQuery.trim() ? '没找到匹配的 document' : '输入关键词开始搜索'}
                </p>
              ) : (
                docResults.map((d) => {
                  const already = attachedDocIds.has(d.id);
                  const checked = selectedDoc === d.id;
                  return (
                    <label
                      key={d.id}
                      className={`flex items-center gap-2 px-3 py-1.5 border-b border-[#f0efe9] last:border-b-0 ${
                        already
                          ? 'opacity-50 cursor-not-allowed'
                          : checked
                            ? 'bg-[#2383e2]/[0.06] cursor-pointer'
                            : 'cursor-pointer hover:bg-[#f4f3ef]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="doc-pick"
                        disabled={already}
                        checked={checked}
                        onChange={() => !already && setSelectedDoc(d.id)}
                        className="shrink-0"
                      />
                      <FileText className="w-3.5 h-3.5 text-[#8a5cf6] shrink-0" strokeWidth={1.8} />
                      <span className="text-[12px] text-text-primary truncate flex-1">
                        {d.title}
                      </span>
                      {already && (
                        <span className="text-[10px] text-text-muted">已挂载</span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

        <p className="text-[11px] text-text-muted">
          挂 source 是粗粒度(整个数据源全文档,后续 source 加文档自动可见);
          挂 document 是细粒度(只这一份文档)。
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            取消
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={
              tab === 'source' ? !selectedSource : !selectedDoc
            }
          >
            挂载
          </Button>
        </div>
      </div>
    </Modal>
  );
}
