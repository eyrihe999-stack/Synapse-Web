import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { useOrgStore } from '@/store/org';
import { useAuthStore } from '@/store/auth';

export function OrgSelector() {
  const { orgs, currentOrg, fetchOrgs, selectOrg, loading } = useOrgStore();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)();
  const [open, setOpen] = useState(false);
  // 容器 ref 用于判断点击事件是否发生在下拉组件外部,进而决定是否关闭菜单。
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLoggedIn) fetchOrgs();
  }, [isLoggedIn, fetchOrgs]);

  // 点击外部区域 / 按 Escape 关闭菜单。
  // 只在 open=true 时绑定监听,避免关闭状态下也占用一份全局事件监听器。
  // 用 mousedown 而非 click —— 按下立即关闭,避免"按下 → 菜单关闭后菜单背后的元素被 click 误触发"的尴尬。
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="sticky top-0 z-40 border-b border-border-default bg-white/80 backdrop-blur-sm px-8 py-2">
      <div className="flex items-center justify-between max-w-[1200px]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">组织上下文</span>
          <div className="relative" ref={containerRef}>
            <button
              onClick={() => setOpen(!open)}
              className={clsx(
                'flex items-center gap-2 px-2.5 py-1 rounded-md border text-[13px] transition-all cursor-pointer',
                currentOrg
                  ? 'border-accent/20 text-accent bg-accent/[0.04]'
                  : 'border-border-default text-text-secondary bg-white hover:bg-bg-hover',
              )}
            >
              <Building2 className="h-3.5 w-3.5" strokeWidth={1.6} />
              {currentOrg ? currentOrg.org.display_name : '选择组织'}
              <ChevronDown className={clsx('h-3 w-3 transition-transform', open && 'rotate-180')} />
            </button>

            {open && (
              <div className="absolute top-full left-0 mt-1 w-56 rounded-md border border-border-default bg-white shadow-lg overflow-hidden">
                {orgs.length === 0 ? (
                  <p className="px-3 py-3 text-[12px] text-text-muted text-center">暂无组织</p>
                ) : (
                  orgs.map((o) => (
                    <button
                      key={o.org.id}
                      onClick={() => { selectOrg(o.org.slug); setOpen(false); }}
                      className={clsx(
                        'w-full flex items-center px-3 py-2 text-left text-[13px] transition-colors cursor-pointer',
                        currentOrg?.org.id === o.org.id
                          ? 'bg-accent/[0.06] text-accent'
                          : 'text-text-secondary hover:bg-bg-hover',
                      )}
                    >
                      <div>
                        <p className="font-medium">{o.org.display_name}</p>
                        <p className="text-[10px] text-text-muted font-mono">{o.org.slug}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => fetchOrgs()}
            disabled={loading}
            className="text-text-muted hover:text-accent transition-colors cursor-pointer p-1"
            title="刷新组织列表"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>
    </div>
  );
}
