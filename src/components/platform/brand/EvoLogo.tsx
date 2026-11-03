import Image from "next/image";
import evoLogo from "../../../../public/brand/evo-logo.png";
import evoLogoWhite from "../../../../public/brand/evo-logo-white.png";

/**
 * Original horizontal lockup; no re-lettering, colour filter or distortion.
 * `white` is the logobook's white lockup for dark and brand red surfaces (logobook
 * pack 03.11.2026: `evo_black@4x.png` geometry, filled white).
 */
export function EvoLogo({
  width = 132,
  className = "",
  variant = "color",
}: {
  width?: number;
  className?: string;
  variant?: "color" | "white";
}) {
  return (
    <Image
      src={variant === "white" ? evoLogoWhite : evoLogo}
      alt="EVO Admissions"
      width={variant === "white" ? 1842 : 1843}
      height={842}
      sizes={`${width}px`}
      className={className}
      style={{ width, height: "auto", maxWidth: "100%" }}
    />
  );
}
