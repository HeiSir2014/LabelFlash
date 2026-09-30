import { useEffect, useId, useState } from 'react';
import { OCR_MODEL_TIERS } from '../../../../../shared/ocr-model';
import {
  type AppSettings,
  HISTORY_LIMIT_RANGE,
  MAX_DEDUP_WINDOW_SECONDS,
  SCAN_LINE_GAP_RANGE,
} from '../../../../../shared/settings';
import { ConfirmButton } from '../../ConfirmButton';
import { Segmented, Switch } from '../../form-controls';
import { RelayUrlSetting } from '../RelayUrlSetting';
import { SettingRow } from '../SettingRow';

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');

type SettingsChange = (patch: Partial<AppSettings>) => Promise<AppSettings | null>;

interface GeneralPageProps {
  settings: AppSettings;
  jobTotal: number;
  canReadImageText: boolean;
  defaultRelayUrl: string | null;
  onChange: SettingsChange;
}

/** 通用：防重复、多行扫码等待、打印记录保留、开机自启、文字识别速度、手机扫码中转地址。软件更新和日志在「关于」。 */
export function GeneralPage({ settings, jobTotal, canReadImageText, defaultRelayUrl, onChange }: GeneralPageProps) {
  return (
    <div className="config-page">
      <section className="config-card" aria-label="扫码与打印">
        <NumberSetting
          label="防重复打印"
          unit="秒"
          hint="同一标签在这段时间内只打一次，防止扫码枪连按重复出纸；填 0 表示不拦截"
          value={settings.dedupWindowSeconds}
          min={0}
          max={MAX_DEDUP_WINDOW_SECONDS}
          onCommit={async (dedupWindowSeconds) => (await onChange({ dedupWindowSeconds }))?.dedupWindowSeconds ?? null}
        />
        <NumberSetting
          label="多行扫码等待"
          unit="毫秒"
          hint="二维码里有换行时，扫码枪会连续发出回车；回车后这么久没有新字符才算扫完。多行内容被拆成几次时调大一点"
          value={settings.scanLineGapMs}
          min={SCAN_LINE_GAP_RANGE.min}
          max={SCAN_LINE_GAP_RANGE.max}
          onCommit={async (scanLineGapMs) => (await onChange({ scanLineGapMs }))?.scanLineGapMs ?? null}
        />
        <HistoryLimitSetting value={settings.historyLimit} jobTotal={jobTotal} onChange={onChange} />
        <SettingRow label="开机自动启动" hint="登录系统后自动打开窗口，可以直接扫码">
          <Switch
            isBare
            ariaLabel="开机自动启动"
            checked={settings.launchAtLogin}
            text={settings.launchAtLogin ? '开启' : '关闭'}
            onChange={(launchAtLogin) => void onChange({ launchAtLogin })}
          />
        </SettingRow>
        {canReadImageText && (
          <SettingRow
            label="文字识别速度"
            hint={`加工步骤「图中文字识别」（手机扫码读货架号）用的模型：${
              OCR_MODEL_TIERS.find((tier) => tier.id === settings.ocrModelTier)?.description ?? ''
            }`}
          >
            <Segmented
              isBare
              label="文字识别速度"
              value={settings.ocrModelTier}
              options={OCR_MODEL_TIERS.map((tier) => ({ value: tier.id, label: tier.label }))}
              onChange={(ocrModelTier) => void onChange({ ocrModelTier })}
            />
          </SettingRow>
        )}
      </section>
      <section className="config-card" aria-label="手机扫码">
        <RelayUrlSetting
          relayUrl={settings.mobileRelayUrl}
          defaultRelayUrl={defaultRelayUrl}
          onChangeRelayUrl={async (mobileRelayUrl) => (await onChange({ mobileRelayUrl })) !== null}
        />
      </section>
    </div>
  );
}

interface HistoryLimitSettingProps {
  value: number;
  jobTotal: number;
  onChange: SettingsChange;
}

/** 打印记录保留条数：调小到当前记录数以下会永久删除旧记录，先在下方确认。 */
function HistoryLimitSetting({ value, jobTotal, onChange }: HistoryLimitSettingProps) {
  const [pending, setPending] = useState<number | null>(null);

  const commit = async (historyLimit: number): Promise<number | null> => {
    // 每次提交都先收起上一次的确认：否则之后点「删除旧记录」会按旧的数值删除。
    setPending(null);
    if (historyLimit < jobTotal) {
      setPending(historyLimit);
      return null;
    }
    return (await onChange({ historyLimit }))?.historyLimit ?? null;
  };

  return (
    <>
      <NumberSetting
        label="打印记录保留"
        unit="条"
        hint={`超出后自动删除最早的记录；当前 ${NUMBER_FORMAT.format(jobTotal)} 条，10 万条约占 20 MB`}
        value={value}
        min={HISTORY_LIMIT_RANGE.min}
        max={HISTORY_LIMIT_RANGE.max}
        onCommit={commit}
      />
      {pending !== null && (
        <div className="confirm-row" role="alert">
          <p>
            调到 {NUMBER_FORMAT.format(pending)} 条会删除最早的 {NUMBER_FORMAT.format(jobTotal - pending)}{' '}
            条记录，删除后无法恢复。
          </p>
          <div className="confirm-row__actions">
            <button type="button" className="button button--small button--quiet" onClick={() => setPending(null)}>
              取消
            </button>
            <ConfirmButton
              className="button button--small"
              label="删除旧记录"
              confirmLabel="确认删除"
              onConfirm={() => {
                setPending(null);
                void onChange({ historyLimit: pending });
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

interface NumberSettingProps {
  label: string;
  unit: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  /** 返回主进程校验后的值（可能被纠正）；null 表示未保存。 */
  onCommit: (value: number) => Promise<number | null>;
}

/** 数字设置：离开输入框或按回车时保存，用主进程纠正后的值回显。 */
function NumberSetting({ label, unit, hint, value, min, max, onCommit }: NumberSettingProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = async () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed) || parsed === value) {
      setDraft(String(value));
      return;
    }
    const saved = await onCommit(parsed);
    setDraft(String(saved ?? value));
  };

  return (
    <SettingRow label={label} htmlFor={inputId} hint={hint}>
      <span className="setting-row__inline">
        <input
          id={inputId}
          type="number"
          className="text-field text-field--number"
          min={min}
          max={max}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="setting-row__unit">{unit}</span>
      </span>
    </SettingRow>
  );
}
