// permission.ts 权限组(perm groups)+ 审计日志的 axios 封装。
//
// 后端挂在 /api/v2/orgs/:slug/groups + /audit-log,共享 OrgContextMiddleware + PermContextMiddleware。
// owner-only 操作(改名 / 删组 / 加减成员)由后端 service 层硬规则校验,前端直接调即可。
import client from './client';
import type {
  BaseResponse,
  PermissionGroup,
  ListGroupsResponse,
  CreateGroupRequest,
  UpdateGroupRequest,
  AddGroupMemberRequest,
  ListGroupMembersResponse,
  AuditLogFilter,
  ListAuditLogResponse,
} from '@/types/api';

// ── Permission Groups ──
export const groupApi = {
  // 分页列 org 下所有组
  list: (slug: string, page = 1, size = 20) =>
    client.get<BaseResponse<ListGroupsResponse>>(`/v2/orgs/${slug}/groups`, {
      params: { page, size },
    }),

  // 列当前 user 加入的组(不分页,单 user 量级小)
  listMine: (slug: string) =>
    client.get<BaseResponse<PermissionGroup[]>>(`/v2/orgs/${slug}/groups/mine`),

  get: (slug: string, groupId: string) =>
    client.get<BaseResponse<PermissionGroup>>(`/v2/orgs/${slug}/groups/${groupId}`),

  // 任何 org 成员都可建组,创建者自动是 owner 兼成员
  create: (slug: string, data: CreateGroupRequest) =>
    client.post<BaseResponse<PermissionGroup>>(`/v2/orgs/${slug}/groups`, data),

  // 改名:仅组 owner 可
  update: (slug: string, groupId: string, data: UpdateGroupRequest) =>
    client.patch<BaseResponse<PermissionGroup>>(`/v2/orgs/${slug}/groups/${groupId}`, data),

  // 删组:仅 owner 可,级联删除成员关系
  delete: (slug: string, groupId: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/groups/${groupId}`),

  // 列组成员
  listMembers: (slug: string, groupId: string, page = 1, size = 100) =>
    client.get<BaseResponse<ListGroupMembersResponse>>(
      `/v2/orgs/${slug}/groups/${groupId}/members`,
      { params: { page, size } },
    ),

  // 加成员:仅 owner 可;目标 user 必须是 org 成员
  addMember: (slug: string, groupId: string, data: AddGroupMemberRequest) =>
    client.post<BaseResponse>(`/v2/orgs/${slug}/groups/${groupId}/members`, data),

  // 踢成员:owner 可踢任何人(除自己),普通成员可踢自己(自我退出)
  removeMember: (slug: string, groupId: string, userId: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/groups/${groupId}/members/${userId}`),
};

// ── Audit Log ──
// scope 由服务端决定:有 audit.read_all → 'all',否则强制 'self'(actor=me)。
// 前端不需要预先判断 perm,只接住响应的 scope 字段做提示文案即可。
export const auditApi = {
  list: (slug: string, filter: AuditLogFilter = {}) =>
    client.get<BaseResponse<ListAuditLogResponse>>(`/v2/orgs/${slug}/audit-log`, {
      params: filter,
    }),
};
