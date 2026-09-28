import { applyNoteOverride } from '../core/templates/note-override';
import type { TemplateCatalog } from '../core/templates/template-catalog';
import type { LabelTemplate } from '../core/templates/template-model';
import type { AppSettings } from '../shared/settings';

/** 实际用于打印和预览的模板：当前模板 + 主界面「备注」下拉框的选择。 */
export function resolvePrintTemplate(templates: TemplateCatalog, settings: AppSettings): LabelTemplate {
  return applyNoteOverride(templates.resolve(settings.activeTemplateId), settings.noteOverride);
}
