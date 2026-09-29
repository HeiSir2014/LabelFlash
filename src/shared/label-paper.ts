import type { PaperSize } from './paper-sizes';

/** 内置模板和旧数据（没有纸张字段）的纸张：60×40mm 背胶热敏标签。冻结：各处共用这一个对象。 */
export const DEFAULT_PAPER: Readonly<PaperSize> = Object.freeze({ widthMm: 60, heightMm: 40 });
