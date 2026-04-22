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
  code: string;
  display_name?: string;
  device_id?: string;
  device_name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  code: string;
  device_id?: string;
  device_name?: string;
}

export interface SendEmailCodeRequest {
  email: string;
}

export interface SendEmailCodeResponse {
  email: string;
  expires_in: number;
  sent_at: string;
}

export interface RefreshRequest {
  refresh_token: string;
  device_id?: string;
  device_name?: string;
}

// ── Password Reset (M1.3) ──
// request:传邮箱,后端无论是否存在都返成功(防账户枚举)
// confirm:传 token + 新密码,成功后后端会清空所有 session,用户需重新登录
export interface RequestPasswordResetRequest {
  email: string;
}

export interface ConfirmPasswordResetRequest {
  token: string;
  new_password: string;
}

// ── OAuth Login (M1.6) ──
// 后端 /auth/oauth/google/callback 完成 OIDC 后把 AuthResponse 暂存 Redis,
// 302 到 /auth/oauth/callback?exchange={code};前端用 code 调 /auth/oauth/exchange 兑换真 tokens。
export interface OAuthExchangeRequest {
  code: string;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string;
  // M1.7 账号状态:0=pending_verify / 1=active / 2=banned / 3=deleted
  status?: number;
  // M1.1 邮箱验证完成时间;null 表示 pending_verify,前端据此提示"请先验证邮箱"
  email_verified_at?: string | null;
  last_login_at?: string | null;
  created_at: string;
}

// ── Account Security (M1.7 改密 / 改邮箱 / 注销) ──
// ChangePassword:OAuth-only 账号 (password_hash 空) 必须带 Code(发到当前邮箱的 6 位);
//                本地账号带 OldPassword。成功后 LogoutAll,需重登。
export interface ChangePasswordRequest {
  old_password?: string;
  new_password: string;
  code?: string;
}

// ChangeEmail:必须先通过 /auth/email/send-code 向 new_email 发码,本接口消费该码;
//             OAuth-only 账号后端直接拒(需先走 ChangePassword 绑本地密码)。
export interface ChangeEmailRequest {
  new_email: string;
  password?: string;
  code: string;
}

// DeleteAccount:本地账号必须带 password 二次确认,OAuth-only 省略。
// Reason 上限 64 字节,审计用。
export interface DeleteAccountRequest {
  password?: string;
  reason?: string;
}

// ── Email Verification (M1.1) ──
// VerifyEmail:从邮件链接里拿 token 激活;一次性消费。
export interface VerifyEmailRequest {
  token: string;
}

