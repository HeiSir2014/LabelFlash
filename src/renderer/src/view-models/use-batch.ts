import { useCallback, useEffect, useMemo, useState } from 'react';
import { type TemplateFields, templateFields } from '../../../core/api/template-fields';
import { planLabels } from '../../../core/batch/batch-labels';
import {
  BATCH_LIMITS,
  type BatchTable,
  type CopiesSettings,
  DEFAULT_COPIES,
  DEFAULT_SERIAL,
  FILE_TOO_LARGE_ISSUE,
  type FieldSource,
  type RowProblem,
  type SerialSettings,
} from '../../../core/batch/batch-model';
import { autoMapping, mappableVariables, unmappedVariables } from '../../../core/batch/column-mapping';
import type { LabelTemplate } from '../../../core/templates/template-model';
import type { BatchPreviewResult, BatchStartResult, BatchStatus, BatchTableResult } from '../../../shared/batch';
import {
  buildPlan,
  type DataKind,
  failuresByRow,
  filterRows,
  historyLimitWarning,
  problemsByRow,
  stepRowIndex,
  toggledSelection,
  withRowsChecked,
} from '../lib/batch-view';
import { reportError } from '../lib/notices';

/** 「只按序号打」默认几张。 */
const DEFAULT_SERIAL_ONLY_COUNT = 10;
/** 改了设置后等这么久再检查全部标签：连着打字时不每个字都把一万张重排一遍。 */
const CHECK_DEBOUNCE_MS = 400;
/** 当前行预览的防抖：和模板页的预览一致。 */
const PREVIEW_DEBOUNCE_MS = 150;
const EMPTY_FIELDS: TemplateFields = { mode: 'PICKED', names: [] };
const NO_COLUMNS: readonly string[] = [];

export type BatchControl = 'pause' | 'resume' | 'cancel';

interface BatchOptions {
  templates: readonly LabelTemplate[];
  activeTemplateId: string | null;
  /** 批量打印页开着：只在开着时预览和检查（关着时不占主进程）。 */
  isOpen: boolean;
  /** 打印记录保留条数（设置页「打印记录保留」）：这一批比它还多时提醒，见 historyLimitWarning。 */
  historyLimit: number;
}

/**
 * 批量打印页的状态：模板、数据、对列、序号、份数、勾选、当前行都在这里。表格本身由主进程读和保存，
 * 这里拿的是一份副本（显示、本地算缺字段的行）；开始打印时只交回设置和表格编号。
 * 页面关掉再打开设置都还在；正在打的那一批在主进程里继续，进度经推送更新。
 */
