/**
 * 测试用：生成只有一个工作表的最小 .xlsx（ZIP 不压缩）。看起来是数字的格子写成数字单元格，其余写成共享字符串，
 * 覆盖 Excel 文件最常见的两种单元格。真实文件由 Excel 生成，这里只用来走通读取路径，不追求完整。
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01：ZIP 的 DOS 日期从 1980 年起，取最早的那天。 */
const DOS_DATE_1980 = 0x21;
const ZIP_VERSION = 20;

function zipStore(files: ReadonlyArray<{ name: string; text: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, ZIP_VERSION, true);
    lv.setUint16(12, DOS_DATE_1980, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, ZIP_VERSION, true);
    cv.setUint16(6, ZIP_VERSION, true);
    cv.setUint16(14, DOS_DATE_1980, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    parts.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, central) => sum + central.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...centrals, end];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 第 index 列（从 0 数）的列名：A、B……Z、AA。 */
function columnName(index: number): string {
  let name = '';
  let rest = index + 1;
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/** 一个工作表的 .xlsx 文件内容；rows[0] 一般是表头。 */
export function minimalXlsx(rows: readonly (readonly string[])[]): Uint8Array {
  const strings: string[] = [];
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${columnName(c)}${r + 1}`;
      if (NUMBER_PATTERN.test(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      strings.push(value);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    });
    return `<row r="${r + 1}">${cells.join('')}</row>`;
  });
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipStore([
    {
      name: '[Content_Types].xml',
      text: `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      text: `${header}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `${header}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `${header}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      text: `${header}<styleSheet xmlns="${MAIN_NS}"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      text: `${header}<sst xmlns="${MAIN_NS}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('')}</sst>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      text: `${header}<worksheet xmlns="${MAIN_NS}"><sheetData>${sheetRows.join('')}</sheetData></worksheet>`,
    },
  ]);
}
