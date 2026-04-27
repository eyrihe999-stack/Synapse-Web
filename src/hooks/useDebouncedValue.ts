// useDebouncedValue 把一个频繁变化的值,延迟 ms 毫秒后同步出新版本。
//
// 典型用法:大块内容(markdown 预览、搜索建议)对最新输入的实时跟随会卡 / 抖动,
// 用 debounce 让"用户停顿后才更新"。
//
// 注意:返回的不是函数式 callback,而是延迟版的"值",直接当 state 用即可:
//
//   const [text, setText] = useState('');
//   const stable = useDebouncedValue(text, 250);
//   useEffect(() => { /* react to stable */ }, [stable]);
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
