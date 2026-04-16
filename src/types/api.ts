// ── Standard response wrappers ──
export interface BaseResponse<T = unknown> {
  code: number;
  message: string;
  result?: T;
  error?: string;
}

export interface PaginationInfo {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface PaginatedResponse<T = unknown> extends BaseResponse<T> {
  pagination?: PaginationInfo;
}

// ── Auth ──
export interface RegisterRequest {
  email: string;
  password: string;
  display_name?: string;
  device_id?: string;
  device_name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  device_id?: string;
  device_name?: string;
}

export interface RefreshRequest {
  refresh_token: string;
  device_id?: string;
  device_name?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: UserProfile;
}

export interface UpdateProfileRequest {
  display_name?: string;
  avatar_url?: string;
}

// ── Organization ──
export interface CreateOrgRequest {
  slug: string;
  display_name: string;
  description?: string;
}

export interface UpdateOrgRequest {
  display_name?: string;
  description?: string;
}

export interface UpdateOrgSettingsRequest {
  require_agent_review?: boolean;
  record_full_payload?: boolean;
}

export interface TransferOwnershipRequest {
  target_user_id: string;
}

export interface OrgResponse {
  id: string;
  slug: string;
  display_name: string;
  description?: string;
  owner_user_id: string;
  status: string;
  require_agent_review: boolean;
  record_full_payload: boolean;
  created_at: number;
  updated_at: number;
}

export interface RoleSummary {
  id: string;
  name: string;
  display_name: string;
  is_preset: boolean;
  permissions: string[];
}

export interface OrgWithMyRole {
  org: OrgResponse;
  my_role: RoleSummary;
  joined_at: number;
}

// ── Members ──
export interface MemberResponse {
  user_id: string;
  display_name?: string;
  avatar_url?: string;
  role: RoleSummary;
  joined_at: number;
}

export interface ListMembersResponse {
  items: MemberResponse[];
  total: number;
  page: number;
  size: number;
}

export interface AssignRoleRequest {
  role_id: string;
}

// ── Invitations ──
export interface SearchInviteesRequest {
  query_type: 'user_id' | 'nickname' | 'email';
  user_id?: string;
  nickname?: string;
  email?: string;
}

export interface InviteeCandidate {
  user_id: string;
  display_name?: string;
  avatar_url?: string;
  masked_email?: string;
}

export interface SearchInviteesResponse {
  candidates: InviteeCandidate[];
}

export interface CreateInvitationRequest {
  invitee_user_id: string;
  role_id: string;
}

export interface InvitationResponse {
  id: string;
  org_id: string;
  org_slug?: string;
  org_display_name?: string;
  org_description?: string;
  org_owner_name?: string;
  org_member_count?: number;
  inviter_user_id: string;
  invitee_user_id: string;
  inviter_name?: string;
  inviter_email?: string;
  invitee_name?: string;
  invitee_email?: string;
  role?: RoleSummary;
  type: string;
  status: string;
  expires_at: number;
  created_at: number;
}

export interface ListInvitationsResponse {
  items: InvitationResponse[];
  total: number;
  page: number;
  size: number;
}

// ── Roles ──
export interface RoleResponse {
  id: string;
  org_id: string;
  name: string;
  display_name: string;
  is_preset: boolean;
  permissions: string[];
  created_at: number;
  updated_at: number;
}

export interface CreateRoleRequest {
  name: string;
  display_name: string;
  permissions: string[];
}

export interface UpdateRoleRequest {
  display_name?: string;
  permissions?: string[];
}

export interface PermissionsResponse {
  all: string[];
  owner_only: string[];
}

// ── Agent ──
export type AgentType = 'chat';

export interface CreateAgentRequest {
  slug: string;
  display_name: string;
  description?: string;
  agent_type?: AgentType;
  endpoint_url: string;
  context_mode?: 'stateless' | 'stateful';
  max_context_rounds?: number;
  auth_token?: string;
  timeout_seconds?: number;
  icon_url?: string;
  tags?: string[];
}

export interface UpdateAgentRequest {
  display_name?: string;
  description?: string;
  endpoint_url?: string;
  context_mode?: 'stateless' | 'stateful';
  max_context_rounds?: number;
  auth_token?: string;
  timeout_seconds?: number;
  icon_url?: string;
  tags?: string[];
}

export interface AgentResponse {
  id: string;
  owner_user_id: string;
  slug: string;
  display_name: string;
  description: string;
  agent_type: AgentType;
  endpoint_url: string;
  context_mode: 'stateless' | 'stateful';
  max_context_rounds: number;
  has_auth_token: boolean;
  timeout_seconds: number;
  icon_url: string;
  tags: string[];
  status: string;
  created_at: number;
  updated_at: number;
}

// ── Agent Publishing ──
export interface PublishAgentRequest {
  agent_id: string;
  note?: string;
}

export interface ReviewPublishRequest {
  note?: string;
}

export interface PublishResponse {
  id: string;
  agent_id: string;
  org_id: string;
  submitted_by_user_id: string;
  status: string;
  reviewed_by_user_id?: string;
  reviewed_at?: number;
  review_note?: string;
  revoked_at?: number;
  revoked_reason?: string;
  created_at: number;
  updated_at: number;
  submitted_by_display_name?: string;
  reviewed_by_display_name?: string;
  agent_slug?: string;
  agent_display_name?: string;
  agent_owner_uid?: string;
  agent_type?: AgentType;
  agent_description?: string;
  agent_icon_url?: string;
  agent_context_mode?: 'stateless' | 'stateful';
  agent_tags?: string[];
}

// ── Chat & Sessions ──
export interface ChatRequest {
  message: string;
  session_id?: string;
  stream?: boolean;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatResponse {
  session_id: string;
  message: ChatMessage;
}

export interface SessionResponse {
  session_id: string;
  agent_id: string;
  title: string;
  context_mode: 'stateless' | 'stateful';
  created_at: number;
  updated_at: number;
}

export interface MessageResponse {
  id: string;
  role: string;
  content: string;
  created_at: number;
}
