import client from './client';
import type { BaseResponse, AsyncJobResponse } from '@/types/api';

export const asyncJobApi = {
  // id 是后端 snowflake uint64 字符串(见 types/api.ts 注释)。
  get: (id: string) =>
    client.get<BaseResponse<AsyncJobResponse>>(`/v2/async-jobs/${id}`),
};
