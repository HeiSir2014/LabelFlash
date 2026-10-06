import { useCallback, useEffect, useRef, useState } from 'react';
import { type NormalizedBox, PDF_LIMITS, type PdfLayout } from '../../../core/pdf/pdf-model';
import { DEFAULT_IMAGE_THRESHOLD } from '../../../core/templates/canvas-model';
import {
  PDF_TOO_LARGE_ISSUE,
  type PdfDocumentView,
  type PdfLayoutResult,
  type PdfOpenResult,
  type PdfPiecePreviewResult,
  type PdfStatus,
} from '../../../shared/pdf';
import { reportError } from '../lib/notices';
import {
  canAddBox,
  defaultPaperKey,
  isPdfPrinting,
  keepsResultOnIssue,
  movePiece,
  printCount,
  visibleOrder,
} from '../lib/pdf-view';

/** 拖阈值滑块时停下 0.3 秒再重新出块：每次出块都要把每一页重新渲染一遍。 */
const THRESHOLD_DEBOUNCE_MS = 300;

type LaidOut = Extract<PdfLayoutResult, { status: 'ok' }>;
type PrintControl = 'pause' | 'resume' | 'cancel';

export interface PdfViewModel {
  pdfFile: PdfDocumentView | null;
  /** 打不开、处理失败、打印被拒的原因；没有为 null。 */
  issue: string | null;
  layout: PdfLayout;
  result: LaidOut | null;
  isLayingOut: boolean;
  /** 全部块的顺序（含删掉的，删掉的在 removed 里）。 */
  order: readonly string[];
  removed: ReadonlySet<string>;
  copies: number;
  labelCount: number;
  selectedId: string | null;
  preview: PdfPiecePreviewResult | null;
  status: PdfStatus | null;
  /** 正在打或暂停中：不能换文件、改设置。 */
  isPrinting: boolean;
  /** 正在打开一个文件：再选、再拖进来的不发出去。 */
  isOpening: boolean;
  openFile: () => Promise<void>;
  dropFile: (file: File) => void;
  changeLayout: (patch: Partial<PdfLayout>) => void;
  addBox: (box: NormalizedBox) => void;
  removeBox: (index: number) => void;
  select: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  removePiece: (id: string) => void;
  restoreAll: () => void;
  setCopies: (copies: number) => void;
  print: () => Promise<void>;
  control: (action: PrintControl) => void;
  close: () => Promise<void>;
}

