import { NavLink, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  User,
  Building2,
  Users,
  Mail,
  Shield,
  Bot,
  Send,
  MessageSquare,
  LogOut,
  Activity,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { useOrgStore } from '@/store/org';

const personalItems = [
  { label: '个人资料', icon: User, to: '/user' },
  { label: '我的 Agent', icon: Bot, to: '/agents' },
];

const navItems = [
  { label: '组织管理', icon: Building2, to: '/org' },
  { label: '成员', icon: Users, to: '/org/members' },
  { label: '邀请', icon: Mail, to: '/org/invitations' },
  { label: '角色与权限', icon: Shield, to: '/org/roles' },
  { label: 'Agent 发布', icon: Send, to: '/org/publishes' },
  { label: '对话', icon: MessageSquare, to: '/org/chat' },
];

export function Sidebar() {
  const { user, logout, isLoggedIn } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    useOrgStore.getState().clearOrg();
    navigate('/auth', { replace: true });
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-[#fbfaf8] border-r border-[#e8e7e3] flex flex-col z-50">
      {/* Logo */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div
            data-augmented-ui="tl-clip br-clip border"
            className="w-7 h-7 flex items-center justify-center shrink-0"
            style={{
              '--aug-tl': '5px',
              '--aug-br': '5px',
              '--aug-border-all': '1.5px',
              '--aug-border-bg': '#2383e2',
              '--aug-border-opacity': '0.5',
              background: 'rgba(35,131,226,0.06)',
            } as React.CSSProperties}
          >
            <span className="text-[10px] font-bold text-[#2383e2]">S</span>
          </div>
          <div>
            <h1 className="text-[14px] font-semibold text-text-primary">Synapse</h1>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-1 px-2 space-y-px">
        <p className="px-2 pt-3 pb-1 text-[11px] font-medium text-text-muted uppercase tracking-wide">
          个人空间
        </p>
        {personalItems.map(({ label, icon: Icon, to }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 px-2.5 py-[6px] rounded-md text-[14px] transition-colors duration-100',
                isActive
                  ? 'bg-[#2383e2]/[0.08] text-[#2383e2] font-medium'
                  : 'text-text-secondary hover:bg-[#eeede8] hover:text-text-primary',
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
            {label}
          </NavLink>
        ))}
        <p className="px-2 pt-3 pb-1 text-[11px] font-medium text-text-muted uppercase tracking-wide">
          组织功能
        </p>
        {navItems.map(({ label, icon: Icon, to }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/org'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 px-2.5 py-[6px] rounded-md text-[14px] transition-colors duration-100',
                isActive
                  ? 'bg-[#2383e2]/[0.08] text-[#2383e2] font-medium'
                  : 'text-text-secondary hover:bg-[#eeede8] hover:text-text-primary',
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* System status */}
      <div className="px-4 py-2.5 border-t border-[#e8e7e3]">
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <Activity className="h-3 w-3" />
          <span className="font-mono">API</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#448361]" />
            <span>已连接</span>
          </span>
        </div>
      </div>

      {/* User */}
      <div className="px-3 py-2.5 border-t border-[#e8e7e3]">
        {isLoggedIn() && user ? (
          <div className="flex items-center gap-2.5 px-1">
            <div className="h-6 w-6 rounded-md bg-[#f1f0ea] flex items-center justify-center shrink-0">
              <span className="text-[11px] font-medium text-text-secondary">
                {(user.display_name || user.email)[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-text-primary truncate leading-tight">
                {user.display_name || 'User'}
              </p>
              <p className="text-[10px] text-text-muted truncate leading-tight">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-text-muted hover:text-accent-red transition-colors cursor-pointer p-0.5"
              title="退出登录"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-[12px] text-text-muted px-1">未登录</p>
        )}
      </div>
    </aside>
  );
}
