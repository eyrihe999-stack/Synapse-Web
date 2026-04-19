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
export type AgentType = 'chat' | 'tool';

export interface CreateAgentRequest {
  slug: string;
  display_name: string;
  description?: string;
  agent_type?: AgentType;
  version?: string;
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
  version?: string;
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
  version: string;
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
  agent_version?: string;
  agent_updated_at?: number;
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

// ── Document ──

/** 文档来源。user = 用户上传;ai-generated = 未来 AI 生成回写的产物(目前无数据)。 */
export type DocumentSource = 'user' | 'ai-generated';

export interface DocumentResponse {
  id: string;
  org_id: string;
  uploader_id: string;
  /** 后端从 users.display_name 回填;未拿到时后端省略此字段。 */
  uploader_display_name?: string;
  title: string;
  mime_type: string;
  file_name: string;
  size_bytes: number;
  /** 文档来源,后端兜底空串为 'user'。前端可据此给 AI 产物加标记。 */
  source: DocumentSource;
  created_at: number;
  updated_at: number;
  /** 相似度 0-1,仅 mode=semantic 时返回;=1-cosine_distance/2。 */
  similarity?: number;
  /** 命中文档里最匹配片段的前 ~200 字,超长带省略号;仅 mode=semantic 返。 */
  matched_snippet?: string;
}

export interface UpdateDocumentRequest {
  title?: string;
}

export interface ListDocumentsResponse {
  items: DocumentResponse[];
  total: number;
  page: number;
  size: number;
}

// ── Document precheck (upload 分流) ──

/** 后端 Upload 三分支的预演结果,加上一个"本地/服务端拒绝"分支。 */
export type PrecheckAction = 'create' | 'overwrite' | 'duplicate' | 'reject';

/** 后端 const.go::PrecheckReason* 的全集。前端据此做 i18n。 */
export type PrecheckReasonCode =
  | 'new_file'
  | 'same_filename_new_content'
  | 'identical_content_exists'
  | 'file_too_large'
  | 'mime_unsupported'
  | 'empty_file'
  | 'invalid_content_hash';

export interface PrecheckCandidate {
  file_name: string;
  size_bytes: number;
  mime_type: string;
  /** sha256(file_bytes) 的 hex,前端用 crypto.subtle.digest 本地算。 */
  content_hash: string;
}

export interface PrecheckRequest {
  /** 单次最多 50 个,见 document.MaxPrecheckBatch。 */
  files: PrecheckCandidate[];
}

export interface PrecheckResultEntry {
  file_name: string;
  action: PrecheckAction;
  reason_code: PrecheckReasonCode;
  /** 仅 action=duplicate 时非空,指向 hash 命中的那条已存在文档。 */
  existing?: DocumentResponse;
  /** 仅 action=overwrite 时非空,所有同名候选,让用户选覆盖目标或选择新建。 */
  existing_list?: DocumentResponse[];
}

export interface PrecheckResponse {
  /** 顺序与请求 files 一一对应。 */
  results: PrecheckResultEntry[];
}

export interface UploadConfigResponse {
  max_file_size_bytes: number;
  allowed_mime_types: string[];
  /** 索引三元(chunker/embedder/pg)是否齐备。false 时前端应灰掉语义搜索切换,避免用户点了撞 503。 */
  semantic_search_enabled: boolean;
}

/** 搜索模式。fuzzy 走 MySQL LIKE(当前默认),semantic 走 pgvector cosine。 */
export type SearchMode = 'fuzzy' | 'semantic';

// ── Document chunk search ──

/**
 * 一条 chunk 级检索结果。和 DocumentResponse 的差别:
 *   - DocumentResponse(mode=semantic):一篇文档 + 最佳 snippet,doc 粒度。
 *   - ChunkSearchResult:一段原文命中,chunk 粒度。保留 doc_id + chunk_idx 作引用定位;
 *     同一 doc 的多个 chunk 都会返回,不 dedup。
 *
 * 前端展示 content 即是"片段全文",不必再下载 OSS 源文档。
 */
export interface ChunkSearchResult {
  doc_id: string;
  chunk_idx: number;
  /** chunk 原文段落,典型 500-1500 字符。 */
  content: string;
  /** 相似度 0-1,越大越相关;= 1 - cosine_distance/2。 */
  similarity: number;
  /** 冗余给 UI 用:片段来自哪篇文档。 */
  doc_title: string;
  /** 冗余给 UI 用:过滤/标记 AI 产物。 */
  doc_source: DocumentSource;
}

export interface ListChunksResponse {
  items: ChunkSearchResult[];
  /** = items.length(此 API 不分页,总数就是返回条数)。 */
  total: number;
  /** 服务端实际使用的 topK(可能被 clamp 过,和请求传的不一定相等)。 */
  top_k: number;
}

// ── Integrations:第三方 OAuth(飞书/google/slack/...)──

/**
 * 飞书集成当前状态。
 * connected=false 时其他字段都为 undefined,前端只显示"连接"按钮。
 */
export interface FeishuStatusResponse {
  connected: boolean;
  /** 授权飞书账号的 open_id,connected=true 时才有。 */
  open_id?: string;
  name?: string;
  email?: string;
  /** 上次后台 sync 完成时间(unix seconds),undefined = 从未同步过。 */
  last_sync_at?: number;
  /** 最早授权时间(unix seconds)。 */
  connected_at?: number;
  /**
   * 当前是否有活跃的飞书同步任务(queued 或 running)。
   * 有值 → 前端 mount 时直接用此 id 走 /async-jobs/:id 轮询,跨页面跳转、刷新不丢进度。
   */
  active_sync_job_id?: number;
  /**
   * 最近一次同步任务若为 failed 状态,返该 job 的 id。仅在无活跃任务时才会给。
   * 前端拉该 job 详情 → 展示"失败 + 重试"横幅,避免 toast 错过导致用户看不到失败提示。
   */
  last_failed_sync_job_id?: number;
  /**
   * 最近一次同步"整体成功但有部分文件失败"时的 job id。前端拉详情 → 展示"部分失败"横幅,
   * 让用户看到哪些文件挂了 / 为啥挂。和 last_failed_sync_job_id 互斥。
   */
  last_partial_sync_job_id?: number;
}

/**
 * 点"连接飞书"后后端返回的内容:前端 window.location = auth_url 跳去飞书授权页。
 * state 是 HMAC-签的,同时回传纯粹给 debug 看。
 */
export interface FeishuConnectResponse {
  auth_url: string;
  state: string;
}

/**
 * POST /integrations/feishu/sync 的响应。
 * - already_running=true 表示此前已有同步任务在跑,job_id 指向那条;前端应直接开始轮询它。
 * - already_running=false 是新建的任务。两种情况前端消费逻辑一致。
 */
export interface FeishuSyncResponse {
  job_id: number;
  already_running: boolean;
}

/**
 * 飞书 App 凭证配置(per org)。由 org admin 在 UI 上填入。
 *
 * 字段说明:
 *   - configured: 该 org 是否已填过应用凭证。false 时其他字段除 redirect_uri 都 undefined。
 *   - app_id: 飞书开放平台"自建应用"的 App ID(明文,非敏感)。
 *   - redirect_uri: OAuth 回调地址,部署级,admin 需要把此 URL 加到飞书开发者后台的白名单。
 *   - app_secret 永远不回传(即使已配置过)—— PUT 时每次必须重填。
 */
export interface FeishuConfigResponse {
  configured: boolean;
  app_id?: string;
  redirect_uri: string;
  created_at?: number;
  updated_at?: number;
}

/**
 * PUT /integrations/feishu/config 请求体。两个字段都必填(即使只想改 app_id 也要重填 app_secret
 * —— 避免看不见的半态更新)。
 */
export interface FeishuConfigPutRequest {
  app_id: string;
  app_secret: string;
}

// ── GitLab 集成(PAT 模式,无 OAuth)──

/**
 * GitLab 实例配置(per org)。由 org admin 在 UI 上填入 base_url;
 * 和 OrgFeishuConfig 对称,不同 org 可接不同 GitLab 实例。
 *
 * 字段说明:
 *   - configured: 该 org 是否已配置 GitLab 实例。false 时其他字段 undefined,前端 disable PAT 表单。
 *   - base_url: GitLab API 根,必须以 /api/v4 结尾,前端展示 + 用来推导 PAT 创建页链接。
 *   - insecure_skip_verify: 仅内网自签证书场景 true,生产环境建议 false。
 */
export interface GitLabConfigResponse {
  configured: boolean;
  base_url?: string;
  insecure_skip_verify: boolean;
  created_at?: number;
  updated_at?: number;
}

/**
 * PUT /integrations/gitlab/config 请求体。
 * base_url 必须以 /api/v4 结尾(后端 gitlab.Config.Validate 强校验);
 * insecure_skip_verify 默认 false,只有内网自签证书场景才置 true。
 */
export interface GitLabConfigPutRequest {
  base_url: string;
  insecure_skip_verify: boolean;
}

/**
 * GitLab 连接状态。
 * connected=false 时其他字段都为 undefined,前端只展示 PAT 输入框。
 *
 * 认证模式:仅支持 Personal Access Token,用户手动粘贴;不做 OAuth 跳转。
 */
export interface GitLabStatusResponse {
  connected: boolean;
  /** GitLab 端 user id(数字型),来自 GET /user。 */
  user_id?: number;
  /** GitLab 用户名(@xxx),展示用。 */
  username?: string;
  /** 用户展示名。 */
  name?: string;
  email?: string;
  /** GitLab 头像 URL,直接渲染 <img>。 */
  avatar_url?: string;
  /** GitLab 个人页 URL,点用户名时跳转。 */
  web_url?: string;
  /** 首次连接时间(unix seconds)。 */
  connected_at?: number;
  /** 上次同步完成时间(unix seconds),undefined = 从未同步过。 */
  last_sync_at?: number;
  /**
   * 当前是否有活跃的 GitLab 代码同步任务(queued 或 running)。
   * 有值 → 前端 mount 时直接用此 id 走 /async-jobs/:id 轮询,跨页面跳转、刷新不丢进度。
   */
  active_sync_job_id?: number;
  /**
   * 最近一次同步任务若为 failed 状态,返该 job 的 id。仅在无活跃任务时才会给。
   * 前端拉该 job 详情 → 展示"失败 + 重试"横幅。
   */
  last_failed_sync_job_id?: number;
  /**
   * 最近一次同步"整体成功但有部分文件失败"时的 job id。前端拉详情 → 展示"部分失败"横幅。
   * 和 last_failed_sync_job_id 互斥。
   */
  last_partial_sync_job_id?: number;
}

/**
 * POST /integrations/gitlab/sync 的响应。
 * - already_running=true 表示此前有同步任务在跑,job_id 指向那条;前端应直接开始轮询它。
 * - already_running=false 是新建的任务。两种情况前端消费逻辑一致。
 */
export interface GitLabSyncResponse {
  job_id: number;
  already_running: boolean;
}

/**
 * 代码同步任务失败条目。对应后端 internal/code/service.FailedItem。
 *   - ref:仓库级失败时 = "group/subgroup/repo-name";文件级失败时 = "group/subgroup/repo-name:path/to/foo.go"
 *   - error:失败根因(err.Error())
 */
export interface CodeSyncFailedItem {
  ref: string;
  error: string;
}

/**
 * 单个代码仓库的同步概览 —— 对应后端 internal/code/handler.repoSummaryResponse。
 *
 * 字段由聚合查询(LEFT JOIN code_files + code_chunks)算出,反映"这个 repo 在 Synapse 里的现状":
 *   - file_count / chunk_count:当前已索引的文件数和函数级切片数
 *   - failed_chunk_count:embed 失败的 chunk(多半是 embedding 限流 / 超长 / 其他)
 *   - last_synced_at:最近一次完整同步完成的时间(不是最近一次触发)
 */
export interface CodeRepoSummary {
  id: number;
  path_with_namespace: string;
  web_url?: string;
  default_branch: string;
  /** unix seconds,undefined = 新 upsert 还没跑完 Phase 2(稀有)或历史数据没回填 */
  last_synced_at?: number;
  archived: boolean;
  created_at: number;
  file_count: number;
  chunk_count: number;
  failed_chunk_count: number;
}

/**
 * GET /api/v2/orgs/:slug/code/repositories 响应。
 */
export interface CodeRepoListResponse {
  repositories: CodeRepoSummary[];
}

/**
 * 代码同步任务 result 字段结构。对应后端 internal/code/service.SyncResult。
 *
 * 语义:一次 sync 可能涉及多个 repo,每个 repo 又有多个 file;统计三元组(repos/files/chunks)
 * + 两类失败明细(按 repo 维度失败 vs 按 file 维度失败)。
 */
export interface CodeSyncResult {
  repos_total: number;
  repos_synced: number;
  /** archived / 临时不可访问 / 无文件变更的 repo 计数。不算失败。 */
  repos_skipped: number;
  repos_failed: number;
  /** 新增 + 更新的文件数。 */
  files_changed: number;
  /** 源端消失 → 本地清除的文件数。 */
  files_deleted: number;
  /** ErrFileTooLarge / ErrFileGone / chunk=0 等单文件跳过。不算失败。 */
  files_skipped: number;
  /** 新写入 code_chunks 表的行数(向量)。 */
  chunks_created: number;
  failed_repos?: CodeSyncFailedItem[];
  failed_files?: CodeSyncFailedItem[];
  last_sync_at: number;
}

/**
 * PUT /integrations/gitlab 请求体。token 字段为用户粘贴的 PAT(glpat-...)。
 * 后端会立即调 GitLab /user 验证;无效返 400 reason=invalid_token。
 */
export interface GitLabConnectRequest {
  token: string;
}

/**
 * PUT /integrations/gitlab 的响应。验证通过后直接回带 GitLab 用户信息,
 * 前端可省掉"连接成功后再发一次 GET status"的往返。
 */
export interface GitLabConnectResponse {
  connected: boolean;
  user_id: number;
  username: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  web_url?: string;
}

// ── Async Jobs:通用长任务轮询(飞书同步 / 未来批量操作...)──

/**
 * 任务状态机。前端轮询到 IsTerminal(succeeded/failed/canceled)后停止。
 * canceled 当前后端未暴露,但枚举保留以免将来加取消功能时要改类型。
 */
export type AsyncJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/**
 * 飞书同步任务失败条目明细。对应后端的 FailedItem。
 *   - ref: source_ref JSON 字符串,稳定标识
 *   - title: 文档标题,Fetch 成功后才有,否则为 undefined
 *   - error: 失败根因(err.Error())
 */
export interface FeishuSyncFailedItem {
  ref: string;
  title?: string;
  error: string;
}

/**
 * 飞书同步任务 result 字段的结构。各 kind 自定义 schema,前端按 kind 解析。
 * 对应后端 internal/asyncjob/runners/feishusync/logic.go 的 SyncResult。
 */
export interface FeishuSyncResult {
  total: number;
  synced: number;
  failed: number;
  failed_items?: FeishuSyncFailedItem[];
  last_sync_at: number;
}

/**
 * 通用任务快照。不同 kind 的 result 字段结构不同,需按 kind 断言后再解析。
 *
 * 字段对应后端 internal/asyncjob/handler/handler.go 的 JobResponse。
 */
export interface AsyncJobResponse {
  id: number;
  /** 任务类型。"integration.sync.feishu" / "integration.sync.gitlab" / ...。 */
  kind: string;
  status: AsyncJobStatus;
  progress_total: number;
  progress_done: number;
  progress_failed: number;
  /** 终态时的结果摘要;running/queued 时通常为 null。按 kind 断言到 FeishuSyncResult / CodeSyncResult。 */
  result?: FeishuSyncResult | CodeSyncResult | Record<string, unknown>;
  /** status=failed 时的根因。 */
  error?: string;
  created_at: number;
  started_at?: number;
  finished_at?: number;
}
