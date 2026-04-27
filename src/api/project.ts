// project.ts 项目 + 版本的 CRUD。对应后端 /api/v2/projects/*。
//
// 权限:org 成员都能 list / create / get;archive 需要 project creator / owner / admin
// (后端兜底,前端先都放出来,失败走 toast)。
import client from './client';
import type {
  BaseResponse,
  ProjectResponse,
  CreateProjectRequest,
  VersionResponse,
  CreateVersionRequest,
  ChannelResponse,
} from '@/types/api';

export const projectApi = {
  // 列出 org 下的所有 project(活的 + 归档的,status 前端自己过滤)
  list: (orgID: number) =>
    client.get<BaseResponse<ProjectResponse[]>>(`/v2/projects`, {
      params: { org_id: orgID },
    }),

  get: (id: number) =>
    client.get<BaseResponse<ProjectResponse>>(`/v2/projects/${id}`),

  create: (data: CreateProjectRequest) =>
    client.post<BaseResponse<ProjectResponse>>(`/v2/projects`, data),

  archive: (id: number) =>
    client.post<BaseResponse>(`/v2/projects/${id}/archive`),

  // 该 project 下的 channel 列表(任何 org 成员可见)
  listChannels: (id: number) =>
    client.get<BaseResponse<ChannelResponse[]>>(`/v2/projects/${id}/channels`),

  // ── Versions ──
  listVersions: (id: number) =>
    client.get<BaseResponse<VersionResponse[]>>(`/v2/projects/${id}/versions`),

  createVersion: (id: number, data: CreateVersionRequest) =>
    client.post<BaseResponse<VersionResponse>>(`/v2/projects/${id}/versions`, data),
};
