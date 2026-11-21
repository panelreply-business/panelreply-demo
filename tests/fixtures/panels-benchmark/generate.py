"""Build a reproducible, synthetic OCR benchmark outside the repository.

Usage: python tests/fixtures/panels-benchmark/generate.py /tmp/panelreply-ocr-benchmark
Requires Pillow and the installed DejaVu fonts. No network or customer images.
"""

import argparse
import hashlib
import json
import random
from pathlib import Path

import PIL
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FIELDS = ("partNumber", "manufacturer", "description")
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
FONTS = {"sans": "DejaVuSans.ttf", "serif": "DejaVuSerif.ttf", "mono": "DejaVuSansMono.ttf"}


def example(identifier, lines, expected):
    return {"id": identifier, "lines": lines, "expected": expected}


def values(part="SAMPLE-2042", manufacturer="FICTIONAL COMPONENTS", description="SYNTHETIC LABEL ALPHA"):
    return dict(zip(FIELDS, (part, manufacturer, description)))


SCENARIOS = [
    example("standard", ["PART NUMBER: SAMPLE-2042", "MANUFACTURER: FICTIONAL COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL ALPHA"], values()),
    example("abbreviated", ["P/N: SAMPLE-2042", "MFR: FICTIONAL COMPONENTS", "DESC: SYNTHETIC LABEL ALPHA"], values()),
    example("lowercase", ["part number: sample-2042", "manufacturer: fictional components", "description: synthetic label alpha"], values("sample-2042", "fictional components", "synthetic label alpha")),
    example("reordered", ["DESCRIPTION: SYNTHETIC LABEL ALPHA", "MANUFACTURER: FICTIONAL COMPONENTS", "PART NUMBER: SAMPLE-2042"], values()),
    example("leading-zero", ["PART NUMBER: 0000123400", "MANUFACTURER: FICTIONAL COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL ALPHA"], values("0000123400")),
    example("confusable", ["PART NUMBER: O0-I1-S5-B8", "MANUFACTURER: FICTIONAL COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL ALPHA"], values("O0-I1-S5-B8")),
    example("punctuation", ["PART NUMBER: X/24_A.03-7", "MANUFACTURER: FICTIONAL COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL ALPHA"], values("X/24_A.03-7")),
    example("unknown-manufacturer", ["PART NUMBER: SAMPLE-2042", "MANUFACTURER: INVENTED ZETA LAB", "DESCRIPTION: SYNTHETIC LABEL ALPHA"], values(manufacturer="INVENTED ZETA LAB")),
    example("missing-manufacturer", ["PART NUMBER: SAMPLE-2042", "DESCRIPTION: SYNTHETIC LABEL ALPHA"], values(manufacturer="")),
    example("missing-part", ["MANUFACTURER: FICTIONAL COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL ALPHA"], values(part="")),
    example("missing-description", ["PART NUMBER: SAMPLE-2042", "MANUFACTURER: FICTIONAL COMPONENTS"], values(description="")),
    example("conflicting-parts", ["PART NUMBER: SAMPLE-1001", "PART NUMBER: SAMPLE-2042", "MANUFACTURER: FICTIONAL COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL ALPHA"], values(part="")),
    example("conflicting-manufacturers", ["PART NUMBER: SAMPLE-2042", "MANUFACTURER: INVENTED ZETA LAB", "MANUFACTURER: FICTIONAL COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL ALPHA"], values(manufacturer="")),
    example("multiple-components", ["PART NUMBER: SAMPLE-1001", "MANUFACTURER: INVENTED ZETA LAB", "DESCRIPTION: SYNTHETIC LABEL ALPHA", "PART NUMBER: SAMPLE-2042", "MANUFACTURER: FICTIONAL COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL BRAVO"], values("", "", "")),
    example("unlabelled", ["SAMPLE-2042", "FICTIONAL COMPONENTS", "SYNTHETIC LABEL ALPHA"], None),
    example("blank", [], None),
]

CONDITIONS = [
    "clear-sans", "clear-serif", "clear-mono", "small-22px", "large-64px",
    "rotate-plus-1", "rotate-plus-3", "rotate-minus-3", "rotate-90",
    "skew-horizontal", "blur-0.6", "blur-1.4", "low-contrast", "inverted",
    "noise", "downsample", "jpeg-35", "crop-last-line", "tight-spacing", "wide-spacing",
]


