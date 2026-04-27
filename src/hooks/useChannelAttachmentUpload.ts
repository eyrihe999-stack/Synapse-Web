// useChannelAttachmentUpload 频道附件上传 hook(图片粘贴 / 拖拽 / 选文件复用)。
//
// 用法:
//
//   const { uploadImage, uploading } = useChannelAttachmentUpload(channelId);
//   const onPaste = async (e: React.ClipboardEvent) => {
//     for (const item of e.clipboardData.items) {
//       if (!item.type.startsWith('image/')) continue;
//       const file = item.getAsFile();
//       if (!file) continue;
//       e.preventDefault();
//       const md = await uploadImage(file);
//       if (md) insertAtCursor(md);
//     }
//   };
//
// 流程:request_attachment_upload_url → fetch(PUT 字节直传 OSS) → commit_attachment_upload。
// 字节不经 server。失败 toast 报错,返 null;成功返 `![filename](url)` markdown 片段。
//
// MIME 白名单与后端一致(image/png|jpeg|gif|webp);非白名单直接拒。
import { useCallback, useState } from 'react';
import axios from 'axios';
import { channelApi } from '@/api/channel';
import { toast } from '@/components/ui/Toast';
import { getErrorMessage } from '@/lib/api-helpers';
import type { AttachmentMimeType } from '@/types/api';

const ALLOWED_MIME: AttachmentMimeType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function isAllowedMime(mime: string): mime is AttachmentMimeType {
  return (ALLOWED_MIME as string[]).includes(mime);
}

/** 后端 ChannelAttachmentMaxByteSize = 10 MB,前端先拒一次省一次 round-trip。 */
const MAX_BYTES = 10 * 1024 * 1024;

export interface UploadedAttachment {
  /** 直接可拷进 markdown 的相对 URL,如 /api/v2/channels/123/attachments/456 */
  url: string;
  /** 给 markdown alt 用的 filename(可空时退化为 'image') */
  filename: string;
  /** `![alt](url)` 拼好的 markdown 片段,粘贴场景直接 insert */
  markdown: string;
  /** dedup 命中时 true */
  reused: boolean;
}

export function useChannelAttachmentUpload(channelId: number) {
  // 计数语义:支持并发上传(用户连贴多张),只要还有 in-flight 就 uploading=true
  const [inFlight, setInFlight] = useState(0);

  const uploadImage = useCallback(
    async (file: File): Promise<UploadedAttachment | null> => {
      if (!isAllowedMime(file.type)) {
        toast('error', `不支持的图片格式:${file.type || '未知'}(仅支持 png/jpeg/gif/webp)`);
        return null;
      }
      if (file.size > MAX_BYTES) {
        toast('error', `图片过大(${(file.size / 1024 / 1024).toFixed(1)} MB),上限 10 MB`);
        return null;
      }
      // filename 兜底:剪贴板粘的截图通常是 "image.png" 或空,做个友好默认
      const filename = file.name && file.name !== 'image.png'
        ? file.name
        : `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.${extOf(file.type)}`;

      setInFlight((n) => n + 1);
      try {
        // 1. presign
        const presignRes = await channelApi.requestAttachmentUploadURL(channelId, {
          mime_type: file.type,
          filename,
        });
        if (presignRes.data.code && presignRes.data.code !== 200) {
          toast('error', presignRes.data.error || presignRes.data.message || 'presign 失败');
          return null;
        }
        const presign = presignRes.data.result;
        if (!presign) {
          toast('error', '上传地址生成失败');
          return null;
        }

        // 2. PUT 字节到 OSS。绕开 axios 默认拦截器(它会带 Authorization,
        // 而 OSS presign 已经在 query 里签名;多带 header 可能 SignatureDoesNotMatch)。
        // 用裸 axios + transformRequest=undefined 让 axios 不去 JSON 化 File。
        await axios.put(presign.upload_url, file, {
          headers: { 'Content-Type': presign.content_type },
          // 大图上传给 60s
          timeout: 60_000,
          // 防止全局默认 transformRequest 把 File 当对象 stringify
          transformRequest: [(d) => d],
        });

        // 3. commit
        const commitRes = await channelApi.commitAttachmentUpload(channelId, {
          commit_token: presign.commit_token,
        });
        if (commitRes.data.code && commitRes.data.code !== 200) {
          toast('error', commitRes.data.error || commitRes.data.message || 'commit 失败');
          return null;
        }
        const commit = commitRes.data.result;
        if (!commit) {
          toast('error', '附件提交失败');
          return null;
        }

        const alt = commit.attachment.filename || 'image';
        return {
          url: commit.attachment.url,
          filename: alt,
          markdown: `![${alt}](${commit.attachment.url})`,
          reused: commit.reused,
        };
      } catch (err) {
        toast('error', `图片上传失败:${getErrorMessage(err)}`);
        return null;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [channelId],
  );

  return {
    uploadImage,
    uploading: inFlight > 0,
  };
}

/** Extract files-from-clipboard helper:从粘贴/拖拽事件挑出图片 File 列表。 */
export function extractImageFiles(items: DataTransferItemList | FileList | null): File[] {
  if (!items) return [];
  const files: File[] = [];
  // DataTransferItemList(粘贴/拖拽)和 FileList(input[type=file])接口不一样
  if ('length' in items && (items as FileList)[0] instanceof File) {
    for (let i = 0; i < items.length; i++) {
      const f = (items as FileList).item(i);
      if (f && f.type.startsWith('image/')) files.push(f);
    }
    return files;
  }
  for (let i = 0; i < items.length; i++) {
    const it = (items as DataTransferItemList)[i];
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

function extOf(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}
