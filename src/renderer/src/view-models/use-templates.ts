import { useCallback, useEffect, useMemo, useState } from 'react';
import { isBuiltInTemplateId, type LabelTemplate } from '../../../core/templates/template-model';
import type { AppSettings } from '../../../shared/settings';
import { notices, reportError } from '../lib/notices';

interface TemplatesOptions {
  activeTemplateId: string | null;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings | null>;
  replaceSettings: (settings: AppSettings) => void;
  onActiveTemplateChanged: () => void;
}

/** 模板列表、启用、复制、编辑（草稿）、保存、删除。草稿只用于预览，保存后才用于打印。 */
export function useTemplates({
  activeTemplateId,
  updateSettings,
  replaceSettings,
  onActiveTemplateChanged,
}: TemplatesOptions) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [draft, setDraft] = useState<LabelTemplate | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await window.api.listTemplates());
    } catch (error) {
      reportError('读取模板', error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(
    () => templates.find((template) => template.id === activeTemplateId) ?? templates[0] ?? null,
    [templates, activeTemplateId],
  );
  const stored = useMemo(() => templates.find((template) => template.id === draft?.id) ?? null, [templates, draft]);
  const isDirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored);

  const activate = useCallback(
    async (id: string) => {
      if (await updateSettings({ activeTemplateId: id })) {
        onActiveTemplateChanged();
      }
    },
    [updateSettings, onActiveTemplateChanged],
  );

  const duplicate = useCallback(
    async (sourceId: string) => {
      try {
        const copy = await window.api.duplicateTemplate(sourceId);
        await load();
        setDraft(structuredClone(copy));
      } catch (error) {
        reportError('复制模板', error);
      }
    },
    [load],
  );

  const startEdit = useCallback(
    (id: string) => {
      const template = templates.find((candidate) => candidate.id === id);
      if (template && !isBuiltInTemplateId(id)) {
        setDraft(structuredClone(template));
      }
    },
    [templates],
  );

  const saveDraft = useCallback(async () => {
    if (!draft) {
      return;
    }
    try {
      const saved = await window.api.saveTemplate(draft);
      await load();
      setDraft(null);
      notices.push('info', `模板「${saved.name}」已保存`);
      if (saved.id === activeTemplateId) {
        onActiveTemplateChanged();
      }
    } catch (error) {
      reportError('保存模板', error);
    }
  }, [draft, load, activeTemplateId, onActiveTemplateChanged]);

  const remove = useCallback(
    async (id: string) => {
      try {
        replaceSettings(await window.api.deleteTemplate(id));
        await load();
        setDraft((current) => (current?.id === id ? null : current));
        if (id === activeTemplateId) {
          onActiveTemplateChanged();
        }
      } catch (error) {
        reportError('删除模板', error);
      }
    },
    [load, replaceSettings, activeTemplateId, onActiveTemplateChanged],
  );

  return {
    templates,
    active,
    draft,
    isDirty,
    activate,
    duplicate,
    startEdit,
    changeDraft: setDraft,
    saveDraft,
    cancelEdit: () => setDraft(null),
    remove,
  };
}
