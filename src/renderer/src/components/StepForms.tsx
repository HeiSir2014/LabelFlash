import type { ReactNode } from 'react';
import type { LookupTableInfo } from '../../../core/lookup/lookup-model';
import {
  type EnrichStep,
  HTTP_ERROR_POLICIES,
  HTTP_METHODS,
  type HttpErrorPolicy,
  type HttpStep,
  type LookupStep,
  REPLACE_FLAGS,
  type RegexReplaceStep,
  STEP_LIMITS,
  type TemplateStep,
} from '../../../core/scan/enrich-model';
import { RULE_LIMITS } from '../../../core/scan/rule-model';
import type { ConfigPage } from '../lib/app-view';
import { PageLink } from './config/PageLink';
import { NumberField, Segmented, SelectField, TextAreaField, TextInput, Toggle } from './form-controls';

export interface StepFormContext {
  lookupTables: readonly LookupTableInfo[];
  secretNames: readonly string[];
  /** 跳到查找表、密钥等配置页（经过未保存修改的确认）。 */
  openPage: (page: ConfigPage) => void;
}

interface StepFormProps<S extends EnrichStep> {
  step: S;
  context: StepFormContext;
  onChange: (step: S) => void;
}

/** 按步骤类型显示对应的表单。 */
export function StepForm({ step, context, onChange }: StepFormProps<EnrichStep>) {
  switch (step.kind) {
    case 'template':
      return <TemplateStepForm step={step} context={context} onChange={onChange} />;
    case 'regexReplace':
      return <RegexReplaceStepForm step={step} context={context} onChange={onChange} />;
    case 'lookup':
      return <LookupStepForm step={step} context={context} onChange={onChange} />;
    case 'http':
      return <HttpStepForm step={step} context={context} onChange={onChange} />;
  }
}

/** 新加一个步骤时的初始内容（用户再改）。 */
export function newStep(kind: EnrichStep['kind'], context: StepFormContext): EnrichStep {
  switch (kind) {
    case 'template':
      return { kind, text: 'https://example.com/o/{订单号}', output: '链接' };
    case 'regexReplace':
      return { kind, input: null, pattern: '^SO-', flags: '', replacement: '', output: '单号' };
    case 'lookup': {
      const [table] = context.lookupTables;
      const [keyColumn = '', valueColumn = ''] = table?.columns ?? [];
      return {
        kind,
        input: keyColumn || null,
        tableId: table?.id ?? '',
        keyColumn,
        ignoreCase: false,
        outputs: [{ column: valueColumn, field: valueColumn || '查表结果' }],
      };
    }
    case 'http':
      return {
        kind,
        method: 'GET',
        url: 'https://example.com/api/shelf?code={编码}',
        headers: [],
        body: '',
        timeoutMs: STEP_LIMITS.timeoutMs.default,
        cacheSeconds: STEP_LIMITS.cacheSeconds.default,
        outputs: [{ path: 'data.shelf', field: '货架号' }],
        onError: 'empty',
      };
  }
}

function InputFieldInput({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  return (
    <TextInput
      label="输入字段"
      value={value ?? ''}
      maxLength={RULE_LIMITS.fieldNameLength}
      placeholder="留空表示完整内容"
      onChange={(next) => onChange(next.trim() === '' ? null : next)}
    />
  );
}

function OutputInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <TextInput
      label="产出字段"
      value={value}
      maxLength={RULE_LIMITS.fieldNameLength}
      placeholder="新字段名，或覆盖已有字段"
      onChange={onChange}
    />
  );
}

function TemplateStepForm({ step, onChange }: StepFormProps<TemplateStep>) {
  return (
    <>
      <TextAreaField
        label="文本"
        value={step.text}
        maxLength={STEP_LIMITS.textLength}
        rows={2}
        placeholder="例如 https://example.com/o/{订单号}"
        onChange={(text) => onChange({ ...step, text })}
      />
      <p className="form-hint">
        可以用 {'{字段名}'}、{'{完整内容}'}、{'{规则}'}、{'{日期}'}、{'{时间}'}。
      </p>
      <OutputInput value={step.output} onChange={(output) => onChange({ ...step, output })} />
    </>
  );
}

