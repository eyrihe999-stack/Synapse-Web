import type { AxiosResponse } from 'axios';
import client from './client';
import type {
  BaseResponse,
  FeishuConfigPutRequest,
  FeishuConfigResponse,
  FeishuConnectResponse,
  FeishuStatusResponse,
  FeishuSyncResponse,
  GitLabConfigPutRequest,
  GitLabConfigResponse,
  GitLabConnectRequest,
  GitLabConnectResponse,
  GitLabStatusResponse,
  GitLabSyncResponse,
} from '@/types/api';

/**
 * 第三方集成(目前仅飞书)的 API 客户端。
 *
 * 路由规约(见后端 internal/integration/handler/router.go):
 *   - org-scoped(带 JWT):connect / status / disconnect
 *   - 顶层公开:/api/v2/integrations/feishu/callback —— 飞书 302 回来时调的,
 *     前端不直接碰这条。前端只需在用户被 302 到 frontend_redirect_url 时读 ?feishu= 查询参数即可。
 */
export const integrationApi = {
  /**
   * 查当前 user 对飞书的授权状态。页面加载时调,决定渲染"连接"还是"已连接"。
   */
  feishuStatus: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<FeishuStatusResponse>>> =>
    client.get(`/v2/orgs/${slug}/integrations/feishu`),

  /**
   * 生成 OAuth 授权 URL。拿到 auth_url 后 window.location.href 跳过去。
   * 后端用 HMAC 签了 state(5 分钟有效),callback 时自证用户身份。
   */
  feishuConnect: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<FeishuConnectResponse>>> =>
    client.post(`/v2/orgs/${slug}/integrations/feishu/connect`),

  /**
   * 撤销飞书授权。幂等,即使本来没授权也返 200。
   * 副作用:删 user_integrations 表对应行;已拉进来的文档不受影响。
   */
  feishuDisconnect: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse>> =>
    client.delete(`/v2/orgs/${slug}/integrations/feishu`),

  /**
   * 触发一次前台飞书文档同步。异步执行,返 job_id,前端用 asyncJobApi.get 轮询。
   *
   * 特殊语义:
   *   - already_running=true 表示此前有同步任务在跑,job_id 指向那条(幂等);前端直接继续轮询即可。
   *   - 未连接(OAuth 未完成)→ 412 Precondition Required。
   *   - 部署未启用 asyncjob(docSvc 未就绪)→ 503。
   */
  feishuSync: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<FeishuSyncResponse>>> =>
    client.post(`/v2/orgs/${slug}/integrations/feishu/sync`),

  /**
   * 查 org 飞书 App 凭证配置状态。任何成员都能读(不回传 app_secret)。
   */
  feishuConfigGet: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<FeishuConfigResponse>>> =>
    client.get(`/v2/orgs/${slug}/integrations/feishu/config`),

  /**
   * 写入 / 更新飞书 App 凭证。需要 PermIntegrationManage(owner + admin 默认持有)。
   * app_secret 每次必须重填 —— 后端不保存半态,这个设计强迫 admin 意识到自己在覆盖凭证。
   */
  feishuConfigPut: (
    slug: string,
    body: FeishuConfigPutRequest,
  ): Promise<AxiosResponse<BaseResponse<FeishuConfigResponse>>> =>
    client.put(`/v2/orgs/${slug}/integrations/feishu/config`, body),

  /**
   * 删除飞书 App 凭证。幂等。副作用:用户再点"连接"/"同步"会返 412(引导 admin 重新配置);
   * 已授权用户的 refresh_token 保留,admin 重新填凭证后仍可直接用(飞书 refresh_token 和 app_id 绑定,
   * 所以重新配置时 admin 必须填原来同一个 app_id,否则旧 token 失效要各用户重新 OAuth)。
   */
  feishuConfigDelete: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<FeishuConfigResponse>>> =>
    client.delete(`/v2/orgs/${slug}/integrations/feishu/config`),

  // ── GitLab(PAT 模式)──

  /**
   * 查当前 user 对 GitLab 的连接状态。页面加载时调。
   * 未连接时 connected=false,前端显示 PAT 输入框。
   */
  gitlabStatus: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<GitLabStatusResponse>>> =>
    client.get(`/v2/orgs/${slug}/integrations/gitlab`),

  /**
   * 用 PAT 连接 GitLab。后端调 GitLab /user 立即验证,无效 token 返 400。
   * 成功响应体直接包含 GitLab 用户信息,前端可以跳过刷新 status。
   */
  gitlabConnect: (
    slug: string,
    body: GitLabConnectRequest,
  ): Promise<AxiosResponse<BaseResponse<GitLabConnectResponse>>> =>
    client.put(`/v2/orgs/${slug}/integrations/gitlab`, body),

  /**
   * 断开 GitLab。幂等。副作用:删 user_integrations 表对应行;PAT 建议用户在 GitLab 侧也一并 revoke。
   */
  gitlabDisconnect: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse>> =>
    client.delete(`/v2/orgs/${slug}/integrations/gitlab`),

  /**
   * 触发一次前台 GitLab 代码同步。异步执行,返 job_id,前端用 asyncJobApi.get 轮询。
   *
   * 特殊语义:
   *   - already_running=true 表示已有同步任务在跑,job_id 指向那条(幂等);前端直接继续轮询。
   *   - 未连接(PAT 未 Connect)→ 412 Precondition Required。
   *   - 部署未启用 asyncjob(code ingest 不可用,缺 PG 或 embedding)→ 503。
   */
  gitlabSync: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<GitLabSyncResponse>>> =>
    client.post(`/v2/orgs/${slug}/integrations/gitlab/sync`),

  /**
   * 查 org GitLab 实例配置(base_url / insecure_skip_verify)。成员可读,不涉及敏感字段。
   * 未配置时成员 Connect PAT 会得到 412,引导回到此页。
   */
  gitlabConfigGet: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<GitLabConfigResponse>>> =>
    client.get(`/v2/orgs/${slug}/integrations/gitlab/config`),

  /**
   * 写入 / 更新 org GitLab 实例配置。需要 PermIntegrationManage。
   * base_url 必须以 /api/v4 结尾,后端会强校验;insecure_skip_verify 仅自签证书内网场景用。
   */
  gitlabConfigPut: (
    slug: string,
    body: GitLabConfigPutRequest,
  ): Promise<AxiosResponse<BaseResponse<GitLabConfigResponse>>> =>
    client.put(`/v2/orgs/${slug}/integrations/gitlab/config`, body),

  /**
   * 清空 GitLab 实例配置。幂等。副作用:成员再 Connect PAT 会得到 412;已存的 PAT 不会自动清,
   * 需要 admin 显式决定是否批量 Revoke(v1 未提供,只能靠用户点自己页面的断开)。
   */
  gitlabConfigDelete: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<GitLabConfigResponse>>> =>
    client.delete(`/v2/orgs/${slug}/integrations/gitlab/config`),
};

/**
 * OAuth 回调结果的前端标识。
 * 后端 callback handler 把 ?feishu=success / ?feishu=error&reason=xxx 拼到 frontend_redirect_url 上,
 * 前端在对应路由里读出来提示用户。
 */
export type FeishuCallbackStatus = 'success' | 'error';

/**
 * 从 URL 查询串解析飞书 OAuth 回调结果。
 * 没有 ?feishu= 参数时返 null(用户不是刚从飞书回跳过来的)。
 */
export function parseFeishuCallback(
  search: string,
): { status: FeishuCallbackStatus; reason?: string } | null {
  const params = new URLSearchParams(search);
  const raw = params.get('feishu');
  if (raw !== 'success' && raw !== 'error') return null;
  const out: { status: FeishuCallbackStatus; reason?: string } = { status: raw };
  const reason = params.get('reason');
  if (reason) out.reason = reason;
  return out;
}
