"""Generate every Trimbit brand asset from one source of geometry and colour.

    .venv/bin/python branding/build.py

Writes branding/svg/*.svg (sources) and branding/png/*.png (renders).
Requires: resvg-py, fonttools (see branding/requirements.txt).
"""

from __future__ import annotations

import io
from pathlib import Path

import resvg_py
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent
SVG_DIR = ROOT / "svg"
PNG_DIR = ROOT / "png"
FONT_PATH = ROOT / "fonts" / "SpaceGrotesk[wght].ttf"

PALETTE = {
    "ink": "#0B1220",
    "slate": "#16263D",
    "cloud": "#F4F7F6",
    "mist": "#8A97A8",
    "mint": "#2EE6A8",
    "mint_deep": "#0E9F74",
    "coral": "#FF6B5B",
    "amber": "#FFB547",
}
P = PALETTE


# ---- the mark ------------------------------------------------------------------
#
# Three context lines. The top one is whole; the lower two are trimmed along a
# slanted cut and the trimmed "bits" drift away, shrinking and fading.
# Drawn on a 100×100 grid.


def mark(bar: str, bit: str, *, height: float = 14, gap: float = 9, fade: bool = True, minimal: bool = False) -> str:
    slant = height * 0.43
    top = 50 - (3 * height + 2 * gap) / 2
    rows = [top + i * (height + gap) for i in range(3)]
    r = height / 2
    left = 12
    out = []

    def bar_path(y: float, end: float | None) -> str:
        if end is None:  # untrimmed: both caps round
            return f'<rect x="{left}" y="{y:.2f}" width="{88 - left}" height="{height}" rx="{r}" fill="{bar}"/>'
        b = y + height
        return (
            f'<path d="M{left + r},{y:.2f} H{end} L{end - slant:.2f},{b:.2f} H{left + r} '
            f'A{r},{r} 0 0 1 {left + r},{y:.2f} Z" fill="{bar}"/>'
        )

    def bit_path(y: float, x0: float, x1: float, opacity: float) -> str:
        b = y + height
        op = f' fill-opacity="{opacity}"' if fade and opacity < 1 else ""
        return (
            f'<path d="M{x0},{y:.2f} H{x1} L{x1 - slant:.2f},{b:.2f} H{x0 - slant:.2f} Z" fill="{bit}"{op}/>'
        )

    out.append(bar_path(rows[0], None))
    out.append(bar_path(rows[1], 64))
    out.append(bit_path(rows[1], 70, 84, 1.0))
    out.append(bar_path(rows[2], 44))
    out.append(bit_path(rows[2], 50, 62, 0.8))
    if not minimal:  # the faintest bit turns to mush at tray sizes
        out.append(bit_path(rows[2], 68, 77, 0.45))
    return "\n    ".join(out)


def svg(width: float, height: float, body: str, defs: str = "") -> str:
    defs = f"\n  <defs>{defs}\n  </defs>" if defs else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">{defs}\n  {body}\n</svg>\n'
    )


# ---- type ------------------------------------------------------------------------

_fonts: dict[int, TTFont] = {}


def _font(weight: int) -> TTFont:
    if weight not in _fonts:
        _fonts[weight] = instantiateVariableFont(TTFont(FONT_PATH), {"wght": weight})
    return _fonts[weight]


def text_paths(
    text: str, weight: int, size: float, tracking: float = 0.0
) -> tuple[list[tuple[str, str]], float, float]:
    """Outline `text` into SVG paths (one per character) at `size` px, baseline at y=0.

    Returns ([(char, d)], advance_width, cap_height).
    """
    font = _font(weight)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    x = 0.0
    paths = []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        paths.append((ch, pen.getCommands()))
        x += glyphs[name].width * scale + tracking * size
    x -= tracking * size
    cap = font["OS/2"].sCapHeight * scale
    return paths, x, cap


def text_group(
    text: str, weight: int, size: float, x: float, y: float, colors: list[str], tracking: float = 0.0
) -> str:
    paths, _, _ = text_paths(text, weight, size, tracking)
    body = "".join(f'<path d="{d}" fill="{colors[min(i, len(colors) - 1)]}"/>' for i, (_, d) in enumerate(paths) if d)
    return f'<g transform="translate({x:.2f},{y:.2f})">{body}</g>'


