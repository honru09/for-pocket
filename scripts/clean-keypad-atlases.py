#!/usr/bin/env python3
"""Clean and register the generated keypad motion atlases.

The v2 PNGs are retained as source references. This deterministic pass removes
isolated generator halo/noise, keeps a soft edge on the real keycap, and places
each frame on a shared center line so a frame preview cannot jump sideways.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

CELL_W, CELL_H = 543, 362
COLS, ROWS = 4, 2
CORE_ALPHA = 128
EDGE_ALPHA = 24
DILATE = 3
TARGET_WIDTH = 512
TARGET_HEIGHT = 190


def largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if count <= 1:
        raise ValueError("keycap core is empty")
    label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == label


def clean_frame(frame: np.ndarray) -> tuple[np.ndarray, dict[str, int | float]]:
    alpha = frame[..., 3]
    core = largest_component(alpha >= CORE_ALPHA)
    # The dilation only restores an antialiased edge around the trusted core;
    # detached halo specks never enter because they are not in this component.
    trusted = cv2.dilate(core.astype(np.uint8), np.ones((DILATE, DILATE), np.uint8), 1).astype(bool)
    keep = trusted & (alpha >= EDGE_ALPHA)
    clean = np.zeros_like(frame)
    clean[..., :3] = frame[..., :3]
    clean[..., 3] = np.where(keep, np.clip((alpha.astype(np.int32) - EDGE_ALPHA) * 255 / (255 - EDGE_ALPHA), 0, 255), 0).astype(np.uint8)
    ys, xs = np.where(clean[..., 3] >= 16)
    if len(xs) == 0:
        raise ValueError("cleaned keycap is empty")
    x0, x1, y0, y1 = int(xs.min()), int(xs.max() + 1), int(ys.min()), int(ys.max() + 1)
    cropped = clean[y0:y1, x0:x1]
    h, w = cropped.shape[:2]
    target_h = TARGET_HEIGHT
    resized = np.asarray(Image.fromarray(cropped, "RGBA").resize((TARGET_WIDTH, target_h), Image.Resampling.LANCZOS))
    canvas = np.zeros((CELL_H, CELL_W, 4), dtype=np.uint8)
    ox = (CELL_W - TARGET_WIDTH) // 2
    oy = (CELL_H - target_h) // 2
    canvas[oy:oy + target_h, ox:ox + TARGET_WIDTH] = resized
    final_alpha = canvas[..., 3]
    final_mask = final_alpha >= 16
    fy, fx = np.where(final_mask)
    component_count, _, component_stats, _ = cv2.connectedComponentsWithStats(final_mask.astype(np.uint8), 8)
    tiny_components = int(np.count_nonzero(component_stats[1:, cv2.CC_STAT_AREA] < 16))
    low_alpha_pct = float(np.mean((final_alpha > 0) & (final_alpha < 64)) * 100)
    # Quality gate: no detached particles and a stable horizontal registration.
    if tiny_components:
        raise ValueError("cleaned keycap contains detached alpha components")
    if low_alpha_pct >= 2:
        raise ValueError(f"cleaned keycap retains too much low-alpha edge noise ({low_alpha_pct:.2f}%)")
    return canvas, {
        "source_x": x0, "source_y": y0, "source_w": w, "source_h": h,
        "target_x": ox, "target_y": oy, "target_w": TARGET_WIDTH, "target_h": target_h,
        "quality_bbox": [int(fx.min()), int(fy.min()), int(fx.max()), int(fy.max())],
        "low_alpha_pct": round(low_alpha_pct, 3), "tiny_components": tiny_components,
    }


def clean_atlas(source: Path, destination: Path) -> list[dict[str, object]]:
    image = np.asarray(Image.open(source).convert("RGBA"))
    if image.shape[1] != CELL_W * COLS or image.shape[0] != CELL_H * ROWS:
        raise ValueError(f"unexpected atlas size: {image.shape[1]}x{image.shape[0]}")
    frames: list[np.ndarray] = []
    metadata: list[dict[str, object]] = []
    for row in range(ROWS):
        for col in range(COLS):
            cell = image[row * CELL_H:(row + 1) * CELL_H, col * CELL_W:(col + 1) * CELL_W]
            cleaned, info = clean_frame(cell)
            frames.append(cleaned)
            metadata.append(info)
    atlas = np.zeros_like(image)
    for index, frame in enumerate(frames):
        row, col = divmod(index, COLS)
        atlas[row * CELL_H:(row + 1) * CELL_H, col * CELL_W:(col + 1) * CELL_W] = frame
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas, "RGBA").save(destination, optimize=True)
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    raster = args.root / "public/assets/ui-kit-v1/rasters"
    for stem in ("neumorphic-keypad-motion-numeric", "neumorphic-keypad-motion-utility"):
        source = raster / f"{stem}-v2.png"
        destination = raster / f"{stem}-v3.png"
        metadata = clean_atlas(source, destination)
        print(destination)
        print(metadata)


if __name__ == "__main__":
    main()

