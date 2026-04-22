import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { authApi } from '@/api/user';
import { getDeviceId, getDeviceName } from '@/lib/device';
import { getErrorMessage } from '@/lib/api-helpers';
import { resolveErrorMessage } from '@/lib/errors';
import { PENDING_INVITE_TOKEN_KEY } from '@/pages/InvitePage';
import { Loader2, ArrowRight } from 'lucide-react';

type Mode = 'login' | 'register';

// 发码按钮冷却时长(秒)。与后端 code_ttl 无关,只是 UX 上避免用户狂点。
const CODE_COOLDOWN_SECONDS = 60;
// 邮箱格式正则,前端只做粗过滤,严格校验在后端。
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GoogleGlyph Google 官方 4 色 "G" 图标。
// 行内 SVG,避免引额外 icon 包;sizing 由外层 className 控制。
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [codeSending, setCodeSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<number | null>(null);

  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  // 组件卸载时清理计时器,避免切页后还在 setState 造成 warning。
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  const startCooldown = () => {
    setCooldown(CODE_COOLDOWN_SECONDS);
    timerRef.current = window.setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const sendCode = async () => {
    setError('');
    if (!EMAIL_RE.test(email)) {
      setError('请先填写正确的邮箱');
      return;
    }
    setCodeSending(true);
    try {
      const res = await authApi.sendEmailCode({ email });
      if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
        setError(resolveErrorMessage(res.data));
        return;
      }
      startCooldown();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCodeSending(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const deviceId = getDeviceId();
      const deviceName = getDeviceName();
      const res = mode === 'login'
        ? await authApi.login({ email, password, code, device_id: deviceId, device_name: deviceName })
        : await authApi.register({ email, password, code, display_name: displayName || undefined, device_id: deviceId, device_name: deviceName });

      // 检查业务错误码（后端部分错误返回 HTTP 200 + 业务码）
      if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
        setError(resolveErrorMessage(res.data));
        return;
      }
      const data = res.data.result!;
      setAuth(data.access_token, data.refresh_token, data.user);
      // 如果用户是从邀请落地页被引导过来的,登录成功后直接回跳 /invite 完成 accept。
      // token 在 InvitePage 跳转时塞进 localStorage,这里读出来即可 —— 只读不清,
      // 清理交给 InvitePage 的 accept 成功分支(失败时保留 token,用户可再试)。
      const pendingInvite = localStorage.getItem(PENDING_INVITE_TOKEN_KEY);
      if (pendingInvite) {
        navigate(`/invite?token=${encodeURIComponent(pendingInvite)}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
    setCode('');
  };

  const codeButtonDisabled = codeSending || cooldown > 0 || !EMAIL_RE.test(email);
  const codeButtonLabel = codeSending
    ? '发送中...'
    : cooldown > 0
      ? `${cooldown} 秒后重发`
      : '发送验证码';

  return (
    <div className="min-h-screen flex">
      {/* Left: warm branding panel */}
      <div className="hidden lg:flex lg:w-[460px] xl:w-[520px] bg-[#f0efe9] flex-col justify-between p-12 relative overflow-hidden border-r border-[#e3e2dc]">
        {/* Subtle sci-fi dot grid */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: 'radial-gradient(circle, #373530 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />

        <div className="relative">
          <h1 className="text-[36px] font-bold text-text-primary tracking-tight mb-8">Synapse</h1>

          <p className="text-[16px] text-text-secondary leading-relaxed mb-2">
            Agent 网络管理控制台
          </p>
          <p className="text-[14px] text-text-muted leading-relaxed max-w-sm">
            在统一平台上管理你的组织、成员、角色和 Agent 服务。
          </p>
        </div>

        <div className="relative space-y-3.5">
          {[
            '组织与团队管理',
            '基于角色的权限控制',
            'Agent 发布与调用',
          ].map((text) => (
            <div key={text} className="flex items-center gap-3">
              <div className="w-1 h-1 rounded-full bg-[#2383e2]" />
              <span className="text-[13px] text-text-secondary">{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right: auth form */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-[380px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-10">
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-7 h-7 flex items-center justify-center"
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
            <span className="text-[14px] font-semibold text-text-primary">Synapse</span>
          </div>

          <div className="mb-7">
            <h1 className="text-[22px] font-semibold text-text-primary">
              {mode === 'login' ? '欢迎回来' : '创建账户'}
            </h1>
            <p className="text-[14px] text-text-secondary mt-1">
              {mode === 'login'
                ? '登录到你的工作空间'
                : '开始使用 Synapse'}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-3.5">
            {mode === 'register' && (
              <div className="space-y-1">
                <label className="block text-[12px] font-medium text-text-secondary">显示名称</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="你的名称"
                  className="w-full rounded-md border border-border-default bg-white px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-text-secondary">邮箱</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border border-border-default bg-white px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-[12px] font-medium text-text-secondary">密码</label>
                {mode === 'login' && (
                  <Link
                    to="/auth/password-reset"
                    className="text-[12px] text-accent hover:underline transition-colors"
                  >
                    忘记密码?
                  </Link>
                )}
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-md border border-border-default bg-white px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-text-secondary">验证码</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="6 位邮箱验证码"
                  className="flex-1 rounded-md border border-border-default bg-white px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all tracking-widest"
                />
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={codeButtonDisabled}
                  className="shrink-0 rounded-md border border-border-default bg-white px-3 py-2 text-[13px] font-medium text-text-primary hover:border-accent/40 hover:text-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                >
                  {codeButtonLabel}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-accent-red/15 bg-[#faecec] px-3 py-2">
                <p className="text-[13px] text-accent-red">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-md bg-accent text-white px-4 py-2 text-[14px] font-medium hover:bg-[#1b6ec2] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === 'login' ? '登录' : '创建账户'}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* OAuth 第三方登录 —— 当前仅 Google。点击直接 full-page 跳后端 /start,
              后端会签 state cookie 再 302 到 Google。完成后浏览器回到 /auth/oauth/callback。 */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border-default" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-2 text-[12px] text-text-muted">或</span>
            </div>
          </div>
          <a
            href={`/api/v1/auth/oauth/google/start?device_id=${encodeURIComponent(getDeviceId())}&device_name=${encodeURIComponent(getDeviceName())}`}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-border-default bg-white px-4 py-2 text-[14px] font-medium text-text-primary hover:border-accent/40 hover:text-accent transition-colors cursor-pointer"
          >
            <GoogleGlyph className="h-4 w-4" />
            使用 Google 账号{mode === 'login' ? '登录' : '注册'}
          </a>

          <div className="mt-6 text-center">
            <span className="text-[13px] text-text-muted">
              {mode === 'login' ? '还没有账户？' : '已有账户？'}
            </span>
            <button
              onClick={switchMode}
              className="ml-1.5 text-[13px] font-medium text-accent hover:underline transition-colors cursor-pointer"
            >
              {mode === 'login' ? '注册' : '登录'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
