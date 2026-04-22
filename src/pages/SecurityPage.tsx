import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { toast } from '@/components/ui/Toast';
import { authApi, userApi } from '@/api/user';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { resolveErrorMessage } from '@/lib/errors';
import { useAuthStore } from '@/store/auth';
import { useOrgStore } from '@/store/org';
import { Lock, Mail, Trash2, KeyRound, Send, AlertTriangle, ShieldAlert, Building2 } from 'lucide-react';
import type { OwnedOrgSummary } from '@/types/api';

// M3.7 注销 guard:用户仍是 active org 所有者时后端返回的业务码
const CODE_OWNER_OF_ACTIVE_ORGS = 409010011;

// 发码按钮冷却。与后端 60s per-email cooldown 对齐,略给 1s 宽容。
const CODE_COOLDOWN_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;

/**
 * /user/security 账号安全设置。
 *
 * 三张卡:改密 / 改邮箱 / 注销。三者成功后后端都 LogoutAll + 清 session,
 * 前端必须 logoutLocalOnly + 跳登录页,否则会陷入"本地有 token 但后端拒"的循环。
 */
export function SecurityPage() {
  const { user, logoutLocalOnly } = useAuthStore();
  const { clearOrg } = useOrgStore();
  const navigate = useNavigate();

  if (!user) return null;

  // 成功后统一的"强制退出"动作:清本地 auth + org + 跳登录
  const kickToLogin = (msg: string) => {
    toast('success', msg);
    logoutLocalOnly();
    clearOrg();
    // setTimeout 让 toast 有时间显示再跳转
    setTimeout(() => navigate('/auth', { replace: true }), 600);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="安全设置" subtitle="修改密码、更换邮箱或注销账号" />
      <ChangePasswordCard userEmail={user.email} onSuccess={kickToLogin} />
      <ChangeEmailCard currentEmail={user.email} onSuccess={kickToLogin} />
      <DeleteAccountCard onSuccess={kickToLogin} />
    </div>
  );
}

// ─── Change Password ───────────────────────────────────────────────────────

type PasswordMode = 'old_password' | 'email_code';

