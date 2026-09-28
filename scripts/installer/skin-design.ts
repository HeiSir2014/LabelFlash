/**
 * 安装界面的外观：图片（SVG）和页面（nsNiuniuSkin 的 XML）都在这里按逻辑像素描述，
 * 由 build-skin.ts 按各缩放比例渲染。插件本身不会随系统缩放放大界面，所以每个比例单独生成一份，
 * 安装程序按系统 DPI 挑最接近的那份（见 nsisSkinInclude）。
 *
 * 窗口是一个圆：圆外全透明（分层窗口，按像素透明，点击也会穿透），所有内容都在圆内。
 * 配置页是图标、名称、「立即安装」和安装位置；安装时圆的边缘是一圈刻度（取材软尺），
 * 黄色进度沿刻度走一圈，最外沿有一段发光的弧不停绕行；装完整圈变绿打勾，随即启动程序并关闭窗口。
 */

import { BRAND } from '../../src/shared/brand';

const BRAND_NAME = BRAND.productName;

/**
 * 安装界面上的全部文字。静态的写进 XML，安装过程中才显示的由 skins.nsh 以 NSIS 常量提供，
 * 所以文案只在这一处维护。用词和软件界面保持一致。
 */
export const SKIN_TEXT = {
  windowTitle: `${BRAND_NAME} 安装`,
  updateWindowTitle: `${BRAND_NAME} 更新`,
  tagline: '样衣标签重打工具',
  install: '立即安装',
  changeDir: '更改',
  chooseDirTitle: '选择安装位置',
  installing: '正在安装',
  updating: '正在更新',
  /** 安装时轮换的一句话：各说一个功能，短到能放进刻度圈里。 */
  tips: ['扫码自动预览并打印', '3 秒内同一标签只打一次', '缺纸、卡纸会语音提醒'],
  installedLaunching: '安装完成，正在启动',
  updatedLaunching: '更新完成，正在启动',
  invalidPath: '请填写完整的本地路径，例如 D:\\Programs',
  startFailed: '无法启动安装，请重试',
  /** 后面由安装脚本接上错误码。 */
  installFailed: '安装没有完成，请重试。错误码',
} as const;

/** 生成的缩放比例（%）。常见的 Windows 缩放都能对上；其他值取最接近的一档。 */
export const SKIN_SCALES = [100, 125, 150, 175, 200, 250, 300] as const;
export type SkinScale = (typeof SKIN_SCALES)[number];

/** Windows 的 100% 缩放对应 96 DPI。 */
const BASE_DPI = 96;
const PERCENT = 100;

/** 安装脚本会读写的控件；改名时两边一起改（有测试核对 XML 里都有）。 */
export const SKIN_CONTROLS = [
  'wizardTab',
  'btnClose',
  'message',
  'btnInstall',
  'editDir',
  'btnSelectDir',
  'ring',
  'orbit',
  'percent',
  'percentCaption',
  'tip',
] as const;

const COLOR = {
  paper: '#FBFBF8',
  housing: '#E4E7E2',
  ink: '#18211E',
  inkHover: '#2B3632',
  inkPressed: '#0E1412',
  inkDisabled: '#8A918E',
  inkSoft: '#55605B',
  rule: '#C5CBC4',
  tape: '#F2C12E',
  success: '#2FAE63',
  error: '#C8372D',
  errorPressed: '#A92E26',
} as const;

/**
 * 逻辑像素（100% 缩放）下的布局。内容区是边长 400 的正方形，圆内切于它；
 * 窗口四周再留出阴影的边距。控件坐标都相对内容区。
 */
const LAYOUT = {
  diameter: 400,
  shadow: 20,
  /** 圆边的细线，让圆在白色桌面上也有轮廓。 */
  rimLine: 196,
  /** 安装页的刻度带（半径）：刻度和进度弧都在这里，离圆边留出绕行动画的空间。 */
  tickInner: 170,
  majorTickInner: 164,
  tickOuter: 182,
  arcRadius: 176,
  arcWidth: 12,
  orbitRadius: 191,
  /** 完成时的绿色勾：画在百分比的位置（和它同一中心），「正在启动」显示在它下面的提示行。 */
  doneMark: { offsetY: -6, radius: 32 },
  windowButton: 28,
  /** 各控件的顶边（内容区坐标，圆心在 200）：两页的主要内容都落在圆心附近。 */
  rows: {
    close: 46,
    lockup: 108,
    tagline: 184,
    install: 222,
    path: 288,
    installLockup: 108,
    percent: 166,
    percentCaption: 222,
    tip: 256,
  },
  /** 图标和名称横排成一组（图标里本身有字，不再上下重复）：配置页大一号，安装页小一号。 */
  lockup: { logo: 64, gap: 14, fontSize: 26 },
  installLockup: { logo: 32, gap: 10, fontSize: 16 },
} as const;

