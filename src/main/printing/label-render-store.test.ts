import { describe, expect, test } from 'bun:test';
import { LabelRenderStore } from './label-render-store';

describe('LabelRenderStore', () => {
  test('returns the stored html once for its token', () => {
    const store = new LabelRenderStore();
    const token = store.put('<html>a</html>');
    expect(store.take(token)).toBe('<html>a</html>');
  });

  test('forgets the html after it is taken once', () => {
    const store = new LabelRenderStore();
    const token = store.put('<html>a</html>');
    store.take(token);
    expect(store.take(token)).toBeUndefined();
  });

  test('returns undefined for a token that was never stored', () => {
    const store = new LabelRenderStore();
    expect(store.take('not-a-real-token')).toBeUndefined();
  });

  test('gives each stored html its own token', () => {
    const store = new LabelRenderStore();
    const first = store.put('<html>a</html>');
    const second = store.put('<html>b</html>');
    expect(first).not.toBe(second);
    expect(store.take(first)).toBe('<html>a</html>');
    expect(store.take(second)).toBe('<html>b</html>');
  });
});
