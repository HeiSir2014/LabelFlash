import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandSetChoice, PrinterAction } from '../../../core/printer-commands/command-model';
import type { PaperSize } from '../../../shared/paper-sizes';
import type { PrinterCommandResult, PrinterCommandsView } from '../../../shared/printer-commands';
import { reportError } from '../lib/notices';
import {
  busyFor,
  type CommandForm,
  type CommandMessage,
  type CommandRequest,
  type CommandRequestTicket,
  configFromForm,
  describeCommandResult,
  formFromConfig,
  isFormDirty,
  isSameRequest,
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
  /** 哪台打印机、哪个请求正在跑；展开的面板换了之后，旧请求不再显示成「正在发送」（busyFor 按打印机名过滤）。 */
  const [busyTicket, setBusyTicket] = useState<CommandRequestTicket | null>(null);
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

  /**
   * printerName 在请求发出的那一刻就固定下来：操作员随后可能切换面板，结果回来时要核对
   * 当时开着的还是不是这一台，不是的话就不显示消息、也不拿它的结果去刷新现在打开的面板（isSameRequest）。
   */
  const send = async (
    printerName: string,
    request: CommandRequest,
    call: () => Promise<PrinterCommandResult>,
  ): Promise<void> => {
    const ticket: CommandRequestTicket = { printerName, request };
    setBusyTicket(ticket);
    if (openNameRef.current === printerName) {
      setMessage(null);
    }
    try {
      const result = await call();
      if (openNameRef.current === printerName) {
        setMessage(describeCommandResult(result, request));
        // 没通过把关的设置没有保存：留着操作员改到一半的表单；其余情况重新读，表单回到保存的样子。
        if (request === 'save' && result.status !== 'invalid') {
          await load(printerName);
        }
      }
    } catch (error) {
      reportError(request === 'save' ? '保存标签机指令设置' : '发送打印机指令', error);
    } finally {
      // 这段时间里可能已经有新的请求把 ticket 换掉了（针对现在这台或另一台打印机），不要把它清空。
      setBusyTicket((current) => (isSameRequest(current, printerName, request) ? null : current));
    }
  };

  const run = (action: PrinterAction) => {
    if (openName !== null) {
      const printerName = openName;
      void send(printerName, action, () => window.api.runPrinterAction(printerName, action));
    }
  };

  return {
    openName,
    view,
    form,
    isDirty: form !== null && savedForm !== null && isFormDirty(form, savedForm),
    busy: busyFor(busyTicket, openName),
    message,
    isConfirmingReset,
    toggle,
    change,
    changeCommandSet,
    save: () => {
      if (openName !== null && form !== null) {
        const printerName = openName;
        const commandConfig = configFromForm(form);
        void send(printerName, 'save', () => window.api.applyPrinterCommands(printerName, commandConfig));
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
