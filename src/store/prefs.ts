// prefs.ts 本地 UI 偏好(localStorage 持久化,跨 tab + 跨登录保留)。
//
// 区别于 auth.ts 的 sessionStorage(登出清零)—— 偏好是用户级别的习惯,
// 换浏览器也能手动同步过去,没必要跟 session 绑定。
//
// 目前只含 messageSendMode。未来添新的偏好时往这个 store 里加。
import { create } from 'zustand';

const STORAGE_KEY = 'synapse-prefs';

// 消息发送快捷键:
//   'enter'        Enter 发送 / Shift+Enter 换行(IM 习惯,多数聊天工具默认)
//   'mod-enter'    Cmd/Ctrl+Enter 发送 / Enter 换行(代码习惯,长消息友好)
//   'button-only'  Enter 总是换行,只能点按钮发
export type MessageSendMode = 'enter' | 'mod-enter' | 'button-only';

interface PrefsState {
  messageSendMode: MessageSendMode;
  setMessageSendMode: (mode: MessageSendMode) => void;
}

function load(): Pick<PrefsState, 'messageSendMode'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed?.messageSendMode === 'enter' ||
        parsed?.messageSendMode === 'mod-enter' ||
        parsed?.messageSendMode === 'button-only'
      ) {
        return { messageSendMode: parsed.messageSendMode };
      }
    }
  } catch {
    /* ignore */
  }
  // 默认 mod-enter —— 对 agent 对话长消息 / 多行内容更友好,不会误发
  return { messageSendMode: 'mod-enter' };
}

function save(state: Pick<PrefsState, 'messageSendMode'>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const initial = load();

export const usePrefsStore = create<PrefsState>()((set) => ({
  messageSendMode: initial.messageSendMode,
  setMessageSendMode: (mode) => {
    save({ messageSendMode: mode });
    set({ messageSendMode: mode });
  },
}));

// describeSendMode composer 旁边的提示文案,告诉用户当前快捷键。
export function describeSendMode(mode: MessageSendMode): string {
  switch (mode) {
    case 'enter':
      return 'Enter 发送 · Shift+Enter 换行';
    case 'mod-enter':
      return '⌘+Enter 发送 · Enter 换行';
    case 'button-only':
      return '仅按钮发送';
  }
}
