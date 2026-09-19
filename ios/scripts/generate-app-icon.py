#!/usr/bin/env python3
"""App icon (волна 9b): адаптация СУЩЕСТВУЮЩЕГО знака EVO, не новая графика.

Берёт официальный логотип public/brand/evo-logo.png (тот же файл, что
рендерит src/components/platform/brand/EvoLogo.tsx), вырезает альфа-bbox
красного знака (левая часть лок-апа, без чёрной словесной части) и
центрирует его на бумажном фоне #f7f5f2 дизайн-контракта
(docs/design/portal/design-contract.md:24). Пиксели знака не перекрашиваются:
брендовый красный #d70217 уже в них.

App Store marketing icon (1024x1024) не допускает альфа-канал — результат
сохраняется как непрозрачный RGB PNG.

Запуск (из корня репозитория):
    python3 ios/scripts/generate-app-icon.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public/brand/evo-logo.png"
TARGET = ROOT / "ios/EVOAdmissions/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"

CANVAS = 1024
# Знак занимает ~62% холста — воздух по краям, как у системных иконок.
MARK_FRACTION = 0.62
PAPER = (0xF7, 0xF5, 0xF2)


def is_red(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, a = pixel
    return a > 0 and r > 120 and r > 2 * g and r > 2 * b


def main() -> None:
    logo = Image.open(SOURCE).convert("RGBA")
    pixels = logo.load()

    # Bbox ТОЛЬКО красных пикселей: чёрная словесная часть лок-апа в иконку
    # не входит (адаптация знака, план §1).
    min_x, min_y = logo.width, logo.height
    max_x = max_y = -1
    for y in range(logo.height):
        for x in range(logo.width):
            if is_red(pixels[x, y]):
                min_x, max_x = min(min_x, x), max(max_x, x)
                min_y, max_y = min(min_y, y), max(max_y, y)
    if max_x < 0:
        raise SystemExit("no red mark pixels found in the source logo")

    mark = logo.crop((min_x, min_y, max_x + 1, max_y + 1))

    side = int(CANVAS * MARK_FRACTION)
    scale = min(side / mark.width, side / mark.height)
    scaled = mark.resize(
        (round(mark.width * scale), round(mark.height * scale)),
        Image.LANCZOS,
    )

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (*PAPER, 255))
    canvas.alpha_composite(
        scaled,
        ((CANVAS - scaled.width) // 2, (CANVAS - scaled.height) // 2),
    )

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(TARGET, "PNG")
    print(f"wrote {TARGET} ({CANVAS}x{CANVAS}, mark bbox {mark.width}x{mark.height})")


if __name__ == "__main__":
    main()