def text_bounds(text: str, weight: int, size: float, tracking: float = 0.0) -> tuple[float, float, float, float]:
    font = _font(weight)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    pen = BoundsPen(glyphs)
    x = 0.0
    for ch in text:
        name = cmap[ord(ch)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        x += glyphs[name].width * scale + tracking * size
    return pen.bounds  # xMin, yMin, xMax, yMax (y down)


WORD_WEIGHT = 700
WORD_TRACKING = -0.035


def wordmark(size: float, x: float, baseline: float, trim: str, bit: str) -> str:
    return text_group("trimbit", WORD_WEIGHT, size, x, baseline, [trim] * 4 + [bit] * 3, WORD_TRACKING)


# ---- assets ------------------------------------------------------------------------


def app_icon() -> str:
    defs = f"""
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{P['slate']}"/>
      <stop offset="1" stop-color="{P['ink']}"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.09"/>
      <stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0.03"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="mint" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6FF5C8"/>
      <stop offset="1" stop-color="{P['mint']}"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.35"/>
    </filter>"""
    body = f"""<rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)" filter="url(#shadow)"/>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#sheen)"/>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none"
        stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="3"/>
  <g transform="translate(232,232) scale(5.6)">
    {mark(P['cloud'], 'url(#mint)')}
  </g>"""
    return svg(1024, 1024, body, defs)


def mark_svg(bar: str, bit: str) -> str:
    return svg(100, 100, mark(bar, bit))


TRAY_GRID = {"height": 400 / 22, "gap": 200 / 22, "minimal": True}


def tray(bar: str, bit: str, *, offline: bool = False) -> str:
    """Menu bar / system tray glyph: heavier strokes so it survives 16 px.

    Rows sit on the 22 px menu bar grid: 4 px bars, 2 px gaps.
    """
    glyph = mark(bar, bit, **TRAY_GRID)
    if not offline:
        return svg(100, 100, glyph)
    defs = """
    <mask id="cut">
      <rect width="100" height="100" fill="#FFFFFF"/>
      <line x1="10" y1="90" x2="90" y2="10" stroke="#000000" stroke-width="22" stroke-linecap="round"/>
    </mask>"""
    body = f"""<g mask="url(#cut)" opacity="0.55">
    {mark(bar, bar, fade=False, **TRAY_GRID)}
  </g>
  <line x1="14" y1="86" x2="86" y2="14" stroke="{bar}" stroke-width="10" stroke-linecap="round"/>"""
    return svg(100, 100, body, defs)


def lockup(dark: bool) -> str:
    bar = P["cloud"] if dark else P["ink"]
    bit = P["mint"] if dark else P["mint_deep"]
    size = 120
    _, y_min, x_max, y_max = text_bounds("trimbit", WORD_WEIGHT, size, WORD_TRACKING)
    mark_size = 132
    pad = 24
    gap = 10  # the mark's own 12 % side bearing supplies the rest
    height = mark_size + 2 * pad
    baseline = pad + mark_size / 2 - (y_min + y_max) / 2  # centre the word on the mark
    width = pad + mark_size + gap + x_max + pad
    body = f"""<g transform="translate({pad},{pad}) scale({mark_size / 100})">
    {mark(bar, bit)}
  </g>
  {wordmark(size, pad + mark_size + gap, baseline, bar, bit)}"""
    return svg(round(width), round(height), body)


def wordmark_svg(dark: bool) -> str:
    trim = P["cloud"] if dark else P["ink"]
    bit = P["mint"] if dark else P["mint_deep"]
    size = 120
    x_min, y_min, x_max, y_max = text_bounds("trimbit", WORD_WEIGHT, size, WORD_TRACKING)
    pad = 8
    return svg(
        round(x_max - x_min + 2 * pad),
        round(y_max - y_min + 2 * pad),
        wordmark(size, pad - x_min, pad - y_min, trim, bit),
    )


def social_card() -> str:
    w, h = 1280, 640
    defs = f"""
    <radialGradient id="glow" cx="0.5" cy="0.35" r="0.75">
      <stop offset="0" stop-color="{P['slate']}"/>
      <stop offset="1" stop-color="{P['ink']}"/>
    </radialGradient>
    <linearGradient id="mint" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6FF5C8"/>
      <stop offset="1" stop-color="{P['mint']}"/>
    </linearGradient>"""
    size = 150
    _, y_min, word_w, y_max = text_bounds("trimbit", WORD_WEIGHT, size, WORD_TRACKING)
    mark_size = 170
    gap = 16
    total = mark_size + gap + word_w
    x0 = (w - total) / 2
    mark_y = 170
    baseline = mark_y + mark_size / 2 - (y_min + y_max) / 2

    tagline = "An unofficial menu bar companion for Headroom"
    _, _, tag_w, _ = text_bounds(tagline, 400, 38)
    chips = ["Live token savings", "Proxy health", "macOS · Windows · Linux"]
    chip_size, chip_pad, chip_gap, chip_h = 24, 24, 16, 52
    widths = [text_bounds(c, 500, chip_size)[2] + 2 * chip_pad for c in chips]
    cx = (w - (sum(widths) + chip_gap * (len(chips) - 1))) / 2
    chip_svg = []
    for label, cw in zip(chips, widths, strict=True):
        chip_svg.append(
            f'<rect x="{cx:.1f}" y="486" width="{cw:.1f}" height="{chip_h}" rx="{chip_h / 2}" '
            f'fill="#FFFFFF" fill-opacity="0.06" stroke="{P["mint"]}" stroke-opacity="0.35" stroke-width="1.5"/>'
        )
        chip_svg.append(text_group(label, 500, chip_size, cx + chip_pad, 486 + chip_h / 2 + 8.5, [P["cloud"]]))
        cx += cw + chip_gap

    body = f"""<rect width="{w}" height="{h}" fill="url(#glow)"/>
  <g transform="translate({x0:.1f},{mark_y}) scale({mark_size / 100})">
    {mark(P['cloud'], 'url(#mint)')}
  </g>
  {wordmark(size, x0 + mark_size + gap, baseline, P['cloud'], P['mint'])}
  {text_group(tagline, 400, 38, (w - tag_w) / 2, 430, [P['mist']])}
  {"".join(chip_svg)}"""
    return svg(w, h, body, defs)


def palette_svg() -> str:
    names = list(PALETTE)
    sw, gap, pad = 150, 16, 24
    w = pad * 2 + len(names) * sw + (len(names) - 1) * gap
    h = 230
    parts = [f'<rect width="{w}" height="{h}" rx="20" fill="#FFFFFF"/>']
    for i, name in enumerate(names):
        x = pad + i * (sw + gap)
        parts.append(f'<rect x="{x}" y="{pad}" width="{sw}" height="120" rx="14" fill="{PALETTE[name]}" '
                     f'stroke="#0B1220" stroke-opacity="0.08"/>')
        parts.append(text_group(name.replace("_", " "), 700, 20, x + 2, pad + 158, [P["ink"]]))
        parts.append(text_group(PALETTE[name], 400, 18, x + 2, pad + 184, [P["mist"]]))
    return svg(w, h, "\n  ".join(parts))


# ---- output ------------------------------------------------------------------------


def contrast(a: str, b: str) -> float:
    def lum(hex_: str) -> float:
        rgb = [int(hex_[i : i + 2], 16) / 255 for i in (1, 3, 5)]
        lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]

    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def dims(source: str) -> tuple[int, int]:
    w, h = source.split('viewBox="0 0 ')[1].split('"')[0].split()
    return round(float(w)), round(float(h))


