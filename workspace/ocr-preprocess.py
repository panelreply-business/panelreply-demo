"""Bounded stdin-only pixel normalization. No paths or network inputs."""
import io
import json
import math
import sys
import warnings

from PIL import Image, ImageChops, ImageFilter, __version__ as pillow_version

MAX_INPUT = 2 * 1024 * 1024
MAX_OUTPUT = 8 * 1024 * 1024
MAX_PIXELS = 16_000_000
METHOD = "median3-isolated-noise"


def main():
    if sys.argv[1:] == ["--probe"]:
        print(json.dumps({"method": METHOD, "pillowVersion": pillow_version}))
        return
    if sys.argv[1:]:
        raise ValueError("unsupported arguments")
    source = sys.stdin.buffer.read(MAX_INPUT + 1)
    if not source or len(source) > MAX_INPUT:
        raise ValueError("unsupported input")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    with Image.open(io.BytesIO(source)) as original:
        if original.format not in ("PNG", "JPEG") or getattr(original, "n_frames", 1) != 1:
            raise ValueError("unsupported image")
        width, height = original.size
        if not 0 < width <= 6000 or not 0 < height <= 6000 or width * height > MAX_PIXELS:
            raise ValueError("unsupported dimensions")
        original.load()
        if "A" in original.getbands() or "transparency" in original.info:
            rgba = original.convert("RGBA")
            pixels = Image.new("RGB", rgba.size, "white")
            pixels.paste(rgba, mask=rgba.getchannel("A"))
        else:
            pixels = original.convert("RGB")
    gray = pixels.convert("L")
    # An isolated dark/bright pixel is unlike all eight neighbours. Printed
    # strokes are not an excuse to denoise an otherwise clean image. The rule
    # uses pixels only, never recognized text, known parts or benchmark labels.
    neighbours = gray.filter(ImageFilter.Kernel((3, 3), [1, 1, 1, 1, 0, 1, 1, 1, 1], 8, 0))
    dark = ImageChops.multiply(gray.point(lambda value: 255 if value <= 32 else 0), neighbours.point(lambda value: 255 if value >= 250 else 0))
    light = ImageChops.multiply(gray.point(lambda value: 255 if value >= 223 else 0), neighbours.point(lambda value: 255 if value <= 5 else 0))
    isolated = dark.histogram()[255] + light.histogram()[255]
    threshold = max(32, math.ceil(width * height / 1000))
    applied = isolated >= threshold
    header = {"method": METHOD, "pillowVersion": pillow_version, "applied": applied,
              "isolatedNoisePixels": isolated, "thresholdPixels": threshold, "imagePixels": width * height}
    output = b""
    if applied:
        # Native process address-space, CPU, output and wall-time bounds still
        # apply. Normalized pixels never replace the saved source bytes.
        encoded = io.BytesIO()
        pixels.filter(ImageFilter.MedianFilter(3)).save(encoded, format="PNG")
        output = encoded.getvalue()
        if len(output) > MAX_OUTPUT:
            raise ValueError("normalized output exceeds limit")
    sys.stdout.buffer.write(json.dumps(header, separators=(",", ":")).encode("ascii") + b"\n" + output)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not expose library diagnostics, source content or local paths.
        sys.stderr.write("Image normalization failed.\n")
        sys.exit(1)
