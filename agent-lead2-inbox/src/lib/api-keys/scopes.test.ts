import { describe, expect, it } from 'vitest';
import {
  API_SCOPES,
  SCOPE_DESCRIPTIONS,
  hasScope,
  isApiScope,
  normalizeScopes,
} from './scopes';

describe('isApiScope', () => {
  it('accepts every declared scope', () => {
    for (const s of API_SCOPES) expect(isApiScope(s)).toBe(true);
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isApiScope('messages:delete')).toBe(false);
    expect(isApiScope('')).toBe(false);
    expect(isApiScope(null)).toBe(false);
    expect(isApiScope(42)).toBe(false);
  });
});

describe('normalizeScopes', () => {
  it('passes a valid list through, de-duplicated', () => {
    expect(
      normalizeScopes(['contacts:read', 'contacts:read', 'conversations:read'])
    ).toEqual(['contacts:read', 'conversations:read']);
  });

  it('treats an empty array as valid (key with no scopes)', () => {
    expect(normalizeScopes([])).toEqual([]);
  });

  it('returns null if any entry is not a known scope', () => {
    expect(normalizeScopes(['contacts:read', 'bogus'])).toBeNull();
    expect(normalizeScopes(['messages:send'])).toBeNull();
    expect(normalizeScopes(['broadcasts:send'])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(normalizeScopes('contacts:read')).toBeNull();
    expect(normalizeScopes(undefined)).toBeNull();
  });
});

describe('hasScope', () => {
  it('is true when the scope is present', () => {
    expect(hasScope(['contacts:write', 'contacts:read'], 'contacts:read')).toBe(
      true
    );
  });

  it('is false when the scope is absent or the list is empty', () => {
    expect(hasScope(['contacts:write'], 'contacts:read')).toBe(false);
    expect(hasScope([], 'contacts:read')).toBe(false);
  });
});

describe('SCOPE_DESCRIPTIONS', () => {
  it('has a description for every scope', () => {
    for (const s of API_SCOPES) {
      expect(SCOPE_DESCRIPTIONS[s]).toBeTruthy();
    }
  });
});
