import client from './client';
import type {
  BaseResponse,
  RegisterRequest,
  LoginRequest,
  RefreshRequest,
  AuthResponse,
  UserProfile,
  UpdateProfileRequest,
  SendEmailCodeRequest,
  SendEmailCodeResponse,
  RequestPasswordResetRequest,
  ConfirmPasswordResetRequest,
  OAuthExchangeRequest,
  ChangePasswordRequest,
  ChangeEmailRequest,
  DeleteAccountRequest,
  VerifyEmailRequest,
  SessionEntry,
  CreatePATRequest,
  CreatePATResponse,
  PATListItem,
} from '@/types/api';

export const authApi = {
  register: (data: RegisterRequest) =>
    client.post<BaseResponse<AuthResponse>>('/v1/auth/register', data),

  login: (data: LoginRequest) =>
    client.post<BaseResponse<AuthResponse>>('/v1/auth/login', data),

  refresh: (data: RefreshRequest) =>
    client.post<BaseResponse<AuthResponse>>('/v1/auth/refresh', data),

  sendEmailCode: (data: SendEmailCodeRequest) =>
    client.post<BaseResponse<SendEmailCodeResponse>>('/v1/auth/email/send-code', data),

  // 密码重置:请求发邮件。后端统一返成功(不区分邮箱是否存在),防账户枚举。
  requestPasswordReset: (data: RequestPasswordResetRequest) =>
    client.post<BaseResponse>('/v1/auth/password-reset/request', data),

  // 密码重置:凭邮件里的 token 改密。成功后所有设备 session 被吊销,需重新登录。
  confirmPasswordReset: (data: ConfirmPasswordResetRequest) =>
    client.post<BaseResponse>('/v1/auth/password-reset/confirm', data),

  // OAuth 登录成功后的 token 兑换。只在 /auth/oauth/callback 页调一次,code 一次性。
  oauthExchange: (data: OAuthExchangeRequest) =>
    client.post<BaseResponse<AuthResponse>>('/v1/auth/oauth/exchange', data),

  // M1.1 从邮件链接拿 token 激活邮箱。一次性消费,成功后 status=active。
  verifyEmail: (data: VerifyEmailRequest) =>
    client.post<BaseResponse>('/v1/auth/email/verify', data),
};

export const userApi = {
  getMe: () =>
    client.get<BaseResponse<UserProfile>>('/v1/users/me'),

  updateMe: (data: UpdateProfileRequest) =>
    client.patch<BaseResponse<UserProfile>>('/v1/users/me', data),

  // 踢指定设备的 session（吊销后端 Redis session）。
  // 用于用户主动登出:先调这个吊销服务端,再清本地 token。
  // 超时短一点:后端抖动不能卡死登出按钮。
  kickSession: (deviceId: string) =>
    client.delete<BaseResponse>(`/v1/users/me/sessions/${deviceId}`, { timeout: 3000 }),

  // 列出所有活跃设备 session(含当前设备),用户可以在"已登录设备"页踢单个或全部。
  listSessions: () =>
    client.get<BaseResponse<SessionEntry[]>>('/v1/users/me/sessions'),

  // 登出所有设备(含当前)。成功后本地 session 也会在下一次请求被 401 挡下,前端应立即回登录页。
  logoutAll: () =>
    client.post<BaseResponse>('/v1/users/me/sessions/logout-all', {}, { timeout: 5000 }),

  // M1 改密。OAuth-only 账号必须带 code(从当前邮箱发出的 6 位),本地账号带 old_password。
  // 成功后后端 LogoutAll,当前 session 立即失效。
  changePassword: (data: ChangePasswordRequest) =>
    client.post<BaseResponse>('/v1/users/me/password', data),

  // M1 改邮箱。需要先调 sendEmailCode 给 new_email 发码,本接口消费该码;OAuth-only 账号会被拒。
  // 成功后后端 LogoutAll,需用新邮箱重登。
  changeEmail: (data: ChangeEmailRequest) =>
    client.post<BaseResponse>('/v1/users/me/email', data),

  // M1.7 自助注销。本地账号必须带 password,OAuth-only 可省略(JWT+session 已证身份)。
  // 成功后账号进入 deleted 状态,PII pseudo 化,不可恢复;前端应清本地 auth state + 跳回登录页。
  deleteAccount: (data: DeleteAccountRequest) =>
    client.delete<BaseResponse>('/v1/users/me', { data }),

  // M1.1 重发邮箱激活邮件(60s per-user cooldown)。仅 pending_verify 账号有意义。
  resendVerification: () =>
    client.post<BaseResponse>('/v1/users/me/email/resend-verification', {}),
};

// ─── PAT(Personal Access Token)─────────────────────────────────────────────
//
// 给 user 自助管理"代表自己的客户端凭证":Cursor / Claude Desktop 接 MCP、
// agent-bridge daemon 接 SSE 都用这个。后端路由 /api/v2/users/me/pats —— 注意是 v2,
// 跟上面 user/auth 的 v1 不同(PAT 跟 OAuth 一组,在 /api/v2 下)。
export const patApi = {
  // 创建。返回里的 token 字段是**明文,只此一次**。前端关弹窗后再也拿不到。
  create: (data: CreatePATRequest) =>
    client.post<BaseResponse<CreatePATResponse>>('/v2/users/me/pats', data),

  // 列表。不返 token(已无明文),只列元数据(label / created_at / last_used_at / revoked_at)。
  list: () =>
    client.get<BaseResponse<PATListItem[]>>('/v2/users/me/pats'),

  // 吊销。仅可撤销自己的 PAT;吊销后该 PAT 立刻失效但仍留在 DB(revoked_at 标记)。
  revoke: (id: number) =>
    client.delete<BaseResponse>(`/v2/users/me/pats/${id}`),
};