export function useBatch({ templates, activeTemplateId, isOpen, historyLimit }: BatchOptions) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [table, setTable] = useState<BatchTable | null>(null);
  const [dataKind, setDataKind] = useState<DataKind>('table');
  const [serialOnlyCount, setSerialOnlyCount] = useState(DEFAULT_SERIAL_ONLY_COUNT);
  const [isLoading, setIsLoading] = useState(false);
  const [loadIssue, setLoadIssue] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, FieldSource>>({});
  const [serial, setSerialState] = useState<SerialSettings>(DEFAULT_SERIAL);
  const [wantsSerial, setWantsSerial] = useState(false);
  const [copies, setCopies] = useState<CopiesSettings>(DEFAULT_COPIES);
  const [selected, setSelected] = useState<ReadonlySet<number> | null>(null);
  const [search, setSearch] = useState('');
  const [currentRow, setCurrentRow] = useState(0);
  const [renderProblems, setRenderProblems] = useState<readonly RowProblem[]>([]);
  /** 排版检查这一轮根本没能检查的原因（模板、表格对不上，见 BatchStation.check）；能检查时为 null。 */
  const [checkIssue, setCheckIssue] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [preview, setPreview] = useState<BatchPreviewResult | null>(null);
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [startIssue, setStartIssue] = useState<string | null>(null);

  const template = templates.find((item) => item.id === (templateId ?? activeTemplateId)) ?? templates[0] ?? null;
  const fields = useMemo(() => (template === null ? EMPTY_FIELDS : templateFields(template)), [template]);
  const variables = useMemo(() => mappableVariables(fields), [fields]);
  const dataTable = dataKind === 'table' ? table : null;
  const columns = dataTable?.columns ?? NO_COLUMNS;
  const rowCount = dataKind === 'table' ? (table?.rows.length ?? 0) : serialOnlyCount;
  const current = Math.min(currentRow, Math.max(0, rowCount - 1));

  // 换了模板或表格：按列名重新自动对列（变量和列都可能变了，原来手动对的不一定还成立）。
  useEffect(() => {
    setMapping(autoMapping(variables, columns));
  }, [variables, columns]);

  const plan = useMemo(
    () =>
      template === null
        ? null
        : buildPlan({
            templateId: template.id,
            fields,
            dataKind,
            table,
            serialOnlyCount,
            mapping,
            serial,
            wantsSerial,
            copies,
            selected,
          }),
    [template, fields, dataKind, table, serialOnlyCount, mapping, serial, wantsSerial, copies, selected],
  );
  const labelPlan = useMemo(
    () => (plan === null ? null : planLabels({ table: dataTable, plan, fields })),
    [plan, dataTable, fields],
  );
  const dataProblems = useMemo(() => problemsByRow(labelPlan?.ok ? labelPlan.problems : []), [labelPlan]);
  const problems = useMemo(
    () => problemsByRow(labelPlan?.ok ? labelPlan.problems : [], renderProblems),
    [labelPlan, renderProblems],
  );
  const visibleRows = useMemo(() => filterRows(dataTable, rowCount, search), [dataTable, rowCount, search]);
  const isRunning = status !== null && (status.state === 'running' || status.state === 'paused');
  // 取消的那一刻正在打的那一张可能还没结束：这期间 state 已经是 canceled，但 isActive 还是 true。
  // 这时「打印」按钮不能又点得了——点了也只会被主进程以 BUSY 拒绝，界面要显示「正在停止…」。
  const isStopping = status !== null && status.state === 'canceled' && status.isActive;
  const labelCount = labelPlan?.ok ? labelPlan.labels.length : 0;

  // 排版的问题（条码印不了、二维码放不下）要把每一行排一遍：交给主进程，改设置后稍等再查。
  useEffect(() => {
    if (!isOpen || plan === null) {
      setRenderProblems([]);
      setCheckIssue(null);
      return;
    }
    let isActive = true;
    const timer = window.setTimeout(async () => {
      setIsChecking(true);
      try {
        const result = await window.api.checkBatch(plan);
        if (isActive && result !== null) {
          setRenderProblems(result.problems);
          setCheckIssue(result.issue ?? null);
        }
      } catch (error) {
        reportError('检查标签', error);
      } finally {
        if (isActive) {
          setIsChecking(false);
        }
      }
    }, CHECK_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
      setIsChecking(false);
    };
  }, [isOpen, plan]);

  useEffect(() => {
    if (!isOpen || plan === null || rowCount === 0) {
      setPreview(null);
      return;
    }
    let isActive = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await window.api.previewBatchRow(plan, current);
        if (isActive) {
          setPreview(next);
        }
      } catch (error) {
        reportError('生成预览', error);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, plan, current, rowCount]);

  // 进度来自主进程：打开程序时读一次（上一批可能还在打），之后跟着推送。
  useEffect(() => {
    let isActive = true;
    window.api.getBatchStatus().then(
      (next) => {
        if (isActive) {
          setStatus(next);
        }
      },
      (error: unknown) => reportError('读取批量打印进度', error),
    );
    // 推送来的状态永远是最新的：不管这次更新是不是这个页面实例自己触发的（例如打印记录页点了
    // 「重打这一批」），上一次本地操作留下的错误提示都已经过时，不然它会一直挡住新的进度文字。
    const unsubscribe = window.api.onBatchStatus((next) => {
      setStatus(next);
      setStartIssue(null);
    });
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  const load = useCallback(async (read: () => Promise<BatchTableResult>): Promise<boolean> => {
    setIsLoading(true);
    setLoadIssue(null);
    try {
      const result = await read();
      if (result.status === 'invalid') {
        setLoadIssue(result.issue);
        return false;
      }
      if (result.status === 'canceled') {
        return false;
      }
      setTable(result.table);
      setDataKind('table');
      setSelected(null);
      setCurrentRow(0);
      setSearch('');
      return true;
    } catch (error) {
      reportError('导入表格', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const accept = (result: BatchStartResult): void => {
    if (result.status === 'started') {
      setStatus(result.batch);
      setStartIssue(null);
    } else {
      setStartIssue(result.issue);
    }
  };

  return {
    template,
    fields,
    variables,
    columns,
    hasTable: dataTable !== null,
    setTemplateId,
    table,
    dataKind,
    /** 「只按序号打」和表格之间切换（已导入的表格留着，切回来不用重新导入）。 */
    toggleSerialOnly: () => {
      setDataKind((kind) => (kind === 'serial-only' ? 'table' : 'serial-only'));
      setCurrentRow(0);
    },
    serialOnlyCount,
    setSerialOnlyCount,
    isLoading,
    loadIssue,
    openFile: () => void load(() => window.api.openBatchFile()),
    /** 拖进窗口的文件：先看大小（超限的不读进内存），再读成字节交给主进程。 */
    dropFile: (file: File) => {
      if (file.size > BATCH_LIMITS.fileBytes) {
        setLoadIssue(FILE_TOO_LARGE_ISSUE);
        return;
      }
      void load(async () => window.api.readDroppedBatchFile(file.name, new Uint8Array(await file.arrayBuffer())));
    },
    pasteTable: (text: string) => load(() => window.api.pasteBatchTable(text)),
    mapping,
    unmapped: unmappedVariables(mapping, variables, columns),
    setSource: (variable: string, source: FieldSource) =>
      setMapping((previous) => ({ ...previous, [variable]: source })),
    serial,
    setSerial: (patch: Partial<SerialSettings>) => setSerialState((previous) => ({ ...previous, ...patch })),
    wantsSerial,
    setWantsSerial,
    copies,
    setCopies,
    plan,
    // 本地排的问题优先（不用等主进程来回）；排不出问题但主进程那边检查不了（模板、表格对不上）时用那个原因。
    planIssue: (labelPlan !== null && !labelPlan.ok ? labelPlan.issue : null) ?? checkIssue,
    labelCount,
    /** 这一批比打印记录保留的条数还多时的提醒（非阻塞：仍然能打，只是提醒后果）。 */
    historyLimitWarning: historyLimitWarning(labelCount, historyLimit),
    rowCount,
    selectedCount: selected === null ? rowCount : selected.size,
    search,
    setSearch,
    visibleRows,
    isSelected: (index: number) => selected === null || selected.has(index),
    isAllVisibleChecked:
      visibleRows.length > 0 && visibleRows.every((index) => selected === null || selected.has(index)),
    toggleRow: (index: number) => setSelected((previous) => toggledSelection(previous, index, rowCount)),
    setVisibleChecked: (checked: boolean) =>
      setSelected((previous) => withRowsChecked(previous, visibleRows, checked, rowCount)),
    problems,
    dataProblems,
    isChecking,
    currentRow: current,
    setCurrentRow,
    stepRow: (delta: number) => setCurrentRow(stepRowIndex(visibleRows, current, delta)),
    preview,
    status,
    isRunning,
    isStopping,
    failures: failuresByRow(status, dataTable?.id ?? null),
    startIssue,
    start: async () => {
      if (plan === null) {
        return;
      }
      try {
        accept(await window.api.startBatch(plan));
      } catch (error) {
        reportError('开始批量打印', error);
      }
    },
    control: (action: BatchControl) => {
      const call = { pause: window.api.pauseBatch, resume: window.api.resumeBatch, cancel: window.api.cancelBatch }[
        action
      ];
      call().catch((error: unknown) => reportError('批量打印', error));
    },
    /** 重打这一批失败的标签（row 为 null 时整批）：按打印记录里当时的模板和字段。 */
    retryFailed: async (batchId: string, row: number | null) => {
      try {
        accept(await window.api.retryBatchFailures(batchId, row));
      } catch (error) {
        reportError('重打失败的标签', error);
      }
    },
  };
}

export type BatchViewModel = ReturnType<typeof useBatch>;
