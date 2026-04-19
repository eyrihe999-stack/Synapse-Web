import type { AxiosResponse } from 'axios';
import client from './client';
import type { AsyncJobResponse, AsyncJobStatus, BaseResponse } from '@/types/api';

/**
 * 通用长任务 API。触发端点按业务域各自挂(如 integrationApi.feishuSync),
 * 查询端点是通用的 —— 所有 kind 共用 /api/v2/async-jobs/:id。
 *
 * 前端用法惯例:
 *   1. 触发: const { job_id } = await feishuSync(slug)
 *   2. 轮询: 每 1-2s 调 asyncJobApi.get(job_id),直到 status 进入终态
 *   3. 终态后读 result.synced / result.failed 展示结果,停止轮询
 */
export const asyncJobApi = {
  /**
   * 取任务最新快照。
   * 404 → 任务不存在或不属于当前用户(后端合并这两种情况防存在性泄漏)。
   */
  get: (
    jobId: number,
  ): Promise<AxiosResponse<BaseResponse<AsyncJobResponse>>> =>
    client.get(`/v2/async-jobs/${jobId}`),

  /**
   * 列出当前用户某 kind 的最近 limit 条任务(按创建顺序倒序)。
   * 后端 limit 默认 10,上限 50;超限 clamp。
   * 用途:前端"同步历史"视图。
   */
  list: (
    kind: string,
    limit = 10,
  ): Promise<AxiosResponse<BaseResponse<{ jobs: AsyncJobResponse[] }>>> =>
    client.get('/v2/async-jobs', { params: { kind, limit } }),
};

/**
 * 判断任务状态是否为终态。终态 = 前端停止轮询。
 */
export function isTerminalStatus(s: AsyncJobStatus): boolean {
  return s === 'succeeded' || s === 'failed' || s === 'canceled';
}

/** 后端 asyncjob Kind 常量,和 internal/asyncjob/model/models.go 对齐。 */
export const AsyncJobKinds = {
  FeishuSync: 'integration.sync.feishu',
  GitLabSync: 'integration.sync.gitlab',
} as const;
