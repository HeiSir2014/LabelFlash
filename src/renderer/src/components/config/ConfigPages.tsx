import type { ReactNode } from 'react';
import type { AppSettings } from '../../../../shared/settings';
import type { VoiceCue } from '../../../../shared/voice';
import type { ConfigPage } from '../../lib/app-view';
import type { LocalApiModel } from '../../view-models/use-local-api';
import { AboutPage, type AboutPageProps } from './pages/AboutPage';
import { GeneralPage } from './pages/GeneralPage';
import { LocalApiPage } from './pages/LocalApiPage';
import { LookupTablesPage, type LookupTablesPageProps } from './pages/LookupTablesPage';
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
  /** 安装包自带的手机扫码中转地址；自己构建的安装包可能没有。 */
  defaultRelayUrl: string | null;
}

interface ConfigPagesProps {
  page: ConfigPage;
  settings: AppSettings;
  templates: TemplatesPageProps;
  rules: Omit<RulesPageProps, 'onOpenPage'>;
  lookup: LookupTablesPageProps;
  secrets: SecretsPageProps;
  webhooks: Omit<WebhooksPageProps, 'webhooks' | 'onChange' | 'onOpenPage'>;
  /** 打印机页：纸张分配和本机打印机（components/PrinterList）。 */
  printers: ReactNode;
  /** 打印机页下面的「驱动」卡片（components/DriverSection）。 */
  drivers: ReactNode;
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
  printers,
  drivers,
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
    case 'printers':
      // 和其他配置页一样放在白底卡片上：打印机清单原来在工作台右侧的白底栏里，缺打印机的红字在灰底上对比度不够。
      return (
        <div className="config-page">
          <section className="config-card printers-card" aria-label="打印机">
            {printers}
          </section>
          <section className="config-card driver-card" aria-label="驱动">
            {drivers}
          </section>
        </div>
      );
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
