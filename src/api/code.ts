import type { AxiosResponse } from 'axios';
import client from './client';
import type { BaseResponse, CodeRepoListResponse } from '@/types/api';

/**
 * 代码知识库(code)模块 API 客户端。
 *
 * 当前端点仅提供"列 org 下已同步仓库的聚合视图"—— 给 GitLab 集成页展示同步结果用。
 * 真正的代码检索(search / ask agent)等后续端点会陆续加到此处。
 */
export const codeApi = {
  /**
   * 列 org 下所有已同步的代码仓库,带文件数 / chunk 数 / 失败数聚合。
   * 权限:org member 即可。GitLab 未连接时也能看(同事同步进来的 repo 对全 org 可见)。
   */
  listRepositories: (
    slug: string,
  ): Promise<AxiosResponse<BaseResponse<CodeRepoListResponse>>> =>
    client.get(`/v2/orgs/${slug}/code/repositories`),
};