function RegexReplaceStepForm({ step, onChange }: StepFormProps<RegexReplaceStep>) {
  return (
    <>
      <InputFieldInput value={step.input} onChange={(input) => onChange({ ...step, input })} />
      <TextInput
        label="正则"
        value={step.pattern}
        maxLength={STEP_LIMITS.patternLength}
        onChange={(pattern) => onChange({ ...step, pattern })}
      />
      <TextInput
        label="标志"
        value={step.flags}
        maxLength={REPLACE_FLAGS.length}
        placeholder="g 表示全部替换，i 忽略大小写"
        onChange={(flags) => onChange({ ...step, flags })}
      />
      <TextInput
        label="替换为"
        value={step.replacement}
        maxLength={STEP_LIMITS.replacementLength}
        placeholder="可以用 $1、$<名字>；留空表示删除"
        onChange={(replacement) => onChange({ ...step, replacement })}
      />
      <OutputInput value={step.output} onChange={(output) => onChange({ ...step, output })} />
    </>
  );
}

function LookupStepForm({ step, context, onChange }: StepFormProps<LookupStep>) {
  const table = context.lookupTables.find((candidate) => candidate.id === step.tableId);
  if (context.lookupTables.length === 0) {
    return (
      <p className="form-hint form-hint--error">
        还没有查找表，先去
        <PageLink page="lookup" onOpen={context.openPage}>
          「查找表」页
        </PageLink>
        导入一个 CSV 表格。
      </p>
    );
  }
  const columnOptions = (table?.columns ?? []).map((column) => ({ value: column, label: column }));
  const setOutput = (index: number, patch: Partial<LookupStep['outputs'][number]>) =>
    onChange({ ...step, outputs: step.outputs.map((output, i) => (i === index ? { ...output, ...patch } : output)) });
  return (
    <>
      <InputFieldInput value={step.input} onChange={(input) => onChange({ ...step, input })} />
      <SelectField
        label="表格"
        value={table ? step.tableId : ''}
        options={[
          ...(table ? [] : [{ value: '', label: '请选择' }]),
          ...context.lookupTables.map((item) => ({ value: item.id, label: `${item.name}（${item.rowCount} 行）` })),
        ]}
        onChange={(tableId) => {
          const next = context.lookupTables.find((item) => item.id === tableId);
          onChange({ ...step, tableId, keyColumn: next?.columns[0] ?? '' });
        }}
      />
      {table && (
        <>
          <SelectField
            label="按哪一列匹配"
            value={step.keyColumn}
            options={columnOptions}
            onChange={(keyColumn) => onChange({ ...step, keyColumn })}
          />
          <Toggle
            label="忽略大小写"
            checked={step.ignoreCase}
            onChange={(ignoreCase) => onChange({ ...step, ignoreCase })}
          />
          <PairList
            label="取出的列 → 字段"
            rows={step.outputs.map((output) => [output.column, output.field])}
            max={STEP_LIMITS.outputs}
            renderFirst={(value, index) => (
              <select
                className="text-field"
                aria-label={`第 ${index + 1} 个取出的列`}
                value={value}
                onChange={(event) => setOutput(index, { column: event.target.value })}
              >
                {columnOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            secondPlaceholder="字段名"
            onSecondChange={(index, field) => setOutput(index, { field })}
            onAdd={() =>
              onChange({ ...step, outputs: [...step.outputs, { column: table.columns[0] ?? '', field: '' }] })
            }
            onRemove={(index) => onChange({ ...step, outputs: step.outputs.filter((_, i) => i !== index) })}
          />
        </>
      )}
      <p className="form-hint">精确匹配（去掉首尾空白）；查不到时产出的字段为空，标签上不显示。</p>
    </>
  );
}

const ERROR_POLICY_LABELS: Record<HttpErrorPolicy, string> = { empty: '照常打印', block: '不打印并提示' };

function HttpStepForm({ step, context, onChange }: StepFormProps<HttpStep>) {
  const setHeader = (index: number, patch: Partial<HttpStep['headers'][number]>) =>
    onChange({ ...step, headers: step.headers.map((header, i) => (i === index ? { ...header, ...patch } : header)) });
  const setOutput = (index: number, patch: Partial<HttpStep['outputs'][number]>) =>
    onChange({ ...step, outputs: step.outputs.map((output, i) => (i === index ? { ...output, ...patch } : output)) });
  return (
    <>
      <Segmented
        label="方法"
        value={step.method}
        options={HTTP_METHODS.map((method) => ({ value: method, label: method }))}
        onChange={(method) => onChange({ ...step, method })}
      />
      <TextAreaField
        label="地址"
        value={step.url}
        maxLength={STEP_LIMITS.urlLength}
        rows={2}
        placeholder="https://example.com/api/shelf?code={编码}"
        onChange={(url) => onChange({ ...step, url })}
      />
      <p className="form-hint">主机名要写死；路径和参数里可以用 {'{字段名}'}，会自动按网址编码。</p>
      <PairList
        label="请求头"
        rows={step.headers.map((header) => [header.name, header.value])}
        max={STEP_LIMITS.headers}
        firstPlaceholder="名称，例如 Authorization"
        secondPlaceholder="值，例如 Bearer {密钥:仓库接口}"
        onFirstChange={(index, name) => setHeader(index, { name })}
        onSecondChange={(index, value) => setHeader(index, { value })}
        onAdd={() => onChange({ ...step, headers: [...step.headers, { name: 'Authorization', value: '' }] })}
        onRemove={(index) => onChange({ ...step, headers: step.headers.filter((_, i) => i !== index) })}
      />
      <p className="form-hint">
        令牌请存成密钥，在这里写 {'{密钥:名称}'}：密钥只保存在这台电脑、加密存放，不会随规则导出。
        {context.secretNames.length > 0 ? `已有密钥：${context.secretNames.join('、')}。` : '还没有密钥，'}
        <PageLink page="secrets" onOpen={context.openPage}>
          {context.secretNames.length > 0 ? '管理密钥' : '去「密钥」页添加'}
        </PageLink>
      </p>
      {step.method === 'POST' && (
        <TextAreaField
          label="请求体（JSON）"
          value={step.body}
          maxLength={STEP_LIMITS.bodyLength}
          placeholder={'{"code": "{编码}"}'}
          onChange={(body) => onChange({ ...step, body })}
        />
      )}
      <NumberField
        label="超时"
        unit="毫秒"
        value={step.timeoutMs}
        min={STEP_LIMITS.timeoutMs.min}
        max={STEP_LIMITS.timeoutMs.max}
        step={100}
        onChange={(timeoutMs) => onChange({ ...step, timeoutMs })}
      />
      <NumberField
        label="结果缓存"
        unit="秒"
        value={step.cacheSeconds}
        min={STEP_LIMITS.cacheSeconds.min}
        max={STEP_LIMITS.cacheSeconds.max}
        step={10}
        onChange={(cacheSeconds) => onChange({ ...step, cacheSeconds })}
      />
      <PairList
        label="取值路径 → 字段"
        rows={step.outputs.map((output) => [output.path, output.field])}
        max={STEP_LIMITS.outputs}
        firstPlaceholder="例如 data.shelf"
        secondPlaceholder="字段名"
        onFirstChange={(index, path) => setOutput(index, { path })}
        onSecondChange={(index, field) => setOutput(index, { field })}
        onAdd={() => onChange({ ...step, outputs: [...step.outputs, { path: '', field: '' }] })}
        onRemove={(index) => onChange({ ...step, outputs: step.outputs.filter((_, i) => i !== index) })}
      />
      <Segmented
        label="查询失败时"
        value={step.onError}
        options={HTTP_ERROR_POLICIES.map((policy) => ({ value: policy, label: ERROR_POLICY_LABELS[policy] }))}
        onChange={(onError) => onChange({ ...step, onError })}
      />
    </>
  );
}

interface PairListProps {
  label: string;
  rows: ReadonlyArray<readonly [string, string]>;
  max: number;
  firstPlaceholder?: string;
  secondPlaceholder: string;
  /** 第一列不是普通输入框时（例如下拉选列名）自己渲染。 */
  renderFirst?: (value: string, index: number) => ReactNode;
  onFirstChange?: (index: number, value: string) => void;
  onSecondChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/** 两列的小表格：请求头、取值路径、查表的列。 */
function PairList(props: PairListProps) {
  return (
    <fieldset className="pair-list">
      <legend className="form-row__label">{props.label}</legend>
      {props.rows.map(([first, second], index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 按位置编辑的列表，编辑中内容可能为空或重复
        <div key={index} className="pair-list__row">
          {props.renderFirst ? (
            props.renderFirst(first, index)
          ) : (
            <input
              type="text"
              className="text-field"
              aria-label={`${props.label}第 ${index + 1} 行第一列`}
              value={first}
              placeholder={props.firstPlaceholder}
              onChange={(event) => props.onFirstChange?.(index, event.target.value)}
            />
          )}
          <input
            type="text"
            className="text-field"
            aria-label={`${props.label}第 ${index + 1} 行第二列`}
            value={second}
            placeholder={props.secondPlaceholder}
            onChange={(event) => props.onSecondChange(index, event.target.value)}
          />
          <button type="button" className="button button--small button--quiet" onClick={() => props.onRemove(index)}>
            删除
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button--small"
        disabled={props.rows.length >= props.max}
        onClick={props.onAdd}
      >
        添加（{props.rows.length}/{props.max}）
      </button>
    </fieldset>
  );
}
