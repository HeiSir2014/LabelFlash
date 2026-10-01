import { useId, useState } from 'react';
import {
  isBuiltInRuleId,
  isRuleKind,
  RULE_KINDS,
  type RuleKind,
  type ScanRule,
} from '../../../../../core/scan/rule-model';
import type { RuleSetting } from '../../../../../core/scan/rule-settings';
import type { LabelTemplate } from '../../../../../core/templates/template-model';
import type { ConfigPage } from '../../../lib/app-view';
import { RULE_KIND_LABELS, ruleSummary } from '../../../lib/rule-text';
import { routesButtonLabel } from '../../../lib/template-routes';
import type { RulesViewModel } from '../../../view-models/use-rules';
import { DeleteButton } from '../../ConfirmButton';
import { RuleEditor } from '../../RuleEditor';
import { RuleTester } from '../../RuleTester';
import { TemplateRoutes } from '../TemplateRoutes';

/** 规则指定模板下拉框里「不指定」的值。 */
const FOLLOW_ACTIVE_TEMPLATE = '';

export interface TesterContent {
  raw: string;
  onRawChange: (raw: string) => void;
}

export interface RulesPageProps {
  rules: RulesViewModel;
  templates: readonly LabelTemplate[];
  tester: TesterContent;
  /** 窗口较窄：编辑时「试一试」移到表单上方并收成一行。 */
  isNarrow: boolean;
  /** 加工步骤里「去查找表」「去密钥」的跳转。 */
  onOpenPage: (page: ConfigPage) => void;
  /** 这台电脑能识别标签图上的字（见 AppInfo）。 */
  canReadImageText: boolean;
}

/** 识别规则：列表（右侧固定「试一试」）；编辑时表单和只用草稿的「试一试」并排。 */
export function RulesPage(props: RulesPageProps) {
  return props.rules.draft ? <EditView {...props} draft={props.rules.draft} /> : <ListView {...props} />;
}

function ListView({ rules, templates, tester }: RulesPageProps) {
  return (
    <div className="rules-page">
      <div className="rules-page__main">
        <p className="config-page__intro">
          扫码内容从上到下逐条匹配，第一条认得的规则生效。规则可以指定模板，没指定时用工作台预览工具条里的当前模板。内置规则不能修改，点「复制」后再编辑。
        </p>
        <RuleToolbar rules={rules} />
        <ol className="rule-cards">
          {rules.ordered.map(({ rule, setting }, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              setting={setting}
              templates={templates}
              isFirst={index === 0}
              isLast={index === rules.ordered.length - 1}
              rules={rules}
            />
          ))}
        </ol>
      </div>
      <aside className="rules-page__tester">
        <RuleTester
          hint="按左边的顺序和启用状态识别，和真正扫码时完全一样。"
          raw={tester.raw}
          onRawChange={tester.onRawChange}
          onTest={rules.testSaved}
        />
      </aside>
    </div>
  );
}

function RuleToolbar({ rules }: { rules: RulesViewModel }) {
  const [kind, setKind] = useState<RuleKind>('delimited');
  return (
    <div className="rule-toolbar">
      <select
        className="select-field"
        aria-label="新规则的类型"
        value={kind}
        onChange={(event) => {
          if (isRuleKind(event.target.value)) {
            setKind(event.target.value);
          }
        }}
      >
        {RULE_KINDS.map((option) => (
          <option key={option} value={option}>
            {RULE_KIND_LABELS[option]}
          </option>
        ))}
      </select>
      <button type="button" className="button button--primary" onClick={() => rules.create(kind)}>
        新建规则
      </button>
      <span className="rule-toolbar__spacer" />
      <button type="button" className="button button--quiet" onClick={rules.importRules}>
        导入
      </button>
      <button
        type="button"
        className="button button--quiet"
        disabled={rules.customIds.length === 0}
        onClick={() => rules.exportRules(rules.customIds)}
      >
        导出全部自定义规则
      </button>
    </div>
  );
}

interface RuleCardProps {
  rule: ScanRule;
  setting: RuleSetting;
  templates: readonly LabelTemplate[];
  isFirst: boolean;
  isLast: boolean;
  rules: RulesViewModel;
}

