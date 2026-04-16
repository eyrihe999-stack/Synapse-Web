import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { authApi } from '@/api/user';
import { getDeviceId, getDeviceName } from '@/lib/device';
import { getErrorMessage } from '@/lib/api-helpers';
import { resolveErrorMessage } from '@/lib/errors';
import { Loader2, ArrowRight } from 'lucide-react';

type Mode = 'login' | 'register';

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const deviceId = getDeviceId();
      const deviceName = getDeviceName();
      const res = mode === 'login'
        ? await authApi.login({ email, password, device_id: deviceId, device_name: deviceName })
        : await authApi.register({ email, password, display_name: displayName || undefined, device_id: deviceId, device_name: deviceName });

      // 检查业务错误码（后端部分错误返回 HTTP 200 + 业务码）
      if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
        setError(resolveErrorMessage(res.data));
        return;
      }
      const data = res.data.result!;
      setAuth(data.access_token, data.refresh_token, data.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
  };

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
              <label className="block text-[12px] font-medium text-text-secondary">密码</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-md border border-border-default bg-white px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all"
              />
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
