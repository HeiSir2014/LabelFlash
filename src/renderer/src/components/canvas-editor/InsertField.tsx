import { INSERT_FIELD_PLACEHOLDER, insertFieldOptions } from '../../lib/insert-field-options';
import { SelectField } from '../form-controls';

interface InsertFieldProps {
  /** 规则里出现过的字段名和这次预览识别出的字段名。 */
  fieldNames: readonly string[];
  onInsert: (variable: string) => void;
}

/** 「插入字段」：把 {字段名} 接到内容末尾，免得手打花括号和字段名。 */
export function InsertField({ fieldNames, onInsert }: InsertFieldProps) {
  return (
    <SelectField
      label="插入字段"
      value={INSERT_FIELD_PLACEHOLDER}
      options={insertFieldOptions(fieldNames)}
      onChange={(value) => {
        if (value !== INSERT_FIELD_PLACEHOLDER) {
          onInsert(value);
        }
      }}
    />
  );
}
