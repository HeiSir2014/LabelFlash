import type { LibraryCategoryId } from '../core/templates/library/library-model';
import type { PaperSize } from './paper-sizes';

/** 模板库里一个模板的缩略图和说明（IPC templates:library 返回）。 */
export interface LibraryPreview {
  /** library:xxx；「用这个模板」时交回主进程。 */
  id: string;
  category: LibraryCategoryId;
  name: string;
  description: string;
  paper: PaperSize;
  /** 示例数据的完整内容：复制后显示在「预览内容」里。 */
  sampleContent: string;
  /** 按示例数据排好的标签 HTML（和打印同一份），在 sandbox 的 iframe 里显示。 */
  html: string;
}
