import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useOrgStore } from '@/store/org';
import { roleApi } from '@/api/org';
import { toast } from '@/components/ui/Toast';
import { getErrorMessage } from '@/lib/api-helpers';
import type { RoleResponse, PermissionsResponse } from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Shield, Plus, Trash2, Key } from 'lucide-react';

export function RolesPage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [allPerms, setAllPerms] = useState<PermissionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetch = async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        roleApi.list(slug),
        roleApi.listPermissions(slug),
      ]);
      setRoles(rolesRes.data.result ?? []);
      setAllPerms(permsRes.data.result ?? null);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, [slug]);

  const deleteRole = async (id: string, name: string) => {
    if (!slug || !confirm(`确定要删除角色「${name}」吗？`)) return;
    setDeletingId(id);
    try {
      await roleApi.delete(slug, id);
      toast('success', '角色已删除');
      fetch();
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="角色与权限" />
        <GlassCard>
          <div className="py-8 text-center">
            <Shield className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[13px] text-text-muted">请先在顶部选择一个组织</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="角色与权限"
        subtitle={`${currentOrg.org.display_name} · 管理角色和权限分配`}
        loading={loading}
        onRefresh={fetch}
        action={<Button onClick={() => setShowCreate(true)} icon={<Plus className="h-3.5 w-3.5" />}>创建角色</Button>}
      />

      {loading ? (
        <p className="text-[13px] text-text-muted py-6 text-center">加载中...</p>
      ) : (
        <div className="space-y-2">
          {roles.map((r) => (
            <GlassCard key={r.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-[14px] font-medium text-text-primary">{r.display_name}</p>
                    <StatusBadge status={r.name} />
                    {r.is_preset && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f1f1ef] text-text-muted border border-[#e3e2dc] font-mono">
                        预设
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {r.permissions.map((p) => (
                      <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/[0.06] text-accent border border-accent/10 font-mono">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                {!r.is_preset && (
                  <button
                    onClick={() => deleteRole(r.id, r.display_name)}
                    disabled={deletingId === r.id}
                    className="text-text-muted hover:text-accent-red transition-colors cursor-pointer p-1 disabled:opacity-50"
                    title="删除角色"
                  >
                    {deletingId === r.id
                      ? <span className="h-3.5 w-3.5 block border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* All permissions reference */}
      {allPerms && (
        <GlassCard>
          <div className="flex items-center gap-2 mb-3">
            <Key className="h-4 w-4 text-text-muted" />
            <h3 className="text-[13px] font-semibold text-text-primary">权限参考</h3>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-text-muted mb-1.5">全部权限</p>
              <div className="flex flex-wrap gap-1">
                {allPerms.all.map((p) => (
                  <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/[0.06] text-accent border border-accent/10 font-mono">{p}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-text-muted mb-1.5">仅 Owner 可用</p>
              <div className="flex flex-wrap gap-1">
                {allPerms.owner_only.map((p) => (
                  <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-[#faf3dd] text-[#cb912f] border border-[#eddcb5] font-mono">{p}</span>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      <CreateRoleModal open={showCreate} onClose={() => setShowCreate(false)} slug={slug} allPerms={allPerms} onDone={fetch} />
    </div>
  );
}

function CreateRoleModal({ open, onClose, slug, allPerms, onDone }: {
  open: boolean; onClose: () => void; slug: string; allPerms: PermissionsResponse | null; onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const toggle = (p: string) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p); else next.add(p);
    setSelected(next);
  };

  const submit = async () => {
    setLoading(true);
    try {
      await roleApi.create(slug, { name, display_name: displayName, permissions: [...selected] });
      toast('success', '角色已创建');
      onClose();
      onDone();
      setName(''); setDisplayName(''); setSelected(new Set());
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="创建角色">
      <div className="space-y-3">
        <Input label="角色标识" value={name} onChange={(e) => setName(e.target.value)} placeholder="reviewer（英文标识）" />
        <Input label="显示名称" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="审核员" />

        {allPerms && (
          <div className="space-y-1">
            <label className="block text-[12px] font-medium text-text-secondary">选择权限</label>
            <div className="max-h-48 overflow-auto border border-border-default rounded-md p-2 space-y-1">
              {allPerms.all.filter((p) => !allPerms.owner_only.includes(p)).map((p) => (
                <label key={p} className="flex items-center gap-2 cursor-pointer py-0.5">
                  <input type="checkbox" checked={selected.has(p)} onChange={() => toggle(p)} className="accent-accent" />
                  <span className="text-[12px] font-mono text-text-secondary">{p}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={submit} loading={loading} disabled={!name || !displayName || selected.size === 0}>创建</Button>
        </div>
      </div>
    </Modal>
  );
}
