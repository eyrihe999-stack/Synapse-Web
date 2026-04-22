import { create } from 'zustand';
import type { OrgMembership } from '@/types/api';
import { orgApi } from '@/api/org';

interface OrgState {
  orgs: OrgMembership[];
  currentOrg: OrgMembership | null;
  loading: boolean;

  fetchOrgs: () => Promise<void>;
  selectOrg: (slug: string) => void;
  clearOrg: () => void;
}

export const useOrgStore = create<OrgState>()((set, get) => ({
  orgs: [],
  currentOrg: null,
  loading: false,

  fetchOrgs: async () => {
    set({ loading: true });
    try {
      const res = await orgApi.listMine();
      const orgs = res.data.result ?? [];
      set({ orgs });
      // If current org was selected, refresh or clear it
      const cur = get().currentOrg;
      if (cur) {
        const updated = orgs.find((o) => o.org.slug === cur.org.slug);
        set({ currentOrg: updated ?? null });
      }
    } finally {
      set({ loading: false });
    }
  },

  selectOrg: (slug) => {
    const org = get().orgs.find((o) => o.org.slug === slug) ?? null;
    set({ currentOrg: org });
  },

  clearOrg: () => set({ currentOrg: null }),
}));
