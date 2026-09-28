import { describe, expect, test } from 'bun:test';
import {
  arcPath,
  buildInstallXml,
  nearestSkinScale,
  nsisSkinInclude,
  RING_FRAME_STEP,
  ringFrameName,
  SKIN_CONTROLS,
  SKIN_SCALES,
  SKIN_TEXT,
  skinImages,
} from './skin-design';

describe('arcPath', () => {
  const center = 100;
  const radius = 50;

  test('draws nothing at 0% and a closed circle at 100%', () => {
    expect(arcPath(0, center, radius)).toBe('');
    expect(arcPath(100, center, radius)).toContain('A 50 50 0 1 1 100 150');
    expect(arcPath(100, center, radius)).toContain('A 50 50 0 1 1 100 50');
  });

  test('starts at twelve o’clock and runs clockwise', () => {
    expect(arcPath(25, center, radius)).toBe('M 100 50 A 50 50 0 0 1 150 100');
    expect(arcPath(50, center, radius)).toBe('M 100 50 A 50 50 0 0 1 100 150');
  });

  test('uses the large-arc flag past half way', () => {
    expect(arcPath(75, center, radius)).toBe('M 100 50 A 50 50 0 1 1 50 100');
  });
});

describe('ring frames', () => {
  test('cover 0% to 100% in fixed steps, named so NSIS can build the path from the percentage', () => {
    expect(ringFrameName(0)).toBe('images/ring/p000.png');
    expect(ringFrameName(100)).toBe('images/ring/p100.png');
    const frames = skinImages().filter((image) => image.name.startsWith('images/ring/p'));
    expect(frames).toHaveLength(100 / RING_FRAME_STEP + 1);
  });
});

describe('nearestSkinScale', () => {
  test('picks the closest generated scale for common Windows settings', () => {
    expect(nearestSkinScale(96)).toBe(100);
    expect(nearestSkinScale(120)).toBe(125);
    expect(nearestSkinScale(144)).toBe(150);
    expect(nearestSkinScale(168)).toBe(175);
    expect(nearestSkinScale(192)).toBe(200);
    expect(nearestSkinScale(288)).toBe(300);
  });

  test('stays within the generated range for unusual values', () => {
    expect(nearestSkinScale(72)).toBe(100);
    expect(nearestSkinScale(480)).toBe(300);
  });
});

describe('nsisSkinInclude', () => {
  /** 按生成的 NSIS 代码的规则挑皮肤：依次比较 DPI×200 与各门限，第一个满足的就是它。 */
  function pickLikeNsis(code: string, dpi: number): number {
    const branches = [...code.matchAll(/\$R9 <= (\d+)\s+File \/oname=skin\.zip "[^"]*skin-(\d+)\.zip"/g)];
    for (const [, limit, scale] of branches) {
      if (dpi * 200 <= Number(limit)) {
        return Number(scale);
      }
    }
    const fallback = code.match(/\$\{Else\}\s+File \/oname=skin\.zip "[^"]*skin-(\d+)\.zip"/);
    return Number(fallback?.[1]);
  }

  test('makes the same choice as nearestSkinScale for every DPI, including exact ties', () => {
    const code = nsisSkinInclude();
    for (let dpi = 60; dpi <= 400; dpi += 1) {
      expect(pickLikeNsis(code, dpi)).toBe(nearestSkinScale(dpi));
    }
  });

  test('provides every text as an escaped NSIS constant', () => {
    const code = nsisSkinInclude();
    expect(code).toContain('!define SKIN_TEXT_install "立即安装"');
    expect(code).toContain('!define SKIN_TEXT_tips_2 ');
    expect(code).toContain(`!define SKIN_TIP_COUNT ${SKIN_TEXT.tips.length}`);
    expect(code).not.toMatch(/!define SKIN_TEXT_\w+ "[^"]*[^$]\$[^$\\][^"]*"/);
  });
});

describe('buildInstallXml', () => {
  test('declares every control the install script talks to, at every scale', () => {
    for (const scale of SKIN_SCALES) {
      const xml = buildInstallXml(scale);
      for (const name of SKIN_CONTROLS) {
        expect(xml).toContain(`name="${name}"`);
      }
    }
  });

  test('scales the round window with the system setting', () => {
    expect(buildInstallXml(100)).toMatch(/<Window size="440,440"/);
    expect(buildInstallXml(150)).toMatch(/<Window size="660,660"/);
  });

  test('lets the whole window be dragged, since a round window has no title bar', () => {
    expect(buildInstallXml(150)).toContain('caption="0,0,0,660"');
  });

  test('refers only to images that are generated', () => {
    const generated = new Set(skinImages().map((image) => image.name.replaceAll('/', '\\')));
    const referenced = [...buildInstallXml(100).matchAll(/images\\[\w\\.]+\.png/g)].map((match) => match[0]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const path of referenced) {
      expect(generated.has(path)).toBe(true);
    }
  });
});
