import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isBuiltInTemplateId, type LabelTemplate } from '../../../core/templates/template-model';
import type { AppSettings } from '../../../shared/settings';
import { deepEqual } from '../lib/deep-equal';
import { notices, reportError } from '../lib/notices';
import { describeSamplePrint } from '../lib/status-text';

interface TemplatesOptions {
  activeTemplateId: string | null;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings | null>;
  replaceSettings: (settings: AppSettings) => void;
  onActiveTemplateChanged: () => void;
}

/**
 * 模板列表、选中（模板页里点选即预览）、启用、复制、编辑（草稿）、保存、删除。
 * 草稿只用于预览，保存后才用于打印。
 */
export function useTemplates({
  activeTemplateId,
  updateSettings,
  replaceSettings,
  onActiveTemplateChanged,
}: TemplatesOptions) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [draft, setDraft] = useState<LabelTemplate | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPrintingSample, setIsPrintingSample] = useState(false);
  // 守着「打印一张试试」：用 ref 而不是只看 state，state 的更新要等下一次渲染才生效，
  // 同一个事件循环里的第二次点击读到的还是旧值，光靠 state 挡不住几乎同时的两次点击。
  const isPrintingSampleRef = useRef(false);
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  // 守着「新建自由设计模板」：原因同上——双击按钮会在主进程回应第一次调用之前就发出第二次，
  // 光靠 state 挡不住，得建出两个空白模板才反应过来。
  const isCreatingCanvasRef = useRef(false);

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
  /** 模板页列表里选中的模板；还没点选过（或选中的被删了）时是使用中的模板。 */
  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? active,
    [templates, selectedId, active],
  );
  const stored = useMemo(() => templates.find((template) => template.id === draft?.id) ?? null, [templates, draft]);
  const isDirty = draft !== null && !deepEqual(draft, stored);

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
        setSelectedId(copy.id);
        setDraft(structuredClone(copy));
      } catch (error) {
        reportError('复制模板', error);
      }
    },
    [load],
  );

  /**
   * 新建空白的自由设计模板：选中它，直接进设计器。
   * 建好之前再点一下什么也不做，不然双击按钮会建出两个空白模板。
   */
  const createCanvas = useCallback(async () => {
    if (isCreatingCanvasRef.current) {
      return;
    }
    isCreatingCanvasRef.current = true;
    setIsCreatingCanvas(true);
    try {
      const created = await window.api.createCanvasTemplate();
      await load();
      setSelectedId(created.id);
      setDraft(structuredClone(created));
    } catch (error) {
      reportError('新建自由设计模板', error);
    } finally {
      isCreatingCanvasRef.current = false;
      setIsCreatingCanvas(false);
    }
  }, [load]);

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

  /**
   * 「打印一张试试」：按预览内容打印草稿，结果用提示条说。
   * 在调模板时连点按钮会打出好几张一样的草稿，所以打印未完成前，再点一下什么也不做。
   * 复制自模板库、还在用示例数据预览时，打的也是示例数据（librarySampleId）。
   */
  const printSample = useCallback(
    async (raw: string, librarySampleId: string | null) => {
      if (!draft || isPrintingSampleRef.current) {
        return;
      }
      isPrintingSampleRef.current = true;
      setIsPrintingSample(true);
      try {
        const notice = describeSamplePrint(await window.api.printSample(raw, draft, librarySampleId), Date.now());
        notices.push(notice.tone, notice.message);
      } catch (error) {
        reportError('打印一张试试', error);
      } finally {
        isPrintingSampleRef.current = false;
        setIsPrintingSample(false);
      }
    },
    [draft],
  );

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
    selected,
    draft,
    isDirty,
    select: setSelectedId,
    activate,
    duplicate,
    createCanvas,
    isCreatingCanvas,
    startEdit,
    changeDraft: setDraft,
    saveDraft,
    printSample,
    isPrintingSample,
    cancelEdit: () => setDraft(null),
    remove,
  };
}

export type TemplatesViewModel = ReturnType<typeof useTemplates>;
