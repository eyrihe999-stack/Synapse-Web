import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Upload,
  UploadCloud,
  FolderUp,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  X,
  KeySquare,
} from 'lucide-react';
import { clsx } from 'clsx';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { formatBytes, formatTs } from '@/lib/format';
import { useOrgStore } from '@/store/org';
import { documentApi } from '@/api/document';
import { asyncJobApi } from '@/api/asyncjob';
import { sourceApi } from '@/api/source';
import type {
  AsyncJobResponse,
  DocumentDTO,
  SourceResponse,
  UploadResponse,
} from '@/types/api';
import { UploadStagingModal } from './UploadStagingModal';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTS = ['.md', '.markdown', '.mdx', '.txt'];
const POLL_INTERVAL_MS = 1500;
const SEARCH_DEBOUNCE_MS = 300;

// File 标准只提供 webkitRelativePath(folder <input>)。对于 DataTransfer 拖拽进来的文件夹,
// 我们自己递归 walk FileSystemEntry 并给 File 挂个 __relativePath 副字段 ——
// UploadStagingModal 的 webkitPath() 会按 webkitRelativePath → __relativePath → name 顺序回退。
type WalkableFile = File & { __relativePath?: string };

// walkEntry 递归展开 FileSystemEntry,把 file 推到 out。parentPath 以 "/" 结尾或空串。
// readEntries 是分批的(一次最多 100 条),必须循环调到返回空数组才算读完。
async function walkEntry(entry: FileSystemEntry, parentPath: string, out: File[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    return new Promise((resolve, reject) => {
      fileEntry.file((file) => {
        (file as WalkableFile).__relativePath = parentPath + entry.name;
        out.push(file);
        resolve();
      }, reject);
    });
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const readAll = (): Promise<void> =>
      new Promise((resolve, reject) => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve();
            return;
          }
          try {
            await Promise.all(
              entries.map((e) => walkEntry(e, parentPath + entry.name + '/', out)),
            );
            await readAll();
            resolve();
          } catch (err) {
            reject(err as Error);
          }
        }, reject);
      });
    return readAll();
  }
}

async function gatherDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items);
  const out: File[] = [];
  await Promise.all(
    items.map(async (item) => {
      if (item.kind !== 'file') return;
      // webkitGetAsEntry 非标准但所有主流浏览器支持;返回 null 时回退到 getAsFile。
      const entry = item.webkitGetAsEntry?.();
      if (!entry) {
        const f = item.getAsFile();
        if (f) out.push(f);
        return;
      }
      await walkEntry(entry, '', out);
    }),
  );
  return out;
}

// 前端跟踪的上传任务:覆盖三种后端返回态 + 本地 pending/error,供列表上方进度条渲染。
// startedAt 用来算已耗时,加在 label 末尾帮助用户判断是否卡死。
interface UploadTask {
  key: string;
  fileName: string;
  state: 'uploading' | 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'duplicate';
  startedAt: number;
  // jobId / docId 是后端 snowflake uint64 字符串(超 JS Number 精度,见 types/api.ts 注释)。
  jobId?: string;
  docId?: string;
  total?: number;
  done?: number;
  failed?: number;
  error?: string;
}

const ACTIVE_STATES: UploadTask['state'][] = ['uploading', 'queued', 'running'];

interface ConflictPrompt {
  file: File;
  existingFileName: string;
  /** 冲突时记下此次上传原本要进的 source.id(空串 = 默认 manual_upload),覆盖重试时复用。 */
  sourceId: string;
}

// 搜索方式:前端 UI 切换,后端接收互斥的 query param。
// - keyword: 标题 / 文件名模糊搜索(LIKE,大小写不敏感)
// - doc_id:  按文件 id 精确匹配
// - source_id: 按所属数据源 id 精确匹配
type SearchMode = 'keyword' | 'doc_id' | 'source_id';

const SEARCH_MODE_LABEL: Record<SearchMode, string> = {
  keyword: '关键词',
  doc_id: '文件ID',
  source_id: '数据源ID',
};

