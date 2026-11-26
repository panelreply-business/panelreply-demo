"""Regenerate synthetic OCR fixtures. Requires Pillow and DejaVu Sans.

These labels describe fictional components. They contain no customer images,
electrical specifications or claims of compatibility.
"""

from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 46)

CASES = [
    {"file": "complete.png", "lines": ["PART NUMBER: DEMO-1001", "MANUFACTURER: SAMPLE COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL ALPHA"],
     "expected": {"partNumber": "DEMO-1001", "manufacturer": "SAMPLE COMPONENTS", "description": "SYNTHETIC LABEL ALPHA"}},
    {"file": "complete.jpg", "lines": ["PART NUMBER: DEMO-2042", "MANUFACTURER: SAMPLE COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL BRAVO"],
     "expected": {"partNumber": "DEMO-2042", "manufacturer": "SAMPLE COMPONENTS", "description": "SYNTHETIC LABEL BRAVO"}},
    {"file": "missing-manufacturer.png", "lines": ["PART NUMBER: DEMO-3053", "DESCRIPTION: SYNTHETIC LABEL CHARLIE"],
     "expected": {"partNumber": "DEMO-3053", "manufacturer": "", "description": "SYNTHETIC LABEL CHARLIE"}},
    {"file": "conflicting-parts.png", "lines": ["PART NUMBER: DEMO-4001", "PART NUMBER: DEMO-4002", "MANUFACTURER: SAMPLE COMPONENTS", "DESCRIPTION: SYNTHETIC LABEL DELTA"],
     "expected": {"partNumber": "", "manufacturer": "SAMPLE COMPONENTS", "description": "SYNTHETIC LABEL DELTA"}},
    {"file": "unlabelled.png", "lines": ["DEMO-5005", "SAMPLE COMPONENTS", "SYNTHETIC LABEL ECHO"], "expected": None},
    {"file": "blank.png", "lines": [], "expected": None},
]

for case in CASES:
    image = Image.new("RGB", (1600, 440), "white")
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(case["lines"]):
        draw.text((60, 55 + index * 82), line, font=FONT, fill="black")
    if case["file"].endswith(".jpg"):
        image.save(ROOT / case["file"], quality=90, optimize=False, progressive=True, dpi=(300, 300))
    else:
        image.save(ROOT / case["file"], optimize=False, dpi=(300, 300))

(ROOT / "manifest.json").write_text(json.dumps({"purpose": "Synthetic labelled text only. No electrical specifications or real customer data.", "cases": CASES}, indent=2) + "\n")
