import type { ReactNode } from 'react';

/**
 * 设计器的图标：内联 SVG，24 的画布、1.75 的笔画、圆头圆角，颜色跟随文字（currentColor），不引入图标库。
 * 图标只是装饰：按钮的名字在 aria-label 和悬停提示里，这里一律 aria-hidden。
 */

/** 图标在按钮里显示的边长（px）：工具条、检查器、浮动工具条统一用这个大小。 */
const ICON_SIZE_PX = 18;

function Svg({ children, size = ICON_SIZE_PX }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="designer-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ICONS = {
  text: (
    <Svg>
      <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
    </Svg>
  ),
  barcode: (
    <Svg>
      <path d="M4 5v14M7 5v14M10.5 5v14M13 5v14M16.5 5v14M20 5v14" />
    </Svg>
  ),
  qr: (
    <Svg>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 19v1M19 14h1" />
    </Svg>
  ),
  image: (
    <Svg>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="M20.5 16l-5-5-9 8.5" />
    </Svg>
  ),
  line: (
    <Svg>
      <path d="M4 12h16" />
    </Svg>
  ),
  rect: (
    <Svg>
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
    </Svg>
  ),
  table: (
    <Svg>
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <path d="M3.5 10h17M3.5 14.5h17M10 5v14" />
    </Svg>
  ),
  undo: (
    <Svg>
      <path d="M9 7L5 11l4 4" />
      <path d="M5 11h9a5 5 0 0 1 0 10h-2" />
    </Svg>
  ),
  redo: (
    <Svg>
      <path d="M15 7l4 4-4 4" />
      <path d="M19 11h-9a5 5 0 0 0 0 10h2" />
    </Svg>
  ),
  alignLeft: (
    <Svg>
      <path d="M4 3v18" />
      <rect x="7" y="6" width="12" height="4" rx="1" />
      <rect x="7" y="14" width="7" height="4" rx="1" />
    </Svg>
  ),
  alignCenter: (
    <Svg>
      <path d="M12 3v18" />
      <rect x="5" y="6" width="14" height="4" rx="1" />
      <rect x="8" y="14" width="8" height="4" rx="1" />
    </Svg>
  ),
  alignRight: (
    <Svg>
      <path d="M20 3v18" />
      <rect x="5" y="6" width="12" height="4" rx="1" />
      <rect x="10" y="14" width="7" height="4" rx="1" />
    </Svg>
  ),
  alignTop: (
    <Svg>
      <path d="M3 4h18" />
      <rect x="6" y="7" width="4" height="12" rx="1" />
      <rect x="14" y="7" width="4" height="7" rx="1" />
    </Svg>
  ),
  alignMiddle: (
    <Svg>
      <path d="M3 12h18" />
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="8" width="4" height="8" rx="1" />
    </Svg>
  ),
  alignBottom: (
    <Svg>
      <path d="M3 20h18" />
      <rect x="6" y="5" width="4" height="12" rx="1" />
      <rect x="14" y="10" width="4" height="7" rx="1" />
    </Svg>
  ),
  distributeHorizontal: (
    <Svg>
      <path d="M4 4v16M20 4v16" />
      <rect x="9.5" y="7" width="5" height="10" rx="1" />
    </Svg>
  ),
  distributeVertical: (
    <Svg>
      <path d="M4 4h16M4 20h16" />
      <rect x="7" y="9.5" width="10" height="5" rx="1" />
    </Svg>
  ),
  bringToFront: (
    <Svg>
      <rect x="8" y="8" width="11" height="11" rx="1.5" fill="currentColor" fillOpacity="0.25" />
      <path d="M5 15V6a1 1 0 0 1 1-1h9" />
    </Svg>
  ),
  bringForward: (
    <Svg>
      <path d="M12 19V6M7 11l5-5 5 5" />
    </Svg>
  ),
  sendBackward: (
    <Svg>
      <path d="M12 5v13M7 13l5 5 5-5" />
    </Svg>
  ),
  sendToBack: (
    <Svg>
      <rect x="5" y="5" width="11" height="11" rx="1.5" />
      <path d="M19 9v9a1 1 0 0 1-1 1H9" />
    </Svg>
  ),
  duplicate: (
    <Svg>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </Svg>
  ),
  trash: (
    <Svg>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </Svg>
  ),
  lock: (
    <Svg>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  ),
  unlock: (
    <Svg>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </Svg>
  ),
  eye: (
    <Svg>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  eyeOff: (
    <Svg>
      <path d="M4 4l16 16M10 6a10 10 0 0 1 2-.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9" />
    </Svg>
  ),
  more: (
    <Svg>
      <circle cx="6" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="18" cy="12" r="1.25" fill="currentColor" />
    </Svg>
  ),
  minus: (
    <Svg>
      <path d="M6 12h12" />
    </Svg>
  ),
  plus: (
    <Svg>
      <path d="M12 6v12M6 12h12" />
    </Svg>
  ),
  bold: (
    <Svg>
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </Svg>
  ),
  textLeft: (
    <Svg>
      <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />
    </Svg>
  ),
  textCenter: (
    <Svg>
      <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />
    </Svg>
  ),
  textRight: (
    <Svg>
      <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />
    </Svg>
  ),
  edit: (
    <Svg>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </Svg>
  ),
  field: (
    <Svg>
      <path d="M8 4c-2 0-2 1.5-2 3s0 3-2 5c2 2 2 3.5 2 5s0 3 2 3M16 4c2 0 2 1.5 2 3s0 3 2 5c-2 2-2 3.5-2 5s0 3-2 3" />
    </Svg>
  ),
  grow: (
    <Svg>
      <path d="M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3" />
    </Svg>
  ),
  help: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </Svg>
  ),
  grid: (
    <Svg>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" />
    </Svg>
  ),
  magnet: (
    <Svg>
      <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z" />
      <path d="M6 8h4M14 8h4" />
    </Svg>
  ),
  warning: (
    <Svg>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </Svg>
  ),
  check: (
    <Svg>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  ),
  chevronDown: (
    <Svg>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  ),
  chevronUp: (
    <Svg>
      <path d="M6 15l6-6 6 6" />
    </Svg>
  ),
  rotate: (
    <Svg>
      <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
    </Svg>
  ),
} as const;

export type IconName = keyof typeof ICONS;
