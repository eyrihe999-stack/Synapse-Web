import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useOrgStore } from '@/store/org';
import { orgApi } from '@/api/org';
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

  const startEdit = () => {
    setDisplayName(org.display_name);
    setDescription(org.description ?? '');
    setEditing(true);
  };

  const saveInfo = async () => {
    setSaving(true);
    const res = await apiCall(
      () => orgApi.update(org.slug, { display_name: displayName, description: description || undefined }),
      { success: '组织信息已更新' },
    );
    if (res.ok) { await fetchOrgs(); setEditing(false); }
    setSaving(false);
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

// slug 实时预检的本地状态机。idle = 未输入 / 已清空,checking = debounce 中,
// 其余对齐后端 SlugCheckResponse.reason 枚举。
type SlugCheckState = 'idle' | 'checking' | 'available' | 'invalid_format' | 'taken';

// 后端预检结果的快照,带 slug 锚点避免乱序:只有快照里的 slug 和当前输入一致时才算数。
// 把 setState 搬出 effect 主体以绕过 set-state-in-effect 规则 —— UI state 全部从这两个 state 派生。
interface SlugCheckSnapshot {
  slug: string;
  available: boolean;
  reason?: 'invalid_format' | 'taken';
}

function CreateOrgModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkSnapshot, setCheckSnapshot] = useState<SlugCheckSnapshot | null>(null);
  const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
  const selectOrg = useOrgStore((s) => s.selectOrg);

  // slug 改动触发 debounce 预检:350ms 内连续输入只发最后一次。
  // 不在 effect 主体 setState,只在 setTimeout 回调里写;UI 从派生状态读,避免级联渲染告警。
  useEffect(() => {
    if (!slug) return;
    const timer = setTimeout(async () => {
      try {
        const res = await orgApi.checkSlug(slug);
        const r = res.data.result;
        if (!r) return;
        setCheckSnapshot({ slug, available: r.available, reason: r.reason });
      } catch {
        // 网络/后端临时故障不阻塞提交,终极 CreateOrg 会兜底报错;
        // 此时不更新 snapshot,UI 仍停在 'checking' 态,用户可直接点创建。
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [slug]);

  // 从 slug + 最近的 snapshot 派生出 UI 状态。snapshot.slug 落后于当前 slug 说明 debounce 还没回来。
  const slugState: SlugCheckState = (() => {
    if (!slug) return 'idle';
    if (!checkSnapshot || checkSnapshot.slug !== slug) return 'checking';
    if (checkSnapshot.available) return 'available';
    if (checkSnapshot.reason === 'invalid_format' || checkSnapshot.reason === 'taken') {
      return checkSnapshot.reason;
    }
    return 'idle';
  })();

  const submit = async () => {
    setLoading(true);
    const res = await apiCall(
      () => orgApi.create({ slug, display_name: displayName, description: description || undefined }),
      { success: '组织创建成功' },
    );
    if (res.ok) {
      await fetchOrgs();
      // 创建成功后自动把新 org 选中 —— 否则用户得再点一次卡片才能看到详情
      selectOrg(slug);
      onClose();
      setSlug(''); setDisplayName(''); setDescription(''); setCheckSnapshot(null);
    }
    setLoading(false);
  };

  const slugHint = (() => {
    switch (slugState) {
      case 'checking': return { text: '正在校验可用性...', cls: 'text-text-muted' };
      case 'available': return { text: '✓ 可用', cls: 'text-accent-green' };
      case 'invalid_format': return { text: '格式不合法(3-32 字符,小写字母开头,仅允许字母/数字/连字符)', cls: 'text-accent-red' };
      case 'taken': return { text: '该 Slug 已被占用,请换一个', cls: 'text-accent-red' };
      default: return null;
    }
  })();

  // 拦截提交:格式非法 / 已占用 直接禁用创建按钮
  const slugBlocked = slugState === 'invalid_format' || slugState === 'taken' || slugState === 'checking';

  return (
    <Modal open={open} onClose={onClose} title="创建组织">
      <div className="space-y-3">
        <div className="space-y-1">
          <Input label="Slug（唯一标识）" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-org（小写字母、数字、连字符）" />
          {slugHint && <p className={`text-[11px] ${slugHint.cls}`}>{slugHint.text}</p>}
        </div>
        <Input label="显示名称" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="我的组织" />
        <Input label="描述（可选）" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="组织描述" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={submit} loading={loading} disabled={!slug || !displayName || slugBlocked}>创建</Button>
        </div>
      </div>
    </Modal>
  );
}
