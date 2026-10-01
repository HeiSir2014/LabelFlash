import { useState } from 'react';
import { resolvePrinter } from '../../../core/printing/resolve-printer';
import { type LabelTemplate, TEMPLATE_LIMITS, withPaper } from '../../../core/templates/template-model';
import type { PrinterInfo } from '../../../core/types';
import { findPreset, PAPER_LIMITS_MM, PAPER_PRESETS, type PaperSize, paperKey } from '../../../shared/paper-sizes';
import { NumberField, SelectField, TextInput } from './form-controls';

/** 自定义纸张尺寸按 0.1mm 调：驱动和打印页面的精度都是这个量级。 */
const PAPER_STEP_MM = 0.1;
/** 纸张下拉框里「自定义」一项的值（不会和纸张键重名）。 */
const CUSTOM_PAPER = 'custom';

const PAPER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  ...PAPER_PRESETS.map((preset) => ({ value: paperKey(preset), label: `${preset.name}（${preset.usage}）` })),
  { value: CUSTOM_PAPER, label: '自定义…' },
];

/** 选打印机要用到的：本机的打印机和纸张分配。 */
export interface PrinterChoices {
  printers: readonly PrinterInfo[];
  paperPrinters: Readonly<Record<string, string>>;
}

interface TemplateBasicsProps<T extends LabelTemplate> extends PrinterChoices {
  draft: T;
  onChange: (draft: T) => void;
}

/** 两类模板都有的：名称、纸张、打印机（标签模板和面单模板的编辑器共用）。 */
export function TemplateBasics<T extends LabelTemplate>({
  draft,
  onChange,
  printers,
  paperPrinters,
}: TemplateBasicsProps<T>) {
  // 选了「自定义」时纸张还是原来的尺寸（可能正好是预设）：记住这个选择，才能显示宽、高两个输入框。
  const [isCustom, setIsCustom] = useState(() => findPreset(draft.paper) === null);
  const setPaper = (paper: PaperSize) => onChange(withPaper(draft, paper));
  const names = printers.map((printer) => printer.name);
  const assignedName = resolvePrinter({ paper: draft.paper, printer: null }, paperPrinters, names).printerName;
  const assigned =
    assignedName === null
      ? null
      : (printers.find((printer) => printer.name === assignedName)?.displayName ?? assignedName);
  const printerOptions = [
    { value: '', label: `按纸张分配（当前是 ${assigned ?? '还没有'}）` },
    // 指定的打印机不在这台电脑上：仍然显示它的名字，不悄悄显示成别的选项。
    ...(draft.printer !== null && !names.includes(draft.printer)
      ? [{ value: draft.printer, label: `${draft.printer}（这台电脑上没有）` }]
      : []),
    ...printers.map((printer) => ({ value: printer.name, label: printer.displayName })),
  ];

  return (
    <>
      <TextInput
        label="模板名称"
        value={draft.name}
        maxLength={TEMPLATE_LIMITS.nameLength}
        onChange={(name) => onChange({ ...draft, name })}
      />
      <SelectField
        label="纸张尺寸"
        value={isCustom ? CUSTOM_PAPER : paperKey(draft.paper)}
        options={PAPER_OPTIONS}
        onChange={(value) => {
          const preset = PAPER_PRESETS.find((item) => paperKey(item) === value);
          setIsCustom(preset === undefined);
          if (preset) {
            setPaper({ widthMm: preset.widthMm, heightMm: preset.heightMm });
          }
        }}
      />
      {isCustom && (
        <>
          <NumberField
            label="纸张宽"
            value={draft.paper.widthMm}
            min={PAPER_LIMITS_MM.width.min}
            max={PAPER_LIMITS_MM.width.max}
            step={PAPER_STEP_MM}
            onChange={(widthMm) => setPaper({ ...draft.paper, widthMm })}
          />
          <NumberField
            label="纸张高"
            value={draft.paper.heightMm}
            min={PAPER_LIMITS_MM.height.min}
            max={PAPER_LIMITS_MM.height.max}
            step={PAPER_STEP_MM}
            onChange={(heightMm) => setPaper({ ...draft.paper, heightMm })}
          />
          <p className="form-hint">
            {`宽 ${PAPER_LIMITS_MM.width.min}–${PAPER_LIMITS_MM.width.max}mm，高 ${PAPER_LIMITS_MM.height.min}–${PAPER_LIMITS_MM.height.max}mm；超出范围的数字不会生效。`}
          </p>
        </>
      )}
      <SelectField
        label="打印机"
        value={draft.printer ?? ''}
        options={printerOptions}
        onChange={(value) => onChange({ ...draft, printer: value === '' ? null : value })}
      />
      <p className="form-hint">
        通常按纸张分配（在配置中心的「打印机」页设置）；同一种纸要打到不同打印机时，在这里为模板指定一台。
      </p>
    </>
  );
}
