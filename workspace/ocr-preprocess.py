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
METHOD = "median3-small-text-v2"


def ink_bands(gray):
    """Measure horizontal ink bands, without recognizing or changing text."""
    histogram = gray.histogram()
    count = gray.width * gray.height
    total = sum(value * frequency for value, frequency in enumerate(histogram))
    weight = subtotal = 0
    best_variance = -1
    threshold = None
    for value, frequency in enumerate(histogram):
        weight += frequency
        subtotal += value * frequency
        if not weight or weight == count:
            continue
        variance = weight * (count - weight) * (subtotal / weight - (total - subtotal) / (count - weight)) ** 2
        if variance > best_variance:
            best_variance = variance
            threshold = value
    if threshold is None:
        return 0, 0
    # Use the minority side of an Otsu split for both dark-on-light and
    # light-on-dark labels. The threshold is used only for measurement.
    dark_ink = sum(histogram[:threshold + 1]) <= count / 2
    mask = gray.point(lambda value: 255 if (value <= threshold if dark_ink else value > threshold) else 0)
    bands = []
    height = 0
    for row in range(gray.height):
        if mask.crop((0, row, gray.width, row + 1)).histogram()[255] >= 3:
            height += 1
        else:
            if height >= 3:
                bands.append(height)
            height = 0
    if height >= 3:
        bands.append(height)
    bands.sort()
    return len(bands), bands[(len(bands) - 1) // 2] if bands else 0


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
    if applied:
        pixels = pixels.filter(ImageFilter.MedianFilter(3))
    band_count, band_height = ink_bands(pixels.convert("L"))
    # Small glyphs lose punctuation during native thresholding. Enlarge the
    # pixels once, without dictionary repair or character substitution. Keep
    # the decoder's original dimension/pixel ceilings for this temporary copy.
    rescale = 2 if 3 <= band_height < 16 and width <= 3000 and height <= 3000 and width * height <= MAX_PIXELS // 4 else 1
    header = {"method": METHOD, "pillowVersion": pillow_version, "applied": applied,
              "isolatedNoisePixels": isolated, "thresholdPixels": threshold, "imagePixels": width * height,
              "inkBandCount": band_count, "medianInkBandHeight": band_height, "rescaleFactor": rescale}
    output = b""
    if applied or rescale != 1:
        # Native process address-space, CPU, output and wall-time bounds still
        # apply. Normalized pixels never replace the saved source bytes.
        if rescale != 1:
            pixels = pixels.resize((width * rescale, height * rescale), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        pixels.save(encoded, format="PNG")
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
