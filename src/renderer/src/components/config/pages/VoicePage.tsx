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
} from '../../../../../shared/voice';
import { Switch } from '../../form-controls';
import { SettingRow } from '../SettingRow';

interface VoicePageProps {
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

/** 语音播报：开关、音色、语速（调整后后台重新生成并缓存全部播报语），逐句试听。 */
export function VoicePage({ voice, onChange, onPreview }: VoicePageProps) {
  const voiceId = useId();
  const rateId = useId();
  const cuesId = useId();
  const { min, max, step } = VOICE_RATE_RANGE;

  return (
    <div className="config-page">
      <p className="config-page__intro">
        扫码、打印后播一句固定的话，操作员不看屏幕也知道结果；故障提示不会被随后的播报打断。关闭或离线时改用提示音。
      </p>
      <section className="config-card" aria-label="播报设置">
        <SettingRow label="播报">
          <Switch
            isBare
            ariaLabel="扫码、打印后播报"
            checked={voice.enabled}
            text={voice.enabled ? '开启' : '关闭'}
            onChange={(enabled) => onChange({ ...voice, enabled })}
          />
        </SettingRow>
        <SettingRow label="音色" htmlFor={voiceId}>
          <select
            id={voiceId}
            className="select-field"
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
        </SettingRow>
        <SettingRow label="语速" htmlFor={rateId} hint="首次使用或调整后需要联网生成语音，之后离线也能播报。">
          <div className="voice-rate">
            <input
              id={rateId}
              className="voice-rate__slider"
              type="range"
              min={min}
              max={max}
              step={step}
              value={voice.ratePercent}
              disabled={!voice.enabled}
              onChange={(event) => onChange({ ...voice, ratePercent: Number(event.target.value) })}
            />
            <output className="voice-rate__value" htmlFor={rateId}>
              {describeRate(voice.ratePercent)}
            </output>
            <button
              type="button"
              className="button button--small"
              onClick={() => onPreview()}
              disabled={!voice.enabled}
            >
              试听
            </button>
          </div>
        </SettingRow>
      </section>
      <section className="config-card" aria-labelledby={cuesId}>
        <h2 id={cuesId} className="config-card__title">
          全部播报语（{VOICE_CUES.length} 句，点一句试听）
        </h2>
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
      </section>
    </div>
  );
}
