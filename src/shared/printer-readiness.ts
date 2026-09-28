/** 打印机是否可以打印；null 表示未知（尚未查询、查询失败或非 Windows），不阻止打印。 */
export type PrinterReadiness = { ready: true } | { ready: false; detail: string };
