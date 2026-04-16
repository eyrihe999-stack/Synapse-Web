import { create } from 'zustand';
import type { AgentResponse } from '@/types/api';
import { agentApi } from '@/api/agent';

interface AgentState {
  agents: AgentResponse[];
  loading: boolean;
  fetchMyAgents: () => Promise<void>;
}

export const useAgentStore = create<AgentState>()((set) => ({
  agents: [],
  loading: false,

  fetchMyAgents: async () => {
    set({ loading: true });
    try {
      const res = await agentApi.listMine();
      set({ agents: res.data.result ?? [] });
    } finally {
      set({ loading: false });
    }
  },
}));
