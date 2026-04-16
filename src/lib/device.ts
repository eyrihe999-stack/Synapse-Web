const STORAGE_KEY = 'synapse-device-id';

/**
 * 获取当前 tab 的设备 ID。
 * 使用 sessionStorage（tab 级隔离）：同一浏览器不同 tab 会有不同的 device_id。
 * 格式：web-{timestamp}-{random}
 */
export function getDeviceId(): string {
  let id = sessionStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

/** 返回设备名称，用于后端 session 展示 */
export function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome')) return 'Chrome (Web)';
  if (ua.includes('Firefox')) return 'Firefox (Web)';
  if (ua.includes('Safari')) return 'Safari (Web)';
  return 'Browser (Web)';
}
