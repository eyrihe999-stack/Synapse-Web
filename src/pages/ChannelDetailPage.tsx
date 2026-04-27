// ChannelDetailPage channel 详情页的壳 + 4 个 tab(消息流 / 成员 / 知识库 / 任务)。
//
// 数据加载策略:
//   - channel 元信息 + members + kb_refs 在壳这里集中拉一次,传给各 tab
//   - messages / tasks 由对应 tab 自己管理
//   - 切 tab 不重拉 members / kb_refs(避免闪烁);发送新消息 / 加成员等动作
//     自己触发局部刷新
//
// 路由:/org/channels/:id
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Hash,
  MessagesSquare,
  Users as UsersIcon,
  BookOpen,
  ListChecks,
  ArrowLeft,
  Archive,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/Toast';
import { channelApi } from '@/api/channel';
import { useOrgStore } from '@/store/org';
import { useAuthStore } from '@/store/auth';
import { useOrgPrincipals } from '@/hooks/useOrgPrincipals';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import type {
  ChannelResponse,
  ChannelMemberResponse,
  ChannelKBRefResponse,
} from '@/types/api';
import { MessagesTab } from './channel/MessagesTab';
import { MembersTab } from './channel/MembersTab';
import { KBRefsTab } from './channel/KBRefsTab';
import { TasksTab } from './channel/TasksTab';
import { DocumentsTab } from './channel/DocumentsTab';

type TabKey = 'messages' | 'members' | 'kb' | 'tasks' | 'documents';

