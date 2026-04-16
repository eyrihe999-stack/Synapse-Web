import { create } from 'zustand';
import type { MessageResponse, SessionResponse } from '@/types/api';
import { chatApi } from '@/api/agent';
import { toast } from '@/components/ui/Toast';
import { getErrorMessage } from '@/lib/api-helpers';

/** Extract delta content from an OpenAI-format SSE chunk JSON string. */
function extractDeltaContent(data: string): string {
  try {
    const chunk = JSON.parse(data);
    if (chunk.choices?.[0]?.delta?.content) {
      return chunk.choices[0].delta.content;
    }
  } catch { /* not JSON or no delta */ }
  return '';
}

interface ChatState {
  currentSessionId: string | null;
  messages: MessageResponse[];
  streaming: boolean;
  streamingContent: string;
  sessions: SessionResponse[];
  sessionsLoading: boolean;

  fetchSessions: (slug: string, ownerUid: string, agentSlug: string) => Promise<void>;
  loadSession: (slug: string, sessionId: string) => Promise<void>;
  sendMessage: (slug: string, ownerUid: string, agentSlug: string, message: string, useStream: boolean) => Promise<void>;
  cancelStream: () => void;
  clearChat: () => void;
  deleteSession: (slug: string, sessionId: string) => Promise<void>;
}

let abortController: AbortController | null = null;

export const useChatStore = create<ChatState>()((set, get) => ({
  currentSessionId: null,
  messages: [],
  streaming: false,
  streamingContent: '',
  sessions: [],
  sessionsLoading: false,

  fetchSessions: async (slug, ownerUid, agentSlug) => {
    set({ sessionsLoading: true });
    try {
      const res = await chatApi.listSessions(slug, ownerUid, agentSlug, { page: 1, size: 100 });
      set({ sessions: res.data.result?.items ?? [] });
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      set({ sessionsLoading: false });
    }
  },

  loadSession: async (slug, sessionId) => {
    set({ currentSessionId: sessionId, messages: [], streamingContent: '' });
    try {
      const res = await chatApi.getMessages(slug, sessionId, { page: 1, size: 200 });
      set({ messages: res.data.result?.items ?? [] });
    } catch (err) {
      toast('error', getErrorMessage(err));
    }
  },

  sendMessage: async (slug, ownerUid, agentSlug, message, useStream) => {
    const { currentSessionId, messages } = get();

    // Optimistically add user message to the list
    const userMsg: MessageResponse = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: message,
      created_at: Math.floor(Date.now() / 1000),
    };
    set({ messages: [...messages, userMsg] });

    if (useStream) {
      set({ streaming: true, streamingContent: '' });
      abortController = chatApi.chatStream(
        slug, ownerUid, agentSlug,
        { message, session_id: currentSessionId || undefined },
        {
          onSession: (sessionId) => {
            set({ currentSessionId: sessionId });
          },
          onChunk: (data) => {
            const content = extractDeltaContent(data);
            if (content) {
              set((s) => ({ streamingContent: s.streamingContent + content }));
            }
          },
          onDone: () => {
            const { streamingContent, messages: currentMsgs } = get();
            if (streamingContent) {
              const assistantMsg: MessageResponse = {
                id: `temp-${Date.now()}`,
                role: 'assistant',
                content: streamingContent,
                created_at: Math.floor(Date.now() / 1000),
              };
              set({ messages: [...currentMsgs, assistantMsg] });
            }
            set({ streaming: false, streamingContent: '' });
            abortController = null;
          },
          onError: (err) => {
            toast('error', err);
            set({ streaming: false, streamingContent: '' });
            abortController = null;
          },
        },
      );
    } else {
      // Non-streaming
      try {
        const res = await chatApi.chat(slug, ownerUid, agentSlug, {
          message,
          session_id: currentSessionId || undefined,
        });
        const result = res.data.result;
        if (result) {
          set({ currentSessionId: result.session_id });
          const assistantMsg: MessageResponse = {
            id: `temp-${Date.now()}`,
            role: 'assistant',
            content: result.message.content,
            created_at: Math.floor(Date.now() / 1000),
          };
          set((s) => ({ messages: [...s.messages, assistantMsg] }));
        }
      } catch (err) {
        toast('error', getErrorMessage(err));
      }
    }
  },

  cancelStream: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    const { streamingContent, messages } = get();
    if (streamingContent) {
      const assistantMsg: MessageResponse = {
        id: `temp-${Date.now()}`,
        role: 'assistant',
        content: streamingContent,
        created_at: Math.floor(Date.now() / 1000),
      };
      set({ messages: [...messages, assistantMsg] });
    }
    set({ streaming: false, streamingContent: '' });
  },

  clearChat: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    set({
      currentSessionId: null,
      messages: [],
      streaming: false,
      streamingContent: '',
    });
  },

  deleteSession: async (slug, sessionId) => {
    try {
      await chatApi.deleteSession(slug, sessionId);
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.session_id !== sessionId),
        ...(s.currentSessionId === sessionId
          ? { currentSessionId: null, messages: [], streamingContent: '' }
          : {}),
      }));
      toast('success', '会话已删除');
    } catch (err) {
      toast('error', getErrorMessage(err));
    }
  },
}));
