import { useEffect, useState } from 'react';
import { NOTE_VARIABLES } from '../../../core/templates/note-text';
import { BRAND } from '../../../shared/brand';
import type { AppInfo } from '../../../shared/ipc-contract';
import {
  type AppSettings,
  HISTORY_LIMIT_RANGE,
  MAX_DEDUP_WINDOW_SECONDS,
  MAX_NOTE_PRESETS,
  SCAN_LINE_GAP_RANGE,
  sanitizeNoteText,
} from '../../../shared/settings';
import type { VoiceCue } from '../../../shared/voice';
import type { UpdateView } from '../lib/update-text';
import { useQrImage } from '../view-models/use-qr-image';
import { ConfirmButton } from './ConfirmButton';
import { VoiceSettingsSection } from './VoiceSettingsSection';

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');

interface SettingsFormProps {
  settings: AppSettings;
  jobTotal: number;
  appInfo: AppInfo | null;
  update: UpdateView;
  onChange: (patch: Partial<AppSettings>) => Promise<AppSettings | null>;
  onOpenLogFolder: () => void;
  onOpenShop: () => void;
  onCheckForUpdates: () => void;
  onPreviewVoice: (cue?: VoiceCue) => void;
}

export function SettingsForm({
  settings,
  jobTotal,
  appInfo,
  update,
  onChange,
  onOpenLogFolder,
  onOpenShop,
  onCheckForUpdates,
  onPreviewVoice,
}: SettingsFormProps) {
  const [pendingHistoryLimit, setPendingHistoryLimit] = useState<number | null>(null);
  const [newNote, setNewNote] = useState('');
  const shopQr = useQrImage(BRAND.shop.url);
  const newNoteText = sanitizeNoteText(newNote);
  const canAddNote =
    newNoteText !== null &&
    !settings.notePresets.includes(newNoteText) &&
    settings.notePresets.length < MAX_NOTE_PRESETS;

  const addNote = async () => {
    if (newNoteText && canAddNote && (await onChange({ notePresets: [...settings.notePresets, newNoteText] }))) {
      setNewNote('');
    }
  };

  const commitHistoryLimit = async (historyLimit: number): Promise<number | null> => {
    // 调小到当前记录数以下会永久删除旧记录：先确认。
    if (historyLimit < jobTotal) {
      setPendingHistoryLimit(historyLimit);
      return null;
    }
    return (await onChange({ historyLimit }))?.historyLimit ?? null;
  };

  return (
    <div className="settings">
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
      <NumberSetting
        label="打印记录保留"
        unit="条"
        hint={`超出后自动删除最早的记录；当前 ${NUMBER_FORMAT.format(jobTotal)} 条，10 万条约占 20 MB`}
        value={settings.historyLimit}
        min={HISTORY_LIMIT_RANGE.min}
        max={HISTORY_LIMIT_RANGE.max}
        onCommit={commitHistoryLimit}
      />
      {pendingHistoryLimit !== null && (
        <div className="confirm-row" role="alert">
          <p>
            调到 {NUMBER_FORMAT.format(pendingHistoryLimit)} 条会删除最早的{' '}
            {NUMBER_FORMAT.format(jobTotal - pendingHistoryLimit)} 条记录，删除后无法恢复。
          </p>
          <div className="confirm-row__actions">
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => setPendingHistoryLimit(null)}
            >
              取消
            </button>
            <ConfirmButton
              className="button button--small"
              label="删除旧记录"
              confirmLabel="再点一次确认删除"
              onConfirm={() => {
                const historyLimit = pendingHistoryLimit;
                setPendingHistoryLimit(null);
                void onChange({ historyLimit });
              }}
            />
          </div>
        </div>
      )}
      <label className="setting">
        <span className="setting__label">开机自动启动</span>
        <span className="switch switch--bare">
          <input
            type="checkbox"
            role="switch"
            aria-checked={settings.launchAtLogin}
            checked={settings.launchAtLogin}
            onChange={(event) => void onChange({ launchAtLogin: event.target.checked })}
          />
          <span className="switch__track" aria-hidden="true">
            <span className="switch__thumb" />
          </span>
        </span>
        <span className="setting__hint">登录 Windows 后自动打开窗口，可以直接扫码</span>
      </label>

      <VoiceSettingsSection
        voice={settings.voice}
        onChange={(voice) => void onChange({ voice })}
        onPreview={onPreviewVoice}
      />

      <section className="note-presets" aria-label="常用备注">
        <h3 className="about__title">常用备注</h3>
        <p className="setting__hint">
          在扫码框旁的「备注」下拉框里一键切换，会替换当前模板的备注文字（位置和字号仍按模板）。支持变量：
          {NOTE_VARIABLES.join(' ')}，以及 {'{字段名}'}（例如 {'{订单号}'}）
        </p>
        <ul className="note-presets__list">
          {settings.notePresets.map((text) => (
            <li key={text} className="note-presets__item">
              <span className="note-presets__text">{text}</span>
              <button
                type="button"
                className="button button--small button--quiet"
                onClick={() => void onChange({ notePresets: settings.notePresets.filter((preset) => preset !== text) })}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
        {settings.notePresets.length === 0 && <p className="setting__hint">还没有常用备注。</p>}
        <textarea
          className="text-field text-area"
          rows={2}
          value={newNote}
          placeholder="例如：样衣间 {日期}"
          onChange={(event) => setNewNote(event.target.value)}
        />
        <button type="button" className="button button--small" disabled={!canAddNote} onClick={() => void addNote()}>
          添加常用备注（{settings.notePresets.length}/{MAX_NOTE_PRESETS}）
        </button>
      </section>

      <section className="about" aria-label="关于">
        <h3 className="about__title">关于</h3>
        {appInfo ? (
          <dl className="about__list">
            <dt>软件</dt>
            <dd>
              {appInfo.productName} v{appInfo.version}
            </dd>
            <dt>出品</dt>
            <dd>{appInfo.brandOwner}（CDL）</dd>
            <dt>淘宝店铺</dt>
            <dd>
              <button type="button" className="link-button" onClick={onOpenShop}>
                {BRAND.shop.name}
              </button>
              <span className="about__path about__url">{BRAND.shop.url}</span>
              {shopQr && (
                <figure className="about__qr">
                  <img src={shopQr} alt={`${BRAND.shop.name}店铺二维码`} width={132} height={132} />
                  <figcaption>手机淘宝扫一扫进店</figcaption>
                </figure>
              )}
            </dd>
            <dt>数据目录</dt>
            <dd className="about__path">{appInfo.dataPath}</dd>
          </dl>
        ) : (
          <p className="setting__hint">正在读取版本信息…</p>
        )}
        <p className="setting__hint" role="status">
          {update.text}
        </p>
        <div className="about__actions">
          <button
            type="button"
            className="button button--small"
            onClick={onCheckForUpdates}
            disabled={!update.canCheck}
          >
            检查更新
          </button>
          <button type="button" className="button button--small button--quiet" onClick={onOpenLogFolder}>
            打开日志目录
          </button>
        </div>
      </section>
    </div>
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

function NumberSetting({ label, unit, hint, value, min, max, onCommit }: NumberSettingProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = async () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed) || parsed === value) {
      setDraft(String(value));
      return;
    }
    const saved = await onCommit(parsed);
    // 用主进程纠正后的值回显（例如超出上限被夹回）。
    setDraft(String(saved ?? value));
  };

  return (
    <label className="setting">
      <span className="setting__label">{label}</span>
      <span className="setting__control">
        <input
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
        <span className="setting__unit">{unit}</span>
      </span>
      <span className="setting__hint">{hint}</span>
    </label>
  );
}