const TICK_COUNT = 60;
const MAJOR_TICK_EVERY = 5;
/** 进度环每 2% 一帧：界面上的百分比数字仍然逐 1% 变化。 */
export const RING_FRAME_STEP = 2;
/** 绕行动画一圈的帧数（每帧 10°，60ms 一帧约 2 秒一圈）。 */
export const ORBIT_FRAME_COUNT = 36;
/** 沿圆边绕行的彗星：发光的头部，后面拖一段逐渐变淡的弧。 */
const COMET = {
  tailDegrees: 72,
  tailSegments: 12,
  width: 5,
  headRadius: 4.5,
  glowRadius: 8,
} as const;

const FULL_CIRCLE_DEGREES = 360;
const HALF_CIRCLE_DEGREES = 180;
const DECIMALS = 1000;

function round(value: number): number {
  return Math.round(value * DECIMALS) / DECIMALS;
}

function pointOnCircle(center: { x: number; y: number }, radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / HALF_CIRCLE_DEGREES;
  return { x: round(center.x + radius * Math.sin(radians)), y: round(center.y - radius * Math.cos(radians)) };
}

/** 从 12 点方向顺时针画到 progress%（0–100）的圆弧路径；100% 是闭合的整圆（两段半圆）。 */
export function arcPath(progress: number, center: number, radius: number): string {
  const c = { x: center, y: center };
  const start = pointOnCircle(c, radius, 0);
  if (progress <= 0) {
    return '';
  }
  if (progress >= PERCENT) {
    const bottom = pointOnCircle(c, radius, HALF_CIRCLE_DEGREES);
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 1 1 ${bottom.x} ${bottom.y} A ${radius} ${radius} 0 1 1 ${start.x} ${start.y}`;
  }
  const degrees = (progress / PERCENT) * FULL_CIRCLE_DEGREES;
  const end = pointOnCircle(c, radius, degrees);
  const largeArc = degrees > HALF_CIRCLE_DEGREES ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function ringFrameName(progress: number): string {
  return `images/ring/p${String(progress).padStart(3, '0')}.png`;
}

function orbitFrameName(index: number): string {
  return `images/orbit/o${String(index).padStart(2, '0')}.png`;
}

/** 系统 DPI 对应的皮肤比例：取最接近的一档。 */
export function nearestSkinScale(dpi: number): SkinScale {
  const percent = (dpi * PERCENT) / BASE_DPI;
  let best: SkinScale = SKIN_SCALES[0];
  for (const scale of SKIN_SCALES) {
    if (Math.abs(scale - percent) < Math.abs(best - percent)) {
      best = scale;
    }
  }
  return best;
}

/** 皮肤包所在目录的 NSIS 常量名：installer.nsi 按 PROJECT_DIR 定义它，指向 build-skin.ts 的输出目录。 */
export const SKIN_DIR_DEFINE = 'LABELFLASH_SKIN_DIR';

/** NSIS 字符串常量：$ 和 " 需要转义。 */
function nsisString(text: string): string {
  return `"${text.replaceAll('$', '$$$$').replaceAll('"', '$\\"')}"`;
}

/**
 * 生成 skins.nsh：安装脚本要用的文案和动画参数（常量），以及按系统 DPI 释放皮肤包的宏。
 * 宏用 DPI×200 与「相邻两档之和×96」比较，全是整数运算，结果与 nearestSkinScale 完全一致（平局取小的一档）。
 */
export function nsisSkinInclude(): string {
  const file = (scale: SkinScale) => `File /oname=skin.zip "\${${SKIN_DIR_DEFINE}}\\skin-${scale}.zip"`;
  const texts = Object.entries(SKIN_TEXT).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [`!define SKIN_TEXT_${key} ${nsisString(value)}`]
      : value.map((tip, index) => `!define SKIN_TEXT_${key}_${index} ${nsisString(tip)}`),
  );
  const lines = [
    '; 由 scripts/installer/build-skin.ts 生成，不要手改。',
    ...texts,
    `!define SKIN_TIP_COUNT ${SKIN_TEXT.tips.length}`,
    `!define SKIN_RING_STEP ${RING_FRAME_STEP}`,
    `!define SKIN_ORBIT_FRAMES ${ORBIT_FRAME_COUNT}`,
    '',
    '!macro skinTipText INDEX OUT',
    ...SKIN_TEXT.tips.flatMap((_, index) => [
      `  ${index === 0 ? `\${If}` : `\${ElseIf}`} \${INDEX} == ${index}`,
      `    StrCpy \${OUT} "\${SKIN_TEXT_tips_${index}}"`,
    ]),
    `  \${EndIf}`,
    '!macroend',
    '',
    '!macro extractSkinForDpi DPI',
    '  Push $R9',
    `  IntOp $R9 \${DPI} * 200`,
  ];
  SKIN_SCALES.forEach((scale, index) => {
    const next = SKIN_SCALES[index + 1];
    if (next === undefined) {
      lines.push(`  \${Else}`, `    ${file(scale)}`, `  \${EndIf}`);
      return;
    }
    const keyword = index === 0 ? `\${If}` : `\${ElseIf}`;
    lines.push(`  ${keyword} $R9 <= ${(scale + next) * BASE_DPI}`, `    ${file(scale)}`);
  });
  lines.push('  Pop $R9', '!macroend', '');
  return lines.join('\n');
}

/** 一张皮肤图片：SVG 内容（逻辑坐标），或按尺寸缩放的应用图标。 */
export type SkinImage =
  | { name: string; width: number; height: number; kind: 'svg'; body: string }
  | { name: string; width: number; height: number; kind: 'app-icon' };

const CANVAS = LAYOUT.diameter + LAYOUT.shadow * 2;
const RADIUS = LAYOUT.diameter / 2;
/** 刻度、进度环、绕行动画都画在和圆同心的正方形图片里。 */
const RING_BOX = (LAYOUT.tickOuter + LAYOUT.arcWidth) * 2;
const ORBIT_BOX = (LAYOUT.orbitRadius + COMET.glowRadius) * 2;

function backgroundBody(): string {
  const center = CANVAS / 2;
  return [
    '<defs><filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter></defs>',
    // 阴影：比圆略小、下移几像素再模糊，边缘自然淡出。
    `<circle cx="${center}" cy="${center + 5}" r="${RADIUS - 4}" fill="#000" opacity="0.28" filter="url(#blur)"/>`,
    `<circle cx="${center}" cy="${center}" r="${RADIUS}" fill="${COLOR.paper}"/>`,
    `<circle cx="${center}" cy="${center}" r="${LAYOUT.rimLine}" fill="none" stroke="${COLOR.rule}" stroke-width="1" opacity="0.6"/>`,
  ].join('');
}

function dialBody(): string {
  const center = { x: RING_BOX / 2, y: RING_BOX / 2 };
  const ticks: string[] = [];
  for (let i = 0; i < TICK_COUNT; i += 1) {
    const degrees = (i * FULL_CIRCLE_DEGREES) / TICK_COUNT;
    const isMajor = i % MAJOR_TICK_EVERY === 0;
    const inner = pointOnCircle(center, isMajor ? LAYOUT.majorTickInner : LAYOUT.tickInner, degrees);
    const outer = pointOnCircle(center, LAYOUT.tickOuter, degrees);
    const color = isMajor ? COLOR.inkSoft : COLOR.rule;
    ticks.push(
      `<line x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" stroke="${color}" stroke-width="${isMajor ? 2 : 1.5}" stroke-linecap="round" opacity="${isMajor ? 0.55 : 1}"/>`,
    );
  }
  return ticks.join('');
}