/** 一条规则：第一行启用和名称，第二行摘要，第三行指定模板和操作；按需展开「按字段换模板」。 */
function RuleCard({ rule, setting, templates, isFirst, isLast, rules }: RuleCardProps) {
  const isBuiltIn = isBuiltInRuleId(rule.id);
  const summary = ruleSummary(rule);
  const [isRoutesOpen, setRoutesOpen] = useState(false);
  const routesId = useId();
  return (
    <li className={`config-card rule-card${setting.enabled ? '' : ' rule-card--disabled'}`}>
      <div className="rule-card__head">
        <label className="rule-card__toggle">
          <input
            type="checkbox"
            checked={setting.enabled}
            aria-label={`启用「${rule.name}」`}
            onChange={(event) => rules.setEnabled(rule.id, event.target.checked)}
          />
          <span className="rule-card__name">{rule.name}</span>
        </label>
        <span className="badge badge--quiet">{isBuiltIn ? '内置' : RULE_KIND_LABELS[rule.kind]}</span>
        {rule.steps.length > 0 && <span className="badge badge--quiet">加工 {rule.steps.length} 步</span>}
      </div>
      <p className="rule-card__summary" title={summary}>
        {summary}
      </p>
      <div className="rule-card__actions">
        <select
          className="select-field rule-card__template"
          aria-label={`「${rule.name}」用的模板`}
          value={setting.templateId ?? FOLLOW_ACTIVE_TEMPLATE}
          onChange={(event) =>
            rules.bindTemplate(rule.id, event.target.value === FOLLOW_ACTIVE_TEMPLATE ? null : event.target.value)
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
          aria-expanded={isRoutesOpen}
          aria-controls={routesId}
          onClick={() => setRoutesOpen(!isRoutesOpen)}
        >
          {routesButtonLabel(setting.templateRoutes.length)}
        </button>
        <span className="rule-card__spacer" />
        <button
          type="button"
          className="button button--small button--quiet"
          aria-label={`上移「${rule.name}」`}
          disabled={isFirst}
          onClick={() => rules.move(rule.id, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="button button--small button--quiet"
          aria-label={`下移「${rule.name}」`}
          disabled={isLast}
          onClick={() => rules.move(rule.id, 1)}
        >
          ↓
        </button>
        <button type="button" className="button button--small button--quiet" onClick={() => rules.duplicate(rule.id)}>
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
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => rules.exportRules([rule.id])}
            >
              导出
            </button>
            <DeleteButton onConfirm={() => rules.remove(rule.id)} />
          </>
        )}
      </div>
      {isRoutesOpen && (
        <div id={routesId}>
          <TemplateRoutes
            ruleName={rule.name}
            routes={setting.templateRoutes}
            templates={templates}
            onSave={(routes) => rules.setTemplateRoutes(rule.id, routes)}
          />
        </div>
      )}
    </li>
  );
}

function EditView({
  rules,
  tester,
  isNarrow,
  onOpenPage,
  canReadImageText,
  draft,
}: RulesPageProps & { draft: ScanRule }) {
  const context = {
    lookupTables: rules.lookupTables,
    secretNames: rules.secretNames,
    openPage: onOpenPage,
    canReadImageText,
  };
  return (
    <div className="rule-editing">
      <div className="rule-editing__form">
        <RuleEditor draft={draft} context={context} onChange={rules.changeDraft} />
      </div>
      <aside className="rule-editing__tester">
        <RuleTester
          hint="只用正在编辑的这条规则（含加工步骤）识别，保存前就能看到效果。"
          raw={tester.raw}
          onRawChange={tester.onRawChange}
          onTest={rules.testDraft}
          isCompact={isNarrow}
        />
      </aside>
      <div className="config-actions">
        <p className={`config-actions__status${rules.saveIssue ? ' config-actions__status--error' : ''}`}>
          {rules.saveIssue ?? (rules.isDirty ? '有未保存的修改，保存后才会用于识别' : '还没有修改')}
        </p>
        <button type="button" className="button button--quiet" onClick={rules.cancelEdit}>
          {rules.isDirty ? '放弃修改' : '返回列表'}
        </button>
        <button type="button" className="button button--primary" onClick={rules.saveDraft} disabled={!rules.isDirty}>
          保存规则
        </button>
      </div>
    </div>
  );
}
