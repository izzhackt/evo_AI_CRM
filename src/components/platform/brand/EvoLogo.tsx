import Image from "next/image";
import evoLogo from "../../../../public/brand/evo-logo.png";
import evoLogoOnDark from "../../../../public/brand/evo-logo-on-dark.png";

/**
 * Original horizontal lockup; no re-lettering, colour filter or distortion. `onDark` is the same file with the black
 * "EVO / ADMISSIONS" letters turned white and the red mark untouched, for the dark portal rail (08.11.2026, user:
 * «удали фон у этого лого и текст сделай белым»).
 */
export function EvoLogo({
  width = 132,
  className = "",
  onDark = false,
}: {
  width?: number;
  className?: string;
  onDark?: boolean;
}) {
  return (
    <Image
      src={onDark ? evoLogoOnDark : evoLogo}
      alt="EVO Admissions"
      width={1843}
      height={842}
      sizes={`${width}px`}
      className={className}
      style={{ width, height: "auto", maxWidth: "100%" }}
    />
  );
}