function ringFrameBody(progress: number): string {
  const path = arcPath(progress, RING_BOX / 2, LAYOUT.arcRadius);
  if (path === '') {
    return '';
  }
  return `<path d="${path}" fill="none" stroke="${COLOR.tape}" stroke-width="${LAYOUT.arcWidth}" stroke-linecap="round" opacity="0.9"/>`;
}

function ringDoneBody(): string {
  const half = RING_BOX / 2;
  const { offsetY, radius } = LAYOUT.doneMark;
  const cy = half + offsetY;
  const check = `M ${half - 13} ${cy + 1} L ${half - 4} ${cy + 10} L ${half + 14} ${cy - 9}`;
  return [
    `<circle cx="${half}" cy="${half}" r="${LAYOUT.arcRadius}" fill="none" stroke="${COLOR.success}" stroke-width="${LAYOUT.arcWidth}"/>`,
    `<circle cx="${half}" cy="${cy}" r="${radius}" fill="${COLOR.success}"/>`,
    `<path d="${check}" fill="none" stroke="${COLOR.paper}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join('');
}

function orbitFrameBody(index: number): string {
  const center = { x: ORBIT_BOX / 2, y: ORBIT_BOX / 2 };
  const radius = LAYOUT.orbitRadius;
  const head = (index * FULL_CIRCLE_DEGREES) / ORBIT_FRAME_COUNT;
  const step = COMET.tailDegrees / COMET.tailSegments;
  const tail: string[] = [];
  // 尾巴分成若干小段，越靠后越淡；每段略微重叠，避免段与段之间露出缝。
  for (let segment = 0; segment < COMET.tailSegments; segment += 1) {
    const from = pointOnCircle(center, radius, head - (segment + 1) * step);
    const to = pointOnCircle(center, radius, head - segment * step + 0.5);
    const opacity = round(0.85 * (1 - segment / COMET.tailSegments) ** 1.6);
    tail.push(
      `<path d="M ${from.x} ${from.y} A ${radius} ${radius} 0 0 1 ${to.x} ${to.y}" fill="none" stroke="${COLOR.tape}" stroke-width="${COMET.width}" stroke-linecap="round" opacity="${opacity}"/>`,
    );
  }
  const tip = pointOnCircle(center, radius, head);
  return [
    ...tail,
    `<circle cx="${tip.x}" cy="${tip.y}" r="${COMET.glowRadius}" fill="${COLOR.tape}" opacity="0.25"/>`,
    `<circle cx="${tip.x}" cy="${tip.y}" r="${COMET.headRadius}" fill="${COLOR.tape}"/>`,
  ].join('');
}

type ButtonState = 'normal' | 'hot' | 'pushed' | 'disabled';
const BUTTON_STATES: readonly ButtonState[] = ['normal', 'hot', 'pushed', 'disabled'];

/** 圆形的关闭按钮：悬停时出现红色圆底；安装中禁用（变浅）。窗口很小，不需要最小化。 */
function closeButtonBody(state: ButtonState): string {
  const c = LAYOUT.windowButton / 2;
  const backgrounds: Record<ButtonState, string | null> = {
    normal: null,
    hot: COLOR.error,
    pushed: COLOR.errorPressed,
    disabled: null,
  };
  const background = backgrounds[state];
  const glyphColor = background ? COLOR.paper : state === 'disabled' ? COLOR.rule : COLOR.inkSoft;
  const fill = background ? `<circle cx="${c}" cy="${c}" r="${c}" fill="${background}"/>` : '';
  return `${fill}<path d="M ${c - 4.5} ${c - 4.5} L ${c + 4.5} ${c + 4.5} M ${c + 4.5} ${c - 4.5} L ${c - 4.5} ${c + 4.5}" stroke="${glyphColor}" stroke-width="1.5" stroke-linecap="round"/>`;
}

/** 全部皮肤图片（逻辑尺寸）。 */
export function skinImages(): SkinImage[] {
  const images: SkinImage[] = [
    { name: 'images/bg.png', width: CANVAS, height: CANVAS, kind: 'svg', body: backgroundBody() },
    { name: 'images/dial.png', width: RING_BOX, height: RING_BOX, kind: 'svg', body: dialBody() },
    { name: 'images/logo.png', width: LAYOUT.lockup.logo, height: LAYOUT.lockup.logo, kind: 'app-icon' },
    {
      name: 'images/logo_small.png',
      width: LAYOUT.installLockup.logo,
      height: LAYOUT.installLockup.logo,
      kind: 'app-icon',
    },
    { name: 'images/ring/done.png', width: RING_BOX, height: RING_BOX, kind: 'svg', body: ringDoneBody() },
  ];
  for (let progress = 0; progress <= PERCENT; progress += RING_FRAME_STEP) {
    images.push({
      name: ringFrameName(progress),
      width: RING_BOX,
      height: RING_BOX,
      kind: 'svg',
      body: ringFrameBody(progress),
    });
  }
  for (let index = 0; index < ORBIT_FRAME_COUNT; index += 1) {
    images.push({
      name: orbitFrameName(index),
      width: ORBIT_BOX,
      height: ORBIT_BOX,
      kind: 'svg',
      body: orbitFrameBody(index),
    });
  }
  const size = LAYOUT.windowButton;
  for (const state of BUTTON_STATES) {
    images.push({
      name: `images/close_${state}.png`,
      width: size,
      height: size,
      kind: 'svg',
      body: closeButtonBody(state),
    });
  }
  return images;
}

/** 包成 SVG 文档：像素尺寸按比例放大，坐标仍用逻辑像素。 */
export function svgDocument(image: { width: number; height: number; body: string }, scale: SkinScale): string {
  const width = Math.round((image.width * scale) / PERCENT);
  const height = Math.round((image.height * scale) / PERCENT);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${image.width} ${image.height}">${image.body}</svg>`;
}

/** DuiLib 的颜色写法：0xAARRGGBB。 */
function argb(hex: string): string {
  return `0xFF${hex.slice(1).toUpperCase()}`;
}

const FONT = { base: 0, lockup: 1, message: 2, button: 3, percent: 4, small: 5, installLockup: 6 } as const;

/** 生成 install.xml：所有控件绝对定位（float），数字全部按比例换算。 */
export function buildInstallXml(scale: SkinScale): string {
  const px = (value: number) => Math.round((value * scale) / PERCENT);
  const rect = (x: number, y: number, width: number, height: number) =>
    `float="true" pos="${px(x)},${px(y)},${px(x + width)},${px(y + height)}"`;
  /** 水平居中于圆心的矩形。 */
  const centered = (y: number, width: number, height: number) => rect(RADIUS - width / 2, y, width, height);
  const image = (name: string) => `images\\${name}`;
  const { rows, shadow } = LAYOUT;
  const canvas = px(CANVAS);
  const ringOffset = RADIUS - RING_BOX / 2;
  const orbitOffset = RADIUS - ORBIT_BOX / 2;
  const button = LAYOUT.windowButton;
  const primary = { width: 168, height: 42 };
  const pathRow = { height: 28, editWidth: 216, gap: 6, buttonWidth: 48 };
  const pathLeft = RADIUS - (pathRow.editWidth + pathRow.gap + pathRow.buttonWidth) / 2;
  const primaryColors = [
    `bkcolor="${argb(COLOR.ink)}"`,
    `hotbkcolor="${argb(COLOR.inkHover)}"`,
    `pushedbkcolor="${argb(COLOR.inkPressed)}"`,
    `disabledbkcolor="${argb(COLOR.inkDisabled)}"`,
    `textcolor="${argb(COLOR.paper)}"`,
    `hottextcolor="${argb(COLOR.paper)}"`,
    `pushedtextcolor="${argb(COLOR.paper)}"`,
    `disabledtextcolor="${argb(COLOR.paper)}"`,
    `borderround="${px(primary.height)},${px(primary.height)}"`,
  ].join(' ');
  const closeImages = BUTTON_STATES.map((state) => `${state}image="${image(`close_${state}.png`)}"`).join(' ');
  /**
   * 图标 + 名称横排并整体居中：名称按文字自动定宽（autocalcwidth），两侧的空 Control 平分剩余宽度。
   * 这样不用在构建时估算文字宽度，换字体、换缩放都居中。
   */
  const lockup = (
    y: number,
    spec: { logo: number; gap: number },
    font: number,
    logoImage: string,
  ) => `<HorizontalLayout ${rect(0, y, LAYOUT.diameter, spec.logo)}>
            <Control />
            <Control width="${px(spec.logo)}" height="${px(spec.logo)}" bkimage="${image(logoImage)}" />
            <Label autocalcwidth="true" height="${px(spec.logo)}" padding="${px(spec.gap)},0,0,0" font="${font}" textcolor="${argb(COLOR.ink)}" text="${BRAND_NAME}" />
            <Control />
          </HorizontalLayout>`;
  const fonts = [
    [FONT.base, 13, false],
    [FONT.lockup, LAYOUT.lockup.fontSize, true],
    [FONT.message, 13, false],
    [FONT.button, 16, true],
    [FONT.percent, 44, true],
    [FONT.small, 12, false],
    [FONT.installLockup, LAYOUT.installLockup.fontSize, true],
  ] as const;

  // caption 覆盖整个窗口：圆内任意空白处都能拖动；圆外透明像素本来就不接收点击。
  return `<?xml version="1.0" encoding="utf-8"?>
<Window size="${canvas},${canvas}" sizebox="0,0,0,0" caption="0,0,0,${canvas}" bktrans="true">
${fonts.map(([id, size, bold]) => `  <Font shared="true" id="${id}" name="微软雅黑" size="${px(size)}" bold="${bold}"${id === FONT.base ? ' default="true"' : ''} />`).join('\n')}
  <VerticalLayout bkimage="${image('bg.png')}" inset="${px(shadow)},${px(shadow)},${px(shadow)},${px(shadow)}">
    <VerticalLayout>
      <TabLayout name="wizardTab">
        <VerticalLayout>
          ${lockup(rows.lockup, LAYOUT.lockup, FONT.lockup, 'logo.png')}
          <Label name="message" ${centered(rows.tagline, 320, 20)} font="${FONT.message}" align="center" textcolor="${argb(COLOR.inkSoft)}" text="${SKIN_TEXT.tagline}" />
          <Button name="btnInstall" ${centered(rows.install, primary.width, primary.height)} font="${FONT.button}" cursor="hand" text="${SKIN_TEXT.install}" ${primaryColors} />
          <RichEdit name="editDir" ${rect(pathLeft, rows.path, pathRow.editWidth, pathRow.height)} font="${FONT.small}" textcolor="${argb(COLOR.inkSoft)}" bkcolor="${argb(COLOR.paper)}" bordersize="${Math.max(1, px(1))}" bordercolor="${argb(COLOR.rule)}" focusbordercolor="${argb(COLOR.inkSoft)}" borderround="${px(pathRow.height)},${px(pathRow.height)}" inset="${px(12)},${px(6)},${px(12)},${px(4)}" multiline="false" autohscroll="true" wantreturn="false" wanttab="false" />
          <Button name="btnSelectDir" ${rect(pathLeft + pathRow.editWidth + pathRow.gap, rows.path, pathRow.buttonWidth, pathRow.height)} font="${FONT.small}" cursor="hand" text="${SKIN_TEXT.changeDir}" textcolor="${argb(COLOR.inkSoft)}" hottextcolor="${argb(COLOR.ink)}" pushedtextcolor="${argb(COLOR.inkPressed)}" hotbkcolor="${argb(COLOR.housing)}" borderround="${px(pathRow.height)},${px(pathRow.height)}" />
        </VerticalLayout>
        <VerticalLayout>
          <Control ${rect(ringOffset, ringOffset, RING_BOX, RING_BOX)} bkimage="${image('dial.png')}" />
          <Control name="ring" ${rect(ringOffset, ringOffset, RING_BOX, RING_BOX)} bkimage="${image('ring\\p000.png')}" />
          <Control name="orbit" ${rect(orbitOffset, orbitOffset, ORBIT_BOX, ORBIT_BOX)} bkimage="${image('orbit\\o00.png')}" />
          ${lockup(rows.installLockup, LAYOUT.installLockup, FONT.installLockup, 'logo_small.png')}
          <Label name="percent" ${centered(rows.percent, 200, 56)} font="${FONT.percent}" align="center" textcolor="${argb(COLOR.ink)}" text="0%" />
          <Label name="percentCaption" ${centered(rows.percentCaption, 240, 20)} font="${FONT.message}" align="center" textcolor="${argb(COLOR.inkSoft)}" text="${SKIN_TEXT.installing}" />
          <Label name="tip" ${centered(rows.tip, 280, 20)} font="${FONT.message}" align="center" textcolor="${argb(COLOR.inkSoft)}" text="${SKIN_TEXT.tips[0]}" />
        </VerticalLayout>
      </TabLayout>
      <Button name="btnClose" ${centered(rows.close, button, button)} cursor="hand" ${closeImages} />
    </VerticalLayout>
  </VerticalLayout>
</Window>
`;
}
