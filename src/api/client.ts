import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { BaseResponse } from '@/types/api';
import { useAuthStore } from '@/store/auth';
import { useOrgStore } from '@/store/org';

// 不设实例级 Content-Type：axios 会按 body 类型自动选 ——
// 普通对象自动 application/json，FormData 让浏览器生成带 boundary 的 multipart/form-data。
// 显式写死 application/json 会让 FormData 上传时 boundary 缺失，后端 400。
const client = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// Attach access token
client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Shared refresh-with-dedup logic, also used by fetch-based streaming
let refreshing: Promise<void> | null = null;

export async function ensureValidToken(): Promise<string | null> {
  const store = useAuthStore.getState();
  if (!store.refreshToken) {
    store.logoutLocalOnly();
    useOrgStore.getState().clearOrg();
    window.location.replace('/auth');
    return null;
  }

  if (!refreshing) {
    refreshing = store.refresh().finally(() => { refreshing = null; });
  }

  try {
    await refreshing;
    return useAuthStore.getState().accessToken;
  } catch {
    store.logoutLocalOnly();
    useOrgStore.getState().clearOrg();
    window.location.replace('/auth');
    return null;
  }
}

// Handle 401 → try refresh

client.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<BaseResponse>) => {
    const original = err.config;
    if (!original || err.response?.status !== 401) return Promise.reject(err);

    // Don't retry auth endpoints
    if (original.url?.includes('/auth/')) return Promise.reject(err);

    const newToken = await ensureValidToken();
    if (newToken) {
      original.headers.Authorization = `Bearer ${newToken}`;
      return client(original);
    }
    return Promise.reject(err);
  },
);

export default client;
