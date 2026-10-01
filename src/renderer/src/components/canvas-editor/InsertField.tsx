import { NOTE_VARIABLES } from '../../../../core/templates/note-text';
import { SelectField } from '../form-controls';

/** 下拉框的第一项是提示，不是字段：选了字段之后马上回到它，下次还能再插。 */
const PLACEHOLDER = '';

interface InsertFieldProps {
  /** 规则里出现过的字段名和这次预览识别出的字段名。 */
  fieldNames: readonly string[];
  onInsert: (variable: string) => void;
}

/** 「插入字段」：把 {字段名} 接到内容末尾，免得手打花括号和字段名。 */
export function InsertField({ fieldNames, onInsert }: InsertFieldProps) {
  const fixed = NOTE_VARIABLES.filter((variable) => !fieldNames.includes(variable.slice(1, -1)));
  const options = [
    { value: PLACEHOLDER, label: '插入字段…' },
    ...fieldNames.map((name) => ({ value: `{${name}}`, label: name })),
    ...fixed.map((variable) => ({ value: variable, label: variable.slice(1, -1) })),
  ];
  return (
    <SelectField
      label="插入字段"
      value={PLACEHOLDER}
      options={options}
      onChange={(value) => {
        if (value !== PLACEHOLDER) {
          onInsert(value);
        }
      }}
    />
  );
}
