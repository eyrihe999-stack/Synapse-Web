// project.ts pm 模块 HTTP 客户端 —— project / version / initiative / workstream / kb-ref / roadmap。
//
// 路由清单见 Synapse repo `docs/e2e-test-cases-pm.md` 附录 A。
// 权限校验全在后端 service 层(IsMember 等),前端不做预判,失败统一走 apiCall toast。
import client from './client';
import type {
  BaseResponse,
  ProjectResponse,
  CreateProjectRequest,
  VersionResponse,
  CreateVersionRequest,
  UpdateVersionRequest,
  InitiativeResponse,
  CreateInitiativeRequest,
  UpdateInitiativeRequest,
  WorkstreamResponse,
  CreateWorkstreamRequest,
  UpdateWorkstreamRequest,
  ProjectKBRefResponse,
  AttachProjectKBRefRequest,
  ProjectRoadmapResponse,
  ChannelResponse,
} from '@/types/api';

export const projectApi = {
  // ── Project ──
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

  // 该 project 下的 channel 列表(任何 org 成员可见;后端返回时已带 kind 字段)
  listChannels: (id: number) =>
    client.get<BaseResponse<ChannelResponse[]>>(`/v2/projects/${id}/channels`),

  // ── Version ──
  listVersions: (id: number) =>
    client.get<BaseResponse<VersionResponse[]>>(`/v2/projects/${id}/versions`),

  createVersion: (id: number, data: CreateVersionRequest) =>
    client.post<BaseResponse<VersionResponse>>(`/v2/projects/${id}/versions`, data),

  getVersion: (versionID: number) =>
    client.get<BaseResponse<VersionResponse>>(`/v2/versions/${versionID}`),

  updateVersion: (versionID: number, data: UpdateVersionRequest) =>
    client.patch<BaseResponse<VersionResponse>>(`/v2/versions/${versionID}`, data),

  listWorkstreamsByVersion: (versionID: number) =>
    client.get<BaseResponse<WorkstreamResponse[]>>(`/v2/versions/${versionID}/workstreams`),

  // ── Initiative ──
  listInitiatives: (projectID: number) =>
    client.get<BaseResponse<InitiativeResponse[]>>(`/v2/projects/${projectID}/initiatives`),

  createInitiative: (projectID: number, data: CreateInitiativeRequest) =>
    client.post<BaseResponse<InitiativeResponse>>(`/v2/projects/${projectID}/initiatives`, data),

  getInitiative: (initiativeID: number) =>
    client.get<BaseResponse<InitiativeResponse>>(`/v2/initiatives/${initiativeID}`),

  updateInitiative: (initiativeID: number, data: UpdateInitiativeRequest) =>
    client.patch<BaseResponse<InitiativeResponse>>(`/v2/initiatives/${initiativeID}`, data),

  archiveInitiative: (initiativeID: number) =>
    client.post<BaseResponse>(`/v2/initiatives/${initiativeID}/archive`),

  listWorkstreamsByInitiative: (initiativeID: number) =>
    client.get<BaseResponse<WorkstreamResponse[]>>(`/v2/initiatives/${initiativeID}/workstreams`),

  createWorkstreamInInitiative: (initiativeID: number, data: CreateWorkstreamRequest) =>
    client.post<BaseResponse<WorkstreamResponse>>(
      `/v2/initiatives/${initiativeID}/workstreams`,
      data,
    ),

  // ── Workstream(by-project / get / patch) ──
  listWorkstreamsByProject: (projectID: number) =>
    client.get<BaseResponse<WorkstreamResponse[]>>(`/v2/projects/${projectID}/workstreams`),

  getWorkstream: (workstreamID: number) =>
    client.get<BaseResponse<WorkstreamResponse>>(`/v2/workstreams/${workstreamID}`),

  updateWorkstream: (workstreamID: number, data: UpdateWorkstreamRequest) =>
    client.patch<BaseResponse<WorkstreamResponse>>(`/v2/workstreams/${workstreamID}`, data),

  // ── Project KB Ref ──
  listKBRefs: (projectID: number) =>
    client.get<BaseResponse<ProjectKBRefResponse[]>>(`/v2/projects/${projectID}/kb-refs`),

  attachKBRef: (projectID: number, data: AttachProjectKBRefRequest) =>
    client.post<BaseResponse<ProjectKBRefResponse>>(`/v2/projects/${projectID}/kb-refs`, data),

  detachKBRef: (refID: number) =>
    client.delete<BaseResponse>(`/v2/project-kb-refs/${refID}`),

  // ── Roadmap 聚合视图 ──
  getRoadmap: (projectID: number) =>
    client.get<BaseResponse<ProjectRoadmapResponse>>(`/v2/projects/${projectID}/roadmap`),
};
