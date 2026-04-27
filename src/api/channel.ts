// channel.ts channel / 消息 / 成员 / KB 引用 四类 API。
//
// 后端路由前缀 /api/v2/channels/*(create 在 /api/v2/channels,get 在 /:id)。
// 消息发送 / 列表:POST / GET /:id/messages。
// 消息中的 @mention 需要前端在 POST 时显式填 mentions: number[](principal_id)。
//
// 权限(后端兜底):
//   - create:project 所属 org 的成员
//   - get / list / messages.read / kb-refs.read:channel 成员
//   - post message / add kb ref / manage members:owner / member 角色(observer 不行)
//   - archive:owner
import client from './client';
import type {
  BaseResponse,
  ChannelResponse,
  CreateChannelRequest,
  ChannelMemberResponse,
  AddChannelMemberRequest,
  UpdateChannelMemberRoleRequest,
  ChannelMessageResponse,
  ListMessagesResponse,
  PostMessageRequest,
  ChannelKBRefResponse,
  AddKBRefRequest,
  VersionResponse,
  ChannelDocumentResponse,
  ChannelDocumentVersionResponse,
  ChannelDocumentContentResponse,
  SaveChannelDocumentVersionResponse,
  LockOperationResponse,
  CreateChannelDocumentRequest,
  SaveChannelDocumentVersionRequest,
  RequestChannelAttachmentUploadURLRequest,
  ChannelAttachmentUploadURLResponse,
  CommitChannelAttachmentUploadRequest,
  CommitChannelAttachmentUploadResponse,
} from '@/types/api';

