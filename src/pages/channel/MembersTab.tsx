// MembersTab channel 成员列表 + 增删 + 改角色。
//
// 约束(后端兜底):
//   - 任何成员都能看列表
//   - owner 才能加人 / 删人 / 改角色
//   - member / observer 在 **MVP 阶段权限相同**(都能读写消息、派任务)——
//     observer 当前只是一个社交标签(表达"我主要是围观,少说话"),不是硬拦截。
//     未来若加 role=readonly 的强制限制,再拆开。后端 message_service.go:22 有明确注释。
//
// 目前只提供"从当前 org 的 principal 里挑人加入";不支持邀请 org 外的 principal。
import { useState } from 'react';
import { Plus, X, Shield, UserCircle2, Bot, Globe2, Crown, Eye, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { UserAvatar } from '@/components/ui/UserIdentity';
import { toast } from '@/components/ui/Toast';
import { channelApi } from '@/api/channel';
import { apiCall } from '@/lib/api-helpers';
import type { PrincipalDirEntry } from '@/hooks/useOrgPrincipals';
import type { ChannelMemberResponse, ChannelMemberRole } from '@/types/api';

interface MembersTabProps {
  channelId: number;
  members: ChannelMemberResponse[];
  allPrincipals: PrincipalDirEntry[];
  principalDirByID: Map<number, PrincipalDirEntry>;
  canManage: boolean;
  onRefresh: () => void;
}

// KindBadge 显示 principal 的身份分类 —— user / 系统 agent / 全局 agent / 个人 agent。
//
// 关于"哪个 app"(Claude Desktop / Cursor / 等):**目前后端不存这个信息**,
// OAuth bootstrap 时没把 client_name 关联到 agent。未来 agents 表加
// `created_via_oauth_client_id` 字段后可以显示(例如"Claude Desktop - 本地"
// / "Cursor Web" 等)。这里保留占位,等后端字段到位再填充。
function KindBadge({ entry }: { entry: PrincipalDirEntry }) {
  if (entry.kind === 'user') {
    return (
      <span className="text-[10px] px-1 py-px rounded bg-[#eeede8] text-text-secondary font-medium">
        用户
      </span>
    );
  }
  // agent
  if (entry.isGlobalAgent) {
    return (
      <span className="text-[10px] px-1 py-px rounded bg-gradient-to-r from-[#2383e2]/15 to-[#8a5cf6]/15 text-[#2383e2] font-medium">
        全局系统 Agent
      </span>
    );
  }
  if (entry.agentKind === 'system') {
    return (
      <span className="text-[10px] px-1 py-px rounded bg-[#2383e2]/10 text-[#2383e2] font-medium">
        系统 Agent · WS
      </span>
    );
  }
  // kind === 'user'(个人 agent)
  return (
    <span className="text-[10px] px-1 py-px rounded bg-[#8a5cf6]/10 text-[#8a5cf6] font-medium" title="用户的个人 agent,经 OAuth / MCP 接入(Claude Desktop / Cursor 等)">
      个人 Agent · MCP
    </span>
  );
}

const ROLE_META: Record<
  ChannelMemberRole,
  { label: string; tone: 'amber' | 'blue' | 'neutral'; icon: typeof Crown }
> = {
  owner: { label: '所有者', tone: 'amber', icon: Crown },
  member: { label: '成员', tone: 'blue', icon: Shield },
  observer: { label: '观察者', tone: 'neutral', icon: Eye },
};

export function MembersTab({
  channelId,
  members,
  allPrincipals,
  principalDirByID,
  canManage,
  onRefresh,
}: MembersTabProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [addSelected, setAddSelected] = useState<Set<number>>(new Set());
  const [addRole, setAddRole] = useState<ChannelMemberRole>('member');
  const [saving, setSaving] = useState(false);

  const memberPIDSet = new Set(members.map((m) => m.principal_id));
  const candidates = allPrincipals.filter((p) => !memberPIDSet.has(p.principalId));

  const toggleAddSelected = (pid: number) => {
    setAddSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  // 批量加成员:前端循环调单条 API。后端无原子事务,部分失败会留下"加了一半"
  // 的状态;此时前端汇报失败的几条让用户决定重试还是手动清理。
  const addMember = async () => {
    if (addSelected.size === 0) return;
    setSaving(true);
    const pids = Array.from(addSelected);
    const failures: { pid: number; err: string }[] = [];
    for (const pid of pids) {
      const res = await apiCall(() =>
        channelApi.addMember(channelId, { principal_id: pid, role: addRole }),
      );
      if (!res.ok) {
        const entry = principalDirByID.get(pid);
        const name = entry?.displayName || `#${pid}`;
        failures.push({ pid, err: name });
      }
    }
    setSaving(false);
    if (failures.length === 0) {
      toast('success', `已加入 ${pids.length} 位成员`);
    } else if (failures.length < pids.length) {
      // 部分失败:成功条数 + 失败名字一并报,让用户决定重试哪几个
      toast('error', `加入了 ${pids.length - failures.length} 位,${failures.length} 位失败:${failures.map((f) => f.err).join('、')}`);
    } else {
      toast('error', `全部失败:${failures.map((f) => f.err).join('、')}`);
    }
    setShowAdd(false);
    setAddSelected(new Set());
    setAddRole('member');
    onRefresh();
  };

  const removeMember = async (m: ChannelMemberResponse) => {
    const entry = principalDirByID.get(m.principal_id);
    const name = entry?.displayName || `#${m.principal_id}`;
    if (!confirm(`把「${name}」从 channel 移除?`)) return;
    const res = await apiCall(() => channelApi.removeMember(channelId, m.principal_id));
    if (res.ok) {
      toast('success', '已移除');
      onRefresh();
    }
  };

  const changeRole = async (m: ChannelMemberResponse, role: ChannelMemberRole) => {
    const res = await apiCall(() =>
      channelApi.updateMemberRole(channelId, m.principal_id, { role }),
    );
    if (res.ok) {
      toast('success', '角色已更新');
      onRefresh();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-text-muted">共 {members.length} 位成员</p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={onRefresh}
            title="刷新"
          />
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowAdd(true)}
            disabled={candidates.length === 0}
          >
            加成员
          </Button>
        )}
        </div>
      </div>
      <div className="rounded-md border border-[#e8e7e3] overflow-hidden bg-white">
        {members.map((m, idx) => {
          const entry = principalDirByID.get(m.principal_id);
          const RoleIcon = ROLE_META[m.role].icon;
          return (
            <div
              key={m.principal_id}
              className={clsx(
                'flex items-center gap-3 px-3 py-2',
                idx > 0 && 'border-t border-[#f0efe9]',
              )}
            >
              {entry?.kind === 'agent' ? (
                <div className="w-8 h-8 rounded-full bg-[#2383e2]/10 flex items-center justify-center shrink-0">
                  {entry.isGlobalAgent ? (
                    <Globe2 className="w-4 h-4 text-[#2383e2]" strokeWidth={1.8} />
                  ) : (
                    <Bot className="w-4 h-4 text-[#2383e2]" strokeWidth={1.8} />
                  )}
                </div>
              ) : (
                <UserAvatar
                  avatarUrl={entry?.avatarUrl}
                  fallback={entry?.displayName || `#${m.principal_id}`}
                  size="sm"
                  tone="muted"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[13px] font-medium text-text-primary truncate">
                    {entry?.displayName || `principal#${m.principal_id}`}
                  </span>
                  {entry ? (
                    <KindBadge entry={entry} />
                  ) : (
                    <span className="text-[10px] text-text-muted italic">未知身份</span>
                  )}
                </div>
                {entry?.secondary && (
                  <p className="text-[11px] text-text-muted truncate font-mono">{entry.secondary}</p>
                )}
              </div>
              {canManage && m.role !== 'owner' ? (
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m, e.target.value as ChannelMemberRole)}
                  className="text-[11px] px-1.5 py-0.5 rounded border border-[#e3e2dc] bg-white text-text-secondary focus:outline-none focus:border-[#2383e2]"
                >
                  <option value="member">成员</option>
                  <option value="observer">观察者</option>
                </select>
              ) : (
                <StatusChip tone={ROLE_META[m.role].tone} icon={<RoleIcon className="w-3 h-3" />}>
                  {ROLE_META[m.role].label}
                </StatusChip>
              )}
              {canManage && m.role !== 'owner' && (
                <button
                  onClick={() => removeMember(m)}
                  className="p-1 text-text-muted hover:text-[#d44c47]"
                  title="移除"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="加入新成员">
        <div className="space-y-4">
          {candidates.length === 0 ? (
            <p className="text-[13px] text-text-muted py-4 text-center">
              当前组织里所有 principal 都已经在这个 channel 里
            </p>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[13px] text-text-secondary">
                    选择 principal(可多选,共 {candidates.length} 个候选)
                  </label>
                  {addSelected.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setAddSelected(new Set())}
                      className="text-[11px] text-text-muted hover:text-[#2383e2]"
                    >
                      清空选择
                    </button>
                  )}
                </div>
                <div className="max-h-[240px] overflow-y-auto rounded border border-[#e3e2dc] bg-white">
                  {candidates.map((c) => {
                    const checked = addSelected.has(c.principalId);
                    return (
                      <label
                        key={`${c.kind}-${c.principalId}`}
                        className={clsx(
                          'flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-[#f0efe9] last:border-b-0',
                          checked ? 'bg-[#2383e2]/[0.06]' : 'hover:bg-[#f4f3ef]',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAddSelected(c.principalId)}
                          className="shrink-0"
                        />
                        {c.kind === 'agent' ? (
                          <Bot className="w-4 h-4 text-[#2383e2]" strokeWidth={1.8} />
                        ) : (
                          <UserCircle2 className="w-4 h-4 text-text-muted" strokeWidth={1.8} />
                        )}
                        <span className="text-[13px] text-text-primary">{c.displayName}</span>
                        {c.secondary && (
                          <span className="text-[11px] text-text-muted ml-auto truncate max-w-[140px]">
                            {c.secondary}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-[13px] text-text-secondary mb-1">角色</label>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as ChannelMemberRole)}
                  className="w-full px-2 py-1.5 text-[13px] rounded border border-[#e3e2dc] bg-white focus:outline-none focus:border-[#2383e2]"
                >
                  <option value="member">成员 — 常规参与者</option>
                  <option value="observer">观察者 — 主要围观的人</option>
                </select>
                <p className="mt-1.5 text-[11px] text-text-muted leading-relaxed">
                  MVP 阶段 <b>member 和 observer 实际权限相同</b> —— 都能读写消息、派任务,
                  区别只是社交语义(observer = 跨团队围观者)。未来强制 observer 只读时会加硬拦截。
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowAdd(false)}>
                  取消
                </Button>
                <Button onClick={addMember} loading={saving} disabled={addSelected.size === 0}>
                  {addSelected.size > 1 ? `加入 ${addSelected.size} 人` : '加入'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
