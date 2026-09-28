import { useEffect, useState } from 'react';
import type { RuleTestResult } from '../../../shared/rule-api';
import { fieldsSummary, STEP_KIND_LABELS } from '../lib/rule-text';

/** 输入停下这么久再试：边打字边试，但不每个字都发一次（可能带 HTTP 查询）。 */
const TEST_DEBOUNCE_MS = 400;

const INVALID_TEXT = {
  INVALID_CONTENT: '内容为空、太长或含有不可见字符',
  NO_MATCHING_RULE: '没有规则能识别这段内容',
} as const;

interface RuleTesterProps {
  /** 标题下的说明：试的是保存好的全部规则，还是正在编辑的这一条。 */
  hint: string;
  /** 要识别的内容：由页面保存，扫码时直接填进来，列表和编辑视图之间保留。 */
  raw: string;
  onRawChange: (raw: string) => void;
  /** 需要是稳定引用：它变化时（例如草稿改了）会重新试。 */
  onTest: (raw: string) => Promise<RuleTestResult | null>;
  /** 窄窗口：一行输入 + 一行结果摘要，点「展开」看完整结果。 */
  isCompact?: boolean;
}

/** 试一试：粘贴或扫一段内容，实时显示命中的规则、识别出的字段和每个加工步骤的结果。 */
export function RuleTester({ hint, raw, onRawChange, onTest, isCompact = false }: RuleTesterProps) {
  const [result, setResult] = useState<RuleTestResult | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (raw.trim() === '') {
      setResult(null);
      return;
    }
    let isCurrent = true;
    const timer = window.setTimeout(async () => {
      const next = await onTest(raw);
      if (isCurrent) {
        setResult(next);
      }
    }, TEST_DEBOUNCE_MS);
    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, [raw, onTest]);

  const input = (
    <textarea
      aria-label="要识别的内容"
      className="text-field text-area rule-tester__input"
      rows={isCompact ? 1 : 3}
      value={raw}
      placeholder="扫码，或粘贴一段内容，可以多行"
      spellCheck={false}
      onChange={(event) => onRawChange(event.target.value)}
    />
  );

  if (isCompact) {
    return (
      <section className="rule-tester rule-tester--compact" aria-label="试一试">
        <div className="rule-tester__bar">
          <h2 className="rule-tester__title">试一试</h2>
          {input}
          <button
            type="button"
            className="button button--small button--quiet"
            aria-expanded={isExpanded}
            disabled={result === null}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '收起' : '展开'}
          </button>
        </div>
        {result &&
          (isExpanded ? (
            <TestResultView result={result} />
          ) : (
            <p className="rule-tester__summary">{summarize(result)}</p>
          ))}
      </section>
    );
  }
  return (
    <section className="rule-tester" aria-label="试一试">
      <h2 className="rule-tester__title">试一试</h2>
      <p className="form-hint">{hint}</p>
      {input}
      {result && <TestResultView result={result} />}
    </section>
  );
}

/** 窄窗口里的一行摘要。 */
function summarize(result: RuleTestResult): string {
  switch (result.status) {
    case 'invalid-rule':
      return `规则还不完整：${result.issue}`;
    case 'invalid':
      return INVALID_TEXT[result.reason];
    case 'ok': {
      const failed = result.enriched.traces.filter((trace) => !trace.ok).length;
      const steps = failed > 0 ? `，${failed} 个步骤失败` : '';
      return `命中「${result.recognized.ruleName}」：${fieldsSummary(result.enriched.scan.fields) || '没有字段'}${steps}`;
    }
  }
}

function TestResultView({ result }: { result: RuleTestResult }) {
  if (result.status === 'invalid-rule') {
    return <p className="rule-tester__result rule-tester__result--error">规则还不完整：{result.issue}</p>;
  }
  if (result.status === 'invalid') {
    return <p className="rule-tester__result rule-tester__result--error">{INVALID_TEXT[result.reason]}</p>;
  }
  const { recognized, enriched } = result;
  return (
    <div className="rule-tester__result">
      <p>
        命中「{recognized.ruleName}」：{fieldsSummary(recognized.fields) || '没有字段'}
      </p>
      {enriched.traces.length > 0 && (
        <ol className="rule-tester__steps">
          {enriched.traces.map((trace, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 步骤按顺序执行，序号就是身份
            <li key={index} className={trace.ok ? '' : 'rule-tester__step--failed'}>
              {STEP_KIND_LABELS[trace.kind]}：{trace.ok ? '完成' : trace.detail}（{Math.round(trace.durationMs)} 毫秒）
            </li>
          ))}
        </ol>
      )}
      {enriched.traces.length > 0 && <p>加工后：{fieldsSummary(enriched.scan.fields)}</p>}
      {enriched.blocked && (
        <p className="rule-tester__result--error">查询失败且设为不打印：{enriched.blocked.detail}</p>
      )}
    </div>
  );
}
