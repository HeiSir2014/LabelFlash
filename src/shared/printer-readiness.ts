/**
 * 打印机不能打印的原因分类：界面显示中文说明（detail），语音播报按分类选择对应的一句。
 * 同时有多个问题时取最需要人动手处理的一个（缺纸 > 卡纸 > 开盖 > 离线 > 其他）。
 */
export const PRINTER_ISSUES = ['paperOut', 'paperJam', 'doorOpen', 'offline', 'other'] as const;
export type PrinterIssue = (typeof PRINTER_ISSUES)[number];

/** 打印机是否可以打印；null 表示未知（尚未查询、查询失败或非 Windows），不阻止打印。 */
export type PrinterReadiness = { ready: true } | { ready: false; detail: string; issue: PrinterIssue };
