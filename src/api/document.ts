import type { AxiosProgressEvent, AxiosResponse } from 'axios';
import client from './client';
import type {
  BaseResponse,
  DocumentResponse,
  ListChunksResponse,
  ListDocumentsResponse,
  PrecheckRequest,
  PrecheckResponse,
  SearchMode,
  UpdateDocumentRequest,
  UploadConfigResponse,
} from '@/types/api';

export const DOCUMENT_MAX_FILE_SIZE = 10 * 1024 * 1024;
export const DOCUMENT_MAX_TITLE_LENGTH = 256;
export const DOCUMENT_ALLOWED_EXTENSIONS = ['.md', '.markdown', '.txt'] as const;
export const DOCUMENT_ACCEPT_ATTR =
  '.md,.markdown,.txt,text/markdown,text/plain,text/x-markdown';

/** 后端 document.MaxPrecheckBatch;一次 precheck 请求最多 50 个候选。 */
export const DOCUMENT_PRECHECK_BATCH = 50;

// 文件拓展名 → 上传时建议的 MIME,multipart header 可能为空,手动补一下。
export function guessDocumentMIME(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

/** 从文件名推一个默认标题,去掉扩展名。 */
export function defaultTitleFromFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  const stripped = dot > 0 ? base.slice(0, dot) : base;
  return stripped.trim() || 'untitled';
}

/**
 * 校验单个文件是否符合上传要求。
 * 返回中文错误原因;null 表示通过。
 */
export function validateDocumentFile(file: File): string | null {
  if (file.size === 0) return '文件为空';
  if (file.size > DOCUMENT_MAX_FILE_SIZE) {
    const mb = Math.round(DOCUMENT_MAX_FILE_SIZE / 1024 / 1024);
    return `超过 ${mb}MB 上限`;
  }
  const lower = file.name.toLowerCase();
  const okExt = DOCUMENT_ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  if (!okExt) return '不支持的格式';
  return null;
}

/** 批量收集时的单文件结果。 */
export interface CollectedDocumentFile {
  file: File;
  /** 相对路径(来自 webkitRelativePath),没有则退回文件名。 */
  relPath: string;
  /** null 表示通过,非 null 即用户可读的拒绝原因。 */
  rejectReason: string | null;
}

/**
 * 把用户选择的 FileList(来自 <input multiple> 或 webkitdirectory)
 * 展开成批量队列项。会自动:
 *   - 过滤掉 .DS_Store / ._* 等 macOS 系统垃圾文件
 *   - 用 validateDocumentFile 打上 rejectReason,但不直接丢弃(UI 里作为 skipped 展示)
 */
export function collectDocumentFiles(
  files: FileList | File[] | null | undefined,
): CollectedDocumentFile[] {
  if (!files) return [];
  const out: CollectedDocumentFile[] = [];
  for (const f of Array.from(files)) {
    const relPath = f.webkitRelativePath || f.name;
    const base = relPath.split('/').pop() ?? '';
    if (base === '.DS_Store' || base.startsWith('._') || base === 'Thumbs.db') {
      continue;
    }
    out.push({ file: f, relPath, rejectReason: validateDocumentFile(f) });
  }
  return out;
}

/**
 * 计算文件 SHA-256,返回 64 位小写 hex 字符串。
 *
 * 一次性把文件 bytes 读到 ArrayBuffer,然后调 `crypto.subtle.digest`。
 * 10MB 文件在现代浏览器上约 150-300ms,单文件远低于上限 OK;
 * 批量计算建议调用方**顺序执行**而非并发,避免一次性把 N × 10MB 吃进内存。
 */
