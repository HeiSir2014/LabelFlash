import { currentTemplateId } from '../templates/builtin-templates';

/** 模板编号的两种前缀（见 templates/template-model.ts）。 */
const PREFIXES = ['builtin', 'custom'] as const;
const COLLECTION = 'templates/';

/**
 * 程序里的模板编号（builtin:generic）→ 接口里的名字（templates/builtin-generic）。
 * 接口里不用冒号：它是 AIP 自定义方法的分隔符（templates/{id}:render）。
 */
export function templateName(templateId: string): string {
  return `${COLLECTION}${templateId.replace(':', '-')}`;
}

/**
 * 接口里的名字或编号（templates/builtin-generic、builtin-generic）→ 程序里的模板编号；不是模板名时为 null。
 * 去掉的「样衣」模板名换成版式相同的通用模板（见 currentTemplateId）。
 */
export function templateIdFromName(name: string): string | null {
  const id = name.startsWith(COLLECTION) ? name.slice(COLLECTION.length) : name;
  for (const prefix of PREFIXES) {
    if (id.startsWith(`${prefix}-`) && id.length > prefix.length + 1) {
      return currentTemplateId(`${prefix}:${id.slice(prefix.length + 1)}`);
    }
  }
  return null;
}
