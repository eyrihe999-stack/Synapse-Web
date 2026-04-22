import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/api/user';
import { useAuthStore } from '@/store/auth';
import { getErrorMessage } from '@/lib/api-helpers';
import { resolveErrorMessage } from '@/lib/errors';
import { PENDING_INVITE_TOKEN_KEY } from '@/pages/InvitePage';
import { Loader2, ArrowLeft, AlertTriangle } from 'lucide-react';

// OAUTH_ERROR_MESSAGES 把后端 callback 302 带的 ?error={reason} 转成中文。
// 后端 handler/oauth_login_handler.go:redirectOAuthError 里会写这些 reason。
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  state_invalid: '登录状态已过期,请重新登录',
  email_unverified: '第三方账号邮箱未验证,无法自动合并到已有账号,请用密码登录后再绑定',
  provider_disabled: '该登录方式暂未启用',
  exchange_failed: '向 Google 换取 token 失败,请重试',
  login_failed: '登录处理失败,请稍后重试',
  missing_code: '回调缺少 code 参数',
  access_denied: '已取消 Google 授权',
  internal: '服务器内部错误,请稍后重试',
};

/**
 * OAuthCallbackPage 第三方登录回调中转页。
 *
 * URL 形态(由后端 302 过来):
 *   - 成功: /auth/oauth/callback?exchange={一次性码}
 *   - 失败: /auth/oauth/callback?error={原因}
 *
 * 页面 mount 时只做一件事:如果有 exchange 则 POST 兑换 tokens,成功后 setAuth + 跳首页。
 * StrictMode 下 effect 会双跑 —— 用 ref 守卫,避免 exchange code 被消费两次直接失败。
 */
export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  // URL 里带的错误同步从 query 派生,不进 state。只有 async 兑换失败才 setState。
  const urlError = useMemo(() => {
    const errParam = searchParams.get('error');
    if (errParam) return OAUTH_ERROR_MESSAGES[errParam] || `登录失败: ${errParam}`;
    if (!searchParams.get('exchange')) return '回调缺少必要参数';
    return '';
  }, [searchParams]);
  const [asyncError, setAsyncError] = useState('');
  const error = urlError || asyncError;
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (urlError) return;
    const code = searchParams.get('exchange');
    if (!code) return;
    if (exchangedRef.current) return;
    exchangedRef.current = true;

    (async () => {
      try {
        const res = await authApi.oauthExchange({ code });
        if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
          setAsyncError(resolveErrorMessage(res.data));
          return;
        }
        const data = res.data.result!;
        setAuth(data.access_token, data.refresh_token, data.user);
        // 和 AuthPage 一致:如果用户是从邀请落地页被引导来登录的,登录完成后回跳。
        const pendingInvite = localStorage.getItem(PENDING_INVITE_TOKEN_KEY);
        if (pendingInvite) {
          navigate(`/invite?token=${encodeURIComponent(pendingInvite)}`, { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      } catch (err) {
        setAsyncError(getErrorMessage(err));
      }
    })();
  }, [searchParams, setAuth, navigate, urlError]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-8">
      <div className="w-full max-w-[380px] text-center">
        {error ? (
          <>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-accent-red/10 mx-auto mb-6">
              <AlertTriangle className="h-6 w-6 text-accent-red" />
            </div>
            <h1 className="text-[22px] font-semibold text-text-primary mb-2">登录未完成</h1>
            <p className="text-[14px] text-text-secondary leading-relaxed mb-6">{error}</p>
            <Link
              to="/auth"
              className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回登录
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-accent mx-auto mb-4" />
            <p className="text-[14px] text-text-secondary">正在完成登录...</p>
          </>
        )}
      </div>
    </div>
  );
}
