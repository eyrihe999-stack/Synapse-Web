import client from './client';
import type {
  BaseResponse,
  PaginatedResult,
  CreateOrgRequest,
  UpdateOrgRequest,
  OrgResponse,
  OrgMembership,
  CheckSlugResponse,
  MemberResponse,
  RoleResponse,
  CreateRoleRequest,
  UpdateRoleRequest,
  AssignRoleRequest,
  UpdateRolePermissionsRequest,
  InvitationResponse,
  CreateInvitationRequest,
  ListInvitationsResponse,
  AcceptInvitationRequest,
  AcceptInvitationResult,
  InvitationPreviewResponse,
  InvitationStatus,
  InviteSearchType,
  SearchCandidatesResponse,
  ListMyInvitationsResponse,
  ListSentInvitationsResponse,
} from '@/types/api';

// ── Organization CRUD ──
export const orgApi = {
  create: (data: CreateOrgRequest) =>
    client.post<BaseResponse<OrgResponse>>('/v2/orgs', data),

  listMine: () =>
    client.get<BaseResponse<OrgMembership[]>>('/v2/orgs/mine'),

  // M3.6 创建前实时校验 slug 可用性。JWT 已在 orgsBase 路由组前置,避免匿名枚举。
  // 返回 {available, reason?}; reason 仅在 available=false 时有值。
  checkSlug: (slug: string) =>
    client.get<BaseResponse<CheckSlugResponse>>('/v2/orgs/check-slug', { params: { slug } }),

  get: (slug: string) =>
    client.get<BaseResponse<OrgResponse>>(`/v2/orgs/${slug}`),

  update: (slug: string, data: UpdateOrgRequest) =>
    client.patch<BaseResponse<OrgResponse>>(`/v2/orgs/${slug}`, data),

  dissolve: (slug: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}`),
};

// ── Members ──
export const memberApi = {
  list: (slug: string, page = 1, size = 20) =>
    client.get<BaseResponse<PaginatedResult<MemberResponse>>>(`/v2/orgs/${slug}/members`, {
      params: { page, size },
    }),

  remove: (slug: string, userId: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/members/${userId}`),

  leave: (slug: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/members/me`),

  // 改成员角色。不能给 owner 分配 / 不能改 owner member 的角色(后端强约束)。
  assignRole: (slug: string, userId: string, data: AssignRoleRequest) =>
    client.patch<BaseResponse<RoleResponse>>(`/v2/orgs/${slug}/members/${userId}/role`, data),
};

// ── Roles (per-org) ──
// 系统角色只读;自定义角色最多 20 个,有成员挂着时不能删。
export const roleApi = {
  list: (slug: string) =>
    client.get<BaseResponse<RoleResponse[]>>(`/v2/orgs/${slug}/roles`),

  create: (slug: string, data: CreateRoleRequest) =>
    client.post<BaseResponse<RoleResponse>>(`/v2/orgs/${slug}/roles`, data),

  update: (slug: string, roleSlug: string, data: UpdateRoleRequest) =>
    client.patch<BaseResponse<RoleResponse>>(`/v2/orgs/${slug}/roles/${roleSlug}`, data),

  delete: (slug: string, roleSlug: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/roles/${roleSlug}`),

  // M5:任意角色(含系统)的 permissions 编辑端点。
  // 后端挂 RequirePerm("role.manage_system"),默认 owner 才有。普通自定义角色编辑(非 perms)
  // 走 update();只需要改 perms 时也可以走 update(),但要改"系统角色"的 perms 必须走这个端点。
  updatePermissions: (slug: string, roleSlug: string, data: UpdateRolePermissionsRequest) =>
    client.patch<BaseResponse<RoleResponse>>(`/v2/orgs/${slug}/roles/${roleSlug}/permissions`, data),
};

// ── Invitations ──
// 组织上下文内的 4 个接口 + 独立路由组的 preview / accept。
// Preview 不需要登录态(邮件链接落地页);accept 需要登录(登录用户 email 必须匹配邀请 email)。
export const invitationApi = {
  // 创建邀请:(email, role_slug) → 后端发邮件,失败不回滚,调用方可走 resend 重试。
  create: (slug: string, data: CreateInvitationRequest) =>
    client.post<BaseResponse<InvitationResponse>>(`/v2/orgs/${slug}/invitations`, data),

  list: (slug: string, status?: InvitationStatus, page = 1, size = 20) =>
    client.get<BaseResponse<ListInvitationsResponse>>(`/v2/orgs/${slug}/invitations`, {
      params: { status, page, size },
    }),

  revoke: (slug: string, invitationId: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/invitations/${invitationId}`),

  // 重发 = 生成新 token + 重置过期 + 发邮件。老链接自动失效。
  resend: (slug: string, invitationId: string) =>
    client.post<BaseResponse<InvitationResponse>>(`/v2/orgs/${slug}/invitations/${invitationId}/resend`),

  // 独立路由(非 org 上下文),用 raw token 预览邀请摘要。
  preview: (token: string) =>
    client.get<BaseResponse<InvitationPreviewResponse>>(`/v2/invitations/preview`, {
      params: { token },
    }),

  accept: (data: AcceptInvitationRequest) =>
    client.post<BaseResponse<AcceptInvitationResult>>(`/v2/invitations/accept`, data),

  // 按 type + q 搜可邀请的用户。
  // 后端会在搜索结果中直接标记 is_member / has_pending_invite,前端据此灰掉不可点的条目。
  // 注意:search type=name 时前端应确保 q 至少 2 字符后再调,避免 400。
  searchCandidates: (slug: string, type: InviteSearchType, q: string) =>
    client.get<BaseResponse<SearchCandidatesResponse>>(
      `/v2/orgs/${slug}/invitations/search`,
      { params: { type, q } },
    ),

  // ── 被邀请人视角 ──

  // 列当前登录用户收到的邀请(收件箱)。status 为空拿全部,按 created_at DESC。
  // 后端按 email 大小写不敏感匹配;返全量或过 pending 时会顺带做懒过期。
  listMine: (status?: InvitationStatus) =>
    client.get<BaseResponse<ListMyInvitationsResponse>>(`/v2/invitations/mine`, {
      params: status ? { status } : undefined,
    }),

  // 列当前登录用户作为 inviter 发出的邀请(跨 org 发件箱)。
  listSent: (status?: InvitationStatus) =>
    client.get<BaseResponse<ListSentInvitationsResponse>>(`/v2/invitations/sent`, {
      params: status ? { status } : undefined,
    }),

  // 站内收件箱接受:用 invitation id 而非 token。权限仍以 email 匹配兜底。
  acceptById: (invitationId: string) =>
    client.post<BaseResponse<AcceptInvitationResult>>(
      `/v2/invitations/${invitationId}/accept`,
    ),

  // 被邀请人主动拒绝 pending 邀请。inviter 撤销走 revoke(org context 下)。
  rejectById: (invitationId: string) =>
    client.post<BaseResponse>(`/v2/invitations/${invitationId}/reject`),
};
