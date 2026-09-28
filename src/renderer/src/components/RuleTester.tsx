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
  /** 需要是稳定引用：它变化时（例如草稿改了）会重新试。 */
  onTest: (raw: string) => Promise<RuleTestResult | null>;
}

/** 试一试：粘贴或扫一段内容，实时显示命中的规则、识别出的字段和每个加工步骤的结果。 */
export function RuleTester({ hint, onTest }: RuleTesterProps) {
  const [raw, setRaw] = useState('');
  const [result, setResult] = useState<RuleTestResult | null>(null);

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

  return (
    <section className="form-section rule-tester">
      <h3 className="form-section__title">试一试</h3>
      <p className="form-hint">{hint}</p>
      <textarea
        aria-label="要识别的内容"
        className="text-field text-area"
        rows={3}
        value={raw}
        placeholder="粘贴或手动输入一段扫码内容，可以多行"
        spellCheck={false}
        onChange={(event) => setRaw(event.target.value)}
      />
      {result && <TestResultView result={result} />}
    </section>
  );
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
