import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

/** 由 resources/*.svg 生成应用图标和多倍率托盘图标。修改 SVG 后运行 `bun run icons`。 */
const RESOURCES_DIR = 'resources';
const APP_ICON_SIZE_PX = 512;
const TRAY_ICON_BASE_PX = 16;
const TRAY_SCALES = [
  { suffix: '', scale: 1 },
  { suffix: '@1.25x', scale: 1.25 },
  { suffix: '@1.5x', scale: 1.5 },
  { suffix: '@2x', scale: 2 },
] as const;
const RENDER_DENSITY = 384;

async function render(svgName: string, sizePx: number, outputName: string): Promise<void> {
  const svg = await readFile(`${RESOURCES_DIR}/${svgName}`);
  await sharp(svg, { density: RENDER_DENSITY }).resize(sizePx, sizePx).png().toFile(`${RESOURCES_DIR}/${outputName}`);
  console.log(`wrote ${RESOURCES_DIR}/${outputName} (${sizePx}px)`);
}

await render('icon.svg', APP_ICON_SIZE_PX, 'icon.png');
for (const { suffix, scale } of TRAY_SCALES) {
  await render('tray.svg', Math.round(TRAY_ICON_BASE_PX * scale), `tray${suffix}.png`);
}
