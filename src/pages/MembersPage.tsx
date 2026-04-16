import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useOrgStore } from '@/store/org';
import { memberApi, invitationApi, roleApi } from '@/api/org';
import { toast } from '@/components/ui/Toast';
import { getErrorMessage } from '@/lib/api-helpers';
import type { MemberResponse, RoleResponse, InviteeCandidate } from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Users, UserPlus, UserMinus, Search, ChevronDown } from 'lucide-react';
import { formatTs } from '@/lib/format';

export function MembersPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const fetchMembers = async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const res = await memberApi.list(slug);
      setMembers(res.data.result?.items ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    if (!slug) return;
    try {
      const res = await roleApi.list(slug);
      setRoles(res.data.result ?? []);
    } catch { /* 角色加载失败不阻断主流程 */ }
  };

  useEffect(() => { fetchMembers(); fetchRoles(); }, [slug]);

  const assignRole = async (userId: string, roleId: string) => {
    if (!slug) return;
    setAssigningId(userId);
    try {
      await memberApi.assignRole(slug, userId, { role_id: roleId });
      toast('success', '角色已更新');
      fetchMembers();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setAssigningId(null);
    }
  };

  const removeMember = async (userId: string, name: string) => {
    if (!slug || !confirm(`确定要移除成员「${name || userId}」吗？`)) return;
    setRemovingId(userId);
    try {
      await memberApi.remove(slug, userId);
      toast('success', '成员已移除');
      fetchMembers();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setRemovingId(null);
    }
  };

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="成员管理" />
        <GlassCard>
          <div className="py-8 text-center">
            <Users className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">请先在顶部选择一个组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="成员管理"
        subtitle={`${currentOrg.org.display_name} · 共 ${members.length} 名成员`}
        loading={loading}
        onRefresh={fetchMembers}
        action={<Button onClick={() => setShowInvite(true)} icon={<UserPlus className="h-3.5 w-3.5" />}>邀请成员</Button>}
      />

      <GlassCard>
        {loading ? (
          <p className="py-6 text-center text-[13px] text-text-muted">加载中...</p>
        ) : members.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">暂无成员</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] text-text-muted font-medium border-b border-border-default">
                  <th className="pb-2 text-left font-medium">成员</th>
                  <th className="pb-2 text-left font-medium">角色</th>
                  <th className="pb-2 text-left font-medium">加入时间</th>
                  <th className="pb-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {members.map((m) => (
                  <tr key={m.user_id} className="group">
                    <td className="py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-md bg-[#f1f1ef] flex items-center justify-center shrink-0">
                          <span className="text-[11px] font-medium text-text-secondary">
                            {(m.display_name || '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-text-primary">{m.display_name || '—'}</p>
                          <p className="text-[10px] text-text-muted font-mono">ID: {m.user_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      {m.role.name === 'owner' ? (
                        <StatusBadge status={m.role.name} />
                      ) : (
                        <div className="relative inline-flex items-center">
                          <select
                            value={m.role.id}
                            onChange={(e) => assignRole(m.user_id, e.target.value)}
                            disabled={assigningId === m.user_id}
                            className="appearance-none text-[12px] font-medium pl-2 pr-6 py-1 rounded-md border border-border-default bg-white text-text-secondary hover:border-accent/40 focus:outline-none focus:border-accent/40 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                          >
                            {roles.filter((r) => r.name !== 'owner').map((r) => (
                              <option key={r.id} value={r.id}>{r.display_name}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted pointer-events-none" />
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-text-muted text-[12px]">
                      {formatTs(m.joined_at)}
                    </td>
                    <td className="py-3 text-right">
                      {m.role.name !== 'owner' && (
                        <button
                          onClick={() => removeMember(m.user_id, m.display_name ?? '')}
                          disabled={removingId === m.user_id}
                          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red transition-all cursor-pointer disabled:opacity-50"
                          title="移除成员"
                        >
                          {removingId === m.user_id
                            ? <span className="h-3.5 w-3.5 block border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
                            : <UserMinus className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} slug={slug} onDone={fetchMembers} />
    </div>
  );
}

function InviteModal({ open, onClose, slug, onDone }: { open: boolean; onClose: () => void; slug: string; onDone: () => void }) {
  const [step, setStep] = useState<'search' | 'confirm'>('search');
  const [queryType, setQueryType] = useState<'email' | 'nickname'>('email');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<InviteeCandidate[]>([]);
  const [selected, setSelected] = useState<InviteeCandidate | null>(null);
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [roleId, setRoleId] = useState('');
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      roleApi.list(slug).then((r) => {
        const list = r.data.result ?? [];
        setRoles(list);
        const memberRole = list.find((r) => r.name === 'member');
        if (memberRole) setRoleId(memberRole.id);
      }).catch((err) => {
        toast('error', getErrorMessage(err));
      });
    }
  }, [open, slug]);

  const search = async () => {
    setSearching(true);
    try {
      const data: Record<string, string> = { query_type: queryType };
      if (queryType === 'email') data.email = query;
      else data.nickname = query;
      const res = await invitationApi.searchInvitees(slug, data as never);
      setCandidates(res.data.result?.candidates ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  const selectCandidate = (c: InviteeCandidate) => {
    setSelected(c);
    setStep('confirm');
  };

  const send = async () => {
    if (!selected || !roleId) return;
    setSending(true);
    try {
      await invitationApi.create(slug, { invitee_user_id: selected.user_id, role_id: roleId });
      toast('success', '邀请已发送');
      onClose();
      onDone();
      reset();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setStep('search'); setQuery(''); setCandidates([]); setSelected(null);
  };

  const handleClose = () => { onClose(); reset(); };

  return (
    <Modal open={open} onClose={handleClose} title="邀请成员">
      {step === 'search' ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-[12px] font-medium text-text-secondary">搜索方式</label>
            <select value={queryType} onChange={(e) => setQueryType(e.target.value as typeof queryType)} className="w-full rounded-md border border-border-default bg-white px-3 py-1.5 text-[13px] text-text-primary focus:outline-none focus:border-accent/40">
              <option value="email">邮箱</option>
              <option value="nickname">昵称</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入搜索内容" className="flex-1" />
            <Button variant="secondary" onClick={search} loading={searching} disabled={!query} icon={<Search className="h-3.5 w-3.5" />}>搜索</Button>
          </div>

          {candidates.length > 0 && (
            <div className="border border-border-default rounded-md divide-y divide-border-default mt-2">
              {candidates.map((c) => (
                <button
                  key={c.user_id}
                  onClick={() => selectCandidate(c)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-hover transition-colors cursor-pointer"
                >
                  <div className="h-7 w-7 rounded-md bg-[#f1f1ef] flex items-center justify-center shrink-0">
                    <span className="text-[11px] font-medium text-text-secondary">
                      {(c.display_name || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">{c.display_name || '—'}</p>
                    <p className="text-[11px] text-text-muted font-mono">{c.masked_email || c.user_id}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {candidates.length === 0 && query && !searching && (
            <p className="text-[12px] text-text-muted text-center py-3">未找到匹配的用户</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-md bg-bg-elevated border border-border-default">
            <div className="h-9 w-9 rounded-md bg-accent/10 flex items-center justify-center">
              <span className="text-[13px] font-medium text-accent">
                {(selected?.display_name || '?')[0].toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-[13px] font-medium text-text-primary">{selected?.display_name || '—'}</p>
              <p className="text-[11px] text-text-muted font-mono">{selected?.masked_email || selected?.user_id}</p>
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-[12px] font-medium text-text-secondary">分配角色</label>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="w-full rounded-md border border-border-default bg-white px-3 py-1.5 text-[13px] text-text-primary focus:outline-none focus:border-accent/40">
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.display_name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep('search')}>返回</Button>
            <Button onClick={send} loading={sending}>发送邀请</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
