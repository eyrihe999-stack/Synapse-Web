// channel-doc-draft.ts 共享文档(PR #9')编辑草稿的本地缓存。
//
// 用途:用户在编辑文档时,localStorage 节流写当前内容;意外刷新 / 关闭 / 切换页面
// 后回来,baseVersion 仍匹配则自动恢复 + toast 提示。
//
// 边界:
//   - 同一 (docId, userId) 一份草稿;多 tab 编辑后写覆盖前写
//   - 服务器有新版(baseVersion 不匹配)→ 草稿丢弃,不悄悄覆盖别人改动
//   - localStorage 容量满 / 隐私模式禁用 → setItem 抛错,捕获后静默 + 控制台 warn
//
// 不做:
//   - 跨设备同步(本来就是 best-effort 草稿)
//   - 加密(用户自己电脑,不存敏感数据)

const KEY_PREFIX = 'cdoc-draft:';

export interface DraftPayload {
  baseVersion: string; // 草稿基于的 doc.current_version(空字符串 = 空文档基线)
  content: string;
  updatedAt: number; // ms epoch
}

function key(docId: number, userId: number): string {
  return `${KEY_PREFIX}${docId}:${userId}`;
}

/** 写草稿;失败静默(localStorage 满 / 隐私模式)。 */
export function saveDraft(docId: number, userId: number, payload: DraftPayload): void {
  if (!docId || !userId) return;
  try {
    localStorage.setItem(key(docId, userId), JSON.stringify(payload));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[channel-doc-draft] save failed:', err);
  }
}

/** 读草稿;不存在或解析失败返 null。 */
export function loadDraft(docId: number, userId: number): DraftPayload | null {
  if (!docId || !userId) return null;
  try {
    const raw = localStorage.getItem(key(docId, userId));
    if (!raw) return null;
    const obj = JSON.parse(raw) as DraftPayload;
    if (typeof obj.content !== 'string' || typeof obj.baseVersion !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}

/** 清草稿(保存成功 / 释放锁 / 版本不匹配丢弃 时调)。 */
export function clearDraft(docId: number, userId: number): void {
  if (!docId || !userId) return;
  try {
    localStorage.removeItem(key(docId, userId));
  } catch {
    // 静默
  }
}