export const channelApi = {
  // ── Channel CRUD ──
  create: (data: CreateChannelRequest) =>
    client.post<BaseResponse<ChannelResponse>>(`/v2/channels`, data),

  get: (id: number) =>
    client.get<BaseResponse<ChannelResponse>>(`/v2/channels/${id}`),

  archive: (id: number) =>
    client.post<BaseResponse>(`/v2/channels/${id}/archive`),

  // ── Members ──
  listMembers: (id: number) =>
    client.get<BaseResponse<ChannelMemberResponse[]>>(`/v2/channels/${id}/members`),

  addMember: (id: number, data: AddChannelMemberRequest) =>
    client.post<BaseResponse<ChannelMemberResponse>>(`/v2/channels/${id}/members`, data),

  removeMember: (id: number, principalID: number) =>
    client.delete<BaseResponse>(`/v2/channels/${id}/members/${principalID}`),

  updateMemberRole: (id: number, principalID: number, data: UpdateChannelMemberRoleRequest) =>
    client.patch<BaseResponse<ChannelMemberResponse>>(`/v2/channels/${id}/members/${principalID}/role`, data),

  // ── Messages ──
  // beforeID=0 / undefined => 从最新开始;limit 默认 50 上限 100
  listMessages: (id: number, beforeID?: number, limit = 50) =>
    client.get<BaseResponse<ListMessagesResponse>>(`/v2/channels/${id}/messages`, {
      params: { before_id: beforeID || undefined, limit },
    }),

  postMessage: (id: number, data: PostMessageRequest) =>
    client.post<BaseResponse<ChannelMessageResponse>>(`/v2/channels/${id}/messages`, data),

  // ── Reactions(PR #12')── emoji 走 path param,多字节字符 URL 编码
  addReaction: (messageID: number, emoji: string) =>
    client.post<BaseResponse>(`/v2/messages/${messageID}/reactions`, { emoji }),
  removeReaction: (messageID: number, emoji: string) =>
    client.delete<BaseResponse>(`/v2/messages/${messageID}/reactions/${encodeURIComponent(emoji)}`),

  // ── KB Refs ──
  listKBRefs: (id: number) =>
    client.get<BaseResponse<ChannelKBRefResponse[]>>(`/v2/channels/${id}/kb-refs`),

  addKBRef: (id: number, data: AddKBRefRequest) =>
    client.post<BaseResponse<ChannelKBRefResponse>>(`/v2/channels/${id}/kb-refs`, data),

  removeKBRef: (id: number, refID: number) =>
    client.delete<BaseResponse>(`/v2/channels/${id}/kb-refs/${refID}`),

  // ── Versions(关联 project version)──
  listVersions: (id: number) =>
    client.get<BaseResponse<VersionResponse[]>>(`/v2/channels/${id}/versions`),

  attachVersion: (id: number, versionID: number) =>
    client.post<BaseResponse>(`/v2/channels/${id}/versions/${versionID}`),

  detachVersion: (id: number, versionID: number) =>
    client.delete<BaseResponse>(`/v2/channels/${id}/versions/${versionID}`),

  // ── Shared Documents(PR #9') ── 共享文档 + 独占编辑锁 + 版本历史
  createDocument: (channelID: number, data: CreateChannelDocumentRequest) =>
    client.post<BaseResponse<ChannelDocumentResponse>>(`/v2/channels/${channelID}/documents`, data),

  listDocuments: (channelID: number) =>
    client.get<BaseResponse<ChannelDocumentResponse[]>>(`/v2/channels/${channelID}/documents`),

  getDocument: (channelID: number, docID: number) =>
    client.get<BaseResponse<ChannelDocumentResponse>>(`/v2/channels/${channelID}/documents/${docID}`),

  getDocumentContent: (channelID: number, docID: number) =>
    client.get<BaseResponse<ChannelDocumentContentResponse>>(`/v2/channels/${channelID}/documents/${docID}/content`),

  deleteDocument: (channelID: number, docID: number) =>
    client.delete<BaseResponse>(`/v2/channels/${channelID}/documents/${docID}`),

  // 抢锁:成功 acquired=true;别人持着 acquired=false(后端返 200 + 当前持锁人,前端按 acquired 分支)
  acquireDocumentLock: (channelID: number, docID: number) =>
    client.post<BaseResponse<LockOperationResponse>>(`/v2/channels/${channelID}/documents/${docID}/lock`),

  // 心跳续锁:每 60s 调一次,失败说明锁已被强制释放或被别人抢
  heartbeatDocumentLock: (channelID: number, docID: number) =>
    client.post<BaseResponse<LockOperationResponse>>(`/v2/channels/${channelID}/documents/${docID}/lock/heartbeat`),

  // 主动释放;非持锁人调用幂等无副作用
  releaseDocumentLock: (channelID: number, docID: number) =>
    client.delete<BaseResponse>(`/v2/channels/${channelID}/documents/${docID}/lock`),

  // 强制解锁:owner 任何时候可;普通成员仅在锁过期后可
  forceReleaseDocumentLock: (channelID: number, docID: number) =>
    client.post<BaseResponse>(`/v2/channels/${channelID}/documents/${docID}/lock/force`),

  // 保存新版:必须持有未过期锁;同 hash 重复保存 created=false 幂等
  saveDocumentVersion: (channelID: number, docID: number, data: SaveChannelDocumentVersionRequest) =>
    client.post<BaseResponse<SaveChannelDocumentVersionResponse>>(`/v2/channels/${channelID}/documents/${docID}/versions`, data),

  listDocumentVersions: (channelID: number, docID: number) =>
    client.get<BaseResponse<ChannelDocumentVersionResponse[]>>(`/v2/channels/${channelID}/documents/${docID}/versions`),

  getDocumentVersionContent: (channelID: number, docID: number, versionID: number) =>
    client.get<BaseResponse<ChannelDocumentContentResponse>>(`/v2/channels/${channelID}/documents/${docID}/versions/${versionID}/content`),

  // ── Attachments(图片等,Markdown 内嵌)──
  // 链路:requestAttachmentUploadURL → fetch(PUT presign url) → commitAttachmentUpload。
  // 字节不经 server,直接 PUT 到 OSS;commit 时 server HEAD/算 sha256/写表 + dedup。
  // 拿到的 attachment.url 是相对路径,直接拷进 markdown:`![alt](/api/v2/channels/x/attachments/y)`。
  requestAttachmentUploadURL: (channelID: number, data: RequestChannelAttachmentUploadURLRequest) =>
    client.post<BaseResponse<ChannelAttachmentUploadURLResponse>>(`/v2/channels/${channelID}/attachments/upload-url`, data),

  commitAttachmentUpload: (channelID: number, data: CommitChannelAttachmentUploadRequest) =>
    client.post<BaseResponse<CommitChannelAttachmentUploadResponse>>(`/v2/channels/${channelID}/attachments/upload-commit`, data),
};