export async function sha256HexOfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export const documentApi = {
  /**
   * 列出/搜索文档。两种模式:
   *   - mode=fuzzy(默认):MySQL LIKE 模糊匹配 title/file_name,支持 page/size 分页。
   *   - mode=semantic:pgvector 语义检索,topK 文档按相关度降序,不分页;每项带 similarity + matched_snippet。
   */
  list: (
    slug: string,
    params?: {
      mode?: SearchMode;
      q?: string;
      page?: number;
      size?: number;
      top_k?: number;
    },
  ): Promise<AxiosResponse<BaseResponse<ListDocumentsResponse>>> =>
    // semantic 走 Azure embed(~500ms)+ pg ANN;给 15s 超时,足够覆盖网络抖动。
    client.get(`/v2/orgs/${slug}/documents`, {
      params,
      timeout: params?.mode === 'semantic' ? 15_000 : undefined,
    }),

  /**
   * Chunk 级语义检索。和 list(mode=semantic) 的差别:
   *   - list(mode=semantic):doc 粒度,一篇文档 + 最佳 snippet。
   *   - searchChunks:chunk 粒度,同一 doc 的多个命中段落都返回,不 dedup。
   *
   * 前端展示直接消费 result.items[].content 即可,不用下载 OSS 原文。
   * 空 q 返回空列表(非错);过长 q 由后端按 MaxQueryLength 截断。
   * 索引未启用时后端返 503 业务码(ErrDocumentIndexFailed),UI 应事先通过
   * getUploadConfig 的 semantic_search_enabled 字段灰掉入口。
   */
  searchChunks: (
    slug: string,
    params: { q: string; top_k?: number },
  ): Promise<AxiosResponse<BaseResponse<ListChunksResponse>>> =>
    // embed ~500ms + pg ANN + MySQL JOIN;15s 足够覆盖网络抖动。
    client.get(`/v2/orgs/${slug}/documents/chunks`, {
      params,
      timeout: 15_000,
    }),

  /**
   * 上传预检:批量评估每个候选文件将走 Upload 的哪一分支(create/overwrite/duplicate/reject)。
   * 不写库,纯读;可重复调。失败时前端应降级为"直接上传,由后端三分支兜底"。
   */
  precheck: (
    slug: string,
    req: PrecheckRequest,
  ): Promise<AxiosResponse<BaseResponse<PrecheckResponse>>> =>
    client.post(`/v2/orgs/${slug}/documents/precheck`, req, { timeout: 15_000 }),

  /**
   * 获取上传约束(max_file_size_bytes + allowed_mime_types)。
   * 稳定值,前端可按 org 维度缓存。
   */
  getUploadConfig: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<UploadConfigResponse>>> =>
    client.get(`/v2/orgs/${slug}/documents/config`),

  get: (
    slug: string,
    id: string,
  ): Promise<AxiosResponse<BaseResponse<DocumentResponse>>> =>
    client.get(`/v2/orgs/${slug}/documents/${id}`),

  /**
   * 上传文档。axios 会根据 FormData 自动设置 multipart Content-Type(含 boundary);
   * 这里把 header 设为 undefined 覆盖 client 默认的 application/json。
   */
  upload: (
    slug: string,
    file: File,
    opts?: {
      title?: string;
      /** 非空表示显式覆盖该 doc_id 对应的文档(后端走 overwrite 分支)。 */
      targetDocId?: string;
      onProgress?: (pct: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<AxiosResponse<BaseResponse<DocumentResponse>>> => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts?.title) fd.append('title', opts.title);
    if (opts?.targetDocId) fd.append('target_doc_id', opts.targetDocId);

    return client.post(`/v2/orgs/${slug}/documents`, fd, {
      headers: { 'Content-Type': undefined },
      // 上传 10MB + 后端落 OSS,默认 15s timeout 偏紧,放宽到 60s。
      timeout: 60_000,
      signal: opts?.signal,
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (!opts?.onProgress || !e.total) return;
        opts.onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  },

  updateTitle: (
    slug: string,
    id: string,
    data: UpdateDocumentRequest,
  ): Promise<AxiosResponse<BaseResponse<DocumentResponse>>> =>
    client.patch(`/v2/orgs/${slug}/documents/${id}`, data),

  delete: (slug: string, id: string): Promise<AxiosResponse<BaseResponse>> =>
    client.delete(`/v2/orgs/${slug}/documents/${id}`),
};

/**
 * 以文本方式读取文档内容(复用 /download 端点,不触发浏览器下载)。
 * 适用于 markdown / plain 类文档的在线查看。大文件(> 几 MB 的纯文本)慎用,
 * 一次性 blob → text 会阻塞主线程;当前 10MB 上限下可接受。
 *
 * 后端错误路径返回 JSON + HTTP 200,与 downloadDocument 同样处理。
 */
export async function fetchDocumentContent(slug: string, docId: string): Promise<string> {
  const res = await client.get(`/v2/orgs/${slug}/documents/${docId}/download`, {
    responseType: 'blob',
    timeout: 60_000,
  });
  const ct = String(res.headers['content-type'] ?? '').toLowerCase();
  if (ct.startsWith('application/json')) {
    const text = await (res.data as Blob).text();
    let code: number | undefined;
    let message: string | undefined;
    try {
      const parsed = JSON.parse(text);
      code = parsed?.code;
      message = parsed?.message;
    } catch {
      // ignore parse failure
    }
    const err = new Error(message || '加载失败') as DownloadError;
    err.code = code;
    throw err;
  }
  return (res.data as Blob).text();
}

export interface DownloadError extends Error {
  /** 后端返回的业务错误码(若能识别)。 */
  code?: number;
  /** HTTP 状态码(由 axios 包装抛出的情况)。 */
  httpStatus?: number;
}

/**
 * 下载文档并触发浏览器另存为。
 * 后端会用 Content-Disposition 指定文件名,且错误情况下返回 JSON + 200,
 * 这里通过 content-type 判断,若是 JSON 就解析业务码抛错。
 */
export async function downloadDocument(
  slug: string,
  doc: Pick<DocumentResponse, 'id' | 'file_name'>,
): Promise<void> {
  const res = await client.get(`/v2/orgs/${slug}/documents/${doc.id}/download`, {
    responseType: 'blob',
    timeout: 60_000,
  });

  const ct = String(res.headers['content-type'] ?? '').toLowerCase();
  // 后端错误路径会返回 JSON body + HTTP 200,需要反解包。
  if (ct.startsWith('application/json')) {
    const text = await (res.data as Blob).text();
    let code: number | undefined;
    let message: string | undefined;
    try {
      const parsed = JSON.parse(text);
      code = parsed?.code;
      message = parsed?.message;
    } catch {
      // ignore parse failure
    }
    const err = new Error(message || '下载失败') as DownloadError;
    err.code = code;
    throw err;
  }

  const blob = res.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // 优先用服务端元信息里的原文件名。
  a.download = doc.file_name || `document-${doc.id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 给浏览器一点时间发起下载再释放 URL。
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
