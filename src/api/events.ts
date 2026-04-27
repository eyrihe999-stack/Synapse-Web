// events.ts 浏览器侧 SSE 客户端 + 全局 channel.activity 订阅。
//
// 形态:
//   - 用户登录态时 startGlobalEventStream() 起一条 SSE 长连(filter=channel_activity);
//     登出 / token 失效时 stopGlobalEventStream() 关掉。
//   - 任何组件通过 subscribeChannelActivity(cb) 订阅推过来的事件,返回退订函数。
//   - 实现:fetch + ReadableStream(因为 EventSource 不支持自定义 Authorization
//     header;Synapse Web 用 Bearer header 而非 cookie 携带 JWT,必须用 fetch)。
//
// 帧格式约定(由后端 sse_handler.go 写出):
//
//   event: ready                                 ← 连上时一帧
//   data: {"user_id":1,"principal_id":1}
//
//   event: channel.activity                      ← 我所属 channel 有新消息时
//   data: {"event_id":"...","channel_id":"42","message_id":"123","kind":"text",...}
//
//   event: error                                 ← 服务端拒绝(配置缺失等)
//   data: {"message":"..."}
//
//   : heartbeat                                  ← 每 5 秒一次,保活,client 忽略
//
// 重连:连接断开 → 指数退避重连(1s → 2s → ... ≤ 30s);只在 stop() 调用后才彻底放弃。
// 401/403 视作"凭证失效",不重试;调用方应监听 onUnauthorized 引导重新登录。

import { useAuthStore } from '@/store/auth';

type EventName = 'ready' | 'channel.activity' | 'mention.received' | 'error';

interface Frame {
  name: EventName;
  data: unknown;
}

interface StreamOptions {
  filter: 'mentions' | 'channel_activity';
  onFrame: (f: Frame) => void;
  onUnauthorized?: () => void;
}

class EventStream {
  private abortCtrl: AbortController | null = null;
  private retryCount = 0;
  private closed = false;
  private opts: StreamOptions;

  constructor(opts: StreamOptions) {
    this.opts = opts;
  }

  start() {
    this.closed = false;
    void this.runLoop();
  }

  stop() {
    this.closed = true;
    this.abortCtrl?.abort();
  }

  private async runLoop() {
    while (!this.closed) {
      try {
        await this.streamOnce();
        // streamOnce 自然返回(server 主动关 / body 读完),按短退避重连
        this.retryCount = 0;
      } catch (err) {
        if (this.closed) return;
        const code = (err as { status?: number })?.status;
        if (code === 401 || code === 403) {
          // 凭证失效 —— 不重试,交给上层
          this.opts.onUnauthorized?.();
          return;
        }
        // 网络错 / 其他 → 指数退避重连
        this.retryCount = Math.min(this.retryCount + 1, 5);
      }
      if (this.closed) return;
      const backoff = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
      await sleep(backoff);
    }
  }

  private async streamOnce(): Promise<void> {
    this.abortCtrl = new AbortController();
    const token = useAuthStore.getState().accessToken;
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api/v2/users/me/events?filter=${this.opts.filter}`, {
      method: 'GET',
      headers,
      signal: this.abortCtrl.signal,
      // 避免浏览器 SW 缓存 SSE 流
      cache: 'no-store',
    });

    if (!res.ok) {
      const e: Error & { status?: number } = new Error(`SSE status ${res.status}`);
      e.status = res.status;
      throw e;
    }
    if (!res.body) throw new Error('SSE response has no body');

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';

    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        // SSE 帧分隔符 = 空行 (\n\n)
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.parseFrame(raw);
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  private parseFrame(raw: string) {
    let event = '';
    let data = '';
    for (const line of raw.split('\n')) {
      if (line === '' || line.startsWith(':')) continue; // 空行 / heartbeat comment
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data = line.slice(5).trim();
    }
    if (!event) return;
    let parsed: unknown = data;
    try {
      parsed = data ? JSON.parse(data) : {};
    } catch {
      /* 保留原始字符串 */
    }
    this.opts.onFrame({ name: event as EventName, data: parsed });
  }
}

// ─── channel.activity payload schema(跟后端 marshalEventPayload 对齐)───────

export interface ChannelActivityEvent {
  event_id: string;
  event_type: string;          // "message.posted"
  channel_id: string;          // 数字字符串
  message_id: string;
  author_principal_id: string;
  org_id: string;
  kind: string;                // "text" / "system_event"
  created_at: string;
}

// ─── 全局单例 stream + 订阅总线 ─────────────────────────────────────────────

const eventBus = new EventTarget();
let globalStream: EventStream | null = null;

export function startGlobalEventStream(opts?: { onUnauthorized?: () => void }) {
  if (globalStream) return; // 已启动,幂等
  globalStream = new EventStream({
    filter: 'channel_activity',
    onUnauthorized: opts?.onUnauthorized,
    onFrame: (f) => {
      // 把每一帧 dispatch 到 EventTarget,组件按 event 名订阅
      eventBus.dispatchEvent(new CustomEvent(f.name, { detail: f.data }));
    },
  });
  globalStream.start();
}

export function stopGlobalEventStream() {
  globalStream?.stop();
  globalStream = null;
}

/**
 * 订阅 channel.activity 事件 —— 我所属 channel 有新消息(text 或 system_event)时触发。
 * 返回退订函数,组件 unmount 时调即可。
 */
export function subscribeChannelActivity(handler: (ev: ChannelActivityEvent) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<ChannelActivityEvent>).detail);
  eventBus.addEventListener('channel.activity', listener);
  return () => eventBus.removeEventListener('channel.activity', listener);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
