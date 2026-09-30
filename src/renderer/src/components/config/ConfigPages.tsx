import type { AppSettings } from '../../../../shared/settings';
import type { VoiceCue } from '../../../../shared/voice';
import type { ConfigPage } from '../../lib/app-view';
import type { LocalApiModel } from '../../view-models/use-local-api';
import { AboutPage, type AboutPageProps } from './pages/AboutPage';
import { GeneralPage } from './pages/GeneralPage';
import { LocalApiPage } from './pages/LocalApiPage';
import { LookupTablesPage, type LookupTablesPageProps } from './pages/LookupTablesPage';
import { MobilePage, type MobilePageProps } from './pages/MobilePage';
import { NotePresetsPage } from './pages/NotePresetsPage';
import { RulesPage, type RulesPageProps } from './pages/RulesPage';
import { SecretsPage, type SecretsPageProps } from './pages/SecretsPage';
import { TemplatesPage, type TemplatesPageProps } from './pages/TemplatesPage';
import { VoicePage } from './pages/VoicePage';
import { WebhooksPage, type WebhooksPageProps } from './pages/WebhooksPage';

/** 通用页除设置本身以外要的东西。 */
export interface GeneralPageExtras {
  jobTotal: number;
  /** 这台电脑能识别标签图上的字：不能时（macOS 这一版）不显示文字识别的设置。 */
  canReadImageText: boolean;
}

interface ConfigPagesProps {
  page: ConfigPage;
  settings: AppSettings;
  templates: TemplatesPageProps;
  rules: Omit<RulesPageProps, 'onOpenPage'>;
  lookup: LookupTablesPageProps;
  secrets: SecretsPageProps;
  webhooks: Omit<WebhooksPageProps, 'webhooks' | 'onChange' | 'onOpenPage'>;
  mobile: Pick<MobilePageProps, 'defaultRelayUrl' | 'statusText'>;
  localApi: LocalApiModel;
  general: GeneralPageExtras;
  about: AboutPageProps;
  onChange: (patch: Partial<AppSettings>) => Promise<AppSettings | null>;
  onPreviewVoice: (cue?: VoiceCue) => void;
  /** 页面里「去查找表」「去密钥」这类跳转。 */
  onOpenPage: (page: ConfigPage) => void;
}

/** 配置中心当前页的内容。 */
export function ConfigPages({
  page,
  settings,
  templates,
  rules,
  lookup,
  secrets,
  webhooks,
  mobile,
  localApi,
  general,
  about,
  onChange,
  onPreviewVoice,
  onOpenPage,
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
    case 'rules':
      return <RulesPage {...rules} onOpenPage={onOpenPage} />;
    case 'lookup':
      return <LookupTablesPage {...lookup} />;
    case 'secrets':
      return <SecretsPage {...secrets} />;
    case 'webhooks':
      return (
        <WebhooksPage
          {...webhooks}
          webhooks={settings.webhooks}
          onChange={async (next) => (await onChange({ webhooks: next })) !== null}
          onOpenPage={onOpenPage}
        />
      );
    case 'mobile':
      return (
        <MobilePage
          {...mobile}
          relayUrl={settings.mobileRelayUrl}
          onChangeRelayUrl={async (mobileRelayUrl) => (await onChange({ mobileRelayUrl })) !== null}
        />
      );
    case 'localApi':
      return (
        <LocalApiPage
          api={localApi}
          port={settings.apiPort}
          lanEnabled={settings.apiLanEnabled}
          onChangePort={async (apiPort) => (await onChange({ apiPort })) !== null}
          onChangeLanEnabled={(apiLanEnabled) => void onChange({ apiLanEnabled })}
        />
      );
    case 'voice':
      return (
        <VoicePage voice={settings.voice} onChange={(voice) => void onChange({ voice })} onPreview={onPreviewVoice} />
      );
    case 'general':
      return <GeneralPage {...general} settings={settings} onChange={onChange} />;
    case 'about':
      return <AboutPage {...about} />;
  }
}
