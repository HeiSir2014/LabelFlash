import { expect, test } from 'bun:test';
import { withoutPSModulePath } from './run-command';

test('drops PSModulePath but keeps every other variable', () => {
  expect(withoutPSModulePath({ PSModulePath: 'C:\\pwsh7\\Modules', SystemRoot: 'C:\\WINDOWS' })).toEqual({
    SystemRoot: 'C:\\WINDOWS',
  });
  expect('PSModulePath' in withoutPSModulePath({ PSModulePath: 'x' })).toBe(false);
});

test('is a no-op when PSModulePath is already absent', () => {
  expect(withoutPSModulePath({ SystemRoot: 'C:\\WINDOWS' })).toEqual({ SystemRoot: 'C:\\WINDOWS' });
});
