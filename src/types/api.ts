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
  // 对应 principals.id;ChannelMember / task.assignee / reactions 等存 principal_id,
  // 前端判定"这条数据是不是我的"必须用 principal_id 比对(不是 user.id)。
  principal_id: string;
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
  // principal_id 是 user 的身份根 id(users.principal_id),用于把"人"映射到
  // channel_members / tasks 存的 principal_id。后端 JOIN 缺失时为 "0"。
  principal_id: string;
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
// SourceKind 取值。manual_upload / custom 是地基;gitlab_repo 是 PR-A 后接的同步源,
// 走 owner 凭据拉 GitLab repo 文件 + webhook 增量同步。
// 后续扩展:feishu_space 等
export type SourceKind = 'manual_upload' | 'custom' | 'gitlab_repo' | string;
export type SourceVisibility = 'org' | 'group' | 'private';

// GitLab 同步状态:对应后端 model.SyncStatus*。
//   - never:刚创建,从未同步过(后端字段为空串,前端用 'never' 占位)
//   - running:有 active asyncjob 进行中
//   - succeeded:上一次成功
//   - auth_failed:PAT/OAuth 失效或 owner 看不到 repo,owner 必须重发凭据
//   - failed:GitLab 5xx / 网络 / runner 抛错(可重试)
export type GitLabSyncStatus = 'never' | 'running' | 'succeeded' | 'auth_failed' | 'failed';

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

  // ── GitLab 专属(其他 kind 留空)──
  gitlab_branch?: string;
  // last_sync_status 后端可能给空串(从未同步)— 视图层归一为 'never'
  last_sync_status?: string;
  last_synced_at?: number;
  last_synced_commit?: string;
  last_sync_error?: string;
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

// ── GitLab 同步源 ──
// owner-only 操作(端点 RequirePerm 'integration.gitlab.manage')。
// PAT 由 owner 在 GitLab 自己生成,scope 至少需 read_api + read_repository。
export interface CreateGitLabSourceRequest {
  base_url?: string; // 空 → https://gitlab.com;自托管填 https://gitlab.example.com
  pat: string; // GitLab Personal Access Token
  project_id: string; // GitLab project 数字 id(string,JS 大数安全)
  branch?: string; // 空 → 'main'
  visibility?: SourceVisibility;
}

// CreateGitLabSourceResponse webhook_secret 是**唯一一次**返明文的机会。
// 创建后立刻拷给 GitLab Project → Settings → Webhooks 的 Secret Token 字段。
//
// webhook_url 后端按 cfg.Server.PublicBaseURL(fallback OAuth.Issuer)拼出的完整公网 URL;
// 服务端没配公网基址 → 字段空,前端 fallback 到 window.location.origin 拼并显示 localhost 警告。
export interface CreateGitLabSourceResponse {
  source: SourceResponse;
  webhook_secret: string;
  webhook_url?: string;
  job_id: string; // 首次全量同步 asyncjob id
}

export interface TriggerResyncResponse {
  job_id: string;
}

