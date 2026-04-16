import type { AxiosError } from 'axios';
import type { BaseResponse } from '@/types/api';
import { resolveErrorMessage } from './errors';
import { toast } from '@/components/ui/Toast';

/**
 * 从 axios 错误中提取用户友好的中文错误提示。
 */
export function getErrorMessage(err: unknown): string {
  const axiosErr = err as AxiosError<BaseResponse>;
  return resolveErrorMessage(
    axiosErr.response?.data,
    axiosErr.response?.status,
  );
}

/**
 * 执行 API 调用，成功时 toast 提示，失败时 toast 中文错误。
 * 返回 result 或 null（失败时）。
 */
export async function apiCall<T>(
  fn: () => Promise<{ data: BaseResponse<T> }>,
  opts?: { success?: string },
): Promise<T | null> {
  try {
    const res = await fn();
    // 检查业务错误码（后端有些错误返回 HTTP 200 + 业务码）
    if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
      const msg = resolveErrorMessage(res.data, undefined);
      toast('error', msg);
      return null;
    }
    if (opts?.success) toast('success', opts.success);
    return res.data.result ?? null;
  } catch (err) {
    toast('error', getErrorMessage(err));
    return null;
  }
}
