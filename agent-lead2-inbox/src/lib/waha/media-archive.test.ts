import { describe, expect, it } from 'vitest';

import {
  WahaMediaArchiveError,
  requirePrivateWahaMediaUrl,
} from './media-archive';

describe('WAHA private media URL boundary', () => {
  it('accepts only the configured WAHA origin and files path', () => {
    expect(
      requirePrivateWahaMediaUrl(
        'http://evo-inbox-waha:3000/api/files/message.pdf',
        'http://evo-inbox-waha:3000',
      ).pathname,
    ).toBe('/api/files/message.pdf');
  });

  it('rejects a cross-origin media URL', () => {
    expect(() =>
      requirePrivateWahaMediaUrl(
        'https://public.example/customer.pdf',
        'http://evo-inbox-waha:3000',
      ),
    ).toThrow(WahaMediaArchiveError);
  });

  it('rejects a non-media path on the WAHA origin', () => {
    expect(() =>
      requirePrivateWahaMediaUrl(
        'http://evo-inbox-waha:3000/api/sessions',
        'http://evo-inbox-waha:3000',
      ),
    ).toThrow(WahaMediaArchiveError);
  });
});