// GitLabSyncStatusResponse 单 GitLab source 当前 / 最近一次同步任务的状态。
//
// 从未同步过 → status='never' + 其他字段零值。
// running / queued:Progress* 实时变化,前端轮询展示;heartbeat_at 用来检测 runner 是否卡。
// 终态:finished_at 非零;error 仅 status=failed/canceled 时非空。
export interface GitLabSyncStatusResponse {
  job_id?: string;
  status: 'never' | 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | string;
  mode?: 'full' | 'incremental' | '';
  progress_done: number;
  progress_total: number;
  progress_failed: number;
  started_at?: number; // unix seconds
  finished_at?: number;
  heartbeat_at?: number;
  error?: string;
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

// ── Agents ──
// Agent WS 网关的 agent 档案 —— CRUD + apikey 生命周期。
// 对应后端 /api/v2/orgs/:slug/agents/*(模块号 25)。

// AgentKind agent 分类:
//   - system:apikey 身份,代表服务 / 自动化流程接入。仅 owner/admin 可创建,V1 唯一类型
//   - user  :(未来)JWT 身份,代表某个 user 发起调用;成员可自建
export type AgentKind = 'system' | 'user';

export interface AgentResponse {
  id: string;              // snowflake 序列化为 string
  // principal_id 该 agent 在 principals 表的身份根 id,channel_members / task.assignee
  // 都存 principal_id,@mention / 权限检查靠它定位;全局 agent(org_id='0')也有正常分配的非 0 值。
  principal_id: string;
  agent_id: string;        // 握手时的 X-Agent-ID,系统生成 agt_<...>
  org_id: string;
  kind: AgentKind;
  display_name: string;
  enabled: boolean;
  last_seen_at?: number;   // unix seconds,handshake 成功时刷新
  rotated_at?: number;     // unix seconds,rotate-key 时刷新
  created_by_uid: string;
  created_at: number;
  updated_at: number;
  online: boolean;         // Hub 维度的当前在线状态(不在 DB,运行时填)
}

export interface CreateAgentRequest {
  display_name: string;
}

export interface UpdateAgentRequest {
  display_name?: string;
  enabled?: boolean;
}

// 创建 agent 时 apikey 只返一次 —— 关闭弹窗后再也拿不到。
export interface CreateAgentResponse {
  agent: AgentResponse;
  apikey: string;
}

// rotate-key 同上,新 apikey 只返一次。
export interface RotateKeyResponse {
  agent: AgentResponse;
  apikey: string;
}

export interface ListAgentResponse {
  items: AgentResponse[];
  total: number;
  offset: number;
  limit: number;
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

// ══════════════════════════════════════════════════════════════════════════
// Collaboration(Synapse PR #2 / #4' / #6')—— 项目 / Channel / 消息 / 任务
// ══════════════════════════════════════════════════════════════════════════
//
// 后端 DTO 参考:
//   internal/channel/dto/*.go(project / version / channel / member / message / kb_ref)
//   internal/task/dto/*.go   (task / submission / review)
//
// 说明:
//   - 后端目前把 uint64 id 字段序列化为 JSON 数字(非 ",string")。本项目里
//     org/project/channel/task 的 id 走 MySQL AUTO_INCREMENT,小整数为主,
//     近期不会撞 JS Number 精度上限(2^53-1 ≈ 9e15)。长期 Snowflake 化时
//     需要同步把 DTO 加 ",string" 并把这里的 number 换成 string。
//   - 时间戳后端用 `time.Time`(RFC 3339 string),前端用 `string` 存,展示前
//     再 `new Date(...)` 解。

// ── Project ──
export interface ProjectResponse {
  id: number;
  org_id: number;
  name: string;
  description?: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface CreateProjectRequest {
  org_id: number;
  name: string;
  description?: string;
}

// ── Version ──
// 时间轴维度:什么时候发(里程碑 / sprint / fix-version 都用这个)。
// 后端 pm.IsValidVersionStatus:planning / active / released / cancelled。
// (没有 archived;version 的"结束"语义就是 released 或 cancelled。)
export type VersionStatus = 'planning' | 'active' | 'released' | 'cancelled';

export interface VersionResponse {
  id: number;
  project_id: number;
  name: string;
  status: VersionStatus | string;
  target_date?: string;
  released_at?: string;
  is_system?: boolean;
  created_by?: number;
  created_at: string;
  updated_at?: string;
}

export interface CreateVersionRequest {
  name: string;
  status: string;
  target_date?: string;
}

export interface UpdateVersionRequest {
  status?: string;
  target_date?: string;
  released_at?: string;
}

// ── Initiative ──
// 主题轴维度:为什么做。Initiative ⊥ Version 是正交两维,Workstream 是网格颗粒。
// 后端 pm.IsValidInitiativeStatus:planned / active / completed / cancelled。
// archive 动作触发 active→completed 自动转换 + 写 archived_at。
export type InitiativeStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export interface InitiativeResponse {
  id: number;
  project_id: number;
  name: string;
  description?: string;
  target_outcome?: string;
  status: InitiativeStatus | string;
  is_system?: boolean;
  created_by: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface CreateInitiativeRequest {
  name: string;
  description?: string;
  target_outcome?: string;
}

export interface UpdateInitiativeRequest {
  name?: string;
  description?: string;
  target_outcome?: string;
  status?: string;
}

// ── Workstream ──
// Initiative × Version 网格上的执行颗粒。version_id=null/undefined 表示 backlog(未排期)。
// 后端 pm.IsValidWorkstreamStatus:draft / active / blocked / done / cancelled。
export type WorkstreamStatus = 'draft' | 'active' | 'blocked' | 'done' | 'cancelled';

export interface WorkstreamResponse {
  id: number;
  initiative_id: number;
  version_id?: number;
  project_id: number;
  name: string;
  description?: string;
  status: WorkstreamStatus | string;
  channel_id?: number;
  created_by: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface CreateWorkstreamRequest {
  name: string;
  description?: string;
  version_id?: number;
}

export interface UpdateWorkstreamRequest {
  name?: string;
  description?: string;
  status?: string;
  version_id?: number;
}

// ── Project KB Ref ──
// 二选一:挂 source 或 doc。
export interface ProjectKBRefResponse {
  id: number;
  project_id: number;
  kb_source_id?: number;
  kb_document_id?: number;
  attached_by: number;
  attached_at: string;
}

export interface AttachProjectKBRefRequest {
  kb_source_id?: number;
  kb_document_id?: number;
}

// ── Roadmap 聚合视图 ──
// GET /api/v2/projects/:id/roadmap 返回的形状。后端已过滤 archived initiative /
// archived workstream / cancelled version,前端按 id 自己交叉关联。
export interface ProjectRoadmapResponse {
  project_id: number;
  initiatives: InitiativeResponse[];
  versions: VersionResponse[];
  workstreams: WorkstreamResponse[];
}

// ── Channel ──
export type ChannelStatus = 'open' | 'archived';

// kind=='regular' 是默认普通 channel;kind=='project_console' 是 Project Architect
// agent 的工作间(每个 project 自动有一个,workstream_id IS NULL)。
export type ChannelKind = 'regular' | 'project_console';

export interface ChannelResponse {
  id: number;
  org_id: number;
  project_id: number;
  name: string;
  purpose?: string;
  status: ChannelStatus;
  kind: ChannelKind | string;
  workstream_id?: number;
  created_by: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface CreateChannelRequest {
  project_id: number;
  name: string;
  purpose?: string;
}

// ── Channel Member ──
// admin:系统 agent(如 Project Architect)进入 project_console 时由 pmevent consumer
// 直接 INSERT 写入,人手不可 PATCH 设(后端 isValidMemberRole 拒绝)。
export type ChannelMemberRole = 'owner' | 'admin' | 'member' | 'observer';

export interface ChannelMemberResponse {
  channel_id: number;
  principal_id: number;
  role: ChannelMemberRole;
  joined_at: string;
}

export interface AddChannelMemberRequest {
  principal_id: number;
  role: ChannelMemberRole;
}

export interface UpdateChannelMemberRoleRequest {
  role: ChannelMemberRole;
}

// ── Channel Message ──
// 服务端支持的 kind;V1 只有 text / system_event 两种。
export type MessageKind = 'text' | 'system_event';

// ReplyPreview 引用卡片:作者 + 正文前若干字。目标消息被硬删除时 missing=true。
export interface ReplyPreview {
  message_id: number;
  author_principal_id: number;
  body_snippet: string;
  missing: boolean;
}

// ReactionEntry 一条消息上 "同一 emoji 被哪几个 principal 打过"(PR #12')。
// 前端按 principal_ids 查 displayName 渲染成 `👍 Alice, Bob`。
export interface ReactionEntry {
  emoji: string;
  principal_ids: number[];
}

// 预设 emoji 白名单 —— 和后端 const.go AllowedReactionEmojis 对齐。
// 任何不在此集合的 emoji 后端都会拒(400 CodeReactionEmojiInvalid)。
export const ALLOWED_REACTION_EMOJIS = [
  '👍', '👎', '❤️', '🎉', '🚀', '👀',
  '🙏', '😂', '🔥', '✅', '❌', '🤔',
] as const;

export interface ChannelMessageResponse {
  id: number;
  channel_id: number;
  author_principal_id: number;
  body: string;
  kind: MessageKind;
  mentions: number[]; // principal_id 数组
  reactions?: ReactionEntry[]; // 可选,空不返
  reply_to_message_id?: number; // 引用另一条消息的 id(不引用时缺省)
  reply_to_preview?: ReplyPreview; // 引用卡片预览(目标消息的作者 + 正文前若干字)
  source_event_id?: string; // kind=system_event 时非空,标识来源 Redis stream event ID(幂等键)
  created_at: string;
}

// SystemEventBody kind=system_event 的 body(JSON 字符串)结构。
// event_type 取值见 collaboration-roadmap.md PR #11' 清单(14 种);未知类型
// 前端 SystemEventCard 降级渲染"未知事件"。
export interface SystemEventBody {
  event_type: string;
  actor_principal_id: number;
  detail: Record<string, string>;
}

export interface ListMessagesResponse {
  messages: ChannelMessageResponse[];
  cursor: number; // 0 表示无更多
}

export interface PostMessageRequest {
  body: string;
  mentions?: number[];
  reply_to_message_id?: number;
}

// ── Channel KB Refs ──
// 一条 KBRef 要么挂 source,要么挂 document(恰好一个非 0)。
export interface ChannelKBRefResponse {
  id: number;
  channel_id: number;
  kb_source_id?: number;
  kb_document_id?: number;
  added_by: number;
  added_at: string;
}

export interface AddKBRefRequest {
  kb_source_id?: number;
  kb_document_id?: number;
}

// ── Channel 共享文档(PR #9') ────────────────────────────────────────────────

export type ChannelDocumentKind = 'md' | 'text';

export interface ChannelDocumentLockResponse {
  held_by_principal_id: number;
  locked_at: string;
  expires_at: string;
  acquired: boolean; // 仅在抢/续锁返回时有意义;Get 拼回时为 false
}

// 后端 list/get 都用同一个 response struct;list 也会带 lock(锁未空时)
export interface ChannelDocumentResponse {
  id: number;
  channel_id: number;
  org_id: number;
  title: string;
  content_kind: ChannelDocumentKind;
  current_version?: string;
  current_byte_size: number;
  created_by_principal_id: number;
  updated_by_principal_id: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  lock?: ChannelDocumentLockResponse;
}

export interface ChannelDocumentVersionResponse {
  id: number;
  document_id: number;
  version: string;
  byte_size: number;
  edited_by_principal_id: number;
  edit_summary?: string;
  created_at: string;
}

export interface ChannelDocumentContentResponse {
  document: ChannelDocumentResponse;
  version: ChannelDocumentVersionResponse;
  content: string;
}

export interface SaveChannelDocumentVersionResponse {
  document: ChannelDocumentResponse;
  version: ChannelDocumentVersionResponse;
  created: boolean; // false = 同 hash 已存在,未实际写新版
}

export interface LockOperationResponse {
  lock: ChannelDocumentLockResponse;
}

export interface CreateChannelDocumentRequest {
  title: string;
  content_kind: ChannelDocumentKind;
}

export interface SaveChannelDocumentVersionRequest {
  content: string;
  edit_summary?: string;
}

// ══════════════════════════════════════════════════════════════════════════
// Task(PR #4')
// ══════════════════════════════════════════════════════════════════════════

// task.status —— 和后端 internal/task/const.go 对齐。
//   draft                用于保留字段,前端不会遇到
//   open                 已创建,未派人(或被取消 assignee 后回到此态)
//   in_progress          有 assignee 并开始工作
//   submitted            已提交,等审批
//   approved             审批通过(终态)
//   revision_requested   审批要求修改,可再 submit
//   rejected             审批驳回(终态)
//   cancelled            取消(终态,注意是英式拼写,后端 StatusCancelled)
export type TaskStatus =
  | 'draft'
  | 'open'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'revision_requested'
  | 'rejected'
  | 'cancelled';

export const TASK_STATUS_OPEN: TaskStatus[] = ['open', 'in_progress', 'submitted', 'revision_requested'];
export const TASK_STATUS_CLOSED: TaskStatus[] = ['approved', 'rejected', 'cancelled'];

// task.output_spec_kind —— 产物形态。V1 只 markdown / text。
export type TaskOutputKind = 'markdown' | 'text';

// task_submissions.content_kind —— 普通任务和 task.output_spec_kind 一致;
// 轻量任务(task.is_lightweight=true)的 submission 落 'none',无文件。
export type SubmissionContentKind = TaskOutputKind | 'none';

// review.decision —— 后端 internal/task/const.go 的 DecisionApproved /
// DecisionRequestChanges / DecisionRejected。写 api 请求体时原样传。
export type ReviewDecision = 'approved' | 'request_changes' | 'rejected';

export interface TaskResponse {
  id: number;
  org_id: number;
  channel_id: number;
  title: string;
  description?: string;
  /**
   * 任务发起人(意图所有者)。手动创建 = 操作者本人;agent 代派 = 那个 agent 的 owner user。
   */
  created_by_principal_id: number;
  /**
   * 代派 agent 的 principal_id;0 / undefined 表示手动创建。
   * 用于"由 X 通过 Y 代派"的展示。
   */
  created_via_principal_id?: number;
  assignee_principal_id?: number;
  status: TaskStatus;
  output_spec_kind: TaskOutputKind;
  /**
   * 轻量任务:submit 不要文件,只用 inline_summary 描述"做了什么"。
   * 适合 review PR / 口头汇报 / 确认某事完成等无产物场景。
   */
  is_lightweight?: boolean;
  required_approvals: number;
  due_at?: string;
  submitted_at?: string;
  closed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TaskSubmissionResponse {
  id: number;
  task_id: number;
  submitter_principal_id: number;
  /** 轻量任务的 submission content_kind 是 'none',oss_key 空,byte_size 为 0。 */
  content_kind: SubmissionContentKind;
  oss_key: string;
  byte_size: number;
  inline_summary?: string;
  created_at: string;
}

export interface TaskReviewResponse {
  id: number;
  task_id: number;
  submission_id: number;
  reviewer_principal_id: number;
  decision: ReviewDecision;
  comment?: string;
  created_at: string;
}

export interface TaskDetailResponse {
  task: TaskResponse;
  reviewers: number[]; // reviewer principal_id 列表
  submissions: TaskSubmissionResponse[];
  reviews: TaskReviewResponse[];
}

export interface CreateTaskRequest {
  channel_id: number;
  title: string;
  description?: string;
  output_spec_kind: TaskOutputKind;
  /** true = 轻量任务,submit 不要文件。默认 false。 */
  is_lightweight?: boolean;
  assignee_principal_id?: number;
  reviewer_principal_ids?: number[];
  required_approvals?: number; // 0 自动填 1
}

export interface CreateTaskResponse {
  task: TaskResponse;
  reviewers: number[];
}

export interface SubmitTaskRequest {
  /**
   * 普通任务必填,等于 task.output_spec_kind。
   * 轻量任务(task.is_lightweight=true)留空,后端会落 'none'。
   */
  content_kind?: TaskOutputKind;
  /** 普通任务必填(UTF-8 markdown / plain);轻量任务必须留空。 */
  content?: string;
  /** 普通任务可选 ≤ 512 字符;轻量任务必填(替代 content 描述"做了什么")。 */
  inline_summary?: string;
}

export interface SubmitTaskResponse {
  task: TaskResponse;
  submission: TaskSubmissionResponse;
}

export interface ReviewTaskRequest {
  submission_id: number;
  decision: ReviewDecision;
  comment?: string;
}

export interface ReviewTaskResponse {
  task: TaskResponse;
  review: TaskReviewResponse;
}

// ── PAT (Personal Access Token) ──
//
// 后端 /api/v2/users/me/pats:user 自助管理 PAT。token 明文只在 create 响应里出现一次,
// 之后数据库只存 sha256 hash。expires_in_seconds = 0 表示永不过期。
export interface CreatePATRequest {
  label: string;
  expires_in_seconds?: number;
}

export interface CreatePATResponse {
  id: number;
  /** **明文 token,仅此一次返回**。形如 syn_pat_xxxxx。 */
  token: string;
  label: string;
  agent_principal_id: number;
  expires_at?: string;
  created_at: string;
}

export interface PATListItem {
  id: number;
  label: string;
  agent_principal_id: number;
  last_used_at?: string;
  expires_at?: string;
  revoked_at?: string;
  created_at: string;
}

// ── Channel 附件(图片等,Markdown 内嵌引用)──
//
// 后端 /api/v2/channels/:id/attachments/{upload-url, upload-commit, :att_id}。
// 图片粘贴 / 拖拽 / 选文件 → presign → PUT 直传 OSS → commit 拿可在 markdown
// 直接引用的相对 URL(/api/v2/channels/<cid>/attachments/<aid>)。

/** 第一版允许的 MIME 白名单(后端硬约束)。SVG 不在内(脚本注入风险)。 */
export type AttachmentMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface RequestChannelAttachmentUploadURLRequest {
  /** 必传;必须是 AttachmentMimeType 之一,否则后端 400。 */
  mime_type: string;
  /** 可选;原始文件名透传到附件元数据(不影响 OSS key)。 */
  filename?: string;
}

export interface ChannelAttachmentUploadURLResponse {
  /** OSS 直传 URL;客户端 PUT 时 **必须** 带 `Content-Type: <content_type>`。 */
  upload_url: string;
  /** 5min 单次有效;commit 阶段携带。 */
  commit_token: string;
  /** PUT 时绑定的 Content-Type,与 mime_type 一致。 */
  content_type: string;
  expires_at: string;
  max_byte_size: number;
}

export interface CommitChannelAttachmentUploadRequest {
  commit_token: string;
}

export interface ChannelAttachmentResponse {
  id: number;
  channel_id: number;
  org_id: number;
  /**
   * 直接可拷进 markdown 的相对路径,如 `/api/v2/channels/123/attachments/456`。
   * 浏览器 <img src> 引用 → 后端鉴权后 302 到 OSS 短期签名 URL。
   */
  url: string;
  mime_type: string;
  filename?: string;
  byte_size: number;
  sha256: string;
  uploaded_by_principal_id: number;
  created_at: string;
}

export interface CommitChannelAttachmentUploadResponse {
  attachment: ChannelAttachmentResponse;
  /** true 表示同 (channel_id, sha256) 已有行,本次 OSS 对象被服务端删除以避孤儿。 */
  reused: boolean;
}
