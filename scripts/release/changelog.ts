/**
 * 从 CHANGELOG.md 取出某个版本的说明，发版时当 GitHub Release 的说明（.github/workflows/ci.yml 的 release-draft）。
 * 没有这个版本的说明就报错、不发布：每个发布的版本都要在 CHANGELOG.md 里写清楚大概做了什么。
 *
 * 用法：bun scripts/release/changelog.ts <版本号>        打印这一节（不含标题行）
 */
import { readFileSync } from 'node:fs';

/** 版本标题：「## 1.1.0」，后面可以跟日期，例如「## 1.1.0（2026-09-30）」。 */
const VERSION_HEADING = /^## (\d+\.\d+\.\d+)(?=$|[\s（(])/;

/** 某个版本那一节的内容（到下一个版本标题为止，去掉首尾空行）；没有或是空的返回 null。 */
export function changelogSection(markdown: string, version: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => VERSION_HEADING.exec(line)?.[1] === version);
  if (start < 0) {
    return null;
  }
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const body = lines
    .slice(start + 1, next < 0 ? undefined : next)
    .join('\n')
    .trim();
  return body === '' ? null : body;
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) {
    throw new Error('用法：bun scripts/release/changelog.ts <版本号>');
  }
  const section = changelogSection(readFileSync('CHANGELOG.md', 'utf8'), version);
  if (section === null) {
    console.error(`CHANGELOG.md 里没有 ${version} 的说明：先写好这个版本做了什么再发布。`);
    process.exit(1);
  }
  console.log(section);
}
