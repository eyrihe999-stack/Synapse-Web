import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useOrgStore } from '@/store/org';
import { orgApi } from '@/api/org';
import { toast } from '@/components/ui/Toast';
import { apiCall } from '@/lib/api-helpers';
import { PageHeader } from '@/components/ui/PageHeader';
import { Plus, Building2, Settings, ChevronRight } from 'lucide-react';
import { formatTs } from '@/lib/format';

export function OrgPage() {
  const { orgs, currentOrg, fetchOrgs, selectOrg, loading } = useOrgStore();
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="组织管理"
        subtitle="管理你所属的组织"
        loading={loading}
        onRefresh={fetchOrgs}
        action={<Button onClick={() => setShowCreate(true)} icon={<Plus className="h-3.5 w-3.5" />}>创建组织</Button>}
      />

      {loading && orgs.length === 0 ? (
        <p className="text-[13px] text-text-muted py-8 text-center">加载中...</p>
      ) : orgs.length === 0 ? (
        <GlassCard>
          <div className="py-8 text-center">
            <Building2 className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">暂无组织</p>
            <p className="text-[12px] text-text-muted">点击上方按钮创建你的第一个组织</p>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {orgs.map((o) => (
            <GlassCard key={o.org.id} hover className={currentOrg?.org.id === o.org.id ? 'aug-card-cyan' : ''}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => selectOrg(o.org.slug)}>
                  <div className="h-9 w-9 rounded-lg bg-accent/[0.06] flex items-center justify-center shrink-0">
                    <Building2 className="h-4 w-4 text-accent" strokeWidth={1.6} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-text-primary">{o.org.display_name}</p>
                    <p className="text-[11px] text-text-muted font-mono">{o.org.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={o.my_role.name} />
                  <StatusBadge status={o.org.status} />
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {currentOrg && <OrgDetail />}
      <CreateOrgModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}

function OrgDetail() {
  const { currentOrg, fetchOrgs } = useOrgStore();
  const org = currentOrg!.org;
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [requireReview, setRequireReview] = useState(org.require_agent_review);
  const [recordPayload, setRecordPayload] = useState(org.record_full_payload);
  const [savingSettings, setSavingSettings] = useState(false);

  const startEdit = () => {
    setDisplayName(org.display_name);
    setDescription(org.description ?? '');
    setEditing(true);
  };

  const saveInfo = async () => {
    setSaving(true);
    const result = await apiCall(
      () => orgApi.update(org.slug, { display_name: displayName, description: description || undefined }),
      { success: '组织信息已更新' },
    );
    if (result) { await fetchOrgs(); setEditing(false); }
    setSaving(false);
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    const result = await apiCall(
      () => orgApi.updateSettings(org.slug, { require_agent_review: requireReview, record_full_payload: recordPayload }),
      { success: '设置已保存' },
    );
    if (result) await fetchOrgs();
    setSavingSettings(false);
  };

  return (
    <div className="space-y-4 mt-6">
      <h3 className="text-[14px] font-semibold text-text-primary flex items-center gap-2">
        <Settings className="h-4 w-4 text-text-muted" />
        组织详情 — {org.display_name}
      </h3>

      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-[13px] font-semibold text-text-primary">基本信息</h4>
          {!editing && (
            <Button variant="secondary" size="sm" onClick={startEdit} icon={<Settings className="h-3 w-3" />}>编辑</Button>
          )}
        </div>
        {editing ? (
          <div className="space-y-3">
            <Input label="显示名称" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <Input label="描述" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="组织描述" />
            <div className="flex gap-2 pt-1">
              <Button onClick={saveInfo} loading={saving}>保存</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>取消</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <InfoRow label="Slug" value={org.slug} mono />
            <InfoRow label="显示名称" value={org.display_name} />
            <InfoRow label="描述" value={org.description || '—'} />
            <InfoRow label="状态" value={org.status} />
            <InfoRow label="创建时间" value={formatTs(org.created_at)} />
          </div>
        )}
      </GlassCard>

      <GlassCard>
        <h4 className="text-[13px] font-semibold text-text-primary mb-4">组织设置</h4>
        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-[13px] text-text-primary">Agent 发布审核</p>
              <p className="text-[11px] text-text-muted">发布 Agent 到组织前需要管理员审核</p>
            </div>
            <input type="checkbox" checked={requireReview} onChange={(e) => setRequireReview(e.target.checked)} className="accent-accent h-4 w-4" />
          </label>
          <div className="border-t border-border-default" />
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-[13px] text-text-primary">记录完整载荷</p>
              <p className="text-[11px] text-text-muted">记录 Agent 调用的完整请求和响应数据</p>
            </div>
            <input type="checkbox" checked={recordPayload} onChange={(e) => setRecordPayload(e.target.checked)} className="accent-accent h-4 w-4" />
          </label>
          <div className="pt-1">
            <Button variant="secondary" onClick={saveSettings} loading={savingSettings}>保存设置</Button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center py-2 border-b border-border-default last:border-0">
      <span className="text-[12px] text-text-muted w-24 shrink-0">{label}</span>
      <span className={`text-[13px] text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function CreateOrgModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const fetchOrgs = useOrgStore((s) => s.fetchOrgs);

  const submit = async () => {
    setLoading(true);
    const result = await apiCall(
      () => orgApi.create({ slug, display_name: displayName, description: description || undefined }),
      { success: '组织创建成功' },
    );
    if (result) {
      await fetchOrgs();
      onClose();
      setSlug(''); setDisplayName(''); setDescription('');
    }
    setLoading(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="创建组织">
      <div className="space-y-3">
        <Input label="Slug（唯一标识）" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-org（小写字母、数字、连字符）" />
        <Input label="显示名称" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="我的组织" />
        <Input label="描述（可选）" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="组织描述" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={submit} loading={loading} disabled={!slug || !displayName}>创建</Button>
        </div>
      </div>
    </Modal>
  );
}
