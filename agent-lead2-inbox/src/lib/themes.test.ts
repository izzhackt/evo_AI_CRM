import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODE,
  getOppositeMode,
  isMode,
  MODE_THEME_COLORS,
  resolveMode,
} from './themes';

describe('mode defaults', () => {
  it('starts new visitors in light mode', () => {
    expect(DEFAULT_MODE).toBe('light');
  });

  it('continues to accept either saved mode', () => {
    expect(isMode('light')).toBe(true);
    expect(isMode('dark')).toBe(true);
    expect(resolveMode('dark')).toBe('dark');
    expect(resolveMode('light')).toBe('light');
    expect(resolveMode(null)).toBe(DEFAULT_MODE);
  });

  it('keeps toggle and browser chrome values mode-specific', () => {
    expect(getOppositeMode('light')).toBe('dark');
    expect(getOppositeMode('dark')).toBe('light');
    expect(MODE_THEME_COLORS.light).not.toBe(MODE_THEME_COLORS.dark);
  });
});
