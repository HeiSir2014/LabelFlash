import { describe, expect, test } from 'bun:test';
import { testPrinter } from '../../core/ipp/testing/ipp-requests';
import { escapeHtml, printerListPage, printerPage } from './ipp-pages';

describe('ipp pages', () => {
  test('escape everything that comes from names', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(printerPage(testPrinter({ location: '<script>' }))).not.toContain('<script>');
  });

  test('list the shared printers with links', () => {
    const page = printerListPage([testPrinter()]);
    expect(page).toContain('href="/printers/60x40"');
    expect(page).toContain('60×40 标签');
  });
});
