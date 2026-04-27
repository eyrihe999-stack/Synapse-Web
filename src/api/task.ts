// task.ts channel 内结构化任务的 CRUD + 生命周期操作。
//
// 路由:
//   POST /api/v2/tasks                        创建
//   GET  /api/v2/tasks/:id                    详情
//   POST /api/v2/tasks/:id/claim              认领(open → assigned → in_progress)
//   POST /api/v2/tasks/:id/submit             提交产物
//   POST /api/v2/tasks/:id/review             审批
//   POST /api/v2/tasks/:id/cancel             取消
//   GET  /api/v2/channels/:id/tasks           channel 的任务列表
//   GET  /api/v2/users/me/tasks               我作为 assignee 的任务
//
// 权限(后端兜底):
//   - create:channel 成员(非 observer)
//   - claim:task.assignee == 自己,或 assignee 是自己的 owner_user / agent
//   - submit:同 claim 权限
//   - review:task_reviewers 列表内的 principal
//   - cancel:task.creator 或 channel owner
import client from './client';
import type {
  BaseResponse,
  TaskResponse,
  TaskDetailResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  SubmitTaskRequest,
  SubmitTaskResponse,
  ReviewTaskRequest,
  ReviewTaskResponse,
} from '@/types/api';

export const taskApi = {
  // ── CRUD ──
  create: (data: CreateTaskRequest) =>
    client.post<BaseResponse<CreateTaskResponse>>(`/v2/tasks`, data),

  get: (id: number) =>
    client.get<BaseResponse<TaskDetailResponse>>(`/v2/tasks/${id}`),

  // ── 生命周期 ──
  claim: (id: number) =>
    client.post<BaseResponse<TaskResponse>>(`/v2/tasks/${id}/claim`),

  submit: (id: number, data: SubmitTaskRequest) =>
    client.post<BaseResponse<SubmitTaskResponse>>(`/v2/tasks/${id}/submit`, data),

  review: (id: number, data: ReviewTaskRequest) =>
    client.post<BaseResponse<ReviewTaskResponse>>(`/v2/tasks/${id}/review`, data),

  cancel: (id: number) =>
    client.post<BaseResponse<TaskResponse>>(`/v2/tasks/${id}/cancel`),

  // 变更 assignee:权限 creator / channel owner;非终态可改。
  // assigneePrincipalID=0 表示"清空"(任务回到 open 态等待认领)。
  updateAssignee: (id: number, assigneePrincipalID: number) =>
    client.patch<BaseResponse<TaskResponse>>(`/v2/tasks/${id}/assignee`, {
      assignee_principal_id: assigneePrincipalID,
    }),

  // 变更 reviewers + required_approvals:权限 creator / channel owner;
  // 只允许 open / in_progress 状态改(submitted 后不允许,避免打乱在飞审批)。
  updateReviewers: (
    id: number,
    reviewerPrincipalIDs: number[],
    requiredApprovals: number,
  ) =>
    client.patch<BaseResponse<{ task: TaskResponse; reviewers: number[] }>>(
      `/v2/tasks/${id}/reviewers`,
      {
        reviewer_principal_ids: reviewerPrincipalIDs,
        required_approvals: requiredApprovals,
      },
    ),

  // ── 列表 ──
  // 列某 channel 内全部 task;status='' 返回所有,否则按状态过滤
  listByChannel: (channelID: number, status = '', limit = 50, offset = 0) =>
    client.get<BaseResponse<TaskResponse[]>>(`/v2/channels/${channelID}/tasks`, {
      params: { status: status || undefined, limit, offset },
    }),

  // 当前用户作为 assignee 的任务(后端从 JWT 拿 user_id → 反查 principal_id)
  listMy: (status = '', limit = 50, offset = 0) =>
    client.get<BaseResponse<TaskResponse[]>>(`/v2/users/me/tasks`, {
      params: { status: status || undefined, limit, offset },
    }),
};
