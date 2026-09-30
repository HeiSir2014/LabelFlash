import type { ReactNode } from 'react';
import { PreviewStage, type PreviewStageProps } from '../PreviewStage';
import { ScanBar, type ScanBarProps } from '../ScanBar';
import { WorkbenchSide } from './WorkbenchSide';

interface WorkbenchProps {
  /** 配置中心打开时为 false：整个工作台设为 inert，扫码框的自动回焦也停用。 */
  isActive: boolean;
  scanBar: Omit<ScanBarProps, 'isActive'>;
  preview: PreviewStageProps;
  history: ReactNode;
}

/** 工作台：左边扫码栏 + 标签预览，右边打印记录。 */
export function Workbench({ isActive, scanBar, preview, history }: WorkbenchProps) {
  return (
    <main className="workspace" inert={!isActive}>
      <div className="station">
        <ScanBar isActive={isActive} {...scanBar} />
        <PreviewStage {...preview} />
      </div>
      <WorkbenchSide history={history} />
    </main>
  );
}
