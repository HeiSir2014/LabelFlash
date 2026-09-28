import { useId } from 'react';
import {
  isVoiceName,
  VOICE_CUE_LEVEL,
  VOICE_CUE_TEXT,
  VOICE_CUES,
  VOICE_LEVEL_LABEL,
  VOICE_LEVELS,
  VOICE_NAMES,
  VOICE_RATE_RANGE,
  type VoiceCue,
  type VoiceSettings,
} from '../../../shared/voice';

interface VoiceSettingsSectionProps {
  voice: VoiceSettings;
  onChange: (voice: VoiceSettings) => void;
  /** 不传 cue 时试听「已发送打印」。 */
  onPreview: (cue?: VoiceCue) => void;
}

/** 故障排在最前：最需要操作员记住的几句。 */
const LEVELS_BY_IMPORTANCE = [...VOICE_LEVELS].reverse();

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
          每种结果播一句固定的话；故障提示不会被随后的播报打断。关闭或离线时改用提示音。
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
        <button type="button" className="button button--small" onClick={() => onPreview()} disabled={!voice.enabled}>
          试听
        </button>
      </div>
      <details className="voice-cues">
        <summary>全部播报语（{VOICE_CUES.length} 句，点一句可试听）</summary>
        {LEVELS_BY_IMPORTANCE.map((level) => (
          <div key={level} className="voice-cues__group">
            <span className="voice-cues__level">{VOICE_LEVEL_LABEL[level]}</span>
            <ul className="voice-cues__list">
              {VOICE_CUES.filter((cue) => VOICE_CUE_LEVEL[cue] === level).map((cue) => (
                <li key={cue}>
                  <button
                    type="button"
                    className="voice-cues__cue"
                    onClick={() => onPreview(cue)}
                    disabled={!voice.enabled}
                  >
                    {VOICE_CUE_TEXT[cue]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
      <p className="setting__hint">首次使用或调整后需要联网生成语音，之后离线也能播报。</p>
    </section>
  );
}