def render(name: str, source: str, sizes: dict[str, tuple[int, int]] | None = None, scale: int = 2) -> None:
    """Write the SVG and PNGs at explicit `sizes`, or at `scale`× the viewBox when omitted."""
    (SVG_DIR / f"{name}.svg").write_text(source)
    if sizes is None:
        w, h = dims(source)
        sizes = {f"@{scale}x": (w * scale, h * scale)}
    for suffix, (w, h) in sizes.items():
        png = resvg_py.svg_to_bytes(svg_string=source, width=w, height=h, skip_system_fonts=True)
        (PNG_DIR / f"{name}{suffix}.png").write_bytes(bytes(png))


def main() -> None:
    SVG_DIR.mkdir(exist_ok=True)
    PNG_DIR.mkdir(exist_ok=True)

    render("app-icon", app_icon(), {f"-{s}": (s, s) for s in (1024, 512, 256, 128, 64, 32, 16)})
    render("mark-dark-bg", mark_svg(P["cloud"], P["mint"]), {"": (512, 512)})
    render("mark-light-bg", mark_svg(P["ink"], P["mint_deep"]), {"": (512, 512)})

    # macOS template images: black + alpha only; the OS recolours them.
    render("tray-template", tray("#000000", "#000000"), {"": (22, 22), "@2x": (44, 44), "@3x": (66, 66)})
    render("tray-template-offline", tray("#000000", "#000000", offline=True),
           {"": (22, 22), "@2x": (44, 44), "@3x": (66, 66)})
    # Windows / Linux trays are not recoloured: ship variants for dark and light panels.
    for variant, bar, bit in (("light", P["cloud"], P["mint"]), ("dark", P["ink"], P["mint_deep"])):
        sizes = {f"-{n}": (n, n) for n in (16, 32, 48)}
        render(f"tray-{variant}", tray(bar, bit), sizes)
        render(f"tray-{variant}-offline", tray(bar, bit, offline=True), sizes)

    for dark in (True, False):
        tag = "dark-bg" if dark else "light-bg"
        render(f"lockup-{tag}", lockup(dark))
        render(f"wordmark-{tag}", wordmark_svg(dark))

    render("social-card", social_card(), {"": (1280, 640)})
    render("palette", palette_svg(), scale=1)

    report = io.StringIO()
    for fg, bg in (("cloud", "ink"), ("mint", "ink"), ("mist", "ink"), ("ink", "cloud"),
                   ("mint_deep", "cloud"), ("mint_deep", "ink"), ("coral", "ink"), ("amber", "ink")):
        report.write(f"{fg:>9} on {bg:<5} {contrast(P[fg], P[bg]):5.2f}:1\n")
    print(report.getvalue(), end="")
    print(f"wrote {len(list(SVG_DIR.glob('*.svg')))} SVGs and {len(list(PNG_DIR.glob('*.png')))} PNGs")


if __name__ == "__main__":
    main()
