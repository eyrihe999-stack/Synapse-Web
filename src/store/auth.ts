import { create } from 'zustand';
import type { UserProfile } from '@/types/api';
import { authApi, userApi } from '@/api/user';
import { getDeviceId, getDeviceName } from '@/lib/device';

const STORAGE_KEY = 'synapse-auth';

interface PersistedAuth {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
}

function loadFromSession(): PersistedAuth {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { accessToken: null, refreshToken: null, user: null };
}

function saveToSession(state: PersistedAuth) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  refreshToken: string | null;

  setAuth: (token: string, refresh: string, user: UserProfile) => void;
  // logout 用户主动退出:先调后端吊销 session,再清本地。async。
  logout: () => Promise<void>;
  // logoutLocalOnly token 已失效场景(axios 401 自动登出)的纯本地清理。
  // 不调后端:token 已无效,调也调不动,还会触发拦截器死循环。
  logoutLocalOnly: () => void;
  refresh: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  isLoggedIn: () => boolean;
}

const initial = loadFromSession();

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: initial.user,
  accessToken: initial.accessToken,
  refreshToken: initial.refreshToken,

  setAuth: (accessToken, refreshToken, user) => {
    set({ accessToken, refreshToken, user });
    saveToSession({ accessToken, refreshToken, user });
  },

  logout: async () => {
    // 先调后端吊销 session(带着仍有效的 token),再清本地。
    // 顺序关键:反过来的话 token 已清,axios 拦截器发不出有效请求。
    const deviceId = getDeviceId();
    const hasToken = !!get().accessToken;
    if (deviceId && hasToken) {
      try {
        await userApi.kickSession(deviceId);
      } catch {
        // 后端抖动/超时/401 都不阻塞本地清理 —— 登出按钮必须响应。
      }
    }
    set({ user: null, accessToken: null, refreshToken: null });
    clearSession();
  },

  logoutLocalOnly: () => {
    set({ user: null, accessToken: null, refreshToken: null });
    clearSession();
  },

  refresh: async () => {
    const rt = get().refreshToken;
    if (!rt) throw new Error('No refresh token');
    const res = await authApi.refresh({
      refresh_token: rt,
      device_id: getDeviceId(),
      device_name: getDeviceName(),
    });
    const data = res.data.result!;
    const state = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user,
    };
    set(state);
    saveToSession(state);
  },

  fetchProfile: async () => {
    const res = await userApi.getMe();
    const user = res.data.result!;
    set({ user });
    saveToSession({
      accessToken: get().accessToken,
      refreshToken: get().refreshToken,
      user,
    });
  },

  isLoggedIn: () => !!get().accessToken,
}));
