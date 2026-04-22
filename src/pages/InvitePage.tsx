// InvitePage 邀请邮件落地页,对应路径 /invite?token=xxx。
//
// 三种入场态:
//   1. 未登录 → 调 preview 展示邀请摘要,存 token 到 localStorage,按钮引导去 /auth。
//      AuthPage 登录成功后读 localStorage 自动跳回本页完成 accept。
//   2. 已登录 + email 匹配 → preview 展示后用户点"接受"调 accept。
//   3. 已登录 + email 不匹配 → 提示需要用目标邮箱登录,按钮退出当前账号。
//
// 邀请终态(accepted / revoked / expired)直接展示状态,不再提供接受按钮。
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/auth';
import { useOrgStore } from '@/store/org';
import { invitationApi } from '@/api/org';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { resolveErrorMessage } from '@/lib/errors';
import type { InvitationPreviewResponse } from '@/types/api';
import {
  Mail,
  Building2,
  Shield,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  LogOut,
  LogIn,
} from 'lucide-react';
import { formatTs, formatRelativeTs } from '@/lib/format';
import { UserAvatar } from '@/components/ui/UserIdentity';

// 登录后回跳时存 token 的 localStorage key。AuthPage 登录成功后读取并清理。
export const PENDING_INVITE_TOKEN_KEY = 'pending_invite_token';

export function InvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();

  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)();
  const currentUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
  const selectOrg = useOrgStore((s) => s.selectOrg);

  const [preview, setPreview] = useState<InvitationPreviewResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!token) {
      setLoadErr('缺少邀请 token');
      setLoading(false);
      return;
    }
    try {
      const res = await invitationApi.preview(token);
      if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
        setLoadErr(resolveErrorMessage(res.data));
        return;
      }
      setPreview(res.data.result ?? null);
    } catch (err) {
      setLoadErr(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // 未登录 → 存 token,跳登录
  const goLogin = () => {
    if (token) localStorage.setItem(PENDING_INVITE_TOKEN_KEY, token);
    navigate('/auth', { replace: false });
  };

  const switchAccount = async () => {
    if (token) localStorage.setItem(PENDING_INVITE_TOKEN_KEY, token);
    await logout();
    useOrgStore.getState().clearOrg();
    navigate('/auth', { replace: true });
  };

  const accept = async () => {
    if (!token) return;
    setAccepting(true);
    const res = await apiCall(() => invitationApi.accept({ token }), {
      success: '已加入组织',
    });
    if (res.ok && res.data) {
      localStorage.removeItem(PENDING_INVITE_TOKEN_KEY);
      // 刷新 org 列表 → 选中新 org → 跳成员页
      await fetchOrgs();
      selectOrg(res.data.org_slug);
      navigate('/org/members', { replace: true });
      return;
    }
    setAccepting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] p-6">
      <div className="w-full max-w-[480px]">
        <div className="text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-accent/[0.08] mb-3">
            <Mail className="h-6 w-6 text-accent" strokeWidth={1.6} />
          </div>
          <h1 className="text-[22px] font-semibold text-text-primary">组织邀请</h1>
        </div>

        <GlassCard>
          {loading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 text-text-muted animate-spin" />
              <p className="text-[13px] text-text-muted">加载邀请信息...</p>
            </div>
          ) : loadErr || !preview ? (
            <div className="py-8 text-center space-y-3">
              <AlertCircle className="h-8 w-8 text-accent-red mx-auto" strokeWidth={1.2} />
              <p className="text-[14px] text-text-primary">邀请无法打开</p>
              <p className="text-[12px] text-text-muted">
                {loadErr ?? '邀请不存在或链接已失效'}
              </p>
              <Button variant="secondary" onClick={() => navigate('/', { replace: true })}>
                返回首页
              </Button>
            </div>
          ) : (
            <InvitationCard
              preview={preview}
              isLoggedIn={isLoggedIn}
              currentUserEmail={currentUser?.email}
              accepting={accepting}
              onAccept={accept}
              onLogin={goLogin}
              onSwitchAccount={switchAccount}
            />
          )}
        </GlassCard>

        <p className="text-center text-[11px] text-text-muted mt-4">
          如果不认识邀请人,请直接忽略此邮件。
        </p>
      </div>
    </div>
  );
}

