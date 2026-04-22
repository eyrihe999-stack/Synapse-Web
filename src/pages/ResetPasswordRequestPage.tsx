import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '@/api/user';
import { getErrorMessage } from '@/lib/api-helpers';
import { resolveErrorMessage } from '@/lib/errors';
import { Loader2, ArrowRight, ArrowLeft, MailCheck } from 'lucide-react';

// 邮箱格式正则,只做粗过滤,严格校验后端做。
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ResetPasswordRequestPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 提交成功后不跳页,直接换成"邮件已发送"的确认视图 —— 防枚举的核心:
  // 不论邮箱是否存在后端都返成功,前端也必须展现一致的成功态。
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!EMAIL_RE.test(email)) {
      setError('请填写正确的邮箱');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.requestPasswordReset({ email });
      if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
        setError(resolveErrorMessage(res.data));
        return;
      }
      setSent(true);
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
            重置你的账户密码
          </p>
          <p className="text-[14px] text-text-muted leading-relaxed max-w-sm">
            我们将发送一条含一次性链接的邮件,点击即可设置新密码。
          </p>
        </div>
        <div className="relative space-y-3.5">
          {['一次性重置链接', '15 分钟内有效', '成功后所有设备将登出'].map((text) => (
            <div key={text} className="flex items-center gap-3">
              <div className="w-1 h-1 rounded-full bg-[#2383e2]" />
              <span className="text-[13px] text-text-secondary">{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right: form / confirmation */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-[380px]">
          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary transition-colors mb-8"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回登录
          </Link>

          {sent ? (
            <ConfirmationView email={email} />
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-[22px] font-semibold text-text-primary">忘记密码</h1>
                <p className="text-[14px] text-text-secondary mt-1">
                  输入你的邮箱,我们会发一封重置链接给你。
                </p>
              </div>

              <form onSubmit={submit} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="block text-[12px] font-medium text-text-secondary">邮箱</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
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
                      发送重置链接
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

function ConfirmationView({ email }: { email: string }) {
  return (
    <div>
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-accent/8 mb-6">
        <MailCheck className="h-6 w-6 text-accent" />
      </div>
      <h1 className="text-[22px] font-semibold text-text-primary mb-2">检查你的邮箱</h1>
      <p className="text-[14px] text-text-secondary leading-relaxed">
        若 <span className="font-medium text-text-primary">{email}</span> 对应一个有效账户,
        我们已向其发送了密码重置链接。
      </p>
      <p className="text-[13px] text-text-muted leading-relaxed mt-3">
        链接有效期 15 分钟。没收到邮件?检查垃圾邮件,或稍后重试。
      </p>
    </div>
  );
}
