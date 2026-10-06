import { INSERT_FIELD_PLACEHOLDER, type SelectOption } from '../../lib/insert-field-options';
import { SelectField } from '../form-controls';

interface InsertFieldProps {
  /** 选项（lib/insert-field-options）：规则里的字段名、这次预览识别出的字段和它们的值、固定变量。 */
  fieldOptions: readonly SelectOption[];
  onInsert: (variable: string) => void;
}

/** 「插入字段」：把 {字段名} 接到内容末尾，免得手打花括号和字段名；选项里写着这段预览内容里的值。 */
export function InsertField({ fieldOptions, onInsert }: InsertFieldProps) {
  return (
    <SelectField
      label="插入字段"
      value={INSERT_FIELD_PLACEHOLDER}
      options={fieldOptions}
      onChange={(value) => {
        if (value !== INSERT_FIELD_PLACEHOLDER) {
          onInsert(value);
        }
      }}
    />
  );
}
