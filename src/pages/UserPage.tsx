import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuthStore } from '@/store/auth';
import { useOrgStore } from '@/store/org';
import { userApi } from '@/api/user';
import { apiCall } from '@/lib/api-helpers';
import { toast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatTs } from '@/lib/format';
import {
  Pencil, Save, X, User as UserIcon, Mail, Clock,
  Hash, Building2, Shield, Copy, Check, Image,
} from 'lucide-react';

export function UserPage() {
  const { user, fetchProfile } = useAuthStore();
  const { orgs, fetchOrgs } = useOrgStore();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchProfile(), fetchOrgs()]);
    } catch { /* ignore */ }
    setRefreshing(false);
  };

  const startEdit = () => {
    setDisplayName(user?.display_name ?? '');
    setAvatarUrl(user?.avatar_url ?? '');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    const result = await apiCall(
      () => userApi.updateMe({ display_name: displayName || undefined, avatar_url: avatarUrl || undefined }),
      { success: '个人信息已更新' },
    );
    if (result) {
      await fetchProfile();
      setEditing(false);
    }
    setSaving(false);
  };

  const copyId = async () => {
    if (!user) return;
    await navigator.clipboard.writeText(user.id);
    setCopied(true);
    toast('success', '已复制用户 ID');
    setTimeout(() => setCopied(false), 2000);
  };

  if (!user) return null;

  const initial = (user.display_name || user.email)[0].toUpperCase();
  const hasAvatar = !!user.avatar_url;

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="个人资料" subtitle="管理你的个人信息" loading={refreshing} onRefresh={refresh} />

      {/* ── Profile Card ── */}
      <GlassCard>
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-xl bg-accent/10 flex items-center justify-center overflow-hidden shrink-0">
              {hasAvatar ? (
                <img
                  src={user.avatar_url}
                  alt={user.display_name || 'avatar'}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                  }}
                />
              ) : null}
              <span className={`text-xl font-semibold text-accent ${hasAvatar ? 'hidden' : ''}`}>
                {initial}
              </span>
            </div>
            <div>
              <h3 className="text-[16px] font-semibold text-text-primary">
                {user.display_name || '未命名用户'}
              </h3>
              <p className="text-[13px] text-text-muted font-mono">{user.email}</p>
            </div>
          </div>
          {!editing && (
            <Button variant="secondary" size="sm" onClick={startEdit} icon={<Pencil className="h-3 w-3" />}>
              编辑
            </Button>
          )}
        </div>

        {editing ? (
          <div className="space-y-4">
            <Input label="显示名称" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="你的显示名称" />
            <Input label="头像链接" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
            {avatarUrl && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/50">
                <Image className="h-4 w-4 text-text-muted shrink-0" />
                <span className="text-[12px] text-text-muted">预览</span>
                <div className="h-10 w-10 rounded-lg overflow-hidden bg-accent/10 flex items-center justify-center">
                  <img
                    src={avatarUrl}
                    alt="preview"
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={save} loading={saving} icon={<Save className="h-3.5 w-3.5" />}>保存</Button>
              <Button variant="ghost" onClick={() => setEditing(false)} icon={<X className="h-3.5 w-3.5" />}>取消</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-0">
            <InfoRow icon={<UserIcon className="h-3.5 w-3.5" />} label="显示名称" value={user.display_name || '—'} />
            <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="邮箱" value={user.email} mono />
            <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="注册时间" value={user.created_at ? new Date(user.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—'} />
          </div>
        )}
      </GlassCard>

      {/* ── Account Info Card ── */}
      <GlassCard>
        <h4 className="text-[14px] font-semibold text-text-primary mb-4">账户信息</h4>
        <div className="space-y-0">
          <div className="flex items-center gap-3 py-2.5 border-b border-border-default">
            <span className="text-text-muted"><Hash className="h-3.5 w-3.5" /></span>
            <span className="text-[12px] text-text-muted w-20 shrink-0">用户 ID</span>
            <span className="text-[13px] text-text-primary font-mono truncate">{user.id}</span>
            <button
              onClick={copyId}
              className="ml-auto shrink-0 p-1 rounded hover:bg-bg-secondary/60 text-text-muted hover:text-text-primary transition-colors"
              title="复制 ID"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <InfoRow icon={<Shield className="h-3.5 w-3.5" />} label="账户状态" value="正常" />
        </div>
      </GlassCard>

      {/* ── Organization Memberships Card ── */}
      <GlassCard>
        <h4 className="text-[14px] font-semibold text-text-primary mb-4">
          所属组织
          {orgs.length > 0 && (
            <span className="ml-2 text-[12px] font-normal text-text-muted">{orgs.length} 个</span>
          )}
        </h4>
        {orgs.length === 0 ? (
          <p className="text-[13px] text-text-muted py-2">暂未加入任何组织</p>
        ) : (
          <div className="space-y-0">
            {orgs.map((item) => (
              <div
                key={item.org.id}
                className="flex items-center gap-3 py-2.5 border-b border-border-default last:border-0"
              >
                <span className="text-text-muted"><Building2 className="h-3.5 w-3.5" /></span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-text-primary font-medium truncate">
                      {item.org.display_name}
                    </span>
                    <StatusBadge status={item.my_role.name} />
                  </div>
                  <span className="text-[11px] text-text-muted font-mono">{item.org.slug}</span>
                </div>
                <span className="text-[11px] text-text-muted shrink-0">
                  {formatTs(item.joined_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border-default last:border-0">
      <span className="text-text-muted">{icon}</span>
      <span className="text-[12px] text-text-muted w-20 shrink-0">{label}</span>
      <span className={`text-[13px] text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
