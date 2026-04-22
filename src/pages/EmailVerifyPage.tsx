import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/api/user';
import { getErrorMessage } from '@/lib/api-helpers';
import { resolveErrorMessage } from '@/lib/errors';
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft } from 'lucide-react';

/**
 * 邮箱激活落地页:用户点邮件链接跳到这里,URL 里的 token 自动提交。
 * 路径和后端 email.verification_link_base 拼接的 `{base}/auth/email/verify?token=...` 保持一致。
 *
 * 设计要点:
 *   - 挂载即发起一次 verify(用 StrictMode 避免 dev 下双跑消耗 token);成功/失败都只展示结果,不给重试按钮
 *     —— token 一次性消费,失败了就是失败了,让用户回登录页用 resend 或重新走流程
 *   - "已激活"和"token 无效"是两类不同状态,文案不同:前者提示可以去登录,后者提示链接问题
 */
export function EmailVerifyPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  // token 缺失直接在初始态定格为 invalid,避免 useEffect 里同步 setState 触发 cascading render 警告。
  const [state, setState] = useState<'loading' | 'done' | 'already' | 'invalid' | 'error'>(
    token ? 'loading' : 'invalid',
  );
  const [message, setMessage] = useState(token ? '' : '链接缺少 token 参数,请从邮件里重新打开');

  // StrictMode 下 useEffect 会 double-invoke,token 只能消费一次,用 ref 做幂等。
  const triggeredRef = useRef(false);

  useEffect(() => {
    if (!token) return; // 已在初始 state 处理过,不需要再走网络请求
    if (triggeredRef.current) return;
    triggeredRef.current = true;

    (async () => {
      try {
        const res = await authApi.verifyEmail({ token });
        const code = res.data.code;
        if (!code || code === 200 || code === 201) {
          setState('done');
          return;
        }
        // 已经激活过 → 前端软提示,不算错误
        if (code === 400010023) {
          setState('already');
          return;
        }
        // token 无效/过期
        if (code === 400010022) {
          setState('invalid');
          setMessage(resolveErrorMessage(res.data));
          return;
        }
        setState('error');
        setMessage(resolveErrorMessage(res.data));
      } catch (err) {
        setState('error');
        setMessage(getErrorMessage(err));
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex">
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
          <p className="text-[16px] text-text-secondary leading-relaxed mb-2">邮箱验证</p>
          <p className="text-[14px] text-text-muted leading-relaxed max-w-sm">
            验证完成后即可正常创建组织、发布 Agent、调用模型等操作。
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-[380px]">
          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary transition-colors mb-8"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回登录
          </Link>

          {state === 'loading' && (
            <div>
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-accent/8 mb-6">
                <Loader2 className="h-6 w-6 text-accent animate-spin" />
              </div>
              <h1 className="text-[22px] font-semibold text-text-primary mb-2">正在激活邮箱</h1>
              <p className="text-[14px] text-text-secondary">请稍候...</p>
            </div>
          )}

          {(state === 'done' || state === 'already') && (
            <div>
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-accent/8 mb-6">
                <CheckCircle2 className="h-6 w-6 text-accent" />
              </div>
              <h1 className="text-[22px] font-semibold text-text-primary mb-2">
                {state === 'done' ? '邮箱已激活' : '邮箱已验证过'}
              </h1>
              <p className="text-[14px] text-text-secondary leading-relaxed">
                {state === 'done'
                  ? '现在可以回到登录页继续使用 Synapse。'
                  : '该邮箱已完成验证,可以直接登录使用。'}
              </p>
              <button
                onClick={() => navigate('/auth', { replace: true })}
                className="mt-6 w-full flex items-center justify-center gap-2 rounded-md bg-accent text-white px-4 py-2 text-[14px] font-medium hover:bg-[#1b6ec2] transition-colors cursor-pointer"
              >
                前往登录
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {(state === 'invalid' || state === 'error') && (
            <div>
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-accent-red/10 mb-6">
                <AlertTriangle className="h-6 w-6 text-accent-red" />
              </div>
              <h1 className="text-[22px] font-semibold text-text-primary mb-2">
                {state === 'invalid' ? '链接已失效' : '激活失败'}
              </h1>
              <p className="text-[14px] text-text-secondary leading-relaxed">
                {message || '请重新从邮件中打开,或登录后在「个人资料」里重发激活邮件。'}
              </p>
              <button
                onClick={() => navigate('/auth', { replace: true })}
                className="mt-6 w-full flex items-center justify-center gap-2 rounded-md bg-accent text-white px-4 py-2 text-[14px] font-medium hover:bg-[#1b6ec2] transition-colors cursor-pointer"
              >
                前往登录
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
