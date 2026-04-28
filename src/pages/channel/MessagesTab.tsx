// MessagesTab channel 详情页的核心 tab —— 消息流 + 底部 composer + @ mention。
//
// 交互设计:
//   - 消息按时间升序渲染(老在上,新在下),初次加载后自动滚到底部
//   - Composer 支持 @ 触发 mention picker(方向键选择,Enter 选中,Esc 关闭)
//   - 发送后启动 20 秒轮询(每 2 秒拉一次),捕获到新消息立即停
//     —— 目标:让顶级 agent 的回复尽快出现在 UI 上(目前后端无 SSE/WS,轮询兜底)
//   - 长对话:上滑到顶部自动触发"加载更多"(before_id 分页)
//
// 不做:消息编辑 / 删除(后端无)、富文本(仅纯文本)、图片附件(后端 kind 只支持
// text)、本地 optimistic append(POST 返回才刷新,确保 UI 和 DB 一致)。
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, Globe2, Send, MessageCircle, Sparkles, Settings2, Check, CornerDownRight, Reply, X, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/Button';
import { MentionPicker } from '@/components/ui/MentionPicker';
import { UserAvatar } from '@/components/ui/UserIdentity';
import { SystemEventCard } from '@/components/channel/SystemEventCard';
import { ReactionBar } from '@/components/channel/ReactionBar';
import { toast } from '@/components/ui/Toast';
import { channelApi } from '@/api/channel';
import { subscribeChannelActivity } from '@/api/events';
import { useAuthStore } from '@/store/auth';
import { usePrefsStore, describeSendMode, type MessageSendMode } from '@/store/prefs';
import { apiCall, getErrorMessage } from '@/lib/api-helpers';
import { useChannelAttachmentUpload } from '@/hooks/useChannelAttachmentUpload';
import { AuthImage } from '@/components/ui/AuthImage';
import type { PrincipalDirEntry } from '@/hooks/useOrgPrincipals';
import type {
  ChannelMessageResponse,
  ChannelMemberResponse,
} from '@/types/api';

interface MessagesTabProps {
  channelId: number;
  members: ChannelMemberResponse[];
  principalDirByID: Map<number, PrincipalDirEntry>;
}

const PAGE_SIZE = 50;
// 发送后最多轮询多少轮(每轮 2 秒,共 20 秒)—— 让顶级 agent 回复尽量及时可见
const POLL_ROUNDS = 10;
const POLL_INTERVAL_MS = 2000;