def labelled_field(line):
    upper = line.upper()
    if upper.startswith(("PART NUMBER:", "P/N:")):
        return "partNumber"
    if upper.startswith(("MANUFACTURER:", "MFR:")):
        return "manufacturer"
    if upper.startswith(("DESCRIPTION:", "DESC:")):
        return "description"
    return None


def render(scenario, condition):
    size = 22 if condition == "small-22px" else 64 if condition == "large-64px" else 42
    family = "serif" if condition == "clear-serif" else "mono" if condition == "clear-mono" else "sans"
    font = ImageFont.truetype(str(FONT_DIR / FONTS[family]), size)
    spacing = size + (2 if condition == "tight-spacing" else 72 if condition == "wide-spacing" else 30)
    max_width = max((font.getlength(line) for line in scenario["lines"]), default=0)
    width, height = max(900, int(max_width) + 120), max(280, len(scenario["lines"]) * spacing + 100)
    image = Image.new("RGB", (width, height), (240, 240, 240) if condition == "low-contrast" else "white")
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(scenario["lines"]):
        draw.text((60, 40 + index * spacing), line, font=font, fill=(190, 190, 190) if condition == "low-contrast" else "black")
    expected = None if scenario["expected"] is None else dict(scenario["expected"])
    if condition.startswith("rotate"):
        angle = {"rotate-plus-1": 1, "rotate-plus-3": 3, "rotate-minus-3": -3, "rotate-90": 90}[condition]
        image = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white")
    elif condition == "skew-horizontal":
        image = image.transform((width + int(height * .16), height), Image.Transform.AFFINE, (1, -.16, 0, 0, 1, 0), Image.Resampling.BICUBIC, fillcolor="white")
    elif condition.startswith("blur"):
        image = image.filter(ImageFilter.GaussianBlur(float(condition.split("-")[1])))
    elif condition == "inverted":
        image = ImageOps.invert(image)
    elif condition == "noise":
        rng = random.Random(20261119)
        pixels = image.load()
        for _ in range(width * height // 50):
            x, y = rng.randrange(width), rng.randrange(height)
            shade = rng.randrange(256)
            pixels[x, y] = (shade, shade, shade)
    elif condition == "downsample":
        image = image.resize((width // 3, height // 3), Image.Resampling.LANCZOS)
    elif condition == "crop-last-line" and scenario["lines"]:
        image = image.crop((0, 0, width, 40 + (len(scenario["lines"]) - 1) * spacing))
        field = labelled_field(scenario["lines"][-1])
        if expected is not None and field:
            # The source is intentionally missing the cropped line. For conflicting
            # labels, remaining ambiguity still takes priority over a guessed value.
            expected[field] = ""
    return image, expected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    cases, omitted = [], []
    seen_hashes = {}
    for scenario in SCENARIOS:
        for condition in CONDITIONS:
            identifier = scenario["id"] + "--" + condition
            image, expected = render(scenario, condition)
            filename = identifier + (".jpg" if condition == "jpeg-35" else ".png")
            destination = args.output / filename
            image.save(destination, quality=35, optimize=False, dpi=(300, 300)) if filename.endswith(".jpg") else image.save(destination, optimize=False, dpi=(300, 300))
            image_hash = hashlib.sha256(destination.read_bytes()).hexdigest()
            if image_hash in seen_hashes:
                prior = seen_hashes[image_hash]
                if prior["expected"] != expected:
                    raise ValueError("Identical pixels/encoding have conflicting benchmark expectations")
                omitted.append({"id": identifier, "sameImageAs": prior["id"], "sha256": image_hash})
                destination.unlink()
                continue
            case = {"id": identifier, "scenario": scenario["id"], "condition": condition, "file": filename, "sha256": image_hash, "expected": expected}
            seen_hashes[image_hash] = case
            cases.append(case)
    manifest = {
        "format": "panelreply-synthetic-ocr-benchmark", "version": 1,
        "purpose": "Synthetic printed labels only. No real electrical part claims or customer images.",
        "pillowVersion": PIL.__version__,
        "fonts": {key: {"name": name, "sha256": hashlib.sha256((FONT_DIR / name).read_bytes()).hexdigest()} for key, name in FONTS.items()},
        "scenarios": len(SCENARIOS), "conditions": len(CONDITIONS), "omittedDuplicateCases": omitted, "cases": cases,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"status": "GENERATED", "cases": len(cases), "output": str(args.output), "pillowVersion": PIL.__version__}))


if __name__ == "__main__":
    main()
