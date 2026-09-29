import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { firewallInstallerScript } from '../../src/shared/firewall-rule';
import {
  buildInstallXml,
  nsisSkinInclude,
  SKIN_SCALES,
  type SkinImage,
  type SkinScale,
  skinImages,
  svgDocument,
} from './skin-design';
import { createZip, type ZipEntry } from './zip';

/** 皮肤包和生成的 NSIS 片段的输出目录（installer.nsi 从这里取）。 */
export const SKIN_OUTPUT_DIR = 'dist/.installer';
const APP_ICON = 'resources/icon.png';
const PERCENT = 100;
/** PNG 最高压缩：皮肤包按比例生成七份，都打进安装包。 */
const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: true } as const;
/**
 * 界面图形（进度环、刻度、按钮）只有几种纯色加抗锯齿边缘，用 8 位调色板 PNG 看不出差别，
 * 体积只有真彩色的几分之一；应用图标有渐变，保持真彩色。
 */
const SHAPE_PNG_OPTIONS = { ...PNG_OPTIONS, palette: true, quality: 90, effort: 10 } as const;

async function renderImage(image: SkinImage, scale: SkinScale): Promise<Buffer> {
  if (image.kind === 'app-icon') {
    const size = Math.round((image.width * scale) / PERCENT);
    return sharp(APP_ICON).resize(size, size).png(PNG_OPTIONS).toBuffer();
  }
  return sharp(Buffer.from(svgDocument(image, scale)))
    .png(SHAPE_PNG_OPTIONS)
    .toBuffer();
}

async function buildSkin(scale: SkinScale): Promise<Buffer> {
  const images = skinImages();
  const rendered = await Promise.all(images.map((image) => renderImage(image, scale)));
  const entries: ZipEntry[] = [
    { name: 'install.xml', data: Buffer.from(buildInstallXml(scale), 'utf8') },
    ...images.map((image, index) => ({ name: image.name, data: rendered[index] ?? Buffer.alloc(0) })),
  ];
  return createZip(entries);
}

/**
 * Windows PowerShell 5.1 把没有 BOM 的 .ps1 当作系统代码页（中文系统是 GBK）读：带上 UTF-8 的 BOM，
 * 脚本里的中文注释、以后可能出现的中文都不会读错。
 */
const UTF8_BOM = '﻿';

/** 生成全部比例的皮肤包、挑选皮肤的 NSIS 宏，以及安装时加防火墙规则的脚本。 */
export async function buildSkins(outputDir = SKIN_OUTPUT_DIR): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  for (const scale of SKIN_SCALES) {
    const zip = await buildSkin(scale);
    await writeFile(join(outputDir, `skin-${scale}.zip`), zip);
    console.log(`[installer] skin-${scale}.zip  ${Math.round(zip.length / 1024)} KB`);
  }
  await writeFile(join(outputDir, 'skins.nsh'), nsisSkinInclude(), 'utf8');
  await writeFile(join(outputDir, 'firewall.ps1'), `${UTF8_BOM}${firewallInstallerScript()}`, 'utf8');
}

if (import.meta.main) {
  await buildSkins();
}
