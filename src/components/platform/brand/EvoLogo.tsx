import Image from "next/image";
import evoLogo from "../../../../public/brand/evo-logo.png";

/** Original horizontal lockup; no re-lettering, colour filter or distortion. */
export function EvoLogo({
  width = 132,
  className = "",
}: {
  width?: number;
  className?: string;
}) {
  return (
    <Image
      src={evoLogo}
      alt="EVO Admissions"
      width={1843}
      height={842}
      sizes={`${width}px`}
      className={className}
      style={{ width, height: "auto", maxWidth: "100%" }}
    />
  );
}
