import client, { ensureValidToken } from './client';
import { useAuthStore } from '@/store/auth';
import type {
  BaseResponse,
  PaginatedResult,
  CreateAgentRequest,
  UpdateAgentRequest,
  AgentResponse,
  PublishAgentRequest,
  ReviewPublishRequest,
  PublishResponse,
  ChatRequest,
  ChatResponse,
  SessionResponse,
  MessageResponse,
} from '@/types/api';

// ── Agent CRUD (personal, no org context) ──
export const agentApi = {
  create: (data: CreateAgentRequest) =>
    client.post<BaseResponse<AgentResponse>>('/v2/agents', data),

  listMine: () =>
    client.get<BaseResponse<AgentResponse[]>>('/v2/agents/mine'),

  get: (id: string) =>
    client.get<BaseResponse<AgentResponse>>(`/v2/agents/${id}`),

  update: (id: string, data: UpdateAgentRequest) =>
    client.patch<BaseResponse<AgentResponse>>(`/v2/agents/${id}`, data),

  delete: (id: string) =>
    client.delete<BaseResponse>(`/v2/agents/${id}`),
};

// ── Publishing Workflow (org-scoped) ──
export const publishApi = {
  submit: (slug: string, data: PublishAgentRequest) =>
    client.post<BaseResponse<PublishResponse>>(`/v2/orgs/${slug}/agent-publishes`, data),

  list: (slug: string, params?: { status?: string; page?: number; size?: number }) =>
    client.get<BaseResponse<PaginatedResult<PublishResponse>>>(`/v2/orgs/${slug}/agent-publishes`, { params }),

  revoke: (slug: string, id: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/agent-publishes/${id}`),

  approve: (slug: string, id: string, data?: ReviewPublishRequest) =>
    client.post<BaseResponse<PublishResponse>>(`/v2/orgs/${slug}/agent-publishes/${id}/approve`, data ?? {}),

  reject: (slug: string, id: string, data?: ReviewPublishRequest) =>
    client.post<BaseResponse<PublishResponse>>(`/v2/orgs/${slug}/agent-publishes/${id}/reject`, data ?? {}),
};

// ── Chat & Sessions (org-scoped) ──
export const chatApi = {
  chat: (slug: string, ownerUid: string, agentSlug: string, data: ChatRequest) =>
    client.post<BaseResponse<ChatResponse>>(
      `/v2/orgs/${slug}/agents/${ownerUid}/${agentSlug}/chat`,
      data,
    ),

  /**
   * SSE streaming chat via fetch + ReadableStream.
   * Returns an AbortController for cancellation.
   */
  chatStream: (
    slug: string,
    ownerUid: string,
    agentSlug: string,
    data: Omit<ChatRequest, 'stream'>,
    callbacks: {
      onSession: (sessionId: string) => void;
      onChunk: (data: string) => void;
      onDone: () => void;
      onError: (err: string) => void;
    },
  ): AbortController => {
    const controller = new AbortController();
    const token = useAuthStore.getState().accessToken;

    const doFetch = (bearerToken: string | null) =>
      fetch(`/api/v2/orgs/${slug}/agents/${ownerUid}/${agentSlug}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
        body: JSON.stringify({ ...data, stream: true }),
        signal: controller.signal,
      });

    doFetch(token)
      .then(async (response) => {
        // On 401, refresh token and retry once
        if (response.status === 401) {
          const newToken = await ensureValidToken();
          if (!newToken) return;
          response = await doFetch(newToken);
        }

        if (!response.ok || !response.body) {
          const text = await response.text();
          try {
            const json = JSON.parse(text);
            callbacks.onError(json.message || json.error || '请求失败');
          } catch {
            callbacks.onError(`HTTP ${response.status}`);
          }
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const eventData = line.slice(6);
              if (currentEvent === 'session') {
                callbacks.onSession(eventData);
              } else if (currentEvent === 'chunk') {
                callbacks.onChunk(eventData);
              } else if (currentEvent === 'done') {
                callbacks.onDone();
              } else if (currentEvent === 'error') {
                try {
                  const errObj = JSON.parse(eventData);
                  callbacks.onError(errObj.message || '流式响应错误');
                } catch {
                  callbacks.onError(eventData);
                }
              }
              currentEvent = '';
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          callbacks.onError(err.message || '网络错误');
        }
      });

    return controller;
  },

  listSessions: (slug: string, ownerUid: string, agentSlug: string, params?: { page?: number; size?: number }) =>
    client.get<BaseResponse<PaginatedResult<SessionResponse>>>(
      `/v2/orgs/${slug}/agents/${ownerUid}/${agentSlug}/sessions`,
      { params },
    ),

  getSession: (slug: string, sessionId: string) =>
    client.get<BaseResponse<SessionResponse>>(`/v2/orgs/${slug}/sessions/${sessionId}`),

  getMessages: (slug: string, sessionId: string, params?: { page?: number; size?: number }) =>
    client.get<BaseResponse<PaginatedResult<MessageResponse>>>(
      `/v2/orgs/${slug}/sessions/${sessionId}/messages`,
      { params },
    ),

  deleteSession: (slug: string, sessionId: string) =>
    client.delete<BaseResponse>(`/v2/orgs/${slug}/sessions/${sessionId}`),
};
