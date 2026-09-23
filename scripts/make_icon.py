"""Render resources/AppIcon.icns from an SF Symbol on a gradient squircle."""

import shutil
import subprocess
import sys
from pathlib import Path

from AppKit import (
    NSBezierPath,
    NSBitmapImageRep,
    NSColor,
    NSCompositingOperationSourceAtop,
    NSCompositingOperationSourceOver,
    NSGradient,
    NSGraphicsContext,
    NSImage,
    NSImageSymbolConfiguration,
    NSMakeRect,
    NSPNGFileType,
    NSRectFillUsingOperation,
)

ROOT = Path(__file__).resolve().parent.parent
ICONSET = ROOT / "build" / "AppIcon.iconset"
OUTPUT = ROOT / "resources" / "AppIcon.icns"
SYMBOL = "gauge.with.dots.needle.67percent"


def render(size: int) -> bytes:
    rep = NSBitmapImageRep.alloc().initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        None, size, size, 8, 4, True, False, "NSDeviceRGBColorSpace", 0, 0
    )
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.setCurrentContext_(NSGraphicsContext.graphicsContextWithBitmapImageRep_(rep))

    inset = size * 0.1
    rect = NSMakeRect(inset, inset, size - 2 * inset, size - 2 * inset)
    shape = NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(rect, size * 0.18, size * 0.18)
    gradient = NSGradient.alloc().initWithStartingColor_endingColor_(
        NSColor.colorWithSRGBRed_green_blue_alpha_(0.20, 0.78, 0.55, 1.0),
        NSColor.colorWithSRGBRed_green_blue_alpha_(0.05, 0.36, 0.52, 1.0),
    )
    gradient.drawInBezierPath_angle_(shape, -90)

    config = NSImageSymbolConfiguration.configurationWithPointSize_weight_(size * 0.42, 0.3)
    symbol = NSImage.imageWithSystemSymbolName_accessibilityDescription_(SYMBOL, None)
    symbol = symbol.imageWithSymbolConfiguration_(config)
    tinted = NSImage.alloc().initWithSize_(symbol.size())
    tinted.lockFocus()
    symbol.drawAtPoint_fromRect_operation_fraction_((0, 0), NSMakeRect(0, 0, 0, 0), NSCompositingOperationSourceOver, 1.0)
    NSColor.whiteColor().set()
    NSRectFillUsingOperation(NSMakeRect(0, 0, *symbol.size()), NSCompositingOperationSourceAtop)
    tinted.unlockFocus()
    w, h = tinted.size()
    tinted.drawInRect_(NSMakeRect((size - w) / 2, (size - h) / 2, w, h))

    NSGraphicsContext.restoreGraphicsState()
    return bytes(rep.representationUsingType_properties_(NSPNGFileType, {}))


def main() -> None:
    shutil.rmtree(ICONSET, ignore_errors=True)
    ICONSET.mkdir(parents=True)
    for base in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f"icon_{base}x{base}{'@2x' if scale == 2 else ''}.png"
            (ICONSET / name).write_bytes(render(base * scale))
    OUTPUT.parent.mkdir(exist_ok=True)
    subprocess.run(["iconutil", "-c", "icns", str(ICONSET), "-o", str(OUTPUT)], check=True)
    print(f"wrote {OUTPUT.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
