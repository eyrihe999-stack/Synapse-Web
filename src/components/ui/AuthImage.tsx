// AuthImage 用 axios(带 JWT Bearer) 拉图,转 blob URL 再渲染 <img>。
//
// 为什么需要这个:浏览器原生 <img src="/api/v2/..."> 是基本 HTTP GET,**不会自动带
// Authorization header** —— 我们后端 /attachments/:id 端点走 JWTAuthWithSession,
// 没 header 直接 401 → 浏览器拿不到图,显示破图。
//
// 解决:fetch 一次拿 blob → URL.createObjectURL → <img src=blob:...>。
// 复用 axios client 的 interceptor:自动带 Authorization、401 自动 refresh + retry。
//
// 全局缓存(blobCache):同一 src 在页面 lifetime 内只 fetch 一次。
// 编辑文档时 react-markdown 每次按键都重 parse,可能让 <AuthImage> 反复 unmount/
// remount —— 不缓存就每次重拉 + 旧 blob 被 revoke,视觉上"闪"一下。
// attachment 是 sha256 内容寻址,同 URL 永远是同字节,缓存安全。
//
// 不 revoke:页面 lifetime 内可能反复用,每次 unmount 就 revoke 等于跟没缓存一样。
// 浏览器关 tab 时所有 blob 自动回收,内存最大几 MB(几十张图)可接受。
//
// 安全:src 必须以 `/api/` 开头,拒任意 URL,避免误用为通用 image 加载器。
import { useEffect, useState } from 'react';
import client from '@/api/client';

// 全局 blob URL 缓存:src → blob:... URL。
// in-flight 缓存防"同一图同时 mount 多次时并发 fetch":src → Promise<blobURL>。
const blobCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

async function fetchAttachmentBlob(src: string): Promise<string> {
  const cached = blobCache.get(src);
  if (cached) return cached;
  const pending = inFlight.get(src);
  if (pending) return pending;

  const path = src.startsWith('/api/') ? src.slice('/api'.length) : src;
  const promise = client.get<Blob>(path, { responseType: 'blob' })
    .then((res) => {
      const url = URL.createObjectURL(res.data);
      blobCache.set(src, url);
      return url;
    })
    .finally(() => { inFlight.delete(src); });
  inFlight.set(src, promise);
  return promise;
}

interface AuthImageProps {
  src?: string;
  alt?: string;
  className?: string;
}

export function AuthImage({ src, alt, className }: AuthImageProps) {
  // 同步初始值:命中缓存直接拿,首次渲染就有图(无 loading 闪)
  const [blobUrl, setBlobUrl] = useState<string | null>(() => (src ? blobCache.get(src) ?? null : null));
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src || !src.startsWith('/api/')) {
      setError(true);
      setBlobUrl(null);
      return;
    }
    const cached = blobCache.get(src);
    if (cached) {
      setError(false);
      setBlobUrl(cached);
      return;
    }
    let cancelled = false;
    setError(false);
    setBlobUrl(null);
    fetchAttachmentBlob(src)
      .then((url) => { if (!cancelled) setBlobUrl(url); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [src]);

  if (error) {
    return <span className="text-text-muted text-xs">[图片加载失败 {alt ? `: ${alt}` : ''}]</span>;
  }
  if (!blobUrl) {
    return (
      <span
        className={className}
        style={{ display: 'inline-block', minWidth: 80, minHeight: 80, background: '#f0efe9', borderRadius: 4 }}
        aria-label={alt || 'loading'}
      />
    );
  }
  return <img src={blobUrl} alt={alt || 'image'} className={className} />;
}
