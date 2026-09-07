export const PLATFORM_CASE_NOTE_MAX_BODY_LENGTH = 4_000;

export function isPlatformCaseNoteBodyWithinCodePointLimit(
  value: string,
): boolean {
  let codePointLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const followingCodeUnit = value.charCodeAt(index + 1);
      if (!(
        followingCodeUnit >= 0xdc00 && followingCodeUnit <= 0xdfff
      )) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }

    codePointLength += 1;
    if (codePointLength > PLATFORM_CASE_NOTE_MAX_BODY_LENGTH) return false;
  }

  return true;
}
