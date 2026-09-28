import type { AppInfo } from '../../../../shared/ipc-contract';
import type { AppSettings } from '../../../../shared/settings';
import type { VoiceCue } from '../../../../shared/voice';
import type { ConfigPage } from '../../lib/app-view';
import type { UpdateView } from '../../lib/update-text';
import { WebhookSettings } from '../WebhookSettings';
import { AboutPage } from './pages/AboutPage';
import { GeneralPage } from './pages/GeneralPage';
import { NotePresetsPage } from './pages/NotePresetsPage';
import { TemplatesPage, type TemplatesPageProps } from './pages/TemplatesPage';
import { VoicePage } from './pages/VoicePage';

interface ConfigPagesProps {
  page: ConfigPage;
  templates: TemplatesPageProps;
  settings: AppSettings;
  jobTotal: number;
  appInfo: AppInfo | null;
  update: UpdateView;
  /** 通知签名可选的密钥名称。 */
  secretNames: readonly string[];
  onChange: (patch: Partial<AppSettings>) => Promise<AppSettings | null>;
  onCheckForUpdates: () => void;
  onOpenLogFolder: () => void;
  onOpenShop: () => void;
  onPreviewVoice: (cue?: VoiceCue) => void;
}

/** 配置中心当前页的内容。 */
export function ConfigPages({
  page,
  templates,
  settings,
  jobTotal,
  appInfo,
  update,
  secretNames,
  onChange,
  onCheckForUpdates,
  onOpenLogFolder,
  onOpenShop,
  onPreviewVoice,
}: ConfigPagesProps) {
  switch (page) {
    case 'templates':
      return <TemplatesPage {...templates} />;
    case 'notes':
      return (
        <NotePresetsPage
          presets={settings.notePresets}
          onChange={async (notePresets) => (await onChange({ notePresets })) !== null}
        />
      );
    case 'webhooks':
      return (
        <div className="config-page">
          <WebhookSettings
            webhooks={settings.webhooks}
            secretNames={secretNames}
            onChange={(webhooks) => onChange({ webhooks })}
          />
        </div>
      );
    case 'voice':
      return (
        <VoicePage voice={settings.voice} onChange={(voice) => void onChange({ voice })} onPreview={onPreviewVoice} />
      );
    case 'general':
      return (
        <GeneralPage
          settings={settings}
          jobTotal={jobTotal}
          update={update}
          onChange={onChange}
          onCheckForUpdates={onCheckForUpdates}
          onOpenLogFolder={onOpenLogFolder}
        />
      );
    case 'about':
      return <AboutPage appInfo={appInfo} onOpenShop={onOpenShop} />;
    case 'rules':
    case 'lookup':
    case 'secrets':
      // 这三页在下一步迁进配置中心，目前仍在工作台右侧栏。
      return <p className="config-empty">这一页正在迁移，暂时在工作台右侧栏的「识别规则」里管理。</p>;
  }
}
