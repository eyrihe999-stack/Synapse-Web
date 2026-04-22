import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, FolderOpen, AlertCircle, Upload, KeySquare } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { formatBytes } from '@/lib/format';
import type { SourceResponse } from '@/types/api';

interface StagedFile {
  key: string;
  file: File;
  path: string; // webkitRelativePath || name,文件夹上传时带相对路径
  ext: string;
  size: number;
  reason?: 'oversized' | 'unsupported';
}

interface UploadStagingModalProps {
  /** null = 未打开。非空数组 = 打开并展示这批文件。 */
  files: File[] | null;
  onCancel(): void;
  /** sourceId 为空串时表示走默认 manual_upload;否则是 caller 自建的某 source.id。 */
  onConfirm(files: File[], sourceId: string): void;
  allowedExts: string[];
  maxBytes: number;
  /**
   * 当前 caller 在本 org 下作为 owner 的 source 列表(含 manual_upload + 自建 custom),
   * 由父组件通过 sourceApi.listMine 预取。空数组 → 隐藏数据源选择器,默认 manual_upload。
   */
  ownedSources: SourceResponse[];
}

function extFromName(name: string): string {
  const idx = name.toLowerCase().lastIndexOf('.');
  return idx < 0 ? '' : name.slice(idx).toLowerCase();
}

// 标准 File 对象不带 webkitRelativePath 类型,但文件夹上传场景下浏览器会附上这个属性。
// 单文件拖拽 / 普通 picker 时字段为空串,回落到 name。
function webkitPath(f: File): string {
  const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  return p && p.length > 0 ? p : f.name;
}

// pickDefaultSourceId 挑上传弹窗打开时的默认 source:
//   - 有 custom → 最近建的那个 custom(ownedSources 约定 manual 置顶 + custom DESC 排序,
//     取第一个 kind!='manual_upload' 即最新 custom)
//   - 没 custom → 空串,后端 EnsureManualUpload 兜底
function pickDefaultSourceId(owned: SourceResponse[]): string {
  const latestCustom = owned.find((s) => s.kind !== 'manual_upload');
  return latestCustom?.id ?? '';
}

