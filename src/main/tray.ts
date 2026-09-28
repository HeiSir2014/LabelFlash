import { Menu, nativeImage, Tray } from 'electron';
import { BRAND } from '../shared/brand';

export interface TrayActions {
  show: () => void;
  quit: () => void;
}

export interface AppTray {
  /** 第一次隐藏到托盘时提示：窗口隐藏期间扫码枪的输入会进入别的程序。 */
  notifyHiddenOnce: () => void;
  destroy: () => void;
}

/** 托盘图标用 resources/tray.png，Electron 会按屏幕缩放自动选 @1.25x/@1.5x/@2x 版本。 */
export function createTray(iconPath: string, actions: TrayActions): AppTray {
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip(BRAND.productName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: actions.show },
      { type: 'separator' },
      { label: `退出 ${BRAND.productName}`, click: actions.quit },
    ]),
  );
  // Windows 上单击就该唤出窗口（右键才是菜单）；习惯双击的人也接住。
  tray.on('click', actions.show);
  tray.on('double-click', actions.show);

  let hasNotified = false;
  return {
    notifyHiddenOnce: () => {
      if (hasNotified || process.platform !== 'win32') {
        return;
      }
      hasNotified = true;
      tray.displayBalloon({
        title: `${BRAND.productName} 仍在运行`,
        content: '窗口已隐藏到托盘。扫码前请先打开窗口，否则扫码内容会输入到其他程序。',
        iconType: 'info',
      });
    },
    destroy: () => tray.destroy(),
  };
}