export function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const channelId = id ? Number(id) : 0;
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const me = useAuthStore((s) => s.user);

  const [channel, setChannel] = useState<ChannelResponse | null>(null);
  const [members, setMembers] = useState<ChannelMemberResponse[]>([]);
  const [kbRefs, setKbRefs] = useState<ChannelKBRefResponse[]>([]);
  const [loading, setLoading] = useState(false);
  // tab 持久化到 URL query:从其他页(如文档详情)返回时能保留来源 tab(?tab=documents)。
  // 默认 messages,无效值也回退 messages。
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromQuery = searchParams.get('tab') as TabKey | null;
  const validTabs: TabKey[] = ['messages', 'members', 'kb', 'documents', 'tasks'];
  const initialTab: TabKey = tabFromQuery && validTabs.includes(tabFromQuery) ? tabFromQuery : 'messages';
  const [activeTab, setActiveTabState] = useState<TabKey>(initialTab);
  const setActiveTab = (k: TabKey) => {
    setActiveTabState(k);
    // 同步 URL,但不写入 history(replace)避免污染 back 栈
    const next = new URLSearchParams(searchParams);
    if (k === 'messages') next.delete('tab');
    else next.set('tab', k);
    setSearchParams(next, { replace: true });
  };

  const { entries: allPrincipals, byPrincipalID } = useOrgPrincipals(currentOrg?.org.slug);

  // 切 org / 清 org 时把已加载的详情清零 + 跳回列表。否则 UI 会残留上个 org 的
  // channel 数据(消息流 / 成员),可能误导新 org 里根本不该看到这些内容的用户。
  useEffect(() => {
    if (!currentOrg) {
      setChannel(null);
      setMembers([]);
      setKbRefs([]);
      navigate('/org/channels', { replace: true });
      return;
    }
    // org 变了,如果当前 channel 不属于新 org,fetchChannel 会 404 → 自动跳回
    // (依赖 apiCall 的错误处理 + channel==null 分支)
  }, [currentOrg, navigate]);

  const fetchChannel = useCallback(async () => {
    if (!channelId) return;
    const res = await apiCall(() => channelApi.get(channelId));
    if (res.ok && res.data) {
      setChannel(res.data);
    } else {
      toast('error', '无法加载 channel(可能不是成员)');
    }
  }, [channelId]);

  const fetchMembers = useCallback(async () => {
    if (!channelId) return;
    try {
      const res = await channelApi.listMembers(channelId);
      setMembers(res.data.result ?? []);
    } catch (err) {
      toast('error', getErrorMessage(err));
    }
  }, [channelId]);

  const fetchKBRefs = useCallback(async () => {
    if (!channelId) return;
    try {
      const res = await channelApi.listKBRefs(channelId);
      setKbRefs(res.data.result ?? []);
    } catch {
      // KB refs 查询失败不致命(权限或空列表)
    }
  }, [channelId]);

  useEffect(() => {
    setLoading(true);
    void Promise.all([fetchChannel(), fetchMembers(), fetchKBRefs()]).finally(() =>
      setLoading(false),
    );
  }, [fetchChannel, fetchMembers, fetchKBRefs]);

  // 我的角色(owner / member / observer) —— 控制成员 / KB / 任务 tab 的按钮可见性
  const myRole = useMemo(() => {
    if (!me) return null;
    const mine = members.find((m) => m.principal_id === Number(me.principal_id));
    return mine?.role ?? null;
  }, [members, me]);

  const canManage = myRole === 'owner';
  // MVP:observer 在后端和 member 权限相同(message_service.go:22),前端不做硬拦截
  const canWrite = myRole === 'owner' || myRole === 'member' || myRole === 'observer';

  const archiveChannel = async () => {
    if (!channel) return;
    if (!confirm(`归档 channel「${channel.name}」?归档后不能再发消息。`)) return;
    const res = await apiCall(() => channelApi.archive(channel.id));
    if (res.ok) {
      toast('success', '已归档');
      fetchChannel();
    }
  };

  if (!channelId) {
    return <div className="p-6 text-center text-text-muted">无效的 channel id</div>;
  }

  if (loading && !channel) {
    return (
      <div className="p-6">
        <div className="h-6 bg-[#eeede8] rounded w-1/3 animate-pulse mb-3" />
        <div className="h-4 bg-[#eeede8] rounded w-2/3 animate-pulse" />
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="p-6 text-center text-text-muted">
        <MessagesSquare className="mx-auto h-8 w-8 mb-2" strokeWidth={1.5} />
        <p className="text-[13px]">无法加载此 channel</p>
        <Button
          variant="ghost"
          onClick={() => navigate('/org/channels')}
          className="mt-3"
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
        >
          返回列表
        </Button>
      </div>
    );
  }

  const tabs = [
    { key: 'messages' as TabKey, label: '消息', icon: MessagesSquare },
    {
      key: 'members' as TabKey,
      label: '成员',
      icon: UsersIcon,
      badge: members.length,
    },
    {
      key: 'kb' as TabKey,
      label: '知识库',
      icon: BookOpen,
      badge: kbRefs.length,
    },
    { key: 'documents' as TabKey, label: '文档', icon: FileText },
    { key: 'tasks' as TabKey, label: '任务', icon: ListChecks },
  ];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <button
            onClick={() => navigate('/org/channels')}
            className="mt-1 p-1 text-text-muted hover:text-[#2383e2] rounded"
            title="返回 channel 列表"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Hash
            className="w-5 h-5 text-[#2383e2] mt-0.5 shrink-0"
            strokeWidth={1.8}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-text-primary truncate">
                {channel.name}
              </h2>
              {channel.status === 'archived' && (
                <StatusChip tone="neutral">已归档</StatusChip>
              )}
              {myRole && (
                <StatusChip tone={myRole === 'owner' ? 'amber' : 'blue'}>
                  {myRole === 'owner' ? '所有者' : myRole === 'member' ? '成员' : '观察者'}
                </StatusChip>
              )}
            </div>
            {channel.purpose ? (
              <p className="text-[12px] text-text-secondary mt-0.5 truncate max-w-xl">
                {channel.purpose}
              </p>
            ) : (
              <p className="text-[12px] text-text-muted italic mt-0.5">无说明</p>
            )}
          </div>
        </div>
        {canManage && channel.status === 'open' && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Archive className="w-3.5 h-3.5" />}
            onClick={archiveChannel}
          >
            归档
          </Button>
        )}
      </div>

      <Tabs tabs={tabs} activeKey={activeTab} onChange={setActiveTab} />

      <div>
        {activeTab === 'messages' && (
          <MessagesTab
            channelId={channelId}
            members={members}
            principalDirByID={byPrincipalID}
          />
        )}
        {activeTab === 'members' && (
          <MembersTab
            channelId={channelId}
            members={members}
            allPrincipals={allPrincipals}
            principalDirByID={byPrincipalID}
            canManage={canManage}
            onRefresh={fetchMembers}
          />
        )}
        {activeTab === 'kb' && (
          <KBRefsTab
            channelId={channelId}
            refs={kbRefs}
            canManage={canWrite}
            onRefresh={fetchKBRefs}
          />
        )}
        {activeTab === 'tasks' && (
          <GlassCard>
            <TasksTab
              channelId={channelId}
              principalDirByID={byPrincipalID}
              channelMembers={members}
              canManage={canWrite}
            />
          </GlassCard>
        )}
        {activeTab === 'documents' && (
          <DocumentsTab
            channelId={channelId}
            archived={channel.status === 'archived'}
            principalDirByID={byPrincipalID}
          />
        )}
      </div>
    </div>
  );
}
