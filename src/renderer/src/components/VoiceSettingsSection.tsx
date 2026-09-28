import { useId } from 'react';
import {
  isVoiceName,
  VOICE_CUE_TEXT,
  VOICE_CUES,
  VOICE_NAMES,
  VOICE_RATE_RANGE,
  type VoiceSettings,
} from '../../../shared/voice';

interface VoiceSettingsSectionProps {
  voice: VoiceSettings;
  onChange: (voice: VoiceSettings) => void;
  onPreview: () => void;
}

function describeRate(ratePercent: number): string {
  if (ratePercent === 0) {
    return '正常';
  }
  return `${ratePercent > 0 ? '快' : '慢'} ${Math.abs(ratePercent)}%`;
}

/** 语音确认播报：开关、音色、语速（调整后后台重新生成并缓存全部播报语）。 */
export function VoiceSettingsSection({ voice, onChange, onPreview }: VoiceSettingsSectionProps) {
  const voiceId = useId();
  const rateId = useId();
  const { min, max, step } = VOICE_RATE_RANGE;

  return (
    <section className="voice-settings" aria-label="语音播报">
      <h3 className="about__title">语音播报</h3>
      <label className="setting">
        <span className="setting__label">扫码 / 打印后播报</span>
        <span className="switch switch--bare">
          <input
            type="checkbox"
            role="switch"
            aria-checked={voice.enabled}
            checked={voice.enabled}
            onChange={(event) => onChange({ ...voice, enabled: event.target.checked })}
          />
          <span className="switch__track" aria-hidden="true">
            <span className="switch__thumb" />
          </span>
        </span>
        <span className="setting__hint">
          播报固定确认语：{VOICE_CUES.map((cue) => VOICE_CUE_TEXT[cue]).join('、')}。关闭或离线时改用提示音。
        </span>
      </label>
      <div className="voice-settings__row">
        <label className="setting__label" htmlFor={voiceId}>
          音色
        </label>
        <select
          id={voiceId}
          className="voice-settings__select"
          value={voice.name}
          disabled={!voice.enabled}
          onChange={(event) => {
            if (isVoiceName(event.target.value)) {
              onChange({ ...voice, name: event.target.value });
            }
          }}
        >
          {VOICE_NAMES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="voice-settings__row">
        <label className="setting__label" htmlFor={rateId}>
          语速
        </label>
        <input
          id={rateId}
          className="voice-settings__rate"
          type="range"
          min={min}
          max={max}
          step={step}
          value={voice.ratePercent}
          disabled={!voice.enabled}
          onChange={(event) => onChange({ ...voice, ratePercent: Number(event.target.value) })}
        />
        <output className="voice-settings__rate-value" htmlFor={rateId}>
          {describeRate(voice.ratePercent)}
        </output>
      </div>
      <div className="about__actions">
        <button type="button" className="button button--small" onClick={onPreview} disabled={!voice.enabled}>
          试听
        </button>
      </div>
      <p className="setting__hint">首次使用或调整后需要联网生成语音，之后离线也能播报。</p>
    </section>
  );
}
