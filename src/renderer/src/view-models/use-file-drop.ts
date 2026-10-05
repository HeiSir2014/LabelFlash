import { useEffect, useRef } from 'react';

/** 只认带文件的拖放：拖文字、拖页面里的元素不管。 */
function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

/**
 * 把文件拖进窗口：交给 onFile（打开批量打印页并读这个文件）。必须拦下默认行为，
 * 否则 Chromium 会去打开这个文件（导航被 security.ts 拒绝，文件也就丢了）。
 */
export function useFileDrop(onFile: (file: File) => void, isEnabled: boolean): void {
  const onFileRef = useRef(onFile);

  useEffect(() => {
    onFileRef.current = onFile;
  });

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
      }
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) {
        onFileRef.current(file);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [isEnabled]);
}
