import { useState } from 'react';
import { type EnrichStep, STEP_KINDS, STEP_LIMITS, type StepKind } from '../../../core/scan/enrich-model';
import { RULE_LIMITS, type ScanRule } from '../../../core/scan/rule-model';
import { RULE_KIND_HINTS, RULE_KIND_LABELS, STEP_KIND_LABELS, stepSummary } from '../lib/rule-text';
import { TextInput } from './form-controls';
import { RuleKindForm } from './RuleKindForm';
import { newStep, StepForm, type StepFormContext } from './StepForms';

interface RuleEditorProps {
  draft: ScanRule;
  context: StepFormContext;
  onChange: (draft: ScanRule) => void;
}

/** 自定义规则的编辑表单：识别方式 + 加工步骤（试一试、滚动和保存按钮由页面提供）。 */
export function RuleEditor({ draft, context, onChange }: RuleEditorProps) {
  return (
    <div className="rule-form">
      <section className="form-section">
        <h2 className="form-section__title">基本</h2>
        <TextInput
          label="规则名称"
          value={draft.name}
          maxLength={RULE_LIMITS.nameLength}
          onChange={(name) => onChange({ ...draft, name })}
        />
        <p className="form-hint">
          {RULE_KIND_LABELS[draft.kind]}：{RULE_KIND_HINTS[draft.kind]}
        </p>
      </section>
      <RuleKindForm rule={draft} onChange={onChange} />
      <StepList steps={draft.steps} context={context} onChange={(steps) => onChange({ ...draft, steps } as ScanRule)} />
    </div>
  );
}

interface StepListProps {
  steps: readonly EnrichStep[];
  context: StepFormContext;
  onChange: (steps: EnrichStep[]) => void;
}

/** 加工步骤：按顺序执行；一次只展开一个步骤编辑，其余显示摘要。 */
function StepList({ steps, context, onChange }: StepListProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [kindToAdd, setKindToAdd] = useState<StepKind>('template');
  const setStep = (index: number, step: EnrichStep) => onChange(steps.map((item, i) => (i === index ? step : item)));
  const move = (index: number, offset: -1 | 1) => {
    const next = [...steps];
    const [moved] = next.splice(index, 1);
    if (moved) {
      next.splice(index + offset, 0, moved);
      onChange(next);
      setOpenIndex(null);
    }
  };
  return (
    <section className="form-section">
      <h2 className="form-section__title">加工步骤</h2>
      <p className="form-hint">
        识别出字段后依次执行，每一步产出一个或几个字段，后面的步骤能用前面的结果；模板、备注和二维码内容都能用这些字段。
      </p>
      {steps.map((step, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 步骤按位置编辑，位置即身份
        <div key={index} className="slot-card">
          <div className="step-card__head">
            <span className="badge badge--quiet">
              {index + 1}. {STEP_KIND_LABELS[step.kind]}
            </span>
            <span className="step-card__summary">{stepSummary(step)}</span>
          </div>
          {openIndex === index && <StepForm step={step} context={context} onChange={(next) => setStep(index, next)} />}
          <div className="slot-card__actions">
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
            >
              {openIndex === index ? '收起' : '编辑'}
            </button>
            <button
              type="button"
              className="button button--small button--quiet"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              上移
            </button>
            <button
              type="button"
              className="button button--small button--quiet"
              disabled={index === steps.length - 1}
              onClick={() => move(index, 1)}
            >
              下移
            </button>
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => {
                onChange(steps.filter((_, i) => i !== index));
                setOpenIndex(null);
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
      <div className="step-add">
        <select
          className="select-field"
          aria-label="要添加的步骤类型"
          value={kindToAdd}
          onChange={(event) => setKindToAdd(event.target.value as StepKind)}
        >
          {STEP_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {STEP_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button button--small"
          disabled={steps.length >= STEP_LIMITS.steps}
          onClick={() => {
            onChange([...steps, newStep(kindToAdd, context)]);
            setOpenIndex(steps.length);
          }}
        >
          添加步骤（{steps.length}/{STEP_LIMITS.steps}）
        </button>
      </div>
    </section>
  );
}
