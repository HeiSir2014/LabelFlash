import { expect, test } from 'bun:test';
import { pageSizeMicrons } from './page-size';

test('turns the paper into the page size Electron prints with', () => {
  expect(pageSizeMicrons({ widthMm: 60, heightMm: 40 })).toEqual({ width: 60_000, height: 40_000 });
  expect(pageSizeMicrons({ widthMm: 76.5, heightMm: 130 })).toEqual({ width: 76_500, height: 130_000 });
});
