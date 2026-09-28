import type { LabelFlashApi, WindowControlsApi } from '../../shared/ipc-contract';

declare global {
  interface Window {
    api: LabelFlashApi;
    windowControls: WindowControlsApi;
  }
}
