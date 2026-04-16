import client from './client';
import type {
  BaseResponse,
  PaginatedResult,
  CreateOrgRequest,
  UpdateOrgRequest,
  UpdateOrgSettingsRequest,
  TransferOwnershipRequest,
  OrgResponse,
  OrgWithMyRole,
  MemberResponse,
  ListMembersResponse,
  AssignRoleRequest,
  SearchInviteesRequest,
  SearchInviteesResponse,
  CreateInvitationRequest,
  InvitationResponse,
  ListInvitationsResponse,
  RoleResponse,
  CreateRoleRequest,
  UpdateRoleRequest,
  PermissionsResponse,
} from '@/types/api';

// ── Organization CRUD ──
export const orgApi = {
  create: (data: CreateOrgRequest) =>
    client.post<BaseResponse<OrgResponse>>('/v2/orgs', data),

  listMine: () =>
    client.get<BaseResponse<OrgWithMyRole[]>>('/v2/orgs/mine'),

  get: (slug: string) =>
    client.get<BaseResponse<OrgResponse>>(`/v2/orgs/${slug}`),

  update: (slug: string, data: UpdateOrgRequest) =>
    client.patch<BaseResponse<OrgResponse>>(`/v2/orgs/${slug}`, data),

  updateSettings: (slug: string, data: UpdateOrgSettingsRequest) =>
    client.patch<BaseResponse<OrgResponse>>(`/v2/orgs/${slug}/settings`, data),

  transfer: (slug: string, data: TransferOwnershipRequest) =>
    client.post<BaseResponse<InvitationResponse>>(`/v2/orgs/${slug}/transfer`, data),

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

  assignRole: (slug: string, userId: string, data: AssignRoleRequest) =>
    client.patch<BaseResponse>(`/v2/orgs/${slug}/members/${userId}/role`, data),
};

// ── Invitations ──
export const invitationApi = {
  searchInvitees: (slug: string, data: SearchInviteesRequest) =>
    client.post<BaseResponse<SearchInviteesResponse>>(`/v2/orgs/${slug}/invitations/search-invitees`, data),

  create: (slug: string, data: CreateInvitationRequest) =>
    client.post<BaseResponse<InvitationResponse>>(`/v2/orgs/${slug}/invitations`, data),

  listByOrg: (slug: string, page = 1, size = 20, status = '') =>
    client.get<BaseResponse<PaginatedResult<InvitationResponse>>>(`/v2/orgs/${slug}/invitations`, {
      params: { page, size, ...(status && { status }) },
    }),

  revoke: (slug: string, id: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/invitations/${id}`),

  listMine: (page = 1, size = 20, status = '') =>
    client.get<BaseResponse<PaginatedResult<InvitationResponse>>>('/v2/invitations/mine', {
      params: { page, size, ...(status && { status }) },
    }),

  accept: (id: string) =>
    client.post<BaseResponse<InvitationResponse>>(`/v2/invitations/${id}/accept`),

  reject: (id: string) =>
    client.post<BaseResponse<InvitationResponse>>(`/v2/invitations/${id}/reject`),
};

// ── Roles ──
export const roleApi = {
  list: (slug: string) =>
    client.get<BaseResponse<RoleResponse[]>>(`/v2/orgs/${slug}/roles`),

  create: (slug: string, data: CreateRoleRequest) =>
    client.post<BaseResponse<RoleResponse>>(`/v2/orgs/${slug}/roles`, data),

  update: (slug: string, id: string, data: UpdateRoleRequest) =>
    client.patch<BaseResponse<RoleResponse>>(`/v2/orgs/${slug}/roles/${id}`, data),

  delete: (slug: string, id: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/roles/${id}`),

  listPermissions: (slug: string) =>
    client.get<BaseResponse<PermissionsResponse>>(`/v2/orgs/${slug}/permissions`),
};
