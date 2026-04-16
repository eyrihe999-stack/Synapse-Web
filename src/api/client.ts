import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { BaseResponse } from '@/types/api';
import { useAuthStore } from '@/store/auth';
import { useOrgStore } from '@/store/org';

const client = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token
client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 → try refresh
let refreshing: Promise<void> | null = null;

client.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<BaseResponse>) => {
    const original = err.config;
    if (!original || err.response?.status !== 401) return Promise.reject(err);

    // Don't retry auth endpoints
    if (original.url?.includes('/auth/')) return Promise.reject(err);

    const store = useAuthStore.getState();
    if (!store.refreshToken) {
      store.logout();
      useOrgStore.getState().clearOrg();
      window.location.replace('/auth');
      return Promise.reject(err);
    }

    if (!refreshing) {
      refreshing = store.refresh().finally(() => { refreshing = null; });
    }

    try {
      await refreshing;
      const newToken = useAuthStore.getState().accessToken;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return client(original);
      }
    } catch {
      store.logout();
      useOrgStore.getState().clearOrg();
      window.location.replace('/auth');
    }
    return Promise.reject(err);
  },
);

export default client;
