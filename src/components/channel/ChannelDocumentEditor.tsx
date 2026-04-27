// ChannelDocumentEditor 共享文档(PR #9')的 CodeMirror 编辑器封装。
//
// 简单包一层 react-codemirror,固定一组适合"协作 md 编辑"的扩展:
//   - markdown 语法高亮(text 类型也能用,降级为纯文本视觉)
//   - 软换行(协作文档不该出现横向滚动)
//   - 行号关掉(写文档不写代码,行号视觉嘈杂)
//
// readOnly 通过 EditorState.readOnly + editable=false 双保险实现:前者锁状态,
// 后者禁用键盘交互。两者都 false 才完全可写。
//
// 图片上传(可选):传入 onUploadImage(file) 后,编辑器自动拦截 paste/drop 事件
// 里的 image/* 文件 → 在光标处先插入 HTML 注释占位 → 上传完成后替换为真 URL。
// 占位用 `<!--upload-N-->` 形式,不会污染 markdown 渲染(注释默认不显示),且失败时
// 被自动删除,不会留下脏 markdown。
import { useEffect, useMemo, useRef } from 'react';
import CodeMirror, { EditorView, type Extension, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import type { ChannelDocumentKind } from '@/types/api';

interface ChannelDocumentEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly: boolean;
  /** md 走 markdown 高亮;text 仍用 markdown extension(纯文本无负担)*/
  contentKind: ChannelDocumentKind;
  /** 占位文案,空 doc 时显示。CodeMirror 自带 placeholder 不直观,这里靠 value=='' 时 caller 自行处理 */
  placeholder?: string;
  /** 受控高度;默认 60vh,弹窗用 80vh */
  height?: string;
  /**
   * 可选:粘贴 / 拖拽图片时调用。
   * 返 markdown 片段(如 `![alt](url)`)→ 编辑器替换占位插入;
   * 返 null  → 编辑器静默删除占位(由 hook 内部 toast 报错)。
   * 不传则不拦截 paste/drop(纯文本编辑器行为)。
   */
  onUploadImage?: (file: File) => Promise<{ markdown: string } | null>;
}

export function ChannelDocumentEditor({
  value, onChange, readOnly, contentKind, placeholder, height = '60vh', onUploadImage,
}: ChannelDocumentEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  // CodeMirror extensions 不该频繁重建(会抖动编辑器内部 state),所以 paste/drop
  // handler 通过 ref 拿最新闭包,extensions 只依赖稳定的"启用与否 + contentKind"。
  const onUploadImageRef = useRef(onUploadImage);
  useEffect(() => { onUploadImageRef.current = onUploadImage; }, [onUploadImage]);

  // 占位 token 计数器:每个 paste 拿一个唯一序号防多并发上传错位替换
  const placeholderSeqRef = useRef(0);

  const uploadEnabled = !!onUploadImage && !readOnly;

  const extensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [
      EditorView.lineWrapping,
    ];
    if (contentKind === 'md') {
      exts.push(markdown());
    }
    if (!uploadEnabled) return exts;

    // handleImageFile:在光标处插占位 → 调 upload → 成功替换 / 失败删占位。
    // 全部内联到 extension 里,避免 useCallback ref 闭包带来的 lint 噪音。
    const handleImageFile = async (view: EditorView, file: File) => {
      const upload = onUploadImageRef.current;
      if (!upload) return;
      placeholderSeqRef.current += 1;
      // seq 在 ref 内单调递增,足够唯一(无须时间戳)
      const token = `<!--upload-${placeholderSeqRef.current}-->`;
      const placeholderText = `\n${token}\n`;
      // 插占位:替换当前 selection
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: placeholderText },
        selection: { anchor: sel.from + placeholderText.length },
      });
      try {
        const out = await upload(file);
        const doc = view.state.doc.toString();
        const idx = doc.indexOf(placeholderText);
        if (idx < 0) return; // 用户已手动删了占位,不强求
        view.dispatch({
          changes: {
            from: idx,
            to: idx + placeholderText.length,
            insert: out ? `\n${out.markdown}\n` : '',
          },
        });
      } catch {
        const doc = view.state.doc.toString();
        const idx = doc.indexOf(placeholderText);
        if (idx >= 0) {
          view.dispatch({ changes: { from: idx, to: idx + placeholderText.length, insert: '' } });
        }
      }
    };

    exts.push(EditorView.domEventHandlers({
      paste: (event, view) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const images: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            const f = it.getAsFile();
            if (f) images.push(f);
          }
        }
        if (images.length === 0) return false;
        event.preventDefault();
        // 串行处理,避免多张图占位顺序错乱;用户角度看几乎一致
        (async () => {
          for (const f of images) {
            await handleImageFile(view, f);
          }
        })();
        return true;
      },
      drop: (event, view) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const images: File[] = [];
        for (let i = 0; i < files.length; i++) {
          const f = files.item(i);
          if (f && f.type.startsWith('image/')) images.push(f);
        }
        if (images.length === 0) return false;
        event.preventDefault();
        (async () => {
          for (const f of images) {
            await handleImageFile(view, f);
          }
        })();
        return true;
      },
    }));

    return exts;
  }, [contentKind, uploadEnabled]);

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      editable={!readOnly}
      placeholder={placeholder}
      extensions={extensions}
      height={height}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: false,
      }}
      theme="light"
      style={{
        fontSize: '14px',
        fontFamily: '"PingFang SC", "Helvetica Neue", -apple-system, sans-serif',
      }}
    />
  );
}
