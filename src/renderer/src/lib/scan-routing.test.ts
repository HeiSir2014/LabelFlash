import { describe, expect, test } from 'bun:test';
import { BATCH_VIEW, WORKBENCH } from './app-view';
import { isWorkbenchActive, scanTargetFor } from './scan-routing';

describe('scanTargetFor', () => {
  test('uses the scan box on the workbench', () => {
    expect(scanTargetFor(WORKBENCH)).toBe('scan-box');
  });

  test('fills the test box of the page that has one, and swallows scans elsewhere', () => {
    expect(scanTargetFor({ kind: 'config', page: 'rules' })).toBe('rule-tester');
    expect(scanTargetFor({ kind: 'config', page: 'templates' })).toBe('template-sample');
    expect(scanTargetFor({ kind: 'config', page: 'general' })).toBe('sink');
    expect(scanTargetFor({ kind: 'config', page: 'secrets' })).toBe('sink');
    expect(scanTargetFor(BATCH_VIEW)).toBe('sink');
  });
});

describe('isWorkbenchActive', () => {
  test('enables printing shortcuts and auto refocus only on the workbench', () => {
    expect(isWorkbenchActive(WORKBENCH)).toBe(true);
    expect(isWorkbenchActive({ kind: 'config', page: 'about' })).toBe(false);
    expect(isWorkbenchActive(BATCH_VIEW)).toBe(false);
  });
});
