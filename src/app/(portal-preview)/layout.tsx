import type { ReactNode } from "react";

import "../(v3)/v3.css";

// Each page checks Admin authority before rendering or reading its content.
export default function StudentPortalPreviewLayout({ children }: { children: ReactNode }) {
  return children;
}