const SEARCH_MODE_PLACEHOLDER: Record<SearchMode, string> = {
  keyword: '搜索标题或文件名…',
  doc_id: '输入文件 ID(纯数字)',
  source_id: '输入数据源 ID(纯数字)',
};

export function KnowledgeDocsTab() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;

  const [docs, setDocs] = useState<DocumentDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [conflict, setConflict] = useState<ConflictPrompt | null>(null);

  const navigate = useNavigate();

  // 暂存待上传文件批次:null = 未打开 staging,非空数组 = 打开 modal 让用户确认。
  const [staged, setStaged] = useState<File[] | null>(null);

  // 全页 drop overlay 开关:拖文件进窗口时显示。
  const [dragActive, setDragActive] = useState(false);

  // 搜索框受控值 + debounce 后触发真实请求的值。
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // 搜索方式(三选一互斥)。切换时清空输入避免把关键词当 ID 发给后端。
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword');

  // 当前 org 下的 source 目录,用于文件卡片展示 "所属数据源" 标签。
  // 拉一次即可,source 变化在业务上很少;不可见 source 后端不会返,所以 doc 里出现的 id 通常都能命中。
  const [sourceMap, setSourceMap] = useState<Record<string, SourceResponse>>({});

  // caller 作为 owner 的 source(含 manual_upload + 自建 custom),传给 UploadStagingModal 让用户选择。
  // upload 时后端硬规则:只允许 owner 往自己的 source 传,所以这里只列 owner 自己的。
  const [ownedSources, setOwnedSources] = useState<SourceResponse[]>([]);

  // 500ms tick 驱动"已耗时"计时器。只在有 active 任务时起定时器,避免空转 rerender。
  const [now, setNow] = useState(() => Date.now());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // 记录已启动轮询的 jobId,避免同一个 job 被反复起定时器。
  const pollTimers = useRef<Map<string, number>>(new Map());

  // 搜索 debounce:input 实时更新 search,300ms 空档后才把值提交给 debouncedSearch 触发 fetch。
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  // buildListParams 按 searchMode 组装 documentApi.list 的过滤参数。
  // ID 模式非数字 → 返 null,让调用方走"不发请求 + 空列表"分支(避免把关键词打到 id 过滤上)。
  const buildListParams = useCallback(
    (term: string): { query?: string; docId?: string; sourceId?: string } | null => {
      const trimmed = term.trim();
      if (searchMode === 'keyword') return { query: trimmed };
      if (trimmed === '') return {};
      if (!/^\d+$/.test(trimmed)) return null;
      return searchMode === 'doc_id' ? { docId: trimmed } : { sourceId: trimmed };
    },
    [searchMode],
  );

  const fetchDocs = useCallback(async () => {
    if (!slug) return;
    const params = buildListParams(debouncedSearch);
    if (params === null) {
      // ID 模式但输入非数字:直接清空列表,UI 走空态引导
      setDocs([]);
      setNextCursor(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 知识库文档页展示用户主动整理的文档:manual_upload(默认收件箱)+ custom(自建数据源)。
      // GitLab 同步进来的代码文件(kind=gitlab_repo)走各自专属页面。
      const res = await documentApi.list(slug, {
        limit: 20,
        sourceKinds: ['manual_upload', 'custom'],
        ...params,
      });
      const r = res.data.result;
      setDocs(r?.docs ?? []);
      setNextCursor(r?.next_cursor);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug, debouncedSearch, buildListParams]);

  // 首次进入 / 切 org 时拉一次 source 目录。size=100 覆盖绝大多数组织(当前每人一条 manual_upload)。
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    sourceApi
      .list(slug, 1, 100)
      .then((res) => {
        if (cancelled) return;
        const items = res.data.result?.items ?? [];
        const map: Record<string, SourceResponse> = {};
        items.forEach((s) => {
          map[s.id] = s;
        });
        setSourceMap(map);
      })
      .catch(() => {
        // 拉 source 失败不阻断文档列表,卡片退化成只显示 source id
        if (!cancelled) setSourceMap({});
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // ownedSources:caller 自己作为 owner 的 source 列表。用于上传 modal 里"选择数据源"下拉。
  // manual_upload 放第一位(默认选中),自建 custom 按创建时间倒序跟在后面。
  const fetchOwnedSources = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await sourceApi.listMine(slug);
      const items = res.data.result ?? [];
      // 后端按 created_at DESC 返回,manual_upload 通常最早建,会排到末尾;手动提前它。
      const manual = items.filter((s) => s.kind === 'manual_upload');
      const others = items.filter((s) => s.kind !== 'manual_upload');
      setOwnedSources([...manual, ...others]);
    } catch {
      // 拉失败 → 下拉隐藏,上传默认走 manual_upload 兜底
      setOwnedSources([]);
    }
  }, [slug]);

  useEffect(() => {
    fetchOwnedSources();
  }, [fetchOwnedSources]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // 切换组织 / 卸载时清理所有轮询定时器 + 清本地上传任务列表 ——
  // 否则组织切换后会继续轮询上一个组织的 job,且 UI 会看到上一个组织的遗留进度条。
  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      setTasks([]);
    };
  }, [slug]);

  useEffect(() => {
    const hasActive = tasks.some((t) => ACTIVE_STATES.includes(t.state));
    if (!hasActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [tasks]);

  // 全页 drop:window 级监听,拖 files 到页面任意位置都触发 overlay,松开进 staging。
  // dragenter/dragleave 对每个子元素都会 bubble 一次,用 depth 计数避免 overlay 抖。
  useEffect(() => {
    if (!slug) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      return !!types && Array.prototype.includes.call(types, 'Files');
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (depth === 1) setDragActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragActive(false);
      if (!e.dataTransfer) return;
      try {
        const gathered = await gatherDroppedFiles(e.dataTransfer);
        if (gathered.length > 0) setStaged(gathered);
      } catch (err) {
        toast('error', `读取拖拽内容失败:${getErrorMessage(err)}`);
      }
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [slug]);

  const loadMore = async () => {
    if (!slug || !nextCursor) return;
    const params = buildListParams(debouncedSearch);
    if (params === null) return;
    setLoadingMore(true);
    try {
      const res = await documentApi.list(slug, {
        beforeId: nextCursor,
        limit: 20,
        sourceKinds: ['manual_upload', 'custom'],
        ...params,
      });
      const r = res.data.result;
      setDocs((prev) => [...prev, ...(r?.docs ?? [])]);
      setNextCursor(r?.next_cursor);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const updateTask = useCallback((key: string, patch: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }, []);

  // 对 job 终态做 UI 收敛:succeeded → 刷列表 + toast,failed → 保留错误提示 3s 后自动清掉。
  const pollJob = useCallback(
    (taskKey: string, jobId: string) => {
      const tick = async () => {
        try {
          const res = await asyncJobApi.get(jobId);
          const job: AsyncJobResponse | undefined = res.data.result;
          if (!job) return;
          updateTask(taskKey, {
            state: job.status === 'running' ? 'running' : job.status,
            total: job.progress_total,
            done: job.progress_done,
            failed: job.progress_failed,
            error: job.error,
          });
          if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
            pollTimers.current.delete(jobId);
            if (job.status === 'succeeded') {
              toast('success', '文档向量化完成');
              fetchDocs();
              setTimeout(() => {
                setTasks((prev) => prev.filter((t) => t.key !== taskKey));
              }, 1500);
            } else {
              toast('error', `向量化失败:${job.error || job.status}`);
            }
            return;
          }
        } catch (err) {
          // 轮询临时失败不中断,留给下一轮重试;但连续多次 404 可能意味着 job 被清理,这里简单记录。
          console.warn('poll job failed', err);
        }
        const handle = window.setTimeout(tick, POLL_INTERVAL_MS);
        pollTimers.current.set(jobId, handle);
      };
      tick();
    },
    [updateTask, fetchDocs],
  );

  // 真正发起上传的核心。
  // sourceId: "" 走后端 manual_upload 兜底;非空 = caller 自建 source 的 id,后端硬规则校验 owner。
  // conflictRetry = true:上一轮命中 filename_conflict,本次带 overwrite=true 覆盖。
  const uploadOne = useCallback(
    async (file: File, sourceId: string, conflictRetry = false) => {
      if (!slug) return;
      const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setTasks((prev) => [
        ...prev,
        { key, fileName: file.name, state: 'uploading', startedAt: Date.now() },
      ]);

      try {
        const res = await documentApi.upload(slug, file, {
          overwrite: conflictRetry,
          sourceId: sourceId || undefined,
        });
        const r: UploadResponse | undefined = res.data.result;
        if (!r) {
          updateTask(key, { state: 'failed', error: '响应为空' });
          return;
        }
        if (r.status === 'already_indexed') {
          updateTask(key, { state: 'succeeded', docId: r.doc_id });
          toast('success', `${file.name} 已存在,跳过向量化`);
          fetchDocs();
          setTimeout(() => setTasks((prev) => prev.filter((t) => t.key !== key)), 1500);
          return;
        }
        if (r.status === 'queued') {
          updateTask(key, { state: 'queued', jobId: r.job_id, docId: r.doc_id });
          // queued 态下 doc 已入库,列表里立即显示占位(chunk_count=0);
          // 向量化完成后轮询的 succeeded 分支会再 fetchDocs 一次更新 chunk_count。
          fetchDocs();
          if (r.job_id) pollJob(key, r.job_id);
          return;
        }
        if (r.status === 'filename_conflict') {
          // 这类本来会在 axios 里以 409 抛出,走到这里表示后端把 conflict 放在 200 body 里(旧逻辑兜底)。
          updateTask(key, {
            state: 'duplicate',
            error: `同名文件 ${r.existing_file_name} 已存在,请确认是否覆盖`,
          });
          setConflict({ file, existingFileName: r.existing_file_name || file.name, sourceId });
          return;
        }
      } catch (e: unknown) {
        const anyErr = e as { response?: { status?: number; data?: { result?: UploadResponse } } };
        // 409 → filename_conflict 明确需要用户交互,不算普通错误,从 tasks 里移除 + 弹 modal
        if (anyErr.response?.status === 409) {
          const r = anyErr.response.data?.result;
          setTasks((prev) => prev.filter((t) => t.key !== key));
          setConflict({ file, existingFileName: r?.existing_file_name || file.name, sourceId });
          return;
        }
        updateTask(key, { state: 'failed', error: getErrorMessage(e) });
        toast('error', `${file.name} 上传失败:${getErrorMessage(e)}`);
      }
    },
    [slug, updateTask, pollJob, fetchDocs],
  );

  // 用户从 file/folder picker 或拖拽选了文件 → 打开 staging modal 让用户过滤 / 确认。
  const openStaging = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setStaged(arr);
  };

  const confirmStaging = (filtered: File[], sourceId: string) => {
    setStaged(null);
    filtered.forEach((f) => uploadOne(f, sourceId));
  };

  const confirmOverwrite = async () => {
    if (!conflict) return;
    const { file, sourceId } = conflict;
    setConflict(null);
    await uploadOne(file, sourceId, true);
  };

  const deleteDoc = async (doc: DocumentDTO) => {
    if (!slug) return;
    if (
      !confirm(
        `确定要删除文档「${doc.title || doc.file_name}」吗？关联的向量 chunks 会一并删除。`,
      )
    )
      return;
    const res = await apiCall(() => documentApi.remove(slug, doc.id), { success: '文档已删除' });
    if (res.ok) fetchDocs();
  };

  if (!slug) return null;

  const totalBytes = docs.reduce((acc, d) => acc + (d.content_byte_size || 0), 0);
  const hasSearch = debouncedSearch.trim().length > 0;
  // ID 模式下输入了非数字 → 当前列表实际没请求,空态要给不同文案。
  const isInvalidIdInput =
    hasSearch && searchMode !== 'keyword' && !/^\d+$/.test(debouncedSearch.trim());

  return (
    <div className="space-y-4">
      {/* 工具栏:元信息 + 搜索 + 刷新 + 文件夹按钮 + 上传按钮 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] text-text-secondary shrink-0">
          {docs.length} 篇文档
          {totalBytes > 0 && (
            <>
              <span className="text-text-muted mx-1.5">·</span>
              已用 <span className="font-mono">{formatBytes(totalBytes)}</span>
            </>
          )}
        </span>
        <button
          onClick={fetchDocs}
          disabled={loading}
          className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent/[0.06] transition-colors cursor-pointer disabled:opacity-40"
          title="刷新"
        >
          <RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>

        {/* 搜索框:[mode 下拉][输入框]。切 mode 清空输入,避免误把关键词当 id 搜。 */}
        <div className="flex-1 min-w-[280px] max-w-md flex items-stretch">
          <select
            value={searchMode}
            onChange={(e) => {
              setSearchMode(e.target.value as SearchMode);
              setSearch('');
            }}
            className="text-[13px] rounded-l-md border border-r-0 border-border-default bg-bg-secondary px-2 py-1.5 text-text-secondary focus:outline-none focus:border-accent/[0.5] cursor-pointer"
            title="切换搜索方式"
          >
            {(Object.keys(SEARCH_MODE_LABEL) as SearchMode[]).map((m) => (
              <option key={m} value={m}>
                {SEARCH_MODE_LABEL[m]}
              </option>
            ))}
          </select>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={SEARCH_MODE_PLACEHOLDER[searchMode]}
              inputMode={searchMode === 'keyword' ? 'text' : 'numeric'}
              className="w-full pl-8 pr-7 py-1.5 text-[13px] rounded-r-md border border-border-default bg-white placeholder:text-text-muted focus:outline-none focus:border-accent/[0.5] focus:bg-white transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary rounded cursor-pointer"
                title="清空"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="secondary"
            onClick={() => folderInputRef.current?.click()}
            icon={<FolderUp className="h-3.5 w-3.5" />}
          >
            上传文件夹
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            icon={<Upload className="h-3.5 w-3.5" />}
          >
            上传文件
          </Button>
        </div>
      </div>

      {/* 隐藏 input:文件 + 文件夹两条路径。 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_EXTS.join(',')}
        multiple
        className="hidden"
        onChange={(e) => {
          openStaging(e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        // webkitdirectory 是非标准属性,React 19 TS 类型已覆盖;attr 本身所有主流浏览器支持。
        {...({ webkitdirectory: '', directory: '' } as unknown as Record<string, string>)}
        multiple
        className="hidden"
        onChange={(e) => {
          openStaging(e.target.files);
          if (folderInputRef.current) folderInputRef.current.value = '';
        }}
      />

      {/* 上传任务条:只在有任务时出现,完成后自淡出。 */}
      {tasks.length > 0 && (
        <div className="space-y-2">
          {tasks.map((t) => (
            <UploadTaskRow key={t.key} task={t} now={now} />
          ))}
        </div>
      )}

      {/* 文档列表 */}
      {loading && docs.length === 0 ? (
        <p className="text-[13px] text-text-muted py-8 text-center">加载中...</p>
      ) : docs.length === 0 ? (
        <GlassCard>
          <div className="py-10 text-center">
            <FileText className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            {isInvalidIdInput ? (
              <>
                <p className="text-[14px] text-text-secondary mb-1">
                  {SEARCH_MODE_LABEL[searchMode]} 需要输入纯数字
                </p>
                <p className="text-[12px] text-text-muted">
                  切换到「关键词」可以按标题或文件名搜索
                </p>
              </>
            ) : hasSearch ? (
              <>
                <p className="text-[14px] text-text-secondary mb-1">
                  没有匹配「{debouncedSearch}」的文档
                  {searchMode !== 'keyword' ? `(按 ${SEARCH_MODE_LABEL[searchMode]})` : ''}
                </p>
                <p className="text-[12px] text-text-muted">换个搜索值试试,或清空搜索查看全部</p>
              </>
            ) : (
              <>
                <p className="text-[14px] text-text-secondary mb-1">暂无文档</p>
                <p className="text-[12px] text-text-muted">
                  拖拽文件到页面任意位置,或点右上角「上传文件 / 文件夹」开始
                </p>
              </>
            )}
          </div>
        </GlassCard>
      ) : (
        <>
          <div className="space-y-2">
            {docs.map((d) => (
              <GlassCard key={d.id} hover>
                <div className="flex items-center justify-between gap-3">
                  <div
                    className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                    onClick={() => navigate(`/org/knowledge/docs/${d.id}`)}
                  >
                    <div className="h-9 w-9 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-accent" strokeWidth={1.6} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-text-primary truncate">
                        {d.title || d.file_name}
                      </p>
                      <p className="text-[11px] text-text-muted font-mono truncate">
                        {d.file_name} · {d.provider} · {formatBytes(d.content_byte_size)} ·{' '}
                        {d.chunk_count} chunks
                      </p>
                      <DocMetaLine
                        doc={d}
                        source={sourceMap[d.knowledge_source_id ?? '']}
                        onFilterBySource={(sid) => {
                          // 点徽章 → 切到"数据源ID"过滤模式,填 id,列表自动重拉
                          setSearchMode('source_id');
                          setSearch(sid);
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-[11px] text-text-muted shrink-0">
                    {formatTs(d.created_at)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteDoc(d)}
                    icon={<Trash2 className="h-3 w-3" />}
                  >
                    删除
                  </Button>
                </div>
              </GlassCard>
            ))}
          </div>

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
                加载更多
              </Button>
            </div>
          )}
        </>
      )}

      {/* 全页 drop overlay:拖文件进窗口时出现。 */}
      {dragActive && <DropOverlay />}

      {/* 上传前 staging:让用户确认文件 / 过滤类型 / 移除单个文件 / 选择目标数据源。 */}
      <UploadStagingModal
        files={staged}
        onCancel={() => setStaged(null)}
        onConfirm={confirmStaging}
        allowedExts={ALLOWED_EXTS}
        maxBytes={MAX_UPLOAD_BYTES}
        ownedSources={ownedSources}
      />

      <ConflictModal
        open={!!conflict}
        existingFileName={conflict?.existingFileName || ''}
        onCancel={() => setConflict(null)}
        onConfirm={confirmOverwrite}
      />
    </div>
  );
}

function DropOverlay() {
  return (
    <div className="fixed inset-0 z-[100] bg-accent/[0.08] backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
      <div className="bg-white rounded-2xl border-2 border-dashed border-accent px-10 py-8 shadow-xl text-center">
        <UploadCloud className="h-10 w-10 text-accent mx-auto mb-3" strokeWidth={1.3} />
        <p className="text-[15px] font-medium text-text-primary mb-1">松开即可开始上传</p>
        <p className="text-[12px] text-text-secondary">
          支持 {ALLOWED_EXTS.join(' / ')} · 单文件最大 {formatBytes(MAX_UPLOAD_BYTES)}
        </p>
      </div>
    </div>
  );
}

function UploadTaskRow({ task, now }: { task: UploadTask; now: number }) {
  const [icon, label, tone] = (() => {
    switch (task.state) {
      case 'uploading':
        return [
          <Loader2 key="i" className="h-3.5 w-3.5 animate-spin text-accent" />,
          '上传中',
          'text-text-muted',
        ];
      case 'queued':
        return [
          <Loader2 key="i" className="h-3.5 w-3.5 animate-spin text-accent" />,
          '排队中',
          'text-text-muted',
        ];
      case 'running':
        return [
          <Loader2 key="i" className="h-3.5 w-3.5 animate-spin text-accent" />,
          '向量化中',
          'text-text-muted',
        ];
      case 'succeeded':
        return [
          <CheckCircle2 key="i" className="h-3.5 w-3.5 text-accent-green" />,
          '已完成',
          'text-accent-green',
        ];
      case 'failed':
        return [
          <XCircle key="i" className="h-3.5 w-3.5 text-accent-red" />,
          '失败',
          'text-accent-red',
        ];
      case 'canceled':
        return [
          <XCircle key="i" className="h-3.5 w-3.5 text-text-muted" />,
          '已取消',
          'text-text-muted',
        ];
      case 'duplicate':
        return [
          <XCircle key="i" className="h-3.5 w-3.5 text-accent-red" />,
          '需确认',
          'text-accent-red',
        ];
    }
  })() as [React.ReactElement, string, string];

  const pct =
    task.total && task.total > 0
      ? Math.min(100, Math.round(((task.done ?? 0) / task.total) * 100))
      : null;

  const isActive = ACTIVE_STATES.includes(task.state);
  // 已耗时精度到 0.1s,tabular-nums 防止数字跳动时文本宽度抖动。
  const elapsed = isActive ? Math.max(0, (now - task.startedAt) / 1000) : null;

  return (
    <div className="rounded-md border border-border-default bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-[13px] text-text-primary truncate">{task.fileName}</span>
        </div>
        <span className={clsx('text-[11px] shrink-0 tabular-nums', tone)}>
          {label}
          {task.state === 'running' && task.total
            ? ` · ${task.done ?? 0}/${task.total}${task.failed ? ` (失败 ${task.failed})` : ''}`
            : ''}
          {pct !== null && task.state === 'running' && ` · ${pct}%`}
          {elapsed !== null && ` · ${elapsed.toFixed(1)}s`}
        </span>
      </div>
      {isActive && (
        <div className="mt-1.5 h-1 rounded bg-bg-secondary overflow-hidden">
          {pct !== null ? (
            // 确定进度:蓝色实心条 + 宽度过渡。
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          ) : (
            // 未知进度(刚入队 / total 还没回来):barber-pole 条纹横向流动,只给"在动"的视觉反馈。
            <div className="h-full indeterminate-bar" />
          )}
        </div>
      )}
      {task.error && task.state === 'failed' && (
        <p className="text-[11px] text-accent-red mt-1 font-mono truncate">{task.error}</p>
      )}
    </div>
  );
}

// DocMetaLine 在文件卡片下方展示:所属数据源徽章(显眼,可点击过滤) + 文件ID。
// 点数据源徽章 → 切到"数据源ID"过滤模式,一键看"该数据源下的所有文档"。
// 点文件ID → 复制到剪贴板,方便手工 ID 检索。
// 所有交互都 stopPropagation 防止冒泡到外层卡片的"跳转详情"。
function DocMetaLine({
  doc,
  source,
  onFilterBySource,
}: {
  doc: DocumentDTO;
  source: SourceResponse | undefined;
  onFilterBySource: (sourceId: string) => void;
}) {
  const copy = async (e: React.MouseEvent, text: string, label: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      toast('success', `${label} 已复制`);
    } catch {
      toast('error', '复制失败,请手动选中复制');
    }
  };

  const hasSource = !!doc.knowledge_source_id && doc.knowledge_source_id !== '0';
  // 优先展示 user-friendly name;sourceMap 拿不到(不应发生,因为 doc 列表按 ACL 过滤过)→ 兜底 id。
  const sourceLabel =
    source?.name?.trim() ||
    (source
      ? source.kind === 'manual_upload'
        ? '我的上传'
        : source.kind === 'custom'
          ? `自建 #${source.id}`
          : `#${source.id}`
      : `数据源 #${doc.knowledge_source_id}`);

  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted font-mono truncate">
      {hasSource && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFilterBySource(doc.knowledge_source_id!);
          }}
          className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded border border-accent/[0.2] bg-accent/[0.06] text-accent hover:bg-accent/[0.12] transition-colors cursor-pointer max-w-[240px]"
          title="点击查看该数据源下的所有文件"
        >
          <KeySquare className="h-2.5 w-2.5 shrink-0" strokeWidth={1.8} />
          <span className="truncate">{sourceLabel}</span>
        </button>
      )}
      <span className="text-text-muted/70">文件ID:</span>
      <button
        onClick={(e) => copy(e, doc.id, '文件ID')}
        className="hover:text-accent transition-colors cursor-pointer"
        title="点击复制"
      >
        {doc.id}
      </button>
    </div>
  );
}

function ConflictModal({
  open,
  existingFileName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  existingFileName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title="同名文件已存在">
      <p className="text-[13px] text-text-secondary">
        已存在同名文件 <span className="font-mono text-text-primary">{existingFileName}</span>
        ，但内容不同。覆盖后旧文档的向量 chunks 会被删除并替换为新内容。
      </p>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          确认覆盖
        </Button>
      </div>
    </Modal>
  );
}