// ── Sessions ──
export interface SessionEntry {
  device_id: string;
  device_name: string;
  login_ip: string;
  login_at: number;
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

// M3.6 创建前 slug 预检。reason 仅在 available=false 时有值:
//   - "invalid_format":不符合 ^[a-z][a-z0-9-]{2,31}$
//   - "taken":slug 已被占用(含已解散 org)
export interface CheckSlugResponse {
  available: boolean;
  reason?: 'invalid_format' | 'taken';
}

// M3.7 注销 guard 响应体里的 org 摘要;owner 仍有 active org 时后端带回来引导 UI。
export interface OwnedOrgSummary {
  slug: string;
  display_name: string;
}

export interface OrgResponse {
  id: string;
  slug: string;
  display_name: string;
  description?: string;
  owner_user_id: string;
  status: string;
  created_at: number;
  updated_at: number;
}

// GET /v2/orgs/mine 每条记录:简化架构下只有 org + 加入时间,无 role。
export interface OrgMembership {
  org: OrgResponse;
  joined_at: number;
}

// ── Role (per-org) ──
// 系统角色 (is_system=true) 三条由后端自动 seed:owner / admin / member,slug 锁死、不可改不可删。
// 自定义角色数量上限 20,slug 必须符合 ^[a-z][a-z0-9-]{1,31}$ 且不能冲突系统保留 slug。
//
// M5:角色带 permissions(操作权限位列表),控制 RBAC 受限端点。前端必须把当前 user 自己的
// permissions 缓存起来用于"权限上限"提示(创建/改 role 时不能配出超过自己的 perm)。
export interface RoleSummary {
  slug: string;
  display_name: string;
  is_system: boolean;
}

export interface RoleResponse {
  slug: string;
  display_name: string;
  is_system: boolean;
  permissions: string[];
  created_at: number;
  updated_at: number;
}

export interface CreateRoleRequest {
  slug: string;
  display_name: string;
  permissions?: string[];
}

// UpdateRoleRequest 修改自定义角色:permissions 用 null/undefined 区分"不动"和"清空":
//   - 不传(undefined)→ 不动
//   - 传 [](空数组)→ 替换为空集
// 注意系统角色改 perms 走独立端点 PATCH /roles/:slug/permissions。
export interface UpdateRoleRequest {
  display_name?: string;
  permissions?: string[];
}

// UpdateRolePermissionsRequest:任意角色(含系统)的 permissions 编辑请求体,
// 由 PATCH /roles/:slug/permissions 端点接收。需要 role.manage_system 权限(默认 owner)。
export interface UpdateRolePermissionsRequest {
  permissions: string[];
}

export interface AssignRoleRequest {
  role_slug: string;
}

// ── Permission constants(M4) ──
// 后端权限位,前端用来在 perm 编辑器里渲染、做上限校验。
// 加新 perm 时这里同步加。
export const ALL_PERMISSIONS = [
  // org
  'org.transfer',
  'org.dissolve',
  'org.update',
  // member
  'member.invite',
  'member.remove',
  'member.role_assign',
  // role
  'role.manage',
  'role.manage_system',
  // source
  'source.create',
  'source.delete_any',
  // group
  'group.create',
  'group.delete_any',
  // audit
  'audit.read_all',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

// 权限分组(用于 UI 渲染分类的 checkbox 矩阵)
export const PERMISSION_GROUPS: Array<{ label: string; perms: Permission[] }> = [
  { label: '组织', perms: ['org.transfer', 'org.dissolve', 'org.update'] },
  { label: '成员', perms: ['member.invite', 'member.remove', 'member.role_assign'] },
  { label: '角色', perms: ['role.manage', 'role.manage_system'] },
  { label: '知识源', perms: ['source.create', 'source.delete_any'] },
  { label: '权限组', perms: ['group.create', 'group.delete_any'] },
  { label: '审计', perms: ['audit.read_all'] },
];

// 中文展示名(单条 perm 的文案)
export const PERMISSION_LABELS: Record<Permission, string> = {
  'org.transfer': '转让所有权',
  'org.dissolve': '解散组织',
  'org.update': '修改组织信息',
  'member.invite': '邀请 / 列邀请',
  'member.remove': '踢出成员',
  'member.role_assign': '分配成员角色',
  'role.manage': '管理自定义角色',
  'role.manage_system': '编辑系统角色权限',
  'source.create': '创建知识源',
  'source.delete_any': '删除他人知识源',
  'group.create': '创建权限组',
  'group.delete_any': '删除他人权限组',
  'audit.read_all': '查看全 org 审计',
};

// ── Members ──
// email / status / email_verified_at / last_login_at 由后端 JOIN users 表回填,同 org 成员可见。
// email_verified_at=null 表示未验证邮箱;last_login_at=null 表示从未登录;status 同 UserProfile.status
// 枚举(0=pending_verify / 1=active / 2=banned / 3=deleted)。
export interface MemberResponse {
  user_id: string;
  email?: string;
  display_name?: string;
  avatar_url?: string;
  status?: number;
  email_verified_at?: number | null;
  last_login_at?: number | null;
  joined_at: number;
  role: RoleSummary;
}

export interface ListMembersResponse {
  items: MemberResponse[];
  total: number;
  page: number;
  size: number;
}

// ── Invitations ──
// 邀请状态机:pending → {accepted | revoked | rejected | expired}。
//   - revoked  : inviter 主动撤销
//   - rejected : invitee 主动拒绝(收件箱拒绝按钮)
//   - expired  : 懒过期
// raw token 只出现在邮件链接里,后端 DB 只存 sha256 hash;列表/详情 API 不返 token。
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'rejected' | 'expired';

export interface InvitationResponse {
  id: string;
  email: string;
  role: RoleSummary;
  status: InvitationStatus;
  inviter_user_id: string;
  expires_at: number;
  accepted_at?: number;
  accepted_user_id?: string;
  created_at: number;
  updated_at: number;
}

export interface ListInvitationsResponse {
  items: InvitationResponse[];
  total: number;
  page: number;
  size: number;
}

export interface CreateInvitationRequest {
  email: string;
  role_slug: string;
}

export interface AcceptInvitationRequest {
  token: string;
}

// Accept 成功后前端据此跳到 org 详情页。
export interface AcceptInvitationResult {
  org_id: string;
  org_slug: string;
  display_name: string;
}

// Preview 未登录也可调,返邀请摘要(不含 token)。
export interface InvitationPreviewResponse {
  org_slug: string;
  org_display_name: string;
  inviter_name: string;
  email: string;
  role: RoleSummary;
  status: InvitationStatus;
  expires_at: number;
}

// ── Invitation search candidates ──
// 搜索类型:邀请对话框让用户明示选择,后端按 type 分三路 SQL:
//   email   → LOWER(email) 精确,limit 1
//   user_id → 主键精确,limit 1
//   name    → display_name LIKE '%q%',limit 10,query >= 2 字符
export type InviteSearchType = 'email' | 'user_id' | 'name';

export interface InviteCandidate {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  // is_member = 已是该 org 成员;has_pending_invite = 已有一条 pending 邀请挂着。
  // 任一为 true 的候选前端应灰掉并禁用点击。
  is_member: boolean;
  has_pending_invite: boolean;
}

export interface SearchCandidatesResponse {
  items: InviteCandidate[];
}

// ── My Invitations(收件箱) ──
// 登录用户按 email 匹配收到的邀请。和 InvitationPreviewResponse 相比多了 id,
// 少了 email(email 永远是登录用户自己);status 带上让前端区分 pending / 已处理。
export interface MyInvitationResponse {
  id: string;
  org_slug: string;
  org_display_name: string;
  inviter_name: string;
  role: RoleSummary;
  status: InvitationStatus;
  expires_at: number;
  created_at: number;
}

export interface ListMyInvitationsResponse {
  items: MyInvitationResponse[];
}

// ── Sent Invitations(发件箱) ──
// 登录用户作为 inviter 发出的邀请,跨 org 聚合。和 MyInvitationResponse 相比
// 显式带 email(发给谁),不带 inviter_name(永远是登录用户自己)。
export interface SentInvitationResponse {
  id: string;
  org_slug: string;
  org_display_name: string;
  email: string;
  role: RoleSummary;
  status: InvitationStatus;
  expires_at: number;
  created_at: number;
}

export interface ListSentInvitationsResponse {
  items: SentInvitationResponse[];
}

// ── Documents ──
// Upload 三态:
//   already_indexed  → 同内容已存在,doc_id 即为已有文档
//   queued           → 已入队向量化,轮询 job_id 看进度
//   filename_conflict → 同名异内容,需用户确认后带 overwrite=true 重试
export type UploadStatus = 'already_indexed' | 'queued' | 'filename_conflict';

// 注:snowflake ID (doc_id / job_id / existing_doc_id / uploader_id 等) 是 uint64,
// 超过 JS Number 精度 (2^53),后端已序列化为字符串避免精度丢失。拼 URL / 比较直接用 string。
export interface UploadResponse {
  status: UploadStatus;
  doc_id?: string;
  job_id?: string;
  content_hash?: string;
  existing_doc_id?: string;
  existing_file_name?: string;
}

export interface DocumentDTO {
  id: string;
  title: string;
  file_name: string;
  provider: string;
  mime_type: string;
  version: string;
  chunk_count: number;
  content_byte_size: number;
  uploader_id: string;
  // M2:doc 所属的"知识源"id;前端用于跳转到 source 详情 / 显示归属。
  // 历史 doc backfill 后 != 0;新 doc 在上传时由 handler 调 source.EnsureManualUpload 拿到。
  knowledge_source_id?: string;
  created_at: number;
  updated_at: number;
}

export interface ListDocsResponse {
  docs: DocumentDTO[];
  next_cursor?: string;
}

export interface GetDocResponse {
  doc: DocumentDTO;
  chunks_indexed: number;
  chunks_failed: number;
}

// 一条历史版本。is_current 由后端直接算好(等于 documents.version == version_hash)。
// 版本数量受 OSS.MaxVersionsPerDocument 限制(默认 10),所以不做分页。
export interface DocumentVersionResponse {
  version_hash: string;
  file_size: number;
  created_at: number;
  is_current: boolean;
}

export interface ListDocumentVersionsResponse {
  items: DocumentVersionResponse[];
}

// ── Permission Groups (M1) ──
// 权限组是 per-org 的"用户集合",用于资源 ACL 的授权目标。
// 任何 org 成员都可建组(创建者自动成为 owner 兼成员);
// 改名 / 删组 / 加减成员是组 owner 专属(service 层硬规则,owner 自己不能被踢)。
export interface PermissionGroup {
  id: string;
  org_id: string;
  name: string;
  owner_user_id: string;
  member_count: number;
  created_at: number;
  updated_at: number;
}

export interface ListGroupsResponse {
  items: PermissionGroup[];
  total: number;
  page: number;
  size: number;
}

export interface CreateGroupRequest {
  name: string;
}

export interface UpdateGroupRequest {
  name?: string;
}

export interface AddGroupMemberRequest {
  user_id: string;
}

export interface GroupMemberEntry {
  user_id: string;
  joined_at: number;
}

export interface ListGroupMembersResponse {
  items: GroupMemberEntry[];
  total: number;
  page: number;
  size: number;
}

// ── Sources / 知识源 (M2 + M3) ──
// 每个 doc 必属于一个 source;source 是权限承载者(visibility + ACL 都挂在 source 上)。
// - manual_upload:默认收件箱,每 user 每 org lazy 创建一条
// - custom:       用户自建的命名数据源,同一 owner 下 name 唯一
// 后续扩展 kind:gitlab_repo / feishu_space 等
export type SourceKind = 'manual_upload' | 'custom' | string;
export type SourceVisibility = 'org' | 'group' | 'private';

export interface SourceResponse {
  id: string;
  org_id: string;
  kind: SourceKind;
  owner_user_id: string;
  external_ref?: string;
  name: string;
  visibility: SourceVisibility;
  created_at: number;
  updated_at: number;
}

export interface ListSourcesResponse {
  items: SourceResponse[];
  total: number;
  page: number;
  size: number;
}

export interface UpdateVisibilityRequest {
  visibility: SourceVisibility;
}

// 自建 custom 数据源的请求体。visibility 省略 → 后端默认 org。
export interface CreateSourceRequest {
  name: string;
  visibility?: SourceVisibility;
}

// ── Source ACL (M3) ──
// 一条 ACL 行表示"某 subject(group/user)对某 source 拥有 read/write 权限"。
// 同 (source, subject) 至多一条 ACL;改 permission 走 PATCH,不能 grant 同 subject 两次(409)。
// resource owner 隐式 admin,不能给 owner 自己授权(400)。
export type ACLSubjectType = 'group' | 'user';
export type ACLPermission = 'read' | 'write';

export interface SourceACLEntry {
  id: string;
  source_id: string;
  subject_type: ACLSubjectType;
  subject_id: string;
  permission: ACLPermission;
  granted_by: string;
  created_at: number;
}

export interface ListSourceACLResponse {
  items: SourceACLEntry[];
}

export interface GrantSourceACLRequest {
  subject_type: ACLSubjectType;
  subject_id: string;
  permission: ACLPermission;
}

export interface UpdateSourceACLRequest {
  permission: ACLPermission;
}

// ── Audit Log (M6) ──
// 审计行,所有权限变更都落到 permission_audit_log。
//   - actor_user_id:操作者(系统/迁移路径记 0)
//   - action:动作名,见 ACTION_* 常量列表
//   - target_type / target_id:被操作对象
//   - before / after / metadata:JSON 任意结构,前端按 action 自解释
//
// scope:服务端根据 caller 是否有 audit.read_all 决定:'all' = 全 org,'self' = 仅自己作为 actor
export interface AuditLogRow {
  id: string;
  org_id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  created_at: number;
}

export type AuditScope = 'all' | 'self';

export interface ListAuditLogResponse {
  items: AuditLogRow[];
  next_before_id?: string;
  scope: AuditScope;
}

export interface AuditLogFilter {
  actor_user_id?: string;
  target_type?: string;
  target_id?: string;
  action?: string;
  action_prefix?: string;
  before_id?: string;
  limit?: number;
}

// ── AsyncJob ──
// 对应后端 /api/v2/async-jobs/:id;docupload 任务轮询进度用。
export type AsyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface AsyncJobResponse {
  id: string;
  kind: string;
  status: AsyncJobStatus;
  progress_total: number;
  progress_done: number;
  progress_failed: number;
  result?: Record<string, unknown>;
  error?: string;
  created_at: number;
  started_at?: number;
  finished_at?: number;
}
