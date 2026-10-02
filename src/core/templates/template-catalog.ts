import { DEFAULT_PAPER } from '../../shared/label-paper';
import { BUILT_IN_TEMPLATES, currentTemplateId, GENERIC_TEMPLATE } from './builtin-templates';
import type { CanvasTemplate } from './canvas-model';
import { sanitizeTemplate } from './sanitize-template';
import { CUSTOM_TEMPLATE_PREFIX, isBuiltInTemplateId, type LabelTemplate, TEMPLATE_LIMITS } from './template-model';

/** 自定义模板的持久化（同步，与 DatabaseSync 一致）。 */
export interface TemplateRepository {
  listCustom(): LabelTemplate[];
  save(template: LabelTemplate): void;
  remove(id: string): void;
}

/** 新建的自由设计模板的名字：进了设计器在右栏「模板」里改。 */
export const NEW_CANVAS_TEMPLATE_NAME = '新的自由设计';

export type TemplateErrorCode = 'BUILT_IN_READ_ONLY' | 'NOT_FOUND';

export class TemplateError extends Error {
  readonly code: TemplateErrorCode;

  constructor(code: TemplateErrorCode, message: string) {
    super(message);
    this.name = 'TemplateError';
    this.code = code;
  }
}

/** 内置模板（只读，随程序发布）+ 自定义模板（存数据库）。 */
export class TemplateCatalog {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly createId: () => string,
  ) {}

  list(): LabelTemplate[] {
    return [...BUILT_IN_TEMPLATES, ...this.repository.listCustom()];
  }

  /** 去掉的内置模板按替代它的那个找：打印记录、旧设置里存的还是当时的编号。 */
  get(id: string): LabelTemplate | null {
    const current = currentTemplateId(id);
    return this.list().find((template) => template.id === current) ?? null;
  }

  /** 找不到（例如已被删除）时回退到通用模板，保证打印永远有模板可用。 */
  resolve(id: string): LabelTemplate {
    return this.get(id) ?? GENERIC_TEMPLATE;
  }

  duplicate(sourceId: string): LabelTemplate {
    const source = this.resolve(sourceId);
    const copy: LabelTemplate = {
      ...structuredClone(source),
      id: `${CUSTOM_TEMPLATE_PREFIX}${this.createId()}`,
      name: `${source.name} 副本`.slice(0, TEMPLATE_LIMITS.nameLength),
    };
    this.repository.save(copy);
    return copy;
  }

  /** 新建空白的自由设计模板（默认纸张、没有元素），存成自定义模板，接着在设计器里编辑。 */
  createCanvas(): CanvasTemplate {
    const template: CanvasTemplate = {
      kind: 'canvas',
      id: `${CUSTOM_TEMPLATE_PREFIX}${this.createId()}`,
      name: NEW_CANVAS_TEMPLATE_NAME,
      paper: { ...DEFAULT_PAPER },
      printer: null,
      elements: [],
    };
    this.repository.save(template);
    return template;
  }

  save(id: string, value: unknown): LabelTemplate {
    const existing = this.requireCustom(id);
    const template = sanitizeTemplate(value, id, existing);
    this.repository.save(template);
    return template;
  }

  remove(id: string): void {
    this.requireCustom(id);
    this.repository.remove(id);
  }

  private requireCustom(id: string): LabelTemplate {
    if (isBuiltInTemplateId(id)) {
      throw new TemplateError('BUILT_IN_READ_ONLY', `Built-in template ${id} cannot be changed`);
    }
    const existing = this.get(id);
    if (!existing) {
      throw new TemplateError('NOT_FOUND', `Template ${id} does not exist`);
    }
    return existing;
  }
}