export function MessagesTab({ channelId, members, principalDirByID }: MessagesTabProps) {
  const me = useAuthStore((s) => s.user);
  // 当前用户的 principal_id(非 user.id),ReactionBar 判断"这条反应是不是我打的"用
  const myPrincipalID = me ? Number(me.principal_id) : 0;
  const sendMode = usePrefsStore((s) => s.messageSendMode);
  const setSendMode = usePrefsStore((s) => s.setMessageSendMode);
  const [showSendMenu, setShowSendMenu] = useState(false);

  const [messages, setMessages] = useState<ChannelMessageResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null); // 翻更早的页起点
  const [hasMore, setHasMore] = useState(true);
  const [polling, setPolling] = useState(false);

  const [body, setBody] = useState('');
  const [mentionIDs, setMentionIDs] = useState<number[]>([]);
  // 本次发送关联的"引用目标":点消息上的"回复"按钮会设置;发送后清空。
  const [replyTarget, setReplyTarget] = useState<ChannelMessageResponse | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerActive, setPickerActive] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 图片粘贴 / 拖拽上传
  const { uploadImage, uploading: uploadingImage } = useChannelAttachmentUpload(channelId);

  // 在 textarea 光标处替换 selection 为 text;返插入终点 offset。
  const insertAtTextarea = useCallback((text: string): number | null => {
    const ta = textareaRef.current;
    if (!ta) return null;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newBody = body.slice(0, start) + text + body.slice(end);
    setBody(newBody);
    const cursorAt = start + text.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(cursorAt, cursorAt);
    });
    return cursorAt;
  }, [body]);

  // textarea 不像 CodeMirror 能"占位 → 替换",索性串行 await 每张图,完成后再插
  // markdown 字符串。期间 uploadingImage=true 给 UI 反馈"上传中"。
  const handlePasteImages = useCallback(async (files: File[]) => {
    for (const f of files) {
      const out = await uploadImage(f);
      if (out) insertAtTextarea(out.markdown);
    }
  }, [uploadImage, insertAtTextarea]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) images.push(f);
      }
    }
    if (images.length === 0) return;
    e.preventDefault();
    void handlePasteImages(images);
  }, [handlePasteImages]);

  // 本 channel 的成员候选(用 principal_id 去 directory 找到 display_name / avatar)
  const memberDir = useMemo(() => {
    const entries: PrincipalDirEntry[] = [];
    for (const m of members) {
      const dir = principalDirByID.get(m.principal_id);
      if (dir) {
        entries.push(dir);
      } else {
        // 兜底:directory 里没这个 principal(可能 org 外 agent / 未同步),给个占位
        entries.push({
          principalId: m.principal_id,
          kind: 'user',
          displayName: `principal#${m.principal_id}`,
        });
      }
    }
    // 全局 agent(Synapse)置顶 —— 它是被 @ 最多的目标
    return entries.sort((a, b) => {
      const ag = a.isGlobalAgent ? 0 : 1;
      const bg = b.isGlobalAgent ? 0 : 1;
      if (ag !== bg) return ag - bg;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [members, principalDirByID]);

  // 按 query 过滤 mention 候选;空 query 全返(给 @ 刚按下时用)
  const pickerCandidates = useMemo(() => {
    const q = pickerQuery.toLowerCase();
    if (!q) return memberDir;
    return memberDir.filter((e) => e.displayName.toLowerCase().includes(q));
  }, [memberDir, pickerQuery]);

  // 当前 channel 内可被 @ 的所有 displayName(按长度降序),给 mention 高亮做最长前缀匹配。
  // 含空格的名字(如 "Eyri He"、"Claude Desktop")也能完整识别。
  // 来源 = principalDirByID(覆盖 channel 成员 + org 内的人,前者更窄但 mention 通常都
  // 能命中);为简便直接用整个 directory,误命中代价小。
  const mentionNames = useMemo(() => {
    const arr: string[] = [];
    principalDirByID.forEach((entry) => {
      if (entry.displayName) arr.push(entry.displayName);
    });
    arr.sort((a, b) => b.length - a.length);
    return arr;
  }, [principalDirByID]);

  // 初次加载消息
  const fetchInitial = useCallback(async () => {
    setLoading(true);
    try {
      const res = await channelApi.listMessages(channelId, undefined, PAGE_SIZE);
      const data = res.data.result;
      const items = data?.messages ?? [];
      // 后端按 id 倒序返;倒过来给 UI 显示(老在上)
      setMessages([...items].reverse());
      setCursor(data?.cursor || null);
      setHasMore(!!data?.cursor);
    } catch (err) {
      toast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  // 分页加载更早的消息
  const fetchOlder = useCallback(async () => {
    if (!cursor) return;
    try {
      const res = await channelApi.listMessages(channelId, cursor, PAGE_SIZE);
      const data = res.data.result;
      const older = [...(data?.messages ?? [])].reverse();
      setMessages((prev) => [...older, ...prev]);
      setCursor(data?.cursor || null);
      setHasMore(!!data?.cursor);
    } catch (err) {
      toast('error', getErrorMessage(err));
    }
  }, [channelId, cursor]);

  // 拉最新 —— 追加新 id 的消息;同时用新数据覆盖已有 id 的消息
  // (reactions / mentions / reply_to_preview 等可变字段会随时间变化,id 不变
  // 不代表内容没变,单纯按 id 去重会看不到 reaction 等更新)
  const fetchLatest = useCallback(async () => {
    try {
      const res = await channelApi.listMessages(channelId, undefined, PAGE_SIZE);
      const items = [...(res.data.result?.messages ?? [])].reverse();
      setMessages((prev) => {
        if (prev.length === 0) return items;
        const byID = new Map(items.map((m) => [m.id, m]));
        // 已有消息用新数据覆盖;items 没包到的旧消息保持原样
        const merged = prev.map((p) => byID.get(p.id) ?? p);
        const maxID = prev[prev.length - 1].id;
        const append = items.filter((m) => m.id > maxID);
        return append.length > 0 ? [...merged, ...append] : merged;
      });
      return items;
    } catch {
      return [];
    }
  }, [channelId]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  // SSE 实时更新:订阅 channel.activity,本 channel 有新消息(text 或 system_event 卡片)
  // 时调 fetchLatest 局部刷。fetchLatest 已经做了去重 + 已有消息覆盖更新(reactions
  // 等可变字段),所以同一条消息被多次推过来也安全。
  //
  // 退订函数随 channelId 变化重新绑,避免切换 channel 后旧 channel 的事件还在刷新。
  useEffect(() => {
    const unsub = subscribeChannelActivity((ev) => {
      if (Number(ev.channel_id) !== channelId) return;
      void fetchLatest();
    });
    return unsub;
  }, [channelId, fetchLatest]);

  // 智能滚到底 + 新消息提示。规则:
  //   - 用户**当前在底部**(scroll 距底 < 120px) → 新消息直接滚下来
  //   - 用户**滚上去看历史** → 不打扰,累计 unreadCount,UI 浮出"↓ N 条新消息"按钮,
  //     用户点了或自己滚回底部就清零
  //   - 首次加载(prev=0)直接滚到底
  //   - 已有消息更新(reactions 等可变字段变化,length 不变)不动滚动
  const isNearBottomRef = useRef(true);
  const prevMsgLenRef = useRef(0);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const prev = prevMsgLenRef.current;
    prevMsgLenRef.current = messages.length;

    if (prev === 0 && messages.length > 0) {
      // 首次进入有消息 → 直接滚到底,不要走"近底部判定"
      el.scrollTop = el.scrollHeight;
      isNearBottomRef.current = true;
      return;
    }
    if (messages.length <= prev) return; // 没新增,不动

    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setUnreadCount(0);
    } else {
      setUnreadCount((c) => c + (messages.length - prev));
    }
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnreadCount(0);
    isNearBottomRef.current = true;
  }, []);

  // Composer 操作 —— 检测 @ 触发 picker,维护 pickerQuery
  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // 归一化"看起来像 @ 但实际上不是"的字符,让从中文 IM / Weibo / 其它 IME 环境
    // 复制过来的 mention 能被正常识别:
    //   - 全角 ＠(U+FF20)→ 半角 @(U+0040)
    //   - 剔掉零宽字符(ZWSP / ZWNJ / ZWJ / BOM),避免它们插在 @ 和 name 之间
    // 归一化后所有 @ 检测 / 自动 mention 都只需认半角 @。
    const raw = e.target.value;
    const val = raw.replace(/＠/g, '@').replace(/[​‌‍﻿]/g, '');
    setBody(val);

    // 检测 @:cursor 前最近一个 @ 之后到 cursor 之间无空格/换行 → 认为在打 mention。
    //
    // 刻意**不限**"@ 前必须是空格/标点" —— 用户在中文句子、单词中间、甚至 email
    // 地址里打 @ 都会触发 picker,真不想用 Esc 关掉即可。对照 Slack / Discord /
    // 飞书的行为:它们也都是"遇 @ 就弹",让用户自己决定。加前置字符检查只会让
    // 中文用户(打完汉字直接 @ 会被吞掉)和代码引用场景很难受。
    //
    // 注:selectionStart 来自原始 raw 的位置;归一化若缩短了长度(有零宽符号时),
    // 在 val 上用原 pos 做切片可能多算 0~数个字符,picker 的 query 会夹带几个字符,
    // 但它在下一次 onChange 就会纠正,体感无异。为简化不做精确映射。
    const pos = e.target.selectionStart;
    const before = val.slice(0, pos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1) {
      setPickerOpen(false);
      return;
    }
    const frag = before.slice(atIdx + 1);
    if (/[\s\n]/.test(frag)) {
      setPickerOpen(false);
      return;
    }
    setPickerQuery(frag);
    setPickerActive(0);
    setPickerOpen(true);
  };

  const handlePick = (entry: PrincipalDirEntry) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart;
    const before = body.slice(0, pos);
    const after = body.slice(pos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1) return;

    // 把 @xxx 替换为 @DisplayName + 尾 space
    const insert = `@${entry.displayName} `;
    const newBody = before.slice(0, atIdx) + insert + after;
    setBody(newBody);
    // mentions 列表去重
    setMentionIDs((prev) =>
      prev.includes(entry.principalId) ? prev : [...prev, entry.principalId],
    );
    setPickerOpen(false);

    // 把光标落在插入后
    requestAnimationFrame(() => {
      const cursorAt = atIdx + insert.length;
      textarea.focus();
      textarea.setSelectionRange(cursorAt, cursorAt);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition 守卫:中文 / 日文 / 韩文输入法"候选选择"期间的回车 /
    // 上下箭头只是在和 IME 交互,不该触发发送 / 切换 MentionPicker 高亮。
    // Safari / Chrome 用 isComposing;老浏览器兜底 keyCode=229。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (pickerOpen && pickerCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPickerActive((i) => (i + 1) % pickerCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPickerActive((i) => (i - 1 + pickerCandidates.length) % pickerCandidates.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handlePick(pickerCandidates[pickerActive]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPickerOpen(false);
        return;
      }
    }
    // 发送快捷键按偏好分派:
    //   mod-enter   Cmd/Ctrl+Enter 发送,Enter 默认换行
    //   enter       Enter 发送(无 Shift),Shift+Enter 换行
    //   button-only Enter 一律换行,按钮发送
    if (e.key === 'Enter') {
      const mod = e.metaKey || e.ctrlKey;
      if (sendMode === 'mod-enter' && mod) {
        e.preventDefault();
        void handleSend();
      } else if (sendMode === 'enter' && !e.shiftKey && !mod) {
        e.preventDefault();
        void handleSend();
      }
      // button-only:不拦截任何 Enter,默认换行
    }
  };

  const handleSend = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    // 本次发送涉及的 mention:
    //   1. 先保留 body 里仍然出现 @DisplayName 的(用户可能删了 picker 选过的人)
    //   2. 再扫 body,自动补齐"手打 @xxx 但没从 picker 选"的成员
    //      —— 用户习惯是"直接打 @名字"(复制粘贴 / 记得成员名手敲),没点 picker
    //      候选就会导致 mentions 数组空,后端看不到就不响应。自动补齐对用户透明。
    //      匹配规则:memberDir 里任意 entry 的 displayName 在 body 里以 @XXX 出现且
    //      XXX 前后是空白/标点/行首/行尾,即视为 mention。取最长匹配(优先匹配
    //      "刘华强" 而不是 "刘"),避免前缀冲突。
    const effectiveMentions = mentionIDs.filter((pid) => {
      const entry = principalDirByID.get(pid);
      return entry && body.includes(`@${entry.displayName}`);
    });
    const seen = new Set(effectiveMentions);
    const sortedEntries = [...memberDir].sort(
      (a, b) => b.displayName.length - a.displayName.length,
    );
    for (const entry of sortedEntries) {
      if (seen.has(entry.principalId)) continue;
      if (body.includes(`@${entry.displayName}`)) {
        effectiveMentions.push(entry.principalId);
        seen.add(entry.principalId);
      }
    }
    const res = await apiCall(() =>
      channelApi.postMessage(channelId, {
        body: body.trim(),
        mentions: effectiveMentions.length > 0 ? effectiveMentions : undefined,
        reply_to_message_id: replyTarget?.id,
      }),
    );
    setSending(false);
    if (res.ok) {
      setBody('');
      setMentionIDs([]);
      setReplyTarget(null);
      // 立即拉一次,然后视情况启动轮询等 agent 回复
      await fetchLatest();
      // 只在 @ 到了 **agent**(system / user agent)时才轮询 + 显示"等待 agent 回复"
      // 提示。@ 真人不该显示这个提示 —— 真人不会自动回(可能去吃饭了),挂个轮询
      // 转圈圈让人误以为系统出错。
      const hasAgentMention = effectiveMentions.some((pid) => {
        return principalDirByID.get(pid)?.kind === 'agent';
      });
      if (hasAgentMention) {
        startPolling();
      }
    }
  };

  const pollRef = useRef<number | null>(null);
  const pollRoundRef = useRef(0);
  const startPolling = () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    pollRoundRef.current = 0;
    setPolling(true);
    const tick = async () => {
      pollRoundRef.current += 1;
      const before = messages.length;
      const latest = await fetchLatest();
      // 如果来了新消息且不是我发的(即 agent 回复了),停
      const hasAgentReply = latest.some(
        (m) => me && m.author_principal_id !== Number(me.principal_id) && m.id > (messages[before - 1]?.id ?? 0),
      );
      if (hasAgentReply || pollRoundRef.current >= POLL_ROUNDS) {
        setPolling(false);
        pollRef.current = null;
        return;
      }
      pollRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    pollRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, []);

  // 滚动到顶部时加载更多
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop < 40 && hasMore && !loading) {
      void fetchOlder();
    }
    // 同时跟踪是否接近底部,新消息 useEffect 据此决定"滚 vs 累计 unread"。
    // 阈值 120px:消息卡片高度大致 60-90px,留点冗余防误判。
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isNearBottomRef.current = near;
    if (near && unreadCount > 0) {
      setUnreadCount(0);
    }
  };

  // 缩略算是否是我 / 是全局 agent / 是其他 agent
  const classify = (pid: number): 'me' | 'agent-global' | 'agent' | 'user' => {
    if (me && pid === Number(me.id)) return 'me';
    const dir = principalDirByID.get(pid);
    if (!dir) return 'user';
    if (dir.kind === 'agent') return dir.isGlobalAgent ? 'agent-global' : 'agent';
    return 'user';
  };

  const displayName = (pid: number) =>
    principalDirByID.get(pid)?.displayName || `principal#${pid}`;

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px] gap-2">
      {/* 顶部工具条:显式刷新按钮,给用户在"轮询未命中 / agent 慢回复"场景一个兜底拉最新的入口。
          agent 回复走 20 秒轮询,有时会错过窗口,用户刷新比干等更顺手。 */}
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />}
          onClick={fetchInitial}
          disabled={loading}
          title="刷新"
        />
      </div>
      {/* 消息流 —— 独立卡片,和 composer 之间留 8px 间隙 + composer 自带阴影做视觉分层。
          外层 relative + min-h-0 给"↓ N 条新消息"浮动按钮做定位锚;min-h-0 防止 flex
          子在 Safari/Firefox 默认 min-height: auto 撑爆容器。 */}
      <div className="flex-1 relative min-h-0">
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 z-10 px-3 py-1.5 rounded-full bg-[#2383e2] text-white text-[12px] font-medium shadow-lg hover:bg-[#1a72c8] transition-colors flex items-center gap-1"
          >
            ↓ {unreadCount > 99 ? '99+' : unreadCount} 条新消息
          </button>
        )}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-3 py-3 space-y-3 bg-white rounded-md border border-[#e8e7e3]"
      >
        {!hasMore && messages.length > 0 && (
          <p className="text-center text-[11px] text-text-muted py-2">— 这是起点 —</p>
        )}
        {hasMore && messages.length >= PAGE_SIZE && (
          <p className="text-center text-[11px] text-text-muted py-1">上滑加载更早消息</p>
        )}
        {loading && messages.length === 0 ? (
          <div className="py-8 text-center text-text-muted text-[13px]">加载中…</div>
        ) : messages.length === 0 ? (
          <div className="py-12 text-center text-text-muted">
            <MessageCircle className="mx-auto h-10 w-10 mb-2" strokeWidth={1.2} />
            <p className="text-[13px]">这个 channel 还没有消息</p>
            <p className="text-[11px] mt-1">用 @Synapse 和顶级 agent 打个招呼试试</p>
          </div>
        ) : (
          messages.map((m) => {
            // kind=system_event 走结构化卡片,不走气泡;卡片下方一行 ReactionBar
            if (m.kind === 'system_event') {
              return (
                <div key={m.id} className="flex flex-col items-center gap-1">
                  <SystemEventCard
                    bodyJSON={m.body}
                    createdAt={m.created_at}
                    principalDirByID={principalDirByID}
                    channelId={channelId}
                  />
                  <ReactionBar
                    messageID={m.id}
                    reactions={m.reactions}
                    currentPrincipalID={myPrincipalID}
                    principalDirByID={principalDirByID}
                    onChanged={fetchLatest}
                  />
                </div>
              );
            }
            const cls = classify(m.author_principal_id);
            const isMine = cls === 'me';
            const dir = principalDirByID.get(m.author_principal_id);
            return (
              <div
                key={m.id}
                className={clsx('flex gap-2.5', isMine && 'flex-row-reverse')}
              >
                {cls === 'agent-global' ? (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#2383e2] to-[#8a5cf6] flex items-center justify-center shrink-0 shadow-sm">
                    <Sparkles className="w-3.5 h-3.5 text-white" strokeWidth={2} />
                  </div>
                ) : cls === 'agent' ? (
                  <div className="w-7 h-7 rounded-full bg-[#2383e2]/10 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-[#2383e2]" strokeWidth={1.8} />
                  </div>
                ) : (
                  <UserAvatar
                    avatarUrl={dir?.avatarUrl}
                    fallback={dir?.displayName || `#${m.author_principal_id}`}
                    size="sm"
                    tone="muted"
                  />
                )}
                <div
                  className={clsx(
                    'flex-1 min-w-0 max-w-[75%] flex flex-col',
                    // 始终用 flex-col,否则 reply preview button(inline-block)和主气泡
                    // (inline-block)会水平并排,引用卡片错位到主气泡左边。
                    // isMine 右对齐,其他情况左对齐;子项不拉伸,按各自内容宽度。
                    isMine ? 'items-end' : 'items-start',
                  )}
                >
                  <div
                    className={clsx(
                      'flex items-baseline gap-1.5 mb-0.5',
                      isMine && 'flex-row-reverse',
                    )}
                  >
                    <span
                      className={clsx(
                        'text-[12px] font-medium',
                        cls === 'agent-global' && 'text-[#2383e2]',
                        cls === 'agent' && 'text-[#2383e2]',
                        cls === 'me' && 'text-text-primary',
                        cls === 'user' && 'text-text-primary',
                      )}
                    >
                      {displayName(m.author_principal_id)}
                    </span>
                    {cls === 'agent-global' && (
                      <span className="text-[9px] px-1 py-px rounded bg-[#2383e2]/10 text-[#2383e2] font-medium">
                        全局
                      </span>
                    )}
                    <span className="text-[10px] text-text-muted">
                      {new Date(m.created_at).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {/* reply 引用卡片(如果本消息是对另一条的回复)。点击滚到原消息。 */}
                  {m.reply_to_preview && (
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById(`msg-${m.reply_to_preview!.message_id}`);
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          // 高亮 1.2 秒
                          el.classList.add('ring-2', 'ring-[#2383e2]/40');
                          setTimeout(() => el.classList.remove('ring-2', 'ring-[#2383e2]/40'), 1200);
                        }
                      }}
                      className={clsx(
                        'mb-1 max-w-full text-left px-2 py-1 rounded border-l-2 text-[11px] leading-snug',
                        'bg-[#f9f8f5] border-[#c7c6c0] hover:bg-[#f1f0ec] transition-colors',
                        isMine ? 'mr-0' : 'ml-0',
                      )}
                      title="跳到原消息"
                    >
                      {/* 上下两行结构:行 1 = 图标 + 作者名;行 2 = body 摘要(用图标宽度
                          缩进对齐,视觉上从作者名之下流出来)。原来一行排会被频繁截断。 */}
                      <div className="flex flex-col gap-0.5 text-text-muted min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <CornerDownRight className="w-3 h-3 shrink-0" strokeWidth={1.8} />
                          {m.reply_to_preview.missing ? (
                            <span className="italic">原消息已不存在</span>
                          ) : (
                            <span className="font-medium text-text-secondary truncate">
                              {displayName(m.reply_to_preview.author_principal_id)}
                            </span>
                          )}
                        </div>
                        {!m.reply_to_preview.missing && (
                          <span className="text-text-muted/80 line-clamp-2 pl-4 break-words">
                            {m.reply_to_preview.body_snippet}
                          </span>
                        )}
                      </div>
                    </button>
                  )}
                  <div
                    id={`msg-${m.id}`}
                    className={clsx(
                      'group relative px-3 py-1.5 rounded text-[13px] leading-relaxed inline-block transition-[box-shadow]',
                      isMine
                        ? 'bg-[#2383e2] text-white rounded-tr-none'
                        : cls === 'agent-global'
                          ? 'bg-[#2383e2]/[0.06] border border-[#2383e2]/20 text-text-primary rounded-tl-none'
                          : 'bg-[#f4f3ef] text-text-primary rounded-tl-none',
                    )}
                  >
                    {/* agent 消息渲染 markdown(回复格式化);用户消息纯文本避免注入。
                        两路径都用 MentionText / highlightMentionsInChildren 高亮 @xxx ——
                        最长前缀匹配 channel 内的 displayName,所以 "@Eyri He" 这种带
                        空格的名字也能完整高亮,不会被切到 "@Eyri" 就停。 */}
                    {cls === 'agent-global' || cls === 'agent' ? (
                      <div className="markdown-chat">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => <p>{highlightMentionsInChildren(children, mentionNames, isMine)}</p>,
                            li: ({ children }) => <li>{highlightMentionsInChildren(children, mentionNames, isMine)}</li>,
                            strong: ({ children }) => <strong>{highlightMentionsInChildren(children, mentionNames, isMine)}</strong>,
                            em: ({ children }) => <em>{highlightMentionsInChildren(children, mentionNames, isMine)}</em>,
                            img: ({ src, alt }) => {
                              if (typeof src !== 'string') return null;
                              if (src.startsWith('/api/v2/channels/')) {
                                return <AuthImage src={src} alt={alt} className="my-1 max-w-[320px] rounded border border-[#e3e2dc]" />;
                              }
                              if (src.startsWith('https://')) {
                                return <img src={src} alt={alt || 'image'} className="my-1 max-w-[320px] rounded border border-[#e3e2dc]" />;
                              }
                              return <span className="text-text-muted text-xs">[image: {alt || 'invalid src'}]</span>;
                            },
                          }}
                        >
                          {m.body}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <UserMessageBody body={m.body} names={mentionNames} isMine={isMine} />
                    )}
                    {/* hover 出现的"回复"按钮:把本条设为当前 composer 的 reply target */}
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTarget(m);
                        textareaRef.current?.focus();
                      }}
                      className={clsx(
                        'absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity',
                        'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] shadow-sm',
                        'bg-white border border-[#e3e2dc] text-text-secondary hover:text-[#2383e2]',
                        isMine ? 'left-[-28px]' : 'right-[-28px]',
                      )}
                      title="回复这条消息"
                    >
                      <Reply className="w-3 h-3" strokeWidth={1.8} />
                    </button>
                  </div>
                  {/* 表情反应条(PR #12')—— 放气泡下方,跟气泡左/右对齐 */}
                  <div className={clsx('mt-1', isMine ? 'flex justify-end' : 'flex justify-start')}>
                    <ReactionBar
                      messageID={m.id}
                      reactions={m.reactions}
                      currentPrincipalID={myPrincipalID}
                      principalDirByID={principalDirByID}
                      onChanged={fetchLatest}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
        {polling && (
          <div className="flex justify-center items-center gap-2 py-2 text-[11px] text-[#2383e2]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#2383e2] animate-pulse" />
            <span>等待 agent 回复…</span>
          </div>
        )}
      </div>
      </div>

      {/* Composer —— 独立卡片,shadow + 左侧 accent bar 做视觉分层,
          textarea 自己有 focus ring,浮在消息区下方清晰可辨 */}
      <div className="relative bg-white rounded-md border border-[#e3e2dc] shadow-[0_-2px_10px_rgba(0,0,0,0.05)] focus-within:border-[#2383e2] focus-within:shadow-[0_0_0_3px_rgba(35,131,226,0.08),0_-2px_10px_rgba(0,0,0,0.05)] transition-shadow">
        {/* reply 目标预览条 —— 点 X 取消回复 */}
        {replyTarget && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#f0efe9] bg-[#fbfaf8] rounded-t-md text-[11px] text-text-secondary">
            <CornerDownRight className="w-3 h-3 shrink-0 text-[#2383e2]" strokeWidth={1.8} />
            <span className="truncate">
              回复 <span className="font-medium text-text-primary">{displayName(replyTarget.author_principal_id)}</span>
              <span className="text-text-muted">: {replyTarget.body.slice(0, 80)}{replyTarget.body.length > 80 ? '…' : ''}</span>
            </span>
            <button
              type="button"
              onClick={() => setReplyTarget(null)}
              className="ml-auto p-0.5 rounded hover:bg-[#ebeae5] text-text-muted hover:text-text-primary"
              title="取消回复"
            >
              <X className="w-3 h-3" strokeWidth={1.8} />
            </button>
          </div>
        )}
        <div className="flex items-start gap-2 px-3 pt-3">
          <div className="w-[3px] self-stretch rounded-full bg-gradient-to-b from-[#2383e2] to-[#8a5cf6] opacity-70 shrink-0" />
          <textarea
            ref={textareaRef}
            value={body}
            onChange={handleBodyChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={2}
            placeholder={`输入消息,@ 提及成员,可粘贴图片 · ${describeSendMode(sendMode)}`}
            className="flex-1 text-[13px] bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none resize-none"
          />
        </div>
        {pickerOpen && (
          <div className="absolute bottom-full left-3 mb-1">
            <MentionPicker
              candidates={pickerCandidates}
              activeIndex={pickerActive}
              onPick={handlePick}
              onHover={setPickerActive}
            />
          </div>
        )}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1 relative">
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            {uploadingImage ? (
              <span className="flex items-center gap-1 text-[#2383e2]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#2383e2] animate-pulse" />
                图片上传中…
              </span>
            ) : mentionIDs.length > 0 ? (
              <span className="flex items-center gap-1">
                <Globe2 className="w-3 h-3" />
                {mentionIDs.length} 个 mention
              </span>
            ) : (
              <span className="text-text-muted/70">输入 @ 提及成员,可粘贴图片</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* 发送行为切换 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSendMenu((v) => !v)}
                onBlur={() => setTimeout(() => setShowSendMenu(false), 150)}
                className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-text-muted hover:text-[#2383e2] hover:bg-[#f4f3ef] rounded transition-colors"
                title="发送快捷键"
              >
                <Settings2 className="w-3 h-3" strokeWidth={1.8} />
                <span>{describeSendMode(sendMode)}</span>
              </button>
              {showSendMenu && (
                <div className="absolute right-0 bottom-full mb-1 z-30 w-[240px] rounded-md bg-white border border-[#e3e2dc] shadow-lg overflow-hidden">
                  <div className="px-3 py-2 text-[11px] text-text-muted border-b border-[#f0efe9] bg-[#fbfaf8]">
                    选择发送快捷键
                  </div>
                  {(
                    [
                      { key: 'mod-enter', label: '⌘+Enter 发送', hint: 'Enter 换行(长消息/代码友好)' },
                      { key: 'enter', label: 'Enter 发送', hint: 'Shift+Enter 换行(IM 习惯)' },
                      { key: 'button-only', label: '仅按钮发送', hint: 'Enter 一律换行,避免误发' },
                    ] as Array<{ key: MessageSendMode; label: string; hint: string }>
                  ).map((opt) => {
                    const active = opt.key === sendMode;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSendMode(opt.key);
                          setShowSendMenu(false);
                        }}
                        className={clsx(
                          'w-full text-left px-3 py-2 flex items-start gap-2 text-[12px] hover:bg-[#f4f3ef]',
                          active && 'bg-[#2383e2]/[0.06]',
                        )}
                      >
                        <div className="w-3 shrink-0 pt-0.5">
                          {active && <Check className="w-3 h-3 text-[#2383e2]" strokeWidth={2.2} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div
                            className={clsx(
                              'font-medium',
                              active ? 'text-[#2383e2]' : 'text-text-primary',
                            )}
                          >
                            {opt.label}
                          </div>
                          <div className="text-[10px] text-text-muted mt-0.5">{opt.hint}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleSend}
              loading={sending}
              disabled={!body.trim() || sending}
              icon={<Send className="w-3.5 h-3.5" />}
            >
              发送
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── @ mention 高亮 ────────────────────────────────────────────────────────
//
// 痛点:displayName 可能含空格(如 "Eyri He"、"Claude Desktop"),纯 regex 切不准
// (遇空格就停 → "@Eyri He" 只识别 "@Eyri")。
//
// 解决:用 channel 内已知 displayName 列表做**最长前缀匹配**:
//   1. 遇 "@" → 在 names(按长度降序)里找哪个 name 在 @ 之后正好 startsWith
//   2. 命中 → 整段 "@<name>" 当 mention
//   3. 没命中 → 退回 regex 切到第一个空白/标点(防漏:用户 @ 了不在 members 列表的人)
//
// 视觉:用 pill 样式(浅色背景 + 加粗深色字),按 isMine 切配色:
//   - isMine(蓝底白字消息):白半透明 pill + 白字加粗 → 蓝中浮白,鲜亮
//   - 其他(白/浅米底深字):浅蓝 pill + 蓝字加粗 → Slack 风格
const MENTION_FALLBACK_RE = /^@[^\s@,.!?:;()[\]{}<>]+/;

interface MentionSegment {
  text: string;
  isMention: boolean;
}

function splitMentions(body: string, names: string[]): MentionSegment[] {
  // names 已经按长度降序传进来(调用方 useMemo 排好);这里直接 first match wins
  const segments: MentionSegment[] = [];
  const pushText = (s: string) => {
    const last = segments[segments.length - 1];
    if (last && !last.isMention) last.text += s;
    else segments.push({ text: s, isMention: false });
  };

  let i = 0;
  while (i < body.length) {
    if (body[i] === '@') {
      // 1. 尝试已知 name 最长前缀匹配
      let matched: string | null = null;
      for (const name of names) {
        if (name && body.startsWith(name, i + 1)) {
          matched = name;
          break;
        }
      }
      if (matched) {
        segments.push({ text: '@' + matched, isMention: true });
        i += 1 + matched.length;
        continue;
      }
      // 2. fallback:不在 members 列表 → 用 regex 切到下一个分隔符
      const fallback = body.slice(i).match(MENTION_FALLBACK_RE);
      if (fallback && fallback[0].length > 1) {
        segments.push({ text: fallback[0], isMention: true });
        i += fallback[0].length;
        continue;
      }
    }
    pushText(body[i]);
    i++;
  }
  return segments;
}

function MentionText({
  text,
  names,
  isMine,
}: {
  text: string;
  names: string[];
  isMine: boolean;
}) {
  const segments = splitMentions(text, names);
  const mentionCls = isMine
    ? 'bg-white/25 text-white font-semibold px-1 py-px rounded'
    : 'bg-[#2383e2]/10 text-[#2383e2] font-semibold px-1 py-px rounded';
  return (
    <>
      {segments.map((s, i) =>
        s.isMention ? (
          <span key={i} className={mentionCls}>
            {s.text}
          </span>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

// highlightMentionsInChildren 递归处理 ReactMarkdown 渲染出的 children 树:
// 字符串节点用 MentionText 替换,数组节点逐个递归,React element 原样保留。
function highlightMentionsInChildren(
  children: ReactNode,
  names: string[],
  isMine: boolean,
): ReactNode {
  if (typeof children === 'string') {
    return <MentionText text={children} names={names} isMine={isMine} />;
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => (
      <Fragment key={i}>{highlightMentionsInChildren(c, names, isMine)}</Fragment>
    ));
  }
  return children;
}

// UserMessageBody 用户消息渲染:plain text + @ 高亮 + 内嵌图片。
//
// 我们刻意不让 user 消息走完整 markdown(避免用户输 `**` 被解释成粗体,改变现有
// 行为)。只额外把 `![alt](/api/v2/channels/<n>/attachments/<n>)` 这一种 attachment
// 引用抽出来渲染成 <img>,其它一切照旧。
//
// URL 严格白名单(只允许 attachment 端点),拒任意外链,避免钓鱼 / 跟踪像素。
function UserMessageBody({
  body,
  names,
  isMine,
}: {
  body: string;
  names: string[];
  isMine: boolean;
}) {
  // 没有图片引用 → 走原 plain text 路径,零开销
  if (!body.includes('![')) {
    return (
      <p className="whitespace-pre-wrap break-words">
        <MentionText text={body} names={names} isMine={isMine} />
      </p>
    );
  }
  // 每次 new 一个 RegExp 实例,避免共享 lastIndex 状态(并发渲染下不安全)
  const re = /!\[([^\]]*)\]\((\/api\/v2\/channels\/\d+\/attachments\/\d+)\)/g;
  const parts: ReactNode[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > lastEnd) {
      const seg = body.slice(lastEnd, m.index);
      parts.push(
        <p key={`t-${lastEnd}`} className="whitespace-pre-wrap break-words">
          <MentionText text={seg} names={names} isMine={isMine} />
        </p>,
      );
    }
    parts.push(
      <AuthImage
        key={`i-${m.index}`}
        src={m[2]}
        alt={m[1] || 'image'}
        className="my-1 max-w-[320px] rounded border border-[#e3e2dc]"
      />,
    );
    lastEnd = re.lastIndex;
  }
  if (lastEnd < body.length) {
    const seg = body.slice(lastEnd);
    parts.push(
      <p key={`t-${lastEnd}`} className="whitespace-pre-wrap break-words">
        <MentionText text={seg} names={names} isMine={isMine} />
      </p>,
    );
  }
  return <div className="space-y-1">{parts}</div>;
}
