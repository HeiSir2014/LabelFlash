import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LookupTableInfo } from '../../../core/lookup/lookup-model';
import { isBuiltInRuleId, type RuleKind, type ScanRule } from '../../../core/scan/rule-model';
import type { RuleSetting } from '../../../core/scan/rule-settings';
import type { RuleListing, RuleTestResult } from '../../../shared/rule-api';
import { notices, reportError } from '../lib/notices';

/** 规则设置有变化后回调（例如刷新扫码预览：绑定的模板变了）。 */
interface RulesOptions {
  onRulesChanged: () => void;
}

/**
 * 「识别规则」页：规则列表、顺序 / 启用 / 模板绑定、编辑草稿、试一试、导入导出、查找表和密钥。
 * 草稿保存前只用于「试一试」，不影响打印。
 */
export function useRules({ onRulesChanged }: RulesOptions) {
  const [listing, setListing] = useState<RuleListing>({ rules: [], settings: [] });
  const [draft, setDraft] = useState<ScanRule | null>(null);
  const [saveIssue, setSaveIssue] = useState<string | null>(null);
  const [lookupTables, setLookupTables] = useState<LookupTableInfo[]>([]);
  const [secretNames, setSecretNames] = useState<string[]>([]);

  const apply = useCallback(
    (next: RuleListing) => {
      setListing(next);
      onRulesChanged();
    },
    [onRulesChanged],
  );

  const load = useCallback(async () => {
    try {
      const [rules, tables, secrets] = await Promise.all([
        window.api.listRules(),
        window.api.listLookupTables(),
        window.api.listSecrets(),
      ]);
      setListing(rules);
      setLookupTables(tables);
      setSecretNames(secrets);
    } catch (error) {
      reportError('读取识别规则', error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 按本机顺序排好的规则和它们的设置。 */
  const ordered = useMemo(() => {
    const byId = new Map(listing.rules.map((rule) => [rule.id, rule]));
    return listing.settings.flatMap((setting) => {
      const rule = byId.get(setting.id);
      return rule ? [{ rule, setting }] : [];
    });
  }, [listing]);

  const stored = useMemo(() => listing.rules.find((rule) => rule.id === draft?.id) ?? null, [listing, draft]);
  const isDirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored);

  const saveSettings = useCallback(
    async (settings: RuleSetting[]) => {
      try {
        apply(await window.api.saveRuleSettings(settings));
      } catch (error) {
        reportError('保存规则设置', error);
      }
    },
    [apply],
  );

  const updateSetting = (id: string, patch: Partial<RuleSetting>) =>
    saveSettings(listing.settings.map((setting) => (setting.id === id ? { ...setting, ...patch } : setting)));

  const move = (id: string, offset: -1 | 1) => {
    const settings = [...listing.settings];
    const index = settings.findIndex((setting) => setting.id === id);
    const target = index + offset;
    const [moved] = settings.splice(index, 1);
    if (index === -1 || target < 0 || target > settings.length || !moved) {
      return;
    }
    settings.splice(target, 0, moved);
    void saveSettings(settings);
  };

  const mutate = async (action: string, run: () => ReturnType<typeof window.api.createRule>) => {
    try {
      const result = await run();
      if (!result.ok) {
        notices.push('warning', `${action}失败：${result.issue}`);
        return;
      }
      await load();
      onRulesChanged();
      setSaveIssue(null);
      setDraft(structuredClone(result.rule));
    } catch (error) {
      reportError(action, error);
    }
  };

  const saveDraft = async () => {
    if (!draft) {
      return;
    }
    try {
      const result = await window.api.saveRule(draft);
      if (!result.ok) {
        setSaveIssue(result.issue);
        return;
      }
      await load();
      onRulesChanged();
      setDraft(null);
      setSaveIssue(null);
      notices.push('info', `规则「${result.rule.name}」已保存`);
    } catch (error) {
      reportError('保存规则', error);
    }
  };

  const remove = async (id: string) => {
    try {
      apply(await window.api.deleteRule(id));
      setDraft((current) => (current?.id === id ? null : current));
    } catch (error) {
      reportError('删除规则', error);
    }
  };

  const importRules = async () => {
    try {
      const result = await window.api.importRules();
      if (result.status === 'canceled') {
        return;
      }
      if (result.status === 'invalid') {
        notices.push('warning', `导入失败：${result.issue}`);
        return;
      }
      await load();
      onRulesChanged();
      const skipped = result.skipped.map((item) => `第 ${item.index + 1} 条：${item.issue}`).join('；');
      notices.push(
        result.skipped.length > 0 ? 'warning' : 'info',
        `导入了 ${result.imported} 条规则${skipped ? `，跳过 ${result.skipped.length} 条（${skipped}）` : ''}`,
      );
      if (result.httpHosts.length > 0) {
        notices.push(
          'warning',
          `有规则会把扫码内容发到 ${result.httpHosts.join('、')}，已先停用；确认可信后在列表里手动启用`,
        );
      }
    } catch (error) {
      reportError('导入规则', error);
    }
  };

  const exportRules = async (ids: string[]) => {
    try {
      const result = await window.api.exportRules(ids);
      if (result.status === 'saved') {
        notices.push('info', `已导出 ${result.count} 条规则`);
      }
    } catch (error) {
      reportError('导出规则', error);
    }
  };

  /** 按保存好的全部规则试（稳定引用）。 */
  const testSaved = useCallback(async (raw: string) => runTest(raw, undefined), []);
  /** 只用正在编辑的草稿试；草稿变化时引用随之变化，试一试会自动重试。 */
  const testDraft = useCallback(async (raw: string) => runTest(raw, draft ?? undefined), [draft]);

  const importLookupTable = async (replaceId: string | null) => {
    try {
      const result = await window.api.importLookupTable(replaceId);
      if (result.status === 'invalid') {
        notices.push('warning', `导入表格失败：${result.issue}`);
      } else if (result.status === 'imported') {
        notices.push('info', `表格「${result.table.name}」已导入，${result.table.rowCount} 行`);
        setLookupTables(await window.api.listLookupTables());
      }
    } catch (error) {
      reportError('导入表格', error);
    }
  };

  const deleteLookupTable = async (id: string) => {
    try {
      await window.api.deleteLookupTable(id);
      setLookupTables(await window.api.listLookupTables());
    } catch (error) {
      reportError('删除表格', error);
    }
  };

  const setSecret = async (name: string, value: string): Promise<string | null> => {
    try {
      const result = await window.api.setSecret(name, value);
      if (!result.ok) {
        return result.issue;
      }
      setSecretNames(await window.api.listSecrets());
      return null;
    } catch (error) {
      reportError('保存密钥', error);
      return '保存失败';
    }
  };

  const deleteSecret = async (name: string) => {
    try {
      await window.api.deleteSecret(name);
      setSecretNames(await window.api.listSecrets());
    } catch (error) {
      reportError('删除密钥', error);
    }
  };

  return {
    ordered,
    customIds: listing.rules.filter((rule) => !isBuiltInRuleId(rule.id)).map((rule) => rule.id),
    draft,
    isDirty,
    saveIssue,
    lookupTables,
    secretNames,
    setEnabled: (id: string, enabled: boolean) => void updateSetting(id, { enabled }),
    bindTemplate: (id: string, templateId: string | null) => void updateSetting(id, { templateId }),
    move,
    create: (kind: RuleKind) => void mutate('新建规则', () => window.api.createRule(kind)),
    duplicate: (id: string) => void mutate('复制规则', () => window.api.duplicateRule(id)),
    startEdit: (id: string) => {
      const rule = listing.rules.find((candidate) => candidate.id === id);
      if (rule && !isBuiltInRuleId(id)) {
        setSaveIssue(null);
        setDraft(structuredClone(rule));
      }
    },
    changeDraft: (next: ScanRule) => {
      setSaveIssue(null);
      setDraft(next);
    },
    saveDraft: () => void saveDraft(),
    cancelEdit: () => {
      setSaveIssue(null);
      setDraft(null);
    },
    remove: (id: string) => void remove(id),
    importRules: () => void importRules(),
    exportRules: (ids: string[]) => void exportRules(ids),
    testSaved,
    testDraft,
    importLookupTable: (replaceId: string | null) => void importLookupTable(replaceId),
    deleteLookupTable: (id: string) => void deleteLookupTable(id),
    setSecret,
    deleteSecret: (name: string) => void deleteSecret(name),
  };
}

export type RulesViewModel = ReturnType<typeof useRules>;

async function runTest(raw: string, draft: ScanRule | undefined): Promise<RuleTestResult | null> {
  try {
    return await window.api.testRule(raw, draft);
  } catch (error) {
    reportError('试一试', error);
    return null;
  }
}
