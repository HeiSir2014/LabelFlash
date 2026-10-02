import { useId } from 'react';

/** 「预览内容」的值和修改：默认是最近一次扫码的内容；配置中心里扫码也填进这里。 */
export interface SampleContent {
  value: string;
  onChange: (value: string) => void;
}

interface SampleInputProps {
  sample: SampleContent;
  /** 放在设计器的工具条里：一行高，和工具按钮对齐。 */
  isCompact?: boolean;
}

/** 「预览内容」：多行内容照原样保留，所以用 textarea。 */
export function SampleInput({ sample, isCompact = false }: SampleInputProps) {
  const id = useId();
  return (
    <div className={isCompact ? 'sample-input sample-input--compact' : 'sample-input'}>
      <label className="sample-input__label" htmlFor={id}>
        预览内容
      </label>
      <textarea
        id={id}
        className="text-field text-area sample-input__field"
        rows={isCompact ? 1 : 2}
        value={sample.value}
        placeholder="扫码，或输入要预览的内容"
        spellCheck={false}
        onChange={(event) => sample.onChange(event.target.value)}
      />
    </div>
  );
}
