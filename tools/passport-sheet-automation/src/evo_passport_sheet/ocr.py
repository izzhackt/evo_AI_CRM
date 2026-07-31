from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


class AppleVisionOCR:
    def __init__(self, helper_source: Path):
        if not shutil.which("swiftc") or not shutil.which("pdftoppm"):
            raise RuntimeError("swiftc and pdftoppm are required")
        self.binary = Path(tempfile.mkdtemp(prefix="evo-ocr-helper-")) / "vision-ocr"
        subprocess.run(["swiftc", str(helper_source), "-o", str(self.binary)], check=True, capture_output=True, text=True)

    def extract(self, document: Path) -> str:
        with tempfile.TemporaryDirectory(prefix="evo-passport-pages-") as directory:
            render_dir = Path(directory)
            if document.suffix.lower() == ".pdf":
                prefix = render_dir / "page"
                subprocess.run(
                    ["pdftoppm", "-f", "1", "-l", "3", "-jpeg", "-r", "300", str(document), str(prefix)],
                    check=True, capture_output=True,
                )
                images = sorted(render_dir.glob("page-*.jpg"))
            else:
                images = [document]
            return "\n".join(
                subprocess.run([str(self.binary), str(image)], check=True, capture_output=True, text=True).stdout
                for image in images
            )
