import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/api/user';
import { getErrorMessage } from '@/lib/api-helpers';
import { resolveErrorMessage } from '@/lib/errors';
import { Loader2, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react';

// 和后端一致:密码至少 8 位(service.go Register/ConfirmPasswordReset 都卡这个阈值)。
const MIN_PASSWORD_LEN = 8;

export function ResetPasswordConfirmPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // token 缺失直接拦在前端,省一次后端往返。后端本身也会返 400010014。
  useEffect(() => {
    if (!token) {
      setError('链接缺少 token 参数,请从邮件里重新打开');
    }
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('链接无效,请从邮件里重新打开');
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      setError(`密码至少 ${MIN_PASSWORD_LEN} 个字符`);
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.confirmPasswordReset({ token, new_password: password });
      if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
        setError(resolveErrorMessage(res.data));
        return;
      }
      setDone(true);
      // 不自动跳登录,让用户看到成功状态;下面按钮点击再跳。
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left: warm branding panel */}
      <div className="hidden lg:flex lg:w-[460px] xl:w-[520px] bg-[#f0efe9] flex-col justify-between p-12 relative overflow-hidden border-r border-[#e3e2dc]">
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
            设置新密码
          </p>
          <p className="text-[14px] text-text-muted leading-relaxed max-w-sm">
            重置成功后,所有已登录设备将被登出。请使用新密码重新登录。
          </p>
        </div>
      </div>

      {/* Right: form / done */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-[380px]">
          {!done && (
            <Link
              to="/auth"
              className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary transition-colors mb-8"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回登录
            </Link>
          )}

          {done ? (
            <DoneView onBack={() => navigate('/auth', { replace: true })} />
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-[22px] font-semibold text-text-primary">设置新密码</h1>
                <p className="text-[14px] text-text-secondary mt-1">
                  输入并确认你的新密码。
                </p>
              </div>

              <form onSubmit={submit} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="block text-[12px] font-medium text-text-secondary">新密码</label>
                  <input
                    type="password"
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少 8 个字符"
                    className="w-full rounded-md border border-border-default bg-white px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[12px] font-medium text-text-secondary">确认新密码</label>
                  <input
                    type="password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="再输一次"
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
                  disabled={loading || !token}
                  className="w-full flex items-center justify-center gap-2 rounded-md bg-accent text-white px-4 py-2 text-[14px] font-medium hover:bg-[#1b6ec2] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      设置新密码
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DoneView({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-accent/8 mb-6">
        <CheckCircle2 className="h-6 w-6 text-accent" />
      </div>
      <h1 className="text-[22px] font-semibold text-text-primary mb-2">密码已更新</h1>
      <p className="text-[14px] text-text-secondary leading-relaxed">
        所有设备已被登出,请使用新密码重新登录。
      </p>
      <button
        onClick={onBack}
        className="mt-6 w-full flex items-center justify-center gap-2 rounded-md bg-accent text-white px-4 py-2 text-[14px] font-medium hover:bg-[#1b6ec2] transition-colors cursor-pointer"
      >
        前往登录
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
