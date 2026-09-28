import { useState } from 'react';
import { isBuiltInRuleId, RULE_KINDS, type RuleKind } from '../../../core/scan/rule-model';
import type { LabelTemplate } from '../../../core/templates/template-model';
import { RULE_KIND_LABELS, ruleSummary } from '../lib/rule-text';
import type { RulesViewModel } from '../view-models/use-rules';
import { ConfirmButton } from './ConfirmButton';
import { LookupTables } from './LookupTables';
import { RuleEditor } from './RuleEditor';
import { RuleTester } from './RuleTester';
import { SecretList } from './SecretList';

/** 规则绑定模板下拉框里「不绑定」的值。 */
const FOLLOW_ACTIVE_TEMPLATE = '';

interface RulePanelProps {
  rules: RulesViewModel;
  templates: readonly LabelTemplate[];
}

export function RulePanel({ rules, templates }: RulePanelProps) {
  const context = { lookupTables: rules.lookupTables, secretNames: rules.secretNames };
  if (rules.draft) {
    return (
      <RuleEditor
        draft={rules.draft}
        isDirty={rules.isDirty}
        saveIssue={rules.saveIssue}
        context={context}
        onChange={rules.changeDraft}
        onTest={rules.testDraft}
        onSave={rules.saveDraft}
        onCancel={rules.cancelEdit}
      />
    );
  }
  return (
    <div className="panel-body panel-body--scroll">
      <p className="panel-intro">
        扫码内容从上到下逐条匹配，第一条认得的规则生效；规则可以绑定模板，没绑定时用「模板」页里使用中的模板。
        内置规则不能修改，点「复制」后再编辑。
      </p>
      <RuleToolbar rules={rules} />
      <ol className="rule-list">
        {rules.ordered.map(({ rule, setting }, index) => {
          const isBuiltIn = isBuiltInRuleId(rule.id);
          return (
            <li key={rule.id} className={`rule-row${setting.enabled ? '' : ' rule-row--disabled'}`}>
              <div className="rule-row__head">
                <label className="rule-row__toggle">
                  <input
                    type="checkbox"
                    checked={setting.enabled}
                    aria-label={`启用「${rule.name}」`}
                    onChange={(event) => rules.setEnabled(rule.id, event.target.checked)}
                  />
                  <span className="rule-row__name">{rule.name}</span>
                </label>
                <span className="badge badge--quiet">{isBuiltIn ? '内置' : RULE_KIND_LABELS[rule.kind]}</span>
                {rule.steps.length > 0 && <span className="badge badge--quiet">加工 {rule.steps.length} 步</span>}
              </div>
              <p className="rule-row__summary">{ruleSummary(rule)}</p>
              <div className="rule-row__actions">
                <select
                  className="text-field rule-row__template"
                  aria-label={`「${rule.name}」用的模板`}
                  value={setting.templateId ?? FOLLOW_ACTIVE_TEMPLATE}
                  onChange={(event) =>
                    rules.bindTemplate(
                      rule.id,
                      event.target.value === FOLLOW_ACTIVE_TEMPLATE ? null : event.target.value,
                    )
                  }
                >
                  <option value={FOLLOW_ACTIVE_TEMPLATE}>用当前模板</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button--small button--quiet"
                  aria-label={`上移「${rule.name}」`}
                  disabled={index === 0}
                  onClick={() => rules.move(rule.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button button--small button--quiet"
                  aria-label={`下移「${rule.name}」`}
                  disabled={index === rules.ordered.length - 1}
                  onClick={() => rules.move(rule.id, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="button button--small button--quiet"
                  onClick={() => rules.duplicate(rule.id)}
                >
                  复制
                </button>
                {!isBuiltIn && (
                  <>
                    <button
                      type="button"
                      className="button button--small button--quiet"
                      onClick={() => rules.startEdit(rule.id)}
                    >
                      编辑
                    </button>
                    <ConfirmButton
                      className="button button--small button--quiet"
                      label="删除"
                      confirmLabel="确认删除"
                      onConfirm={() => rules.remove(rule.id)}
                    />
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <RuleTester hint="按上面的顺序和启用状态识别，和真正扫码时完全一样。" onTest={rules.testSaved} />
      <LookupTables tables={rules.lookupTables} onImport={rules.importLookupTable} onDelete={rules.deleteLookupTable} />
      <SecretList names={rules.secretNames} onSave={rules.setSecret} onDelete={rules.deleteSecret} />
    </div>
  );
}

function RuleToolbar({ rules }: { rules: RulesViewModel }) {
  const [kind, setKind] = useState<RuleKind>('delimited');
  return (
    <div className="rule-toolbar">
      <select
        className="text-field"
        aria-label="新规则的类型"
        value={kind}
        onChange={(event) => setKind(event.target.value as RuleKind)}
      >
        {RULE_KINDS.map((option) => (
          <option key={option} value={option}>
            {RULE_KIND_LABELS[option]}
          </option>
        ))}
      </select>
      <button type="button" className="button button--small" onClick={() => rules.create(kind)}>
        新建规则
      </button>
      <button type="button" className="button button--small button--quiet" onClick={rules.importRules}>
        导入
      </button>
      <button
        type="button"
        className="button button--small button--quiet"
        disabled={rules.customIds.length === 0}
        onClick={() => rules.exportRules(rules.customIds)}
      >
        导出自定义规则
      </button>
    </div>
  );
}
