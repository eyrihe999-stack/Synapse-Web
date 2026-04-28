// source.ts 知识源(sources)+ Source ACL 的 axios 封装。
//
// Source 是权限承载者(visibility + ACL 都挂在 source 上)。M2 阶段只 manual_upload 一种 kind。
// owner-only 操作(改 visibility / 管 ACL)由后端 service 层校验。
import client from './client';
import type {
  BaseResponse,
  SourceResponse,
  ListSourcesResponse,
  UpdateVisibilityRequest,
  CreateSourceRequest,
  CreateGitLabSourceRequest,
  CreateGitLabSourceResponse,
  TriggerResyncResponse,
  GitLabSyncStatusResponse,
  ListSourceACLResponse,
  GrantSourceACLRequest,
  UpdateSourceACLRequest,
  SourceACLEntry,
} from '@/types/api';

// scope 取值:
//   - visible(默认):只列 caller 能读的 source(owner / visibility=org / ACL 命中)
//   - all:           全 org 列表
export type SourceListScope = 'visible' | 'all';

export const sourceApi = {
  // 分页列 org 下的 source。
  // kind 可选过滤(manual_upload / custom);scope 默认 visible(后端兜底)。
  list: (slug: string, page = 1, size = 20, kind?: string, scope?: SourceListScope) =>
    client.get<BaseResponse<ListSourcesResponse>>(`/v2/orgs/${slug}/sources`, {
      params: { page, size, kind, scope },
    }),

  // 列当前 user 作为 owner 的所有 source(不分页)
  listMine: (slug: string) =>
    client.get<BaseResponse<SourceResponse[]>>(`/v2/orgs/${slug}/sources/mine`),

  get: (slug: string, sourceId: string) =>
    client.get<BaseResponse<SourceResponse>>(`/v2/orgs/${slug}/sources/${sourceId}`),

  // 创建 kind=custom 的自建数据源(caller 自动成为 owner)
  create: (slug: string, data: CreateSourceRequest) =>
    client.post<BaseResponse<SourceResponse>>(`/v2/orgs/${slug}/sources`, data),

  // 改 visibility(仅 source owner 可)
  updateVisibility: (slug: string, sourceId: string, data: UpdateVisibilityRequest) =>
    client.patch<BaseResponse<SourceResponse>>(
      `/v2/orgs/${slug}/sources/${sourceId}/visibility`,
      data,
    ),

  // 删除 source(仅 owner)。前提:该 source 下所有 doc 已被清空,否则后端返 409/CodeSourceHasDocuments。
  remove: (slug: string, sourceId: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/sources/${sourceId}`),

  // ─ GitLab 同步源 ─
  // 端点都挂 RequirePerm('integration.gitlab.manage')—— 默认只 org owner 拿到该 perm。
  // 创建响应里的 webhook_secret 是**唯一一次**返明文,owner 必须立刻拷给 GitLab UI。

  createGitLab: (slug: string, data: CreateGitLabSourceRequest) =>
    client.post<BaseResponse<CreateGitLabSourceResponse>>(
      `/v2/orgs/${slug}/sources/gitlab`,
      data,
    ),

  removeGitLab: (slug: string, sourceId: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/sources/gitlab/${sourceId}`),

  // 触发重新全量同步。后端走幂等键 'gitlab:<id>:full',已有 active job 会复用 jobID。
  triggerGitLabResync: (slug: string, sourceId: string) =>
    client.post<BaseResponse<TriggerResyncResponse>>(
      `/v2/orgs/${slug}/sources/gitlab/${sourceId}/resync`,
    ),

  // 查 GitLab source 当前 / 最近一次同步任务的状态。前端轮询此端点展示进度。
  // 从未同步过 → status='never';终态 → finished_at 非零。
  getGitLabSyncStatus: (slug: string, sourceId: string) =>
    client.get<BaseResponse<GitLabSyncStatusResponse>>(
      `/v2/orgs/${slug}/sources/gitlab/${sourceId}/sync-status`,
    ),

  // ─ ACL ─

  listACL: (slug: string, sourceId: string) =>
    client.get<BaseResponse<ListSourceACLResponse>>(`/v2/orgs/${slug}/sources/${sourceId}/acl`),

  // 添加 ACL 授权(owner-only)。subject_type=group|user;permission=read|write
  grantACL: (slug: string, sourceId: string, data: GrantSourceACLRequest) =>
    client.post<BaseResponse<SourceACLEntry>>(
      `/v2/orgs/${slug}/sources/${sourceId}/acl`,
      data,
    ),

  // 改 ACL 的 permission(read↔write)
  updateACL: (slug: string, sourceId: string, aclId: string, data: UpdateSourceACLRequest) =>
    client.patch<BaseResponse<SourceACLEntry>>(
      `/v2/orgs/${slug}/sources/${sourceId}/acl/${aclId}`,
      data,
    ),

  revokeACL: (slug: string, sourceId: string, aclId: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/sources/${sourceId}/acl/${aclId}`),
};
