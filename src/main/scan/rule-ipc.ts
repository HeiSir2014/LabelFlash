import { readFile, stat, writeFile } from 'node:fs/promises';
import { type BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { MAX_RULE_FILE_BYTES, RULE_FILE_EXTENSION } from '../../core/scan/rule-file';
import { sanitizeRuleSettings } from '../../core/scan/rule-settings';
import { IpcChannel } from '../../shared/ipc-contract';
import type { RuleExportResult, RuleImportResult } from '../../shared/rule-api';
import { requireRaw, requireRecord, requireRuleId, requireRuleIds, requireRuleKind } from '../ipc-validators';
import type { RuleService } from './rule-service';

export type Handle = (channel: string, listener: (...args: unknown[]) => unknown) => void;

const BYTES_PER_KB = 1024;
const RULE_FILE_FILTERS = [{ name: '识别规则', extensions: ['json'] }];

/** 「识别规则」页的 IPC：参数校验和文件对话框在这里，业务在 RuleService。 */
export function registerRuleIpc(handle: Handle, rules: RuleService, getWindow: () => BrowserWindow | null): void {
  handle(IpcChannel.ListRules, () => rules.list());
  handle(IpcChannel.CreateRule, (kind) => rules.create(requireRuleKind(kind)));
  handle(IpcChannel.DuplicateRule, (id) => rules.duplicate(requireRuleId(id)));
  handle(IpcChannel.SaveRule, (rule) => {
    const record = requireRecord(rule, 'rule');
    return rules.save(requireRuleId(record['id']), record);
  });
  handle(IpcChannel.DeleteRule, (id) => rules.remove(requireRuleId(id)));
  handle(IpcChannel.SaveRuleSettings, (settings) => {
    if (!Array.isArray(settings)) {
      throw new TypeError('Invalid rule settings');
    }
    return rules.saveSettings(sanitizeRuleSettings(settings));
  });
  handle(IpcChannel.TestRule, (raw, draft) =>
    rules.test(requireRaw(raw), draft === undefined ? undefined : requireRecord(draft, 'draft rule')),
  );
  handle(IpcChannel.ExportRules, async (ids): Promise<RuleExportResult> => {
    const { text, count } = rules.exportText(requireRuleIds(ids));
    const options: SaveDialogOptions = {
      title: '导出识别规则',
      defaultPath: `识别规则.${RULE_FILE_EXTENSION}`,
      filters: RULE_FILE_FILTERS,
    };
    const window = getWindow();
    const { canceled, filePath } = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) {
      return { status: 'canceled' };
    }
    await writeFile(filePath, text, 'utf8');
    return { status: 'saved', count };
  });
  handle(IpcChannel.ImportRules, async (): Promise<RuleImportResult> => {
    const options: OpenDialogOptions = { title: '导入识别规则', filters: RULE_FILE_FILTERS, properties: ['openFile'] };
    const window = getWindow();
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [path] = filePaths;
    if (canceled || path === undefined) {
      return { status: 'canceled' };
    }
    if ((await stat(path)).size > MAX_RULE_FILE_BYTES) {
      return { status: 'invalid', issue: `文件不能超过 ${MAX_RULE_FILE_BYTES / BYTES_PER_KB}KB` };
    }
    return rules.importText(await readFile(path, 'utf8'));
  });
}
