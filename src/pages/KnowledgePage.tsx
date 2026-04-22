import { NavLink, Outlet } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  BookOpen,
  FileText,
  Code2,
  Image as ImageIcon,
  Database,
  Bug,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrgStore } from '@/store/org';

interface TabDef {
  to: string;
  label: string;
  icon: LucideIcon;
}

const tabs: TabDef[] = [
  { to: '/org/knowledge/docs', label: '文档', icon: FileText },
  { to: '/org/knowledge/code', label: '代码', icon: Code2 },
  { to: '/org/knowledge/images', label: '图片', icon: ImageIcon },
  { to: '/org/knowledge/databases', label: '数据库', icon: Database },
  { to: '/org/knowledge/bugs', label: '缺陷', icon: Bug },
];

export function KnowledgePage() {
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const slug = currentOrg?.org.slug;

  if (!slug) {
    return (
      <div className="space-y-6">
        <PageHeader title="知识库" />
        <GlassCard>
          <div className="py-8 text-center">
            <BookOpen className="h-8 w-8 text-text-muted mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-[14px] text-text-secondary mb-1">请先选择组织</p>
            <p className="text-[12px] text-text-muted">在顶部选择组织上下文后浏览知识库</p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="知识库"
        subtitle={`${currentOrg.org.display_name} · 多模态资源库，支撑上层 agent 的知识检索`}
      />

      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-bg-card border border-border-default">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] transition-all duration-150',
                isActive
                  ? 'bg-[#2383e2]/[0.08] text-[#2383e2] font-medium'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )
            }
          >
            <Icon className="h-[14px] w-[14px]" strokeWidth={1.7} />
            {label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
