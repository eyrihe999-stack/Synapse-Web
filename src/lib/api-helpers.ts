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

// 历史上 apiCall 返回 `T | null`,成功时返 `res.data.result`,失败时返 null。
// 坑:后端大量 DELETE/POST 成功响应没有 result 字段(如 documents delete, kickSession,
// logoutAll, changePassword 等),导致 `res.data.result` 是 undefined,`?? null` 后
// 和"失败"的返回值无法区分,调用方的 `if (ok !== null)` / `if (ok)` 永远为 false ——
// 表现为"操作成功但后续副作用(刷新列表 / 跳转页面)不执行",也就是用户反馈的
// "点击按钮后没反应 / 需要再点一次 / 不自动刷新"。
//
// 改为 tagged union:`{ ok: true; data?: T }` vs `{ ok: false }`,成功路径明确,
// 即使没有 result payload 也能被调用方识别为成功。
export type ApiResult<T> = { ok: true; data: T | undefined } | { ok: false };

/**
 * 执行 API 调用,成功时 toast 提示、失败时 toast 中文错误。
 * 返回 tagged union — 调用方用 `if (res.ok)` 判断是否执行副作用。
 */
export async function apiCall<T = unknown>(
  fn: () => Promise<{ data: BaseResponse<T> }>,
  opts?: { success?: string },
): Promise<ApiResult<T>> {
  try {
    const res = await fn();
    // 业务错误码(后端部分错误返 HTTP 200 + 业务码),走失败分支
    if (res.data.code && res.data.code !== 200 && res.data.code !== 201) {
      const msg = resolveErrorMessage(res.data, undefined);
      toast('error', msg);
      return { ok: false };
    }
    if (opts?.success) toast('success', opts.success);
    return { ok: true, data: res.data.result };
  } catch (err) {
    toast('error', getErrorMessage(err));
    return { ok: false };
  }
}
