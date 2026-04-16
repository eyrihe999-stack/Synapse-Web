import { useState, useCallback } from 'react';
import type { AxiosResponse, AxiosError } from 'axios';
import type { BaseResponse } from '@/types/api';

interface ApiState<T> {
  data: T | null;
  status: number | null;
  error: string | null;
  loading: boolean;
  raw: unknown;
}

export function useApi<T = unknown>() {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    status: null,
    error: null,
    loading: false,
    raw: null,
  });

  const execute = useCallback(async (fn: () => Promise<AxiosResponse<BaseResponse<T>>>) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fn();
      setState({
        data: res.data.result ?? null,
        status: res.status,
        error: res.data.error ?? null,
        loading: false,
        raw: res.data,
      });
      return res.data;
    } catch (err) {
      const axiosErr = err as AxiosError<BaseResponse>;
      const status = axiosErr.response?.status ?? 0;
      const message =
        axiosErr.response?.data?.error ??
        axiosErr.response?.data?.message ??
        axiosErr.message;
      setState({
        data: null,
        status,
        error: message,
        loading: false,
        raw: axiosErr.response?.data ?? { error: message },
      });
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ data: null, status: null, error: null, loading: false, raw: null });
  }, []);

  return { ...state, execute, reset };
}
