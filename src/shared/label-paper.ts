import type { PaperSize } from './paper-sizes';

/** 内置模板和旧数据（没有纸张字段）的纸张：60×40mm 背胶热敏标签。冻结：各处共用这一个对象。 */
export const DEFAULT_PAPER: Readonly<PaperSize> = Object.freeze({ widthMm: 60, heightMm: 40 });

/** 旧写法，逐步换成模板的纸张；换完后删除。 */
export const LABEL_PAPER_MM = { width: DEFAULT_PAPER.widthMm, height: DEFAULT_PAPER.heightMm } as const;