export function UploadStagingModal({
  files,
  onCancel,
  onConfirm,
  allowedExts,
  maxBytes,
  ownedSources,
}: UploadStagingModalProps) {
  const [items, setItems] = useState<StagedFile[]>([]);
  const [enabledExts, setEnabledExts] = useState<Set<string>>(new Set());
  // 选中的 source.id。空串 = 默认"我的上传"(manual_upload lazy 兜底)。
  // 初始值 / 重置值由 pickDefaultSourceId 决定:caller 建过 custom 时默认选最近那个,
  // 避免"我明明刚建了数据源,上传却还是默认进我的上传"。
  const [selectedSourceId, setSelectedSourceId] = useState<string>(() =>
    pickDefaultSourceId(ownedSources),
  );
  // files prop 变了就重置内部 items / enabledExts。走 React 官方"reset on prop change"
  // 模式(render 里比较 prev → setState),而非 useEffect —— 后者会被 react-hooks lint 视为
  // 级联 rerender 反模式,且会多跑一次 render。
  const [prevFiles, setPrevFiles] = useState(files);
  if (files !== prevFiles) {
    setPrevFiles(files);
    if (files) {
      const staged: StagedFile[] = files.map((f, i) => {
        const ext = extFromName(f.name);
        const path = webkitPath(f);
        let reason: StagedFile['reason'];
        if (!allowedExts.includes(ext)) reason = 'unsupported';
        else if (f.size > maxBytes) reason = 'oversized';
        return { key: `${path}-${i}-${f.size}`, file: f, path, ext, size: f.size, reason };
      });
      setItems(staged);
      setEnabledExts(new Set(staged.filter((s) => !s.reason).map((s) => s.ext)));
      // 每次重开 modal 按 ownedSources 重新挑默认:有 custom → 选最近一个 custom;
      // 没 custom → 空串(manual_upload 兜底)。符合"我特地建了数据源就是想用它"的直觉。
      setSelectedSourceId(pickDefaultSourceId(ownedSources));
    } else {
      setItems([]);
      setEnabledExts(new Set());
    }
  }

  // Esc 关闭 + body 锁滚。只在打开时生效。
  useEffect(() => {
    if (!files) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [files, onCancel]);

  const stats = useMemo(() => {
    let supported = 0;
    let oversized = 0;
    let unsupported = 0;
    let totalBytes = 0;
    for (const it of items) {
      if (it.reason === 'oversized') oversized++;
      else if (it.reason === 'unsupported') unsupported++;
      else {
        supported++;
        totalBytes += it.size;
      }
    }
    return { supported, oversized, unsupported, totalBytes };
  }, [items]);

  const extGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      if (it.reason) continue;
      map.set(it.ext, (map.get(it.ext) ?? 0) + 1);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const toUpload = useMemo(
    () =>
      items.filter((it) => !it.reason && enabledExts.has(it.ext)).map((it) => it.file),
    [items, enabledExts],
  );

  // 来源判定:所有路径都含 "/" → 文件夹上传,取顶层目录名;否则 = 单纯选文件。
  const source = useMemo(() => {
    if (items.length === 0) return null;
    const paths = items.map((i) => i.path);
    const allRel = paths.every((p) => p.includes('/'));
    if (!allRel) return '选择的文件';
    const firstTop = paths[0].split('/')[0];
    const sameTop = paths.every((p) => p.split('/')[0] === firstTop);
    return sameTop ? `文件夹 ${firstTop}/` : '多个文件夹';
  }, [items]);

  const toggleExt = (ext: string) => {
    setEnabledExts((prev) => {
      const next = new Set(prev);
      if (next.has(ext)) next.delete(ext);
      else next.add(ext);
      return next;
    });
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  };

  if (!files) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onCancel} />
      <div
        data-augmented-ui="tl-clip br-clip border"
        className="aug-card aug-card-cyan relative w-full max-w-2xl mx-4 p-0 max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-default shrink-0">
          <h3 className="text-[14px] font-semibold text-text-primary">准备上传</h3>
          <button
            onClick={onCancel}
            className="text-text-muted hover:text-text-primary cursor-pointer p-0.5"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-3 min-h-0 flex-1">
          {/* Summary */}
          <div className="flex items-center gap-2 text-[13px] text-text-secondary">
            <FolderOpen className="h-4 w-4 text-text-muted shrink-0" strokeWidth={1.6} />
            {source && (
              <>
                <span>来自 {source}</span>
                <span className="text-text-muted">·</span>
              </>
            )}
            <span className="text-text-primary font-medium">{stats.supported}</span>
            <span>个文件就绪</span>
            {stats.totalBytes > 0 && (
              <span className="font-mono text-[12px] text-text-muted">
                · {formatBytes(stats.totalBytes)}
              </span>
            )}
          </div>
          {(stats.oversized > 0 || stats.unsupported > 0) && (
            <div className="flex items-center gap-1.5 text-[12px] text-accent-amber">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {stats.unsupported > 0 && <span>{stats.unsupported} 个类型不支持</span>}
              {stats.unsupported > 0 && stats.oversized > 0 && (
                <span className="text-text-muted">·</span>
              )}
              {stats.oversized > 0 && (
                <span>
                  {stats.oversized} 个超过 {formatBytes(maxBytes)} 上限
                </span>
              )}
              <span className="text-text-muted">· 将自动跳过</span>
            </div>
          )}

          {/* 数据源选择器:caller 作为 owner 的所有 source 都可选。恒定展示,让用户清楚
              文件会归到哪个数据源(影响后续的 visibility / ACL 分享)。只有一项(仅 manual_upload)
              时下拉只有一个选项,用户即便不能切换,也能明确看到归属。 */}
          {ownedSources.length > 0 && (
            <div className="flex items-center gap-2 text-[12px]">
              <KeySquare className="h-3.5 w-3.5 text-text-muted shrink-0" strokeWidth={1.6} />
              <span className="text-text-secondary shrink-0">存入数据源</span>
              <select
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                className="flex-1 min-w-0 text-[12px] px-2 py-1 rounded-md border border-border-default bg-white text-text-primary cursor-pointer focus:outline-none focus:border-accent/[0.5]"
                title="上传的文件会归到这个数据源下,影响后续权限分享范围"
              >
                {ownedSources.map((s) => (
                  <option key={s.id} value={s.kind === 'manual_upload' ? '' : s.id}>
                    {s.name || (s.kind === 'manual_upload' ? '我的上传' : `#${s.id}`)}
                    {s.kind === 'manual_upload' ? '（默认）' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Ext filter */}
          {extGroups.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {extGroups.map(([ext, count]) => {
                const active = enabledExts.has(ext);
                return (
                  <button
                    key={ext}
                    onClick={() => toggleExt(ext)}
                    className={clsx(
                      'px-2.5 py-1 rounded-md text-[12px] font-mono border transition-colors cursor-pointer',
                      active
                        ? 'bg-[#2383e2]/[0.08] text-[#2383e2] border-[#2383e2]/[0.25]'
                        : 'bg-white text-text-muted border-border-default hover:bg-bg-hover',
                    )}
                    title={active ? '点击取消选中该类型' : '点击勾选该类型'}
                  >
                    {ext} <span className="opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* File list */}
          <div className="flex-1 min-h-0 overflow-auto border border-border-default rounded-lg bg-bg-primary/30">
            {items.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-text-muted">没有文件</p>
            ) : (
              <ul className="divide-y divide-border-default">
                {items.map((it) => {
                  const excluded = !!it.reason || !enabledExts.has(it.ext);
                  return (
                    <li
                      key={it.key}
                      className={clsx(
                        'flex items-center gap-2 px-3 py-2 bg-white/60',
                        excluded && 'opacity-50',
                      )}
                    >
                      <FileText
                        className="h-3.5 w-3.5 text-text-muted shrink-0"
                        strokeWidth={1.6}
                      />
                      <span className="text-[13px] text-text-primary truncate min-w-0 flex-1 font-mono">
                        {it.path}
                      </span>
                      <span
                        className={clsx(
                          'text-[11px] font-mono shrink-0',
                          it.reason ? 'text-accent-amber' : 'text-text-muted',
                        )}
                      >
                        {it.reason === 'oversized' && `过大 · ${formatBytes(it.size)}`}
                        {it.reason === 'unsupported' && `不支持 · ${it.ext || '无扩展名'}`}
                        {!it.reason && formatBytes(it.size)}
                      </span>
                      <button
                        onClick={() => removeItem(it.key)}
                        className="text-text-muted hover:text-accent-red p-0.5 shrink-0 cursor-pointer"
                        title="从列表移除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-default shrink-0">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button
            onClick={() => onConfirm(toUpload, selectedSourceId)}
            disabled={toUpload.length === 0}
            icon={<Upload className="h-3.5 w-3.5" />}
          >
            上传 {toUpload.length} 个
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
