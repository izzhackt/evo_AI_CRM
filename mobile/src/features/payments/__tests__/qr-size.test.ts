import { FULL_QR_CARD_PAD, fullQrSize } from "../qr-size";

describe("fullQrSize", () => {
  it.each([320, 375, 402, 430, 768, 1024])("QR целиком помещается в карточке с равными полями на ширине %i", (width) => {
    const size = fullQrSize(width);
    const card = Math.min(size + 2 * FULL_QR_CARD_PAD, width - 32);
    expect(card - 2 * FULL_QR_CARD_PAD).toBeGreaterThanOrEqual(size);
    expect(size).toBeLessThanOrEqual(560);
  });
  it("402pt: самый большой квадрат (338)", () => expect(fullQrSize(402)).toBe(338));
  it("не уходит в минус на узком окне", () => expect(fullQrSize(40)).toBe(0));
});
