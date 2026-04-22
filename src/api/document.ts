import client from './client';
import type {
  BaseResponse,
  UploadResponse,
  ListDocsResponse,
  GetDocResponse,
  ListDocumentVersionsResponse,
} from '@/types/api';

export interface UploadOptions {
  title?: string;
  overwrite?: boolean;
  /** 指定 doc 归属的 source.id;必须是 caller 作为 owner 的 source。省略 → 走 manual_upload 兜底。 */
  sourceId?: string;
}

export interface ListDocsOptions {
  provider?: string;
  /** 服务端 LIKE 过滤:标题 + 文件名,大小写不敏感。空串等于不过滤。 */
  query?: string;
  /** 精确按 doc.id 过滤(仍受权限墙约束);非空数字字符串。 */
  docId?: string;
  /** 精确按 doc.knowledge_source_id 过滤;非空数字字符串。 */
  sourceId?: string;
  // 翻页 cursor:用上一页 next_cursor(后端 snowflake uint64 字符串)。axios 拼 query 会按 value.toString() 序列化,字符串直接放进 URL。
  beforeId?: string;
  limit?: number;
}

export const documentApi = {
  // multipart/form-data 上传。axios 识别 FormData 后会自行设置 multipart boundary,
  // 显式设 Content-Type 反而会破坏 boundary,所以这里不碰 headers。
  upload: (slug: string, file: File, opts?: UploadOptions) => {
    const form = new FormData();
    form.append('file', file);
    if (opts?.title) form.append('title', opts.title);
    if (opts?.overwrite) form.append('overwrite', 'true');
    if (opts?.sourceId) form.append('source_id', opts.sourceId);
    return client.post<BaseResponse<UploadResponse>>(
      `/v2/orgs/${slug}/documents/upload`,
      form,
      { timeout: 60000 },
    );
  },

  list: (slug: string, opts?: ListDocsOptions) =>
    client.get<BaseResponse<ListDocsResponse>>(`/v2/orgs/${slug}/documents`, {
      params: {
        provider: opts?.provider || undefined,
        q: opts?.query?.trim() || undefined,
        doc_id: opts?.docId?.trim() || undefined,
        source_id: opts?.sourceId?.trim() || undefined,
        before_id: opts?.beforeId || undefined,
        limit: opts?.limit || undefined,
      },
    }),

  // id 是后端 snowflake uint64 字符串(见 types/api.ts 注释)。
  get: (slug: string, id: string) =>
    client.get<BaseResponse<GetDocResponse>>(`/v2/orgs/${slug}/documents/${id}`),

  // 原文内容。服务端返 text/markdown 裸字节(不是 BaseResponse 包裹),
  // 用 responseType:'text' 让 axios 把 body 当字符串直接返。
  // version 参数用于拉历史版本,省略就拉最新。
  getContent: (slug: string, id: string, version?: string) =>
    client.get<string>(`/v2/orgs/${slug}/documents/${id}/content`, {
      params: version ? { version } : undefined,
      responseType: 'text',
      transformResponse: (v) => v, // 关掉 axios 默认的 JSON.parse,保留原始字符串
    }),

  // 列出历史版本。按 created_at DESC 返回,最新在前。
  // 没有分页 —— 后端版本数受 MaxVersionsPerDocument 约束,默认 10。
  listVersions: (slug: string, id: string) =>
    client.get<BaseResponse<ListDocumentVersionsResponse>>(
      `/v2/orgs/${slug}/documents/${id}/versions`,
    ),

  remove: (slug: string, id: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/documents/${id}`),
};
