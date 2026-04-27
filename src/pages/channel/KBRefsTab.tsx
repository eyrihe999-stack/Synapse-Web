// KBRefsTab channel 挂载的知识库引用(source / document)列表 + 增删。
//
// 一条 KB ref 指向一个 source(整库)或一个 document(单个文档)。
// 前端需要 source / document 的名称来展示,不然只能显示 id。
//
// 为简化:先做 source 维度的挂载(调用 /v2/orgs/:slug/sources 拿列表)。
// 单文档维度留给未来扩展(需要遍历每个 source 的 documents 太慢,不如在
// 详情页单独加入口)。
import { useCallback, useEffect, useState } from 'react';
import { Plus, X, Database, FileText, KeySquare, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { channelApi } from '@/api/channel';
import { sourceApi } from '@/api/source';
import { useOrgStore } from '@/store/org';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import type { ChannelKBRefResponse, SourceResponse } from '@/types/api';

interface KBRefsTabProps {
  channelId: number;
  refs: ChannelKBRefResponse[];
  canManage: boolean;
  onRefresh: () => void;
}

export function KBRefsTab({ channelId, refs, canManage, onRefresh }: KBRefsTabProps) {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const [sources, setSources] = useState<SourceResponse[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedSource, setSelectedSource] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSources = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const res = await sourceApi.list(currentOrg.org.slug);
      setSources(res.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    }
  }, [currentOrg]);

  useEffect(() => {
    if (showAdd) loadSources();
  }, [showAdd, loadSources]);

  const sourceByID = new Map(sources.map((s) => [Number(s.id), s]));
  const linkedSourceIDs = new Set(refs.filter((r) => r.kb_source_id).map((r) => r.kb_source_id!));

  const addRef = async () => {
    if (!selectedSource) return;
    setSaving(true);
    const res = await apiCall(() =>
      channelApi.addKBRef(channelId, { kb_source_id: selectedSource }),
    );
    setSaving(false);
    if (res.ok) {
      toast('success', '已挂载');
      setShowAdd(false);
      setSelectedSource(null);
      onRefresh();
    }
  };

  const removeRef = async (r: ChannelKBRefResponse) => {
    if (!confirm('取消挂载这条 KB 引用?')) return;
    const res = await apiCall(() => channelApi.removeKBRef(channelId, r.id));
    if (res.ok) {
      toast('success', '已移除');
      onRefresh();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-text-muted">
          挂载的知识库引用会被顶级 agent 作为资料上下文({refs.length})
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={onRefresh}
            title="刷新"
          />
          {canManage && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowAdd(true)}
            >
              挂载知识源
            </Button>
          )}
        </div>
      </div>

      {refs.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#e3e2dc] py-8 text-center text-text-muted">
          <Database className="mx-auto w-6 h-6 mb-2" strokeWidth={1.5} />
          <p className="text-[13px]">这个 channel 还没有挂载任何知识库</p>
          <p className="text-[11px] mt-1">挂载后,agent 被 @ 时会把引用的资料作为上下文</p>
        </div>
      ) : (
        <div className="rounded-md border border-[#e8e7e3] bg-white overflow-hidden">
          {refs.map((r, idx) => {
            const source = r.kb_source_id ? sourceByID.get(r.kb_source_id) : undefined;
            return (
              <div
                key={r.id}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2',
                  idx > 0 && 'border-t border-[#f0efe9]',
                )}
              >
                {r.kb_source_id ? (
                  <KeySquare className="w-4 h-4 text-[#2383e2]" strokeWidth={1.8} />
                ) : (
                  <FileText className="w-4 h-4 text-[#2383e2]" strokeWidth={1.8} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-text-primary truncate">
                    {r.kb_source_id
                      ? source?.name || `知识源 #${r.kb_source_id}`
                      : `文档 #${r.kb_document_id}`}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    挂载于{' '}
                    {formatRelativeWithAbsSeconds(Math.floor(new Date(r.added_at).getTime() / 1000))}
                  </p>
                </div>
                {canManage && (
                  <button
                    onClick={() => removeRef(r)}
                    className="p-1 text-text-muted hover:text-[#d44c47]"
                    title="移除挂载"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="挂载知识源">
        <div className="space-y-4">
          {sources.length === 0 ? (
            <p className="text-[13px] text-text-muted py-4 text-center">
              当前组织还没有知识源,先去"知识源"页面创建
            </p>
          ) : (
            <>
              <div>
                <label className="block text-[13px] text-text-secondary mb-1">选择知识源</label>
                <div className="max-h-[260px] overflow-y-auto rounded border border-[#e3e2dc] bg-white">
                  {sources.map((s) => {
                    const alreadyLinked = linkedSourceIDs.has(Number(s.id));
                    return (
                      <label
                        key={s.id}
                        className={clsx(
                          'flex items-center gap-2 px-3 py-1.5 border-b border-[#f0efe9] last:border-b-0',
                          alreadyLinked
                            ? 'opacity-50 cursor-not-allowed'
                            : selectedSource === Number(s.id)
                              ? 'bg-[#2383e2]/[0.06] cursor-pointer'
                              : 'hover:bg-[#f4f3ef] cursor-pointer',
                        )}
                      >
                        <input
                          type="radio"
                          name="add-source"
                          disabled={alreadyLinked}
                          checked={selectedSource === Number(s.id)}
                          onChange={() => setSelectedSource(Number(s.id))}
                          className="shrink-0"
                        />
                        <KeySquare className="w-4 h-4 text-[#2383e2]" strokeWidth={1.8} />
                        <span className="text-[13px] text-text-primary flex-1 min-w-0 truncate">
                          {s.name}
                        </span>
                        {alreadyLinked && (
                          <span className="text-[11px] text-text-muted">已挂载</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowAdd(false)}>
                  取消
                </Button>
                <Button onClick={addRef} loading={saving} disabled={!selectedSource}>
                  挂载
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
