// useOrgPrincipals 构建当前 org 下所有 principal(user + agent)的目录。
//
// 后端有两个接口:
//   - memberApi.list(slug)     → 返回 user 成员(含 principal_id)
//   - agentApi.list(slug)      → 返回该 org 内 agent(含 principal_id)+ 全局 agent
//                                (org_id=0,例如顶级 Synapse)
//
// 前端把两边按 principal_id 聚合为一个扁平索引,供:
//   - @mention picker:列出可提及的候选人
//   - 消息 / 任务 / 成员列表:用 principal_id 查 display_name + avatar
//
// 简化实现:loading / error 只做一次性读,不做 live watch。
// 上层 useEffect 自行决定何时重新拉取(比如成员变更后)。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { memberApi } from '@/api/org';
import { agentApi } from '@/api/agent';
import type { MemberResponse, AgentResponse } from '@/types/api';
import { toast } from '@/components/ui/Toast';
import { getErrorMessage } from '@/lib/api-helpers';

export type PrincipalKind = 'user' | 'agent';

// PrincipalDirEntry 扁平条目,供 UI 统一渲染。
export interface PrincipalDirEntry {
  principalId: number;
  kind: PrincipalKind;
  displayName: string;
  secondary?: string; // email(user)/ agent_id(agent)
  avatarUrl?: string;
  // 只对 agent 有意义:system / user / global(org_id=0)
  agentKind?: 'system' | 'user';
  isGlobalAgent?: boolean; // org_id=0,顶级 Synapse 类
}

export function useOrgPrincipals(slug: string | undefined) {
  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [agents, setAgents] = useState<AgentResponse[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!slug) {
      setMembers([]);
      setAgents([]);
      return;
    }
    setLoading(true);
    try {
      const [mRes, aRes] = await Promise.all([
        memberApi.list(slug, 1, 500),
        agentApi.list(slug, 0, 500),
      ]);
      setMembers(mRes.data.result?.items ?? []);
      setAgents(aRes.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const entries = useMemo<PrincipalDirEntry[]>(() => {
    const out: PrincipalDirEntry[] = [];
    // Agents 先加(顶级 Synapse 等排在前)。org_id=0 的全局 agent 排最前。
    const sortedAgents = [...agents].sort((a, b) => {
      const aGlobal = a.org_id === '0' || Number(a.org_id) === 0 ? 0 : 1;
      const bGlobal = b.org_id === '0' || Number(b.org_id) === 0 ? 0 : 1;
      if (aGlobal !== bGlobal) return aGlobal - bGlobal;
      return a.display_name.localeCompare(b.display_name);
    });
    for (const a of sortedAgents) {
      const pid = Number(a.principal_id);
      if (pid <= 0) continue; // 防御:缺 principal_id 的 agent 无法被 @,跳过
      out.push({
        principalId: pid,
        kind: 'agent',
        displayName: a.display_name,
        secondary: a.agent_id,
        agentKind: a.kind,
        isGlobalAgent: a.org_id === '0' || Number(a.org_id) === 0,
      });
    }
    for (const m of members) {
      out.push({
        principalId: Number(m.principal_id),
        kind: 'user',
        displayName: m.display_name || m.email || `user#${m.user_id}`,
        secondary: m.email,
        avatarUrl: m.avatar_url,
      });
    }
    return out;
  }, [members, agents]);

  const byPrincipalID = useMemo(() => {
    const map = new Map<number, PrincipalDirEntry>();
    for (const e of entries) {
      if (e.principalId > 0) map.set(e.principalId, e);
    }
    return map;
  }, [entries]);

  return { entries, byPrincipalID, loading, refresh: fetchAll };
}
