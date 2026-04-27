// agent.ts Agent WS 网关的档案 CRUD + apikey 生命周期。
//
// 路径前缀 /v2/orgs/:slug/agents/*,鉴权走标准 JWT + session + OrgContextMiddleware。
// 业务规则(后端兜底):
//   - GET / LIST:任何 org 成员
//   - POST / PATCH / DELETE / rotate-key:owner / admin / 该 agent 创建者
import client from './client';
import type {
  BaseResponse,
  AgentResponse,
  CreateAgentRequest,
  UpdateAgentRequest,
  CreateAgentResponse,
  RotateKeyResponse,
  ListAgentResponse,
} from '@/types/api';

export const agentApi = {
  list: (slug: string, offset = 0, limit = 50) =>
    client.get<BaseResponse<ListAgentResponse>>(`/v2/orgs/${slug}/agents`, {
      params: { offset, limit },
    }),

  get: (slug: string, agentId: string) =>
    client.get<BaseResponse<AgentResponse>>(`/v2/orgs/${slug}/agents/${agentId}`),

  // 成功响应含一次性明文 apikey,UI 必须立即展示给用户,关闭后不可再取。
  create: (slug: string, data: CreateAgentRequest) =>
    client.post<BaseResponse<CreateAgentResponse>>(`/v2/orgs/${slug}/agents`, data),

  update: (slug: string, agentId: string, data: UpdateAgentRequest) =>
    client.patch<BaseResponse<AgentResponse>>(`/v2/orgs/${slug}/agents/${agentId}`, data),

  // 硬删。后端同时会踢掉当前活跃 WS 连接。
  remove: (slug: string, agentId: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/agents/${agentId}`),

  // rotate-key 成功后:旧 key 立即失效,当前 WS 连接被踢;新 apikey 明文仅此一次返回。
  rotateKey: (slug: string, agentId: string) =>
    client.post<BaseResponse<RotateKeyResponse>>(`/v2/orgs/${slug}/agents/${agentId}/rotate-key`),
};
