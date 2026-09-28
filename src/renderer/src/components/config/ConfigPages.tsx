import type { AppInfo } from '../../../../shared/ipc-contract';
import type { AppSettings } from '../../../../shared/settings';
import type { VoiceCue } from '../../../../shared/voice';
import type { ConfigPage } from '../../lib/app-view';
import type { UpdateView } from '../../lib/update-text';
import type { EndpointEditorModel } from '../../view-models/use-endpoint-editor';
import { AboutPage } from './pages/AboutPage';
import { GeneralPage } from './pages/GeneralPage';
import { LookupTablesPage } from './pages/LookupTablesPage';
import { NotePresetsPage } from './pages/NotePresetsPage';
import { RulesPage, type RulesPageProps } from './pages/RulesPage';
import { SecretsPage } from './pages/SecretsPage';
import { TemplatesPage, type TemplatesPageProps } from './pages/TemplatesPage';
import { VoicePage } from './pages/VoicePage';
import { WebhooksPage } from './pages/WebhooksPage';

interface ConfigPagesProps {
  page: ConfigPage;
  templates: TemplatesPageProps;
  rules: RulesPageProps;
  endpointEditor: EndpointEditorModel;
  settings: AppSettings;
  jobTotal: number;
  appInfo: AppInfo | null;
  update: UpdateView;
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
  rules,
  endpointEditor,
  settings,
  jobTotal,
  appInfo,
  update,
  onChange,
  onCheckForUpdates,
  onOpenLogFolder,
  onOpenShop,
  onPreviewVoice,
}: ConfigPagesProps) {
  const vm = rules.rules;
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
      return <RulesPage {...rules} />;
    case 'lookup':
      return (
        <LookupTablesPage tables={vm.lookupTables} onImport={vm.importLookupTable} onDelete={vm.deleteLookupTable} />
      );
    case 'secrets':
      return <SecretsPage names={vm.secretNames} onSave={vm.setSecret} onDelete={vm.deleteSecret} />;
    case 'webhooks':
      return (
        <WebhooksPage
          webhooks={settings.webhooks}
          secretNames={vm.secretNames}
          editor={endpointEditor}
          onChange={(webhooks) => onChange({ webhooks })}
          onOpenPage={rules.onOpenPage}
        />
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
  }
}