function InvitationCard({
  preview,
  isLoggedIn,
  currentUserEmail,
  accepting,
  onAccept,
  onLogin,
  onSwitchAccount,
}: {
  preview: InvitationPreviewResponse;
  isLoggedIn: boolean;
  currentUserEmail: string | undefined;
  accepting: boolean;
  onAccept: () => void;
  onLogin: () => void;
  onSwitchAccount: () => void;
}) {
  // 终态 → 只展示状态,不提供任何行动
  if (preview.status !== 'pending') {
    return <TerminalStateView preview={preview} />;
  }

  const emailMatch =
    !!currentUserEmail &&
    currentUserEmail.trim().toLowerCase() === preview.email.trim().toLowerCase();

  return (
    <div className="space-y-5">
      {/* 头部:大 org 头像 + 邀请人字样 + org 名字 */}
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 rounded-lg bg-accent/[0.08] flex items-center justify-center shrink-0">
          <Building2 className="h-6 w-6 text-accent" strokeWidth={1.6} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] text-text-secondary">
            <UserAvatar fallback={preview.inviter_name} size="xs" tone="muted" />
            <span className="font-medium text-text-primary truncate">
              {preview.inviter_name || '有人'}
            </span>
            <span className="text-text-muted">邀请你加入</span>
          </div>
          <p className="text-[20px] font-semibold text-text-primary truncate mt-1">
            {preview.org_display_name}
          </p>
          <p className="text-[11px] text-text-muted font-mono truncate">{preview.org_slug}</p>
        </div>
      </div>

      <div className="space-y-2 border-t border-border-default pt-4">
        <DetailRow
          icon={Shield}
          label="分配角色"
          value={`${preview.role.display_name}${preview.role.is_system ? '' : ' (自定义)'}`}
        />
        <DetailRow icon={Mail} label="邀请邮箱" value={preview.email} mono />
        <DetailRow
          icon={Clock}
          label="过期时间"
          value={`${formatRelativeTs(preview.expires_at)} · ${formatTs(preview.expires_at)}`}
          highlight
        />
      </div>

      {!isLoggedIn ? (
        <div className="space-y-2 pt-2">
          <p className="text-[12px] text-text-muted">
            请先用 <span className="font-medium text-text-primary">{preview.email}</span> 登录或注册,再回到此页面接受邀请。
          </p>
          <Button
            onClick={onLogin}
            icon={<LogIn className="h-3.5 w-3.5" />}
            className="w-full"
          >
            登录 / 注册
          </Button>
        </div>
      ) : emailMatch ? (
        <Button
          onClick={onAccept}
          loading={accepting}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          className="w-full"
        >
          接受邀请
        </Button>
      ) : (
        <div className="space-y-2 pt-2">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-[12px] text-amber-800">
              当前登录账号 <span className="font-mono">{currentUserEmail}</span> 与邀请邮箱{' '}
              <span className="font-mono">{preview.email}</span> 不一致。
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={onSwitchAccount}
            icon={<LogOut className="h-3.5 w-3.5" />}
            className="w-full"
          >
            切换账号
          </Button>
        </div>
      )}
    </div>
  );
}

function TerminalStateView({ preview }: { preview: InvitationPreviewResponse }) {
  const config = {
    accepted: {
      icon: CheckCircle2,
      tone: 'text-accent-green',
      title: '邀请已接受',
      desc: '这条邀请已经被接受过,无需重复操作。',
    },
    revoked: {
      icon: AlertCircle,
      tone: 'text-text-muted',
      title: '邀请已撤销',
      desc: '邀请方已撤销此邀请。如有需要请联系邀请方重新邀请。',
    },
    rejected: {
      icon: AlertCircle,
      tone: 'text-text-muted',
      title: '邀请已拒绝',
      desc: '你之前已经拒绝过这条邀请。如改变主意,请联系邀请方重新邀请。',
    },
    expired: {
      icon: Clock,
      tone: 'text-accent-red',
      title: '邀请已过期',
      desc: '邀请有效期已过。请联系邀请方重新发送邀请。',
    },
  }[preview.status === 'pending' ? 'accepted' : preview.status] ?? {
    icon: AlertCircle,
    tone: 'text-text-muted',
    title: '邀请状态异常',
    desc: '',
  };
  const Icon = config.icon;
  return (
    <div className="py-6 text-center space-y-3">
      <Icon className={`h-9 w-9 mx-auto ${config.tone}`} strokeWidth={1.2} />
      <p className="text-[15px] font-medium text-text-primary">{config.title}</p>
      <p className="text-[12px] text-text-muted">{config.desc}</p>
      <p className="text-[11px] text-text-muted">
        组织:{preview.org_display_name} · 邀请邮箱:
        <span className="font-mono">{preview.email}</span>
      </p>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  mono,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  mono?: boolean;
  // highlight=true 用 accent 色标注,给"过期倒计时"这类需强调的字段
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <Icon className="h-3.5 w-3.5 text-text-muted shrink-0" strokeWidth={1.6} />
      <span className="text-[12px] text-text-muted w-20 shrink-0">{label}</span>
      <span
        className={`text-[13px] flex-1 min-w-0 truncate ${mono ? 'font-mono' : ''} ${
          highlight ? 'text-accent font-medium' : 'text-text-primary'
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