function ChangePasswordCard({ userEmail, onSuccess }: { userEmail: string; onSuccess: (msg: string) => void }) {
  const [mode, setMode] = useState<PasswordMode>('old_password');
  const [oldPassword, setOldPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [codeSending, setCodeSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
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

  // 给当前邮箱发 6 位验证码(OAuth-only 改密路径用)
  const sendCode = async () => {
    setError('');
    setCodeSending(true);
    const res = await apiCall(() => authApi.sendEmailCode({ email: userEmail }), { success: `验证码已发送到 ${userEmail}` });
    setCodeSending(false);
    if (res.ok) startCooldown();
  };

  const submit = async () => {
    setError('');
    if (newPassword.length < MIN_PASSWORD_LEN) {
      setError(`新密码至少 ${MIN_PASSWORD_LEN} 个字符`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (mode === 'old_password' && !oldPassword) {
      setError('请输入当前密码');
      return;
    }
    if (mode === 'email_code' && !code) {
      setError('请输入邮箱验证码');
      return;
    }

    setSubmitting(true);
    const body =
      mode === 'old_password'
        ? { old_password: oldPassword, new_password: newPassword }
        : { code, new_password: newPassword };
    const res = await apiCall(() => userApi.changePassword(body));
    setSubmitting(false);
    if (res.ok) onSuccess('密码已更新,请使用新密码重新登录');
  };

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-4">
        <Lock className="h-4 w-4 text-accent" />
        <h3 className="text-[14px] font-semibold text-text-primary">修改密码</h3>
      </div>

      {/* 验证方式切换。默认"当前密码";OAuth-only 账号没本地密码,切到"邮箱验证码"模式 */}
      <div className="flex items-center gap-1 mb-4 p-0.5 rounded-md bg-bg-secondary/60 w-fit">
        <button
          className={`px-2.5 py-1 text-[12px] rounded transition-colors ${
            mode === 'old_password' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
          }`}
          onClick={() => setMode('old_password')}
        >
          用当前密码验证
        </button>
        <button
          className={`px-2.5 py-1 text-[12px] rounded transition-colors ${
            mode === 'email_code' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
          }`}
          onClick={() => setMode('email_code')}
        >
          用邮箱验证码
        </button>
      </div>

      <div className="space-y-3">
        {mode === 'old_password' ? (
          <Input
            label="当前密码"
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="当前登录密码"
            autoComplete="current-password"
          />
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] text-text-muted">
              未设置过本地密码的 OAuth 账号请用此方式;验证码会发送到 <span className="font-mono text-text-primary">{userEmail}</span>
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="邮箱验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6 位验证码"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <Button
                variant="secondary"
                onClick={sendCode}
                loading={codeSending}
                disabled={codeSending || cooldown > 0}
                icon={cooldown > 0 ? undefined : <Send className="h-3 w-3" />}
              >
                {cooldown > 0 ? `${cooldown}s` : '发送'}
              </Button>
            </div>
          </div>
        )}

        <Input
          label="新密码"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={`至少 ${MIN_PASSWORD_LEN} 个字符`}
          autoComplete="new-password"
        />
        <Input
          label="确认新密码"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="再输一次"
          autoComplete="new-password"
        />

        {error && (
          <div className="rounded-md border border-accent-red/15 bg-[#faecec] px-3 py-2">
            <p className="text-[12px] text-accent-red">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={submit} loading={submitting} icon={<KeyRound className="h-3.5 w-3.5" />}>
            更新密码
          </Button>
          <p className="text-[11px] text-text-muted">成功后所有设备会被登出,需重新登录</p>
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Change Email ──────────────────────────────────────────────────────────

function ChangeEmailCard({ currentEmail, onSuccess }: { currentEmail: string; onSuccess: (msg: string) => void }) {
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [codeSending, setCodeSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
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

  // 给**新邮箱**发 6 位码(ChangeEmail 消费的是新邮箱的 code,证明对新邮箱的所有权)
  const sendCode = async () => {
    setError('');
    if (!EMAIL_RE.test(newEmail)) {
      setError('请填写正确的新邮箱');
      return;
    }
    if (newEmail === currentEmail) {
      setError('新邮箱不能与当前邮箱相同');
      return;
    }
    setCodeSending(true);
    const res = await apiCall(() => authApi.sendEmailCode({ email: newEmail }), { success: `验证码已发送到 ${newEmail}` });
    setCodeSending(false);
    if (res.ok) startCooldown();
  };

  const submit = async () => {
    setError('');
    if (!EMAIL_RE.test(newEmail)) {
      setError('请填写正确的新邮箱');
      return;
    }
    if (newEmail === currentEmail) {
      setError('新邮箱不能与当前邮箱相同');
      return;
    }
    if (!code) {
      setError('请先获取并输入邮箱验证码');
      return;
    }

    setSubmitting(true);
    // OAuth-only 账号 password 省略,后端会返 400010026 提示先绑本地密码
    const body = { new_email: newEmail, code, password: password || undefined };
    const res = await apiCall(() => userApi.changeEmail(body));
    setSubmitting(false);
    if (res.ok) onSuccess('邮箱已更新,请用新邮箱重新登录');
  };

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-4">
        <Mail className="h-4 w-4 text-accent" />
        <h3 className="text-[14px] font-semibold text-text-primary">修改邮箱</h3>
      </div>

      <p className="text-[12px] text-text-muted mb-4">
        当前邮箱:<span className="font-mono text-text-primary ml-1">{currentEmail}</span>
      </p>

      <div className="space-y-3">
        <Input
          label="新邮箱"
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new@example.com"
          autoComplete="email"
        />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="新邮箱验证码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 位验证码"
              inputMode="numeric"
              maxLength={6}
            />
          </div>
          <Button
            variant="secondary"
            onClick={sendCode}
            loading={codeSending}
            disabled={codeSending || cooldown > 0}
            icon={cooldown > 0 ? undefined : <Send className="h-3 w-3" />}
          >
            {cooldown > 0 ? `${cooldown}s` : '发送'}
          </Button>
        </div>
        <Input
          label="当前密码(OAuth 账号可留空)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="本地账号必填"
          autoComplete="current-password"
        />

        {error && (
          <div className="rounded-md border border-accent-red/15 bg-[#faecec] px-3 py-2">
            <p className="text-[12px] text-accent-red">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={submit} loading={submitting} icon={<Mail className="h-3.5 w-3.5" />}>
            更新邮箱
          </Button>
          <p className="text-[11px] text-text-muted">成功后需用新邮箱登录;旧邮箱会收到变更告警</p>
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Delete Account ────────────────────────────────────────────────────────

function DeleteAccountCard({ onSuccess }: { onSuccess: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // M3.7:后端识别出"你仍是某 active org 的 owner"时会带回 orgs 列表,
  // 前端据此阻断注销并引导去转让/解散。非 null 即表示被拦。
  const [blockedByOrgs, setBlockedByOrgs] = useState<OwnedOrgSummary[] | null>(null);

  const close = () => {
    setOpen(false);
    setPassword('');
    setReason('');
    setConfirmed(false);
    setError('');
    setBlockedByOrgs(null);
  };

  const submit = async () => {
    setError('');
    setBlockedByOrgs(null);
    if (!confirmed) {
      setError('请先勾选确认');
      return;
    }
    setSubmitting(true);
    const body = { password: password || undefined, reason: reason || undefined };
    try {
      // 直接调用而不走 apiCall:需要在业务码 = 409010011 时取出 result.orgs,
      // 而 apiCall 对任何非 200 业务码都统一 toast + 返 null,会丢掉 payload。
      const res = await userApi.deleteAccount(body);
      if (res.data.code === CODE_OWNER_OF_ACTIVE_ORGS) {
        const orgs = (res.data.result as { orgs?: OwnedOrgSummary[] } | undefined)?.orgs ?? [];
        setBlockedByOrgs(orgs);
        return;
      }
      if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
        setError(resolveErrorMessage(res.data));
        return;
      }
      close();
      onSuccess('账号已注销');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <Trash2 className="h-4 w-4 text-accent-red" />
          <h3 className="text-[14px] font-semibold text-text-primary">注销账号</h3>
        </div>
        <p className="text-[12px] text-text-muted mb-4 leading-relaxed">
          注销后账号进入已删除状态、PII 会被脱敏、所有登录设备立即登出,<span className="text-accent-red">不可恢复</span>。
          若你只是想暂时离开,可直接登出所有设备即可。
        </p>
        <Button variant="danger" onClick={() => setOpen(true)} icon={<Trash2 className="h-3.5 w-3.5" />}>
          注销账号
        </Button>
      </GlassCard>

      <Modal open={open} onClose={close} title="确认注销账号">
        <div className="space-y-3.5">
          <div className="flex gap-2 p-3 rounded-md bg-[#faecec] border border-accent-red/15">
            <AlertTriangle className="h-4 w-4 text-accent-red shrink-0 mt-0.5" />
            <div className="text-[12px] text-accent-red leading-relaxed">
              此操作不可逆。账号注销后邮箱会被 pseudo 化,原邮箱释放给他人注册,
              所有第三方登录绑定被解除,所有会话立即失效。
            </div>
          </div>

          {blockedByOrgs !== null && (
            <div className="p-3 rounded-md bg-accent-amber/8 border border-accent-amber/25 space-y-2">
              <div className="flex gap-2 items-start">
                <Building2 className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" />
                <div className="text-[12px] text-accent-amber leading-relaxed">
                  <p className="font-medium mb-1">你仍是以下组织的所有者,无法直接注销</p>
                  <p className="text-[11px] opacity-90">请先通过"转让所有权"把组织交给他人,或直接"解散组织",再回来注销账号。</p>
                </div>
              </div>
              <ul className="pl-6 space-y-1">
                {blockedByOrgs.map((o) => (
                  <li key={o.slug} className="flex items-center gap-2 text-[12px]">
                    <span className="font-medium text-text-primary">{o.display_name}</span>
                    <span className="text-text-muted font-mono text-[11px]">{o.slug}</span>
                  </li>
                ))}
                {blockedByOrgs.length === 0 && (
                  <li className="text-[11px] text-text-muted">(后端未返回具体 org,请到组织管理页检查)</li>
                )}
              </ul>
            </div>
          )}

          <Input
            label="当前密码(本地账号必填,OAuth 账号可留空)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="再输一次密码确认"
            autoComplete="current-password"
          />

          <div className="space-y-1">
            <label className="block text-[12px] font-medium text-text-secondary">注销原因(可选)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 64))}
              placeholder="帮助我们改进产品(最多 64 字)"
              className="w-full rounded-md border border-border-default bg-white px-3 py-1.5 text-[13px] text-text-primary shadow-sm placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/8 transition-all resize-none"
              rows={2}
            />
            <div className="text-[11px] text-text-muted text-right">{reason.length}/64</div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-[12px] text-text-secondary">
              我知道注销账号<span className="text-accent-red font-medium">不可恢复</span>,且所有本地数据、创建的组织、发布的 Agent 都会受影响
            </span>
          </label>

          {error && <p className="text-[12px] text-accent-red">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={close}>取消</Button>
            <Button
              variant="danger"
              onClick={submit}
              loading={submitting}
              disabled={!confirmed}
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
            >
              确认注销
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
