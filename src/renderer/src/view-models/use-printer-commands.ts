import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandSetChoice, PrinterAction } from '../../../core/printer-commands/command-model';
import type { PaperSize } from '../../../shared/paper-sizes';
import type { PrinterCommandResult, PrinterCommandsView } from '../../../shared/printer-commands';
import { reportError } from '../lib/notices';
import {
  type CommandForm,
  type CommandMessage,
  type CommandRequest,
  configFromForm,
  describeCommandResult,
  formFromConfig,
  isFormDirty,
  withCommandSet,
} from '../lib/printer-commands-view';

/** 「标签机指令」面板的状态和操作（同一时间只展开一台打印机）。 */
export interface PrinterCommandsModel {
  openName: string | null;
  view: PrinterCommandsView | null;
  form: CommandForm | null;
  isDirty: boolean;
  busy: CommandRequest | null;
  message: CommandMessage | null;
  isConfirmingReset: boolean;
  toggle(printerName: string): void;
  change(patch: Partial<CommandForm>): void;
  changeCommandSet(choice: CommandSetChoice): void;
  save(): void;
  run(action: PrinterAction): void;
  /** 「恢复出厂设置」的第一次确认（按钮两步）之后：打开第二次确认的对话框。 */
  requestReset(): void;
  confirmReset(): void;
  cancelReset(): void;
}

/** paperOf：这台打印机负责的纸，纸张那一组按它预填。 */
export function usePrinterCommands(paperOf: (printerName: string) => PaperSize): PrinterCommandsModel {
  const [openName, setOpenName] = useState<string | null>(null);
  const [view, setView] = useState<PrinterCommandsView | null>(null);
  const [form, setForm] = useState<CommandForm | null>(null);
  const [savedForm, setSavedForm] = useState<CommandForm | null>(null);
  const [busy, setBusy] = useState<CommandRequest | null>(null);
  const [message, setMessage] = useState<CommandMessage | null>(null);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  // 最新的值给异步回调用；在 effect 里更新，不在渲染过程中改 ref。
  const paperOfRef = useRef(paperOf);
  const openNameRef = useRef<string | null>(null);
  useEffect(() => {
    paperOfRef.current = paperOf;
  }, [paperOf]);
  useEffect(() => {
    openNameRef.current = openName;
  }, [openName]);

  const load = useCallback(async (name: string): Promise<void> => {
    try {
      const next = await window.api.printerCommands(name);
      // 读的过程中换了打印机或收起了面板：丢掉这次的结果。
      if (openNameRef.current !== name) {
        return;
      }
      const loaded = formFromConfig(next.config, paperOfRef.current(name));
      setView(next);
      setForm(loaded);
      setSavedForm(loaded);
    } catch (error) {
      reportError('读取标签机指令设置', error);
      if (openNameRef.current === name) {
        setOpenName(null);
      }
    }
  }, []);

  useEffect(() => {
    setView(null);
    setForm(null);
    setSavedForm(null);
    setMessage(null);
    setIsConfirmingReset(false);
    if (openName !== null) {
      void load(openName);
    }
  }, [openName, load]);

  const toggle = useCallback((name: string) => {
    setOpenName((current) => (current === name ? null : name));
  }, []);

  const change = useCallback((patch: Partial<CommandForm>) => {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  const changeCommandSet = useCallback(
    (choice: CommandSetChoice) => {
      setForm((current) => (current === null ? current : withCommandSet(current, choice, view?.detected ?? null)));
    },
    [view],
  );

  const send = async (request: CommandRequest, call: () => Promise<PrinterCommandResult>): Promise<void> => {
    setBusy(request);
    setMessage(null);
    try {
      const result = await call();
      setMessage(describeCommandResult(result, request));
      // 没通过把关的设置没有保存：留着操作员改到一半的表单；其余情况重新读，表单回到保存的样子。
      if (request === 'save' && result.status !== 'invalid' && openName !== null) {
        await load(openName);
      }
    } catch (error) {
      reportError(request === 'save' ? '保存标签机指令设置' : '发送打印机指令', error);
    } finally {
      setBusy(null);
    }
  };

  const run = (action: PrinterAction) => {
    if (openName !== null) {
      void send(action, () => window.api.runPrinterAction(openName, action));
    }
  };

  return {
    openName,
    view,
    form,
    isDirty: form !== null && savedForm !== null && isFormDirty(form, savedForm),
    busy,
    message,
    isConfirmingReset,
    toggle,
    change,
    changeCommandSet,
    save: () => {
      if (openName !== null && form !== null) {
        void send('save', () => window.api.applyPrinterCommands(openName, configFromForm(form)));
      }
    },
    run,
    requestReset: () => setIsConfirmingReset(true),
    confirmReset: () => {
      setIsConfirmingReset(false);
      run('factoryReset');
    },
    cancelReset: () => setIsConfirmingReset(false),
  };
}
