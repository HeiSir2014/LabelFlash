import { describe, expect, test } from 'bun:test';
import { isValidSecretName, SECRET_REFERENCE_PATTERN, secretReference } from './enrich-model';

describe('secretReference', () => {
  test('writes a reference the header substitution recognises', () => {
    const reference = secretReference('仓库接口');
    expect(reference).toBe('{密钥:仓库接口}');
    expect([...reference.matchAll(SECRET_REFERENCE_PATTERN)].map((match) => match[1])).toEqual(['仓库接口']);
  });
});

describe('isValidSecretName', () => {
  test('accepts names that fit in a reference and rejects the rest', () => {
    expect(isValidSecretName('仓库接口')).toBe(true);
    expect(isValidSecretName('')).toBe(false);
    expect(isValidSecretName(' 仓库')).toBe(false);
    expect(isValidSecretName('a{b}')).toBe(false);
    expect(isValidSecretName('x'.repeat(31))).toBe(false);
  });
});