/** 打印 PDF 页的状态：设置留在这里（关掉页面再打开还在），文件、出块、打印都在主进程。 */
export function usePdf({ paperPrinters }: { paperPrinters: Readonly<Record<string, string>> }): PdfViewModel {
  const [pdfFile, setPdfFile] = useState<PdfDocumentView | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [layout, setLayout] = useState<PdfLayout>(() => ({
    paperKey: defaultPaperKey(paperPrinters),
    crop: 'page',
    boxes: [],
    mono: 'threshold',
    threshold: DEFAULT_IMAGE_THRESHOLD,
  }));
  const [result, setResult] = useState<LaidOut | null>(null);
  const [isLayingOut, setIsLayingOut] = useState(false);
  const [order, setOrder] = useState<readonly string[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [copies, setCopies] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PdfPiecePreviewResult | null>(null);
  const [status, setStatus] = useState<PdfStatus | null>(null);
  /** 最新的设置：连着改两项时第二次在第一次的基础上改（不等这一帧重新渲染）。 */
  const layoutRef = useRef(layout);
  const layoutTimer = useRef<number | null>(null);
  /** 每次出块加一：晚回来的旧结果丢掉。 */
  const layoutRequest = useRef(0);

  useEffect(() => {
    let isMounted = true;
    window.api.getPdfStatus().then(
      (next) => {
        if (isMounted) {
          setStatus(next);
        }
      },
      (error: unknown) => reportError('读取 PDF 打印状态', error),
    );
    const unsubscribe = window.api.onPdfStatus(setStatus);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(
    () => () => {
      if (layoutTimer.current !== null) {
        window.clearTimeout(layoutTimer.current);
      }
    },
    [],
  );

  // 还没打开文件时，默认纸张跟着纸张分配走（设置是异步读进来的）。
  useEffect(() => {
    if (pdfFile === null) {
      const next = { ...layoutRef.current, paperKey: defaultPaperKey(paperPrinters) };
      layoutRef.current = next;
      setLayout(next);
    }
  }, [paperPrinters, pdfFile]);

  const clearPieces = useCallback(() => {
    setResult(null);
    setOrder([]);
    setRemoved(new Set());
    setSelectedId(null);
  }, []);

  const relayout = useCallback(
    async (next: PdfLayout) => {
      layoutRequest.current += 1;
      const request = layoutRequest.current;
      // 手动框选还没画框：没有可出的块，等画了框再出。
      if (next.crop === 'manual' && next.boxes.length === 0) {
        clearPieces();
        setIsLayingOut(false);
        return;
      }
      setIsLayingOut(true);
      try {
        const outcome = await window.api.layoutPdf(next);
        if (request !== layoutRequest.current || outcome.status === 'superseded') {
          return;
        }
        if (outcome.status === 'invalid') {
          setIssue(outcome.issue);
          // 主进程拒绝只是因为正在打印（判定窗口比这里的 isPrinting 更宽，两边有一瞬间不一致）：
          // 这不是这次出块真的作废了，保留已经出好的块，不要清空重来。
          if (!keepsResultOnIssue(outcome.issue)) {
            clearPieces();
          }
          return;
        }
        setIssue(null);
        setResult(outcome);
        setOrder(outcome.pieces.map((piece) => piece.id));
        setRemoved(new Set());
        setSelectedId(outcome.pieces[0]?.id ?? null);
      } catch (error) {
        reportError('处理 PDF', error);
      } finally {
        if (request === layoutRequest.current) {
          setIsLayingOut(false);
        }
      }
    },
    [clearPieces],
  );

  const applyLayout = useCallback(
    (next: PdfLayout, delayMs: number) => {
      layoutRef.current = next;
      setLayout(next);
      if (layoutTimer.current !== null) {
        window.clearTimeout(layoutTimer.current);
      }
      layoutTimer.current = window.setTimeout(() => {
        layoutTimer.current = null;
        void relayout(next);
      }, delayMs);
    },
    [relayout],
  );

  const opened = useCallback(
    (outcome: PdfOpenResult) => {
      if (outcome.status === 'canceled' || outcome.status === 'superseded') {
        return;
      }
      if (outcome.status === 'invalid') {
        setIssue(outcome.issue);
        return;
      }
      setIssue(null);
      setPdfFile(outcome.document);
      clearPieces();
      // 新文件：裁切方式用自动识别的；手动框是上一个文件的，清掉；纸张、转黑白方式沿用。
      applyLayout({ ...layoutRef.current, crop: outcome.document.detected, boxes: [] }, 0);
    },
    [applyLayout, clearPieces],
  );

  // 同一时间只打开一个文件：连着点两次「选择 PDF…」、连着拖进两个文件时，后来的那次不发出去
  // （主进程那边也会把被超过的一次作废，这里先挡住，免得白建一个渲染页）。
  const openingRef = useRef(false);
  const [isOpening, setIsOpening] = useState(false);
  const whileOpening = useCallback(async (open: () => Promise<void>) => {
    if (openingRef.current) {
      return;
    }
    openingRef.current = true;
    setIsOpening(true);
    try {
      await open();
    } finally {
      openingRef.current = false;
      setIsOpening(false);
    }
  }, []);

  const openFile = useCallback(
    () =>
      whileOpening(async () => {
        try {
          opened(await window.api.openPdfFile());
        } catch (error) {
          reportError('打开 PDF', error);
        }
      }),
    [opened, whileOpening],
  );

  const dropFile = useCallback(
    (file: File) => {
      // 太大的文件不读进内存，直接说明（主进程收到后还会再核对一次）。
      if (file.size > PDF_LIMITS.fileBytes) {
        setIssue(PDF_TOO_LARGE_ISSUE);
        return;
      }
      void whileOpening(async () => {
        try {
          opened(await window.api.readDroppedPdf(file.name, new Uint8Array(await file.arrayBuffer())));
        } catch (error) {
          reportError('打开拖进来的 PDF', error);
        }
      });
    },
    [opened, whileOpening],
  );

  const changeLayout = useCallback(
    (patch: Partial<PdfLayout>) =>
      applyLayout({ ...layoutRef.current, ...patch }, patch.threshold === undefined ? 0 : THRESHOLD_DEBOUNCE_MS),
    [applyLayout],
  );

  const addBox = useCallback(
    (box: NormalizedBox) => {
      const current = layoutRef.current;
      if (canAddBox(current.boxes)) {
        applyLayout({ ...current, boxes: [...current.boxes, box] }, 0);
      }
    },
    [applyLayout],
  );

  const removeBox = useCallback(
    (index: number) => {
      const current = layoutRef.current;
      applyLayout({ ...current, boxes: current.boxes.filter((_, at) => at !== index) }, 0);
    },
    [applyLayout],
  );

  const runId = result?.runId ?? null;
  useEffect(() => {
    if (runId === null || selectedId === null) {
      setPreview(null);
      return;
    }
    let isCurrent = true;
    window.api.previewPdfPiece(runId, selectedId).then(
      (next) => {
        if (isCurrent) {
          setPreview(next);
        }
      },
      (error: unknown) => reportError('预览这一张', error),
    );
    return () => {
      isCurrent = false;
    };
  }, [runId, selectedId]);

  const move = useCallback(
    (id: string, delta: -1 | 1) => setOrder((current) => movePiece(current, id, delta, removed)),
    [removed],
  );

  const removePiece = useCallback((id: string) => {
    setRemoved((current) => new Set(current).add(id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const restoreAll = useCallback(() => setRemoved(new Set()), []);

  const print = useCallback(async () => {
    const pieceIds = visibleOrder(order, removed);
    if (result === null || pieceIds.length === 0) {
      return;
    }
    try {
      const started = await window.api.printPdf({ runId: result.runId, pieceIds, copies });
      setIssue(started.status === 'invalid' ? started.issue : null);
    } catch (error) {
      reportError('打印 PDF', error);
    }
  }, [result, order, removed, copies]);

  const control = useCallback((action: PrintControl) => {
    const calls = { pause: window.api.pausePdf, resume: window.api.resumePdf, cancel: window.api.cancelPdf };
    calls[action]().catch((error: unknown) => reportError('控制 PDF 打印', error));
  }, []);

  const close = useCallback(async () => {
    try {
      const result = await window.api.closePdf();
      if (result.status === 'invalid') {
        // 主进程拒绝了（正在打印）：文件还在，照实说明，不能当成已经关掉清空界面。
        setIssue(result.issue);
        return;
      }
      layoutRequest.current += 1;
      setPdfFile(null);
      setIssue(null);
      clearPieces();
    } catch (error) {
      reportError('关闭 PDF', error);
    }
  }, [clearPieces]);

  return {
    pdfFile,
    issue,
    layout,
    result,
    isLayingOut,
    order,
    removed,
    copies,
    labelCount: printCount(order, removed, copies),
    selectedId,
    preview,
    status,
    isPrinting: isPdfPrinting(status),
    isOpening,
    openFile,
    dropFile,
    changeLayout,
    addBox,
    removeBox,
    select: setSelectedId,
    move,
    removePiece,
    restoreAll,
    setCopies,
    print,
    control,
    close,
  };
}
