// DocumentsTab channel 共享文档(PR #9')列表 tab。
//
// 列表视图:每条文档卡片(标题 + 内容类型徽章 + 锁状态徽章 + 最近编辑人/时间)。
// 点击卡片跳到独立路由 /org/channels/:id/documents/:doc_id 查看/编辑。
// 顶部"+ 新建文档"按钮 → 弹窗收 title + content_kind。
//
// 锁状态显示策略:列表只展示"是否被锁",不显示持锁人/过期时间(那些信息留到详情页)。
// MVP 不轮询,刷新按钮手动拉。
//
// 软删交互留在详情页(更不容易误操作);列表只展示未删的。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, Lock, RefreshCw, Hash } from 'lucide-react';
// Lock 图标已 import,用于"X 编辑中"徽章
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { channelApi } from '@/api/channel';
import { apiCall } from '@/lib/api-helpers';
import { formatRelativeWithAbsSeconds } from '@/lib/format';
import type { ChannelDocumentResponse, ChannelDocumentKind } from '@/types/api';
import type { PrincipalDirEntry } from '@/hooks/useOrgPrincipals';

interface DocumentsTabProps {
  channelId: number;
  /** channel 是否归档:归档后隐藏新建按钮但仍可点进去看 */
  archived: boolean;
  principalDirByID: Map<number, PrincipalDirEntry>;
}

export function DocumentsTab({ channelId, archived, principalDirByID }: DocumentsTabProps) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<ChannelDocumentResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const fetchDocs = async () => {
    setLoading(true);
    const res = await apiCall(() => channelApi.listDocuments(channelId));
    setLoading(false);
    if (res.ok) setDocs(res.data ?? []);
  };

  useEffect(() => {
    if (channelId) fetchDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-text-muted">
          channel 内多人共建的文档,独占编辑锁防并发({docs.length})
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={fetchDocs}
            title="刷新"
          />
          {!archived && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowCreate(true)}
            >
              新建文档
            </Button>
          )}
        </div>
      </div>

      {loading && docs.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#e3e2dc] py-8 text-center text-text-muted">
          <p className="text-[13px]">加载中…</p>
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#e3e2dc] py-8 text-center text-text-muted">
          <FileText className="mx-auto w-6 h-6 mb-2" strokeWidth={1.5} />
          <p className="text-[13px]">还没有共享文档</p>
          <p className="text-[11px] mt-1">点"新建文档"开始记录 PRD / 会议纪要 / 故障复盘</p>
        </div>
      ) : (
        <div className="rounded-md border border-[#e8e7e3] bg-white overflow-hidden">
          {docs.map((d, idx) => (
            <DocumentRow
              key={d.id}
              doc={d}
              principalDirByID={principalDirByID}
              divider={idx > 0}
              onClick={() => navigate(`/org/channels/${channelId}/documents/${d.id}`)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDocumentModal
          channelId={channelId}
          onClose={() => setShowCreate(false)}
          onCreated={(d) => {
            setShowCreate(false);
            // 直接进编辑,而不是回列表 —— "新建后立即写"是最常见路径
            navigate(`/org/channels/${channelId}/documents/${d.id}`);
          }}
        />
      )}
    </div>
  );
}

// ─── 卡片 ─────────────────────────────────────────────────────────────────

function DocumentRow({
  doc, principalDirByID, divider, onClick,
}: {
  doc: ChannelDocumentResponse;
  principalDirByID: Map<number, PrincipalDirEntry>;
  divider: boolean;
  onClick: () => void;
}) {
  const updatedBy = principalDirByID.get(doc.updated_by_principal_id)?.displayName
    || `principal#${doc.updated_by_principal_id}`;

  // 锁徽章:doc.lock 是后端 list 接口拼回的当前锁(可能空 / 已过期)。
  // 已过期的锁视为无锁(显示同款 view-only 状态)—— 任何人可抢。
  const activeLock = doc.lock && new Date(doc.lock.expires_at).getTime() > Date.now()
    ? doc.lock
    : null;
  const lockHolderName = activeLock
    ? principalDirByID.get(activeLock.held_by_principal_id)?.displayName
      || `principal#${activeLock.held_by_principal_id}`
    : null;

  return (
    <div
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#f8f7f3]',
        divider && 'border-t border-[#f0efe9]',
      )}
    >
      <FileText className="w-4 h-4 text-[#2383e2] shrink-0" strokeWidth={1.8} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] text-text-primary font-medium truncate">{doc.title}</p>
          <span className="text-[10px] text-text-muted font-mono">#{doc.id}</span>
          <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-[#f0efe9]">
            {doc.content_kind === 'md' ? 'markdown' : 'text'}
          </span>
          {doc.current_version && (
            <span className="text-[10px] text-text-muted font-mono">
              <Hash className="inline w-2.5 h-2.5 -mt-0.5" />
              {doc.current_version.slice(0, 7)}
            </span>
          )}
          {activeLock && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border border-[#f0d9a6] bg-[#fdf6e6] text-[#9a6814] flex items-center gap-1"
              title={`锁过期时间 ${new Date(activeLock.expires_at).toLocaleTimeString()}`}
            >
              <Lock className="w-2.5 h-2.5" />
              {lockHolderName} 编辑中
            </span>
          )}
        </div>
        <p className="text-[11px] text-text-muted mt-0.5">
          {updatedBy} 更新于{' '}
          {formatRelativeWithAbsSeconds(Math.floor(new Date(doc.updated_at).getTime() / 1000))}
          {doc.current_byte_size > 0 && <> · {formatBytes(doc.current_byte_size)}</>}
        </p>
      </div>
    </div>
  );
}

// ─── 新建弹窗 ──────────────────────────────────────────────────────────────

function CreateDocumentModal({
  channelId, onClose, onCreated,
}: {
  channelId: number;
  onClose: () => void;
  onCreated: (doc: ChannelDocumentResponse) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ChannelDocumentKind>('md');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      toast('error', '标题不能为空');
      return;
    }
    setSaving(true);
    const res = await apiCall(() =>
      channelApi.createDocument(channelId, { title: t, content_kind: kind }),
    );
    setSaving(false);
    if (res.ok && res.data) {
      onCreated(res.data);
    }
  };

  return (
    <Modal open onClose={onClose} title="新建共享文档">
      <div className="space-y-4">
        <div>
          <label className="block text-[13px] text-text-secondary mb-1">标题</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !saving) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="例如:接入 X 系统的部署手册"
            className="w-full px-3 py-2 text-[13px] border border-[#e3e2dc] rounded focus:border-[#2383e2] outline-none"
            maxLength={128}
          />
          <p className="text-[11px] text-text-muted mt-1">最多 128 字</p>
        </div>
        <div>
          <label className="block text-[13px] text-text-secondary mb-1">内容类型</label>
          <div className="flex gap-3">
            {(['md', 'text'] as const).map((k) => (
              <label
                key={k}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 border rounded cursor-pointer text-[13px]',
                  kind === k
                    ? 'border-[#2383e2] bg-[#2383e2]/[0.06] text-[#2366a8]'
                    : 'border-[#e3e2dc] hover:bg-[#f8f7f3]',
                )}
              >
                <input
                  type="radio"
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="hidden"
                />
                {k === 'md' ? 'Markdown' : '纯文本'}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={submit} loading={saving}>创建</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
