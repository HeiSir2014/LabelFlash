import { useState } from 'react';
import { type EnrichStep, STEP_KINDS, STEP_LIMITS, type StepKind } from '../../../core/scan/enrich-model';
import { RULE_LIMITS, type ScanRule } from '../../../core/scan/rule-model';
import type { RuleTestResult } from '../../../shared/rule-api';
import { RULE_KIND_HINTS, RULE_KIND_LABELS, STEP_KIND_LABELS, stepSummary } from '../lib/rule-text';
import { TextInput } from './form-controls';
import { RuleKindForm } from './RuleKindForm';
import { RuleTester } from './RuleTester';
import { newStep, StepForm, type StepFormContext } from './StepForms';

interface RuleEditorProps {
  draft: ScanRule;
  isDirty: boolean;
  /** 保存被拒绝的原因（主进程校验）。 */
  saveIssue: string | null;
  context: StepFormContext;
  onChange: (draft: ScanRule) => void;
  onTest: (raw: string) => Promise<RuleTestResult | null>;
  onSave: () => void;
  onCancel: () => void;
}

/** 编辑自定义规则：识别方式 + 加工步骤；下方「试一试」用的是正在编辑的草稿。 */
export function RuleEditor({
  draft,
  isDirty,
  saveIssue,
  context,
  onChange,
  onTest,
  onSave,
  onCancel,
}: RuleEditorProps) {
  return (
    <div className="template-editor">
      <div className="template-editor__scroll">
        <section className="form-section">
          <h3 className="form-section__title">基本</h3>
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
        <StepList
          steps={draft.steps}
          context={context}
          onChange={(steps) => onChange({ ...draft, steps } as ScanRule)}
        />
        <RuleTester hint="只用正在编辑的这条规则（含加工步骤）识别，保存前就能看到效果。" onTest={onTest} />
      </div>
      <div className="template-editor__footer">
        {saveIssue && <p className="template-editor__issue">{saveIssue}</p>}
        <button type="button" className="button button--quiet" onClick={onCancel}>
          {isDirty ? '放弃修改' : '返回列表'}
        </button>
        <button type="button" className="button button--primary" onClick={onSave} disabled={!isDirty}>
          保存规则
        </button>
      </div>
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
      <h3 className="form-section__title">加工步骤</h3>
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
          className="text-field"
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
