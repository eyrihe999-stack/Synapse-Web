/**
 * DocumentTabs 在 /org/documents 和 /org/documents/chunks 两个子视图之间切换。
 *
 * 放在 PageHeader 下面,提供"文档列表 | 片段检索"两个 tab。
 * 两个 tab 是独立 route(可深链),切换即 NavLink 跳转,不依赖组件内部 state。
 */
import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import { FileText, FileSearch } from 'lucide-react';

const tabs = [
  { label: '文档列表', icon: FileText, to: '/org/documents' },
  { label: '片段检索', icon: FileSearch, to: '/org/documents/chunks' },
];

export function DocumentTabs() {
  return (
    <div className="inline-flex rounded-md border border-border-default bg-white overflow-hidden shadow-sm">
      {tabs.map(({ label, icon: Icon, to }) => (
        <NavLink
          key={to}
          to={to}
          // end: 文档列表路径是其他 tab 的 URL 前缀,必须精确匹配才算 active,
          // 否则打开片段检索时文档列表 tab 也会被标成 active。
          end
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-[13px] transition-colors border-l border-border-default first:border-l-0',
              isActive
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-[#f5f5f3]',
            )
          }
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
          {label}
        </NavLink>
      ))}
    </div>
  );
}
