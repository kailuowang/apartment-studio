#!/usr/bin/env python3
"""Generate an exact-dimension 3D apartment model (.glb, .obj/.mtl, spec .json) from floorplan.jpeg."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path("/Users/kailuowang/projects/home-misc")
FLOORPLAN_PATH = ROOT / "floorplan.jpeg"
MODEL_DIR = ROOT / "model"
MEASUREMENTS_PATH = MODEL_DIR / "measurements.json"

# Verified architectural scale from floorplan.jpeg (705 x 1024 RGB)
PX_PER_FT = 12.5000
FT_TO_M = 0.3048
PX_TO_M = FT_TO_M / PX_PER_FT  # 0.024384 m/px
CENTER_PX_X = 325.5
CENTER_PX_Y = 485.0

# Elevations in feet (default 9'0" ceiling)
CEILING_FT = 9.0
DOOR_HEAD_FT = 7.0
WIN_SILL_FT = 2.0
WIN_HEAD_FT = 8.0
SLAB_BOTTOM_FT = -0.5

# Doorway and closet opening definitions (pixel bounds + hinge/swing metadata)
OPENINGS: list[dict[str, Any]] = [
    {
        "id": "top_balcony_door",
        "label": "Top Balcony Door",
        "kind": "hinged",
        "px": [383, 72, 413, 81],
        "hinge_px": [384.0, 72.5],
        "closed_angle_deg": 0.0,
        "swing_dir_deg": -90.0,  # swings North (-Z) onto balcony
        "width_px": 29.0,
    },
    {
        "id": "bed_ne_closet",
        "label": "Bedroom NE Closet (CL)",
        "kind": "closet",
        "px": [439, 334, 485, 339],
        "orientation": "horizontal",
        "opens_toward": "-Z",
    },
    {
        "id": "bath_ne_door",
        "label": "En-Suite Bath NE Door",
        "kind": "hinged",
        "px": [417, 370, 424, 402],
        "hinge_px": [422.5, 371.0],
        "closed_angle_deg": 90.0,
        "swing_dir_deg": 0.0,  # swings East (+X) into bath
        "width_px": 31.0,
    },
    {
        "id": "bed_ne_door",
        "label": "Bedroom NE Entry Door",
        "kind": "hinged",
        "px": [378, 462, 409, 468],
        "hinge_px": [379.0, 462.5],
        "closed_angle_deg": 0.0,
        "swing_dir_deg": -90.0,  # swings North (-Z) into bedroom
        "width_px": 30.0,
    },
    {
        "id": "main_entry_door",
        "label": "Main ENTRY Door",
        "kind": "hinged",
        "px": [465, 476, 474, 515],
        "hinge_px": [465.5, 477.0],
        "closed_angle_deg": 90.0,
        "swing_dir_deg": 180.0,  # swings West (-X) into foyer
        "width_px": 36.0,
    },
    {
        "id": "primary_hall_door",
        "label": "Primary Suite Hall Door",
        "kind": "hinged",
        "px": [198, 517, 229, 522],
        "hinge_px": [228.0, 521.0],
        "closed_angle_deg": 180.0,
        "swing_dir_deg": 90.0,  # swings South (+Z) into suite hall
        "width_px": 29.0,
    },
    {
        "id": "wd_closet",
        "label": "W/D Laundry Closet",
        "kind": "closet",
        "px": [254, 517, 282, 522],
        "orientation": "horizontal",
        "opens_toward": "-Z",
    },
    {
        "id": "foyer_cl_west",
        "label": "Foyer Closet (CL)",
        "kind": "closet",
        "px": [333, 517, 362, 522],
        "orientation": "horizontal",
        "opens_toward": "-Z",
    },
    {
        "id": "hall_cl_east",
        "label": "Lower Hall Closet (CL)",
        "kind": "closet",
        "px": [372, 550, 404, 555],
        "orientation": "horizontal",
        "opens_toward": "+Z",
    },
    {
        "id": "coat_closet_opening",
        "label": "Coat Closet Entry",
        "kind": "closet",
        "px": [465, 550, 470, 586],
        "orientation": "vertical",
        "opens_toward": "-X",
    },
    {
        "id": "primary_bath_door",
        "label": "Primary Bath Door",
        "kind": "hinged",
        "px": [177, 548, 184, 580],
        "hinge_px": [177.5, 578.0],
        "closed_angle_deg": -90.0,
        "swing_dir_deg": 180.0,  # swings West (-X) into bath
        "width_px": 30.0,
    },
    {
        "id": "wic_door",
        "label": "Walk-In Closet (WIC) Door",
        "kind": "hinged",
        "px": [177, 643, 184, 675],
        "hinge_px": [182.5, 673.0],
        "closed_angle_deg": -90.0,
        "swing_dir_deg": 0.0,  # swings East (+X) into primary hall
        "width_px": 30.0,
    },
    {
        "id": "hall_bath_door",
        "label": "Hall Bath Door",
        "kind": "hinged",
        "px": [321, 559, 327, 590],
        "hinge_px": [321.5, 560.0],
        "closed_angle_deg": 90.0,
        "swing_dir_deg": 180.0,  # swings West (-X) into bath
        "width_px": 30.0,
    },
    {
        "id": "bed_mid_door",
        "label": "Middle Bedroom Door",
        "kind": "hinged",
        "px": [339, 611, 371, 617],
        "hinge_px": [340.0, 615.5],
        "closed_angle_deg": 0.0,
        "swing_dir_deg": 90.0,  # swings South (+Z) into bedroom
        "width_px": 30.0,
    },
    {
        "id": "bed_mid_closet",
        "label": "Middle Bedroom Closet (CL)",
        "kind": "closet",
        "px": [263, 679, 314, 685],
        "orientation": "horizontal",
        "opens_toward": "+Z",
    },
    {
        "id": "bed_se_door",
        "label": "Bedroom SE Door",
        "kind": "hinged",
        "px": [420, 631, 452, 636],
        "hinge_px": [421.0, 634.5],
        "closed_angle_deg": 0.0,
        "swing_dir_deg": 90.0,  # swings South (+Z) into bedroom
        "width_px": 30.0,
    },
    {
        "id": "bed_se_closet",
        "label": "Bedroom SE Closet (CL)",
        "kind": "closet",
        "px": [485, 683, 536, 688],
        "orientation": "horizontal",
        "opens_toward": "+Z",
    },
    {
        "id": "bot_balcony_door",
        "label": "Bottom Balcony Door",
        "kind": "hinged",
        "px": [488, 919, 520, 930],
        "hinge_px": [518.5, 929.0],
        "closed_angle_deg": 180.0,
        "swing_dir_deg": 90.0,  # swings South (+Z) onto balcony
        "width_px": 30.0,
    },
]


def px_to_m_x(px_x: float) -> float:
    return (px_x - CENTER_PX_X) * PX_TO_M


def px_to_m_z(px_y: float) -> float:
    return (px_y - CENTER_PX_Y) * PX_TO_M


def px_to_ft_x(px_x: float) -> float:
    return (px_x - CENTER_PX_X) / PX_PER_FT


def px_to_ft_z(px_y: float) -> float:
    return (px_y - CENTER_PX_Y) / PX_PER_FT


def ft_to_m(ft: float) -> float:
    return ft * FT_TO_M


def fmt_ft_in(feet: float) -> str:
    total_in = round(feet * 12.0)
    ft_part = int(total_in // 12)
    in_part = int(total_in % 12)
    return f"{ft_part}'-{in_part}\""


def in_to_px(inches: float) -> float:
    return inches * PX_PER_FT / 12.0


def load_measurements() -> dict[str, Any]:
    if MEASUREMENTS_PATH.exists():
        return json.loads(MEASUREMENTS_PATH.read_text(encoding="utf-8"))
    return {}


def compute_layout_anchors(meas: dict[str, Any]) -> dict[str, Any]:
    x_nk_west = 364 - round(in_to_px(float(meas.get("kitchen_north_wall_width_in", 98))))
    y_sink_north = 469 - round(in_to_px(float(meas.get("kitchen_sink_west_wall_length_in", 108))))
    y_isl_south = y_sink_north - 0.15
    y_isl_north = y_isl_south - in_to_px(float(meas.get("kitchen_island_length_in", 65.28)))
    y_col_top = 462 - round(in_to_px(float(meas.get("dining_west_wall_length_in", 199))))
    x_pbath_outer = 100 + round(in_to_px(float(meas.get("primary_bath_north_wall_from_west_ext_in", 80.64))))
    x_pb_in = x_pbath_outer - 7
    x_wic_outer = 100 + round(in_to_px(float(meas.get("primary_bed_wic_north_wall_in", 80.64))))
    x_wic_in = x_wic_outer - 7
    y_sw_col_north = 705 + round(in_to_px(float(meas.get("primary_bed_west_wall_to_sw_col_in", 205))))
    x_sw_col_east = 100 + round(in_to_px(float(meas.get("primary_bed_sw_column_width_in", 21))))
    shelf_cfg = dict(meas.get("dining_builtin_shelf") or {})
    x_shelf_front = 100 + round(in_to_px(float(shelf_cfg.get("depth_in", 13.5))))
    return {
        "x_nk_west": x_nk_west,
        "y_sink_north": y_sink_north,
        "y_isl_south": y_isl_south,
        "y_isl_north": y_isl_north,
        "y_col_top": y_col_top,
        "x_pbath_outer": x_pbath_outer,
        "x_pb_in": x_pb_in,
        "x_wic_outer": x_wic_outer,
        "x_wic_in": x_wic_in,
        "y_sw_col_north": y_sw_col_north,
        "x_sw_col_east": x_sw_col_east,
        "x_shelf_front": x_shelf_front,
        "shelf_cfg": shelf_cfg,
    }


def get_openings(anchors: dict[str, Any]) -> list[dict[str, Any]]:
    out = [dict(op) for op in OPENINGS]
    x_pb_in = anchors["x_pb_in"]
    x_pb_out = anchors["x_pbath_outer"]
    x_wic_in = anchors["x_wic_in"]
    x_wic_out = anchors["x_wic_outer"]
    for op in out:
        if op["id"] == "primary_bath_door":
            op["px"] = [x_pb_in, 548, x_pb_out, 580]
            op["hinge_px"] = [x_pb_in + 0.5, 578.0]
        elif op["id"] == "wic_door":
            op["px"] = [x_wic_in, 643, x_wic_out, 675]
            op["hinge_px"] = [x_wic_out - 1.5, 673.0]
    return out


class MeshBuilder:
    """Right-handed Y-up triangle mesh accumulator with strict outward winding."""

    def __init__(self, name: str, material_name: str, material_index: int) -> None:
        self.name = name
        self.material_name = material_name
        self.material_index = material_index
        self.positions: list[tuple[float, float, float]] = []
        self.normals: list[tuple[float, float, float]] = []
        self.indices: list[int] = []

    def add_quad(
        self,
        v0: tuple[float, float, float],
        v1: tuple[float, float, float],
        v2: tuple[float, float, float],
        v3: tuple[float, float, float],
        normal: tuple[float, float, float],
    ) -> None:
        base = len(self.positions)
        # Ensure (v1 - v0) x (v2 - v0) aligns with expected normal
        ax, ay, az = v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
        bx, by, bz = v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]
        cx = ay * bz - az * by
        cy = az * bx - ax * bz
        cz = ax * by - ay * bx
        dot = cx * normal[0] + cy * normal[1] + cz * normal[2]
        if dot < 0:
            v1, v3 = v3, v1
        self.positions.extend([v0, v1, v2, v3])
        self.normals.extend([normal, normal, normal, normal])
        self.indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    def add_box(
        self,
        x0: float,
        y0: float,
        z0: float,
        x1: float,
        y1: float,
        z1: float,
    ) -> None:
        if x1 <= x0 or y1 <= y0 or z1 <= z0:
            return
        # +Y top
        self.add_quad((x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (0.0, 1.0, 0.0))
        # -Y bottom
        self.add_quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (0.0, -1.0, 0.0))
        # +X east
        self.add_quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), (1.0, 0.0, 0.0))
        # -X west
        self.add_quad((x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0), (-1.0, 0.0, 0.0))
        # +Z south
        self.add_quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (0.0, 0.0, 1.0))
        # -Z north
        self.add_quad((x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (0.0, 0.0, -1.0))

    def add_box_px(
        self,
        px_x0: float,
        y0_ft: float,
        px_y0: float,
        px_x1: float,
        y1_ft: float,
        px_y1: float,
    ) -> None:
        self.add_box(
            px_to_m_x(px_x0),
            ft_to_m(y0_ft),
            px_to_m_z(px_y0),
            px_to_m_x(px_x1),
            ft_to_m(y1_ft),
            px_to_m_z(px_y1),
        )

    def add_rotated_box(
        self,
        pivot_x: float,
        pivot_z: float,
        y0: float,
        y1: float,
        local_x0: float,
        local_z0: float,
        local_x1: float,
        local_z1: float,
        angle_rad: float,
    ) -> None:
        c = math.cos(angle_rad)
        s = math.sin(angle_rad)

        def xf(lx: float, y: float, lz: float) -> tuple[float, float, float]:
            return (pivot_x + lx * c - lz * s, y, pivot_z + lx * s + lz * c)

        def nf(nx: float, ny: float, nz: float) -> tuple[float, float, float]:
            return (nx * c - nz * s, ny, nx * s + nz * c)

        self.add_quad(
            xf(local_x0, y1, local_z0),
            xf(local_x0, y1, local_z1),
            xf(local_x1, y1, local_z1),
            xf(local_x1, y1, local_z0),
            (0.0, 1.0, 0.0),
        )
        self.add_quad(
            xf(local_x0, y0, local_z0),
            xf(local_x1, y0, local_z0),
            xf(local_x1, y0, local_z1),
            xf(local_x0, y0, local_z1),
            (0.0, -1.0, 0.0),
        )
        self.add_quad(
            xf(local_x1, y0, local_z0),
            xf(local_x1, y1, local_z0),
            xf(local_x1, y1, local_z1),
            xf(local_x1, y0, local_z1),
            nf(1.0, 0.0, 0.0),
        )
        self.add_quad(
            xf(local_x0, y0, local_z1),
            xf(local_x0, y1, local_z1),
            xf(local_x0, y1, local_z0),
            xf(local_x0, y0, local_z0),
            nf(-1.0, 0.0, 0.0),
        )
        self.add_quad(
            xf(local_x0, y0, local_z1),
            xf(local_x1, y0, local_z1),
            xf(local_x1, y1, local_z1),
            xf(local_x0, y1, local_z1),
            nf(0.0, 0.0, 1.0),
        )
        self.add_quad(
            xf(local_x1, y0, local_z0),
            xf(local_x0, y0, local_z0),
            xf(local_x0, y1, local_z0),
            xf(local_x1, y1, local_z0),
            nf(0.0, 0.0, -1.0),
        )

    def add_cylinder_y(
        self,
        cx: float,
        cz: float,
        y0: float,
        y1: float,
        radius: float,
        segments: int = 16,
    ) -> None:
        if radius <= 0 or y1 <= y0:
            return
        ring = [(cx + radius * math.cos(2 * math.pi * i / segments), cz + radius * math.sin(2 * math.pi * i / segments)) for i in range(segments)]
        for i in range(segments):
            j = (i + 1) % segments
            x0, z0 = ring[i]
            x1, z1 = ring[j]
            ang = 2 * math.pi * (i + 0.5) / segments
            n = (math.cos(ang), 0.0, math.sin(ang))
            self.add_quad((x0, y0, z0), (x0, y1, z0), (x1, y1, z1), (x1, y0, z1), n)
        # Caps via fan
        top_center_idx = len(self.positions)
        self.positions.append((cx, y1, cz))
        self.normals.append((0.0, 1.0, 0.0))
        for x, z in ring:
            self.positions.append((x, y1, z))
            self.normals.append((0.0, 1.0, 0.0))
        for i in range(segments):
            j = (i + 1) % segments
            self.indices.extend([top_center_idx, top_center_idx + 1 + j, top_center_idx + 1 + i])

        bot_center_idx = len(self.positions)
        self.positions.append((cx, y0, cz))
        self.normals.append((0.0, -1.0, 0.0))
        for x, z in ring:
            self.positions.append((x, y0, z))
            self.normals.append((0.0, -1.0, 0.0))
        for i in range(segments):
            j = (i + 1) % segments
            self.indices.extend([bot_center_idx, bot_center_idx + 1 + i, bot_center_idx + 1 + j])


def greedy_2d_rects(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Decompose a 2D boolean mask (H, W) into disjoint (x0, y0, x1, y1) rectangles."""
    work = mask.copy()
    H, W = work.shape
    rects: list[tuple[int, int, int, int]] = []
    ys, xs = np.where(work)
    if len(ys) == 0:
        return rects
    y_min, y_max = int(ys.min()), int(ys.max())
    x_min, x_max = int(xs.min()), int(xs.max())
    for y in range(y_min, y_max + 1):
        x = x_min
        while x <= x_max:
            if not work[y, x]:
                x += 1
                continue
            x1 = x + 1
            while x1 <= x_max and work[y, x1]:
                x1 += 1
            y1 = y + 1
            while y1 <= y_max and np.all(work[y1, x:x1]):
                y1 += 1
            work[y:y1, x:x1] = False
            rects.append((x, y, x1, y1))
            x = x1
    return rects


def emit_runs_1d(arr: np.ndarray) -> list[tuple[int, int]]:
    """Return maximal True intervals [start, end_exclusive) in a 1D boolean array."""
    if not np.any(arr):
        return []
    padded = np.concatenate(([False], arr, [False]))
    diffs = np.diff(padded.astype(np.int8))
    starts = np.where(diffs == 1)[0]
    ends = np.where(diffs == -1)[0]
    return [(int(s), int(e)) for s, e in zip(starts, ends)]


def build_watertight_band_mesh(
    mesh: MeshBuilder,
    bands: list[tuple[float, float, np.ndarray]],
) -> None:
    """Emit only exposed exterior quads for stacked 2D voxel occupancy bands."""
    num_bands = len(bands)
    for bi, (y0_ft, y1_ft, mask) in enumerate(bands):
        y0 = ft_to_m(y0_ft)
        y1 = ft_to_m(y1_ft)
        prev_mask = bands[bi - 1][2] if bi > 0 else np.zeros_like(mask)
        next_mask = bands[bi + 1][2] if bi + 1 < num_bands else np.zeros_like(mask)

        # +Y top faces
        top_exposed = mask & (~next_mask)
        for x0, z0, x1, z1 in greedy_2d_rects(top_exposed):
            mesh.add_quad(
                (px_to_m_x(x0), y1, px_to_m_z(z0)),
                (px_to_m_x(x0), y1, px_to_m_z(z1)),
                (px_to_m_x(x1), y1, px_to_m_z(z1)),
                (px_to_m_x(x1), y1, px_to_m_z(z0)),
                (0.0, 1.0, 0.0),
            )

        # -Y bottom faces
        bot_exposed = mask & (~prev_mask)
        for x0, z0, x1, z1 in greedy_2d_rects(bot_exposed):
            mesh.add_quad(
                (px_to_m_x(x0), y0, px_to_m_z(z0)),
                (px_to_m_x(x1), y0, px_to_m_z(z0)),
                (px_to_m_x(x1), y0, px_to_m_z(z1)),
                (px_to_m_x(x0), y0, px_to_m_z(z1)),
                (0.0, -1.0, 0.0),
            )

        H, W = mask.shape
        # -Z north faces and +Z south faces
        north_shifted = np.zeros_like(mask)
        north_shifted[1:, :] = mask[:-1, :]
        south_shifted = np.zeros_like(mask)
        south_shifted[:-1, :] = mask[1:, :]

        north_exp = mask & (~north_shifted)
        south_exp = mask & (~south_shifted)
        for y_px in range(H):
            if np.any(north_exp[y_px]):
                z_m = px_to_m_z(y_px)
                for x0, x1 in emit_runs_1d(north_exp[y_px]):
                    mesh.add_quad(
                        (px_to_m_x(x1), y0, z_m),
                        (px_to_m_x(x0), y0, z_m),
                        (px_to_m_x(x0), y1, z_m),
                        (px_to_m_x(x1), y1, z_m),
                        (0.0, 0.0, -1.0),
                    )
            if np.any(south_exp[y_px]):
                z_m = px_to_m_z(y_px + 1)
                for x0, x1 in emit_runs_1d(south_exp[y_px]):
                    mesh.add_quad(
                        (px_to_m_x(x0), y0, z_m),
                        (px_to_m_x(x1), y0, z_m),
                        (px_to_m_x(x1), y1, z_m),
                        (px_to_m_x(x0), y1, z_m),
                        (0.0, 0.0, 1.0),
                    )

        # -X west faces and +X east faces
        west_shifted = np.zeros_like(mask)
        west_shifted[:, 1:] = mask[:, :-1]
        east_shifted = np.zeros_like(mask)
        east_shifted[:, :-1] = mask[:, 1:]

        west_exp = mask & (~west_shifted)
        east_exp = mask & (~east_shifted)
        for x_px in range(W):
            if np.any(west_exp[:, x_px]):
                x_m = px_to_m_x(x_px)
                for y0_px, y1_px in emit_runs_1d(west_exp[:, x_px]):
                    mesh.add_quad(
                        (x_m, y0, px_to_m_z(y1_px)),
                        (x_m, y1, px_to_m_z(y1_px)),
                        (x_m, y1, px_to_m_z(y0_px)),
                        (x_m, y0, px_to_m_z(y0_px)),
                        (-1.0, 0.0, 0.0),
                    )
            if np.any(east_exp[:, x_px]):
                x_m = px_to_m_x(x_px + 1)
                for y0_px, y1_px in emit_runs_1d(east_exp[:, x_px]):
                    mesh.add_quad(
                        (x_m, y0, px_to_m_z(y0_px)),
                        (x_m, y1, px_to_m_z(y0_px)),
                        (x_m, y1, px_to_m_z(y1_px)),
                        (x_m, y0, px_to_m_z(y1_px)),
                        (1.0, 0.0, 0.0),
                    )


def apply_measurement_wall_overrides(
    clean_wall: np.ndarray,
    anchors: dict[str, Any],
    has_measurements: bool,
) -> None:
    """Adjust clean_wall pixels to match field measurements before opening/floor extraction."""
    if not has_measurements:
        return

    x_nk_west = anchors["x_nk_west"]
    y_sink_north = anchors["y_sink_north"]
    y_col_top = anchors["y_col_top"]
    x_pbath_outer = anchors["x_pbath_outer"]
    x_pb_in = anchors["x_pb_in"]
    x_wic_outer = anchors["x_wic_outer"]
    x_wic_in = anchors["x_wic_in"]
    y_sw_col_north = anchors["y_sw_col_north"]
    x_sw_col_east = anchors["x_sw_col_east"]
    x_shelf_front = anchors["x_shelf_front"]

    # 1. Kitchen North wall (8'5" = 101" clear from Bedroom NE inner face x=364)
    clean_wall[244:250, x_nk_west:263] = True

    # 2. Kitchen Sink/DW West wall (9'2" = 110" up from Foyer wall y=469)
    clean_wall[350:371, 263:295] = False
    clean_wall[469:472, 263:295] = False
    clean_wall[y_sink_north : y_sink_north + 13, 263:295] = True
    clean_wall[y_sink_north + 13 : 444, 263:269] = True

    # 3. Dining West wall (16'11" = 203" above Primary Bath North wall y=462) & flush column line
    clean_wall[y_col_top:297, 100:x_shelf_front] = True
    clean_wall[y_col_top:297, x_shelf_front:117] = False
    clean_wall[429:462, x_shelf_front:117] = False

    # 4. Primary Bath East wall (6'7" = 79" from West exterior wall x=100)
    clean_wall[462:615, min(175, x_pb_in):185] = False
    clean_wall[462:468, 100:x_pbath_outer] = True
    clean_wall[468:548, x_pb_in:x_pbath_outer] = True
    clean_wall[580:615, x_pb_in:x_pbath_outer] = True
    clean_wall[517:523, x_pb_in:199] = True

    # 5. Primary Bedroom WIC East wall (7'6" = 90" from West exterior wall x=100)
    clean_wall[621:699, min(175, x_wic_in) : max(185, x_wic_outer)] = False
    clean_wall[615:621, 100:x_wic_outer] = True
    clean_wall[699:705, 100:x_wic_outer] = True
    clean_wall[621:643, x_wic_in:x_wic_outer] = True
    clean_wall[675:699, x_wic_in:x_wic_outer] = True

    # 6. Primary Bedroom SW corner column (15'1" = 181" south of WIC South wall y=705)
    if y_sw_col_north < 919:
        clean_wall[y_sw_col_north:919, 100:x_sw_col_east] = True


def extract_masks(
    arr: np.ndarray,
    anchors: dict[str, Any],
    openings: list[dict[str, Any]],
    has_measurements: bool,
) -> tuple[np.ndarray, list[dict[str, Any]], np.ndarray, np.ndarray, np.ndarray]:
    """Extract clean wall mask, detected cyan windows, opening lintel mask, and interior floor mask."""
    black = (arr[:, :, 0] < 80) & (arr[:, :, 1] < 80) & (arr[:, :, 2] < 80)
    labels, num = ndimage.label(black)
    sizes = ndimage.sum(black, labels, range(1, num + 1))

    big_ids: list[int] = []
    mullion_ids: list[int] = []
    for i, s in enumerate(sizes):
        cid = i + 1
        if s > 140:
            big_ids.append(cid)
        elif s >= 25:
            ys, _ = np.where(labels == cid)
            if (
                (ys.min() >= 39 and ys.max() <= 51)
                or (ys.min() >= 70 and ys.max() <= 82)
                or (ys.min() >= 918 and ys.max() <= 930)
            ):
                mullion_ids.append(cid)

    raw_wall = np.isin(labels, big_ids)
    mullions = np.isin(labels, mullion_ids)

    # Remove 1-px JPEG anti-aliasing fringes on main walls while keeping mullions intact
    clean = raw_wall.copy()
    isolated_v = clean[1:-1, :] & (~clean[:-2, :]) & (~clean[2:, :])
    clean[1:-1, :][isolated_v] = False
    isolated_h = clean[:, 1:-1] & (~clean[:, :-2]) & (~clean[:, 2:])
    clean[:, 1:-1][isolated_h] = False
    clean_wall = clean | mullions
    apply_measurement_wall_overrides(clean_wall, anchors, has_measurements)

    # Detect 11 cyan window panes and snap to exterior wall bands
    cyan = (arr[:, :, 2].astype(int) - arr[:, :, 0].astype(int) > 25) | (
        arr[:, :, 1].astype(int) - arr[:, :, 0].astype(int) > 25
    )
    clabels, cnum = ndimage.label(cyan)
    csizes = ndimage.sum(cyan, clabels, range(1, cnum + 1))

    windows: list[dict[str, Any]] = []
    win_mask = np.zeros_like(clean_wall)
    raw_windows: list[dict[str, Any]] = []
    for i, s in enumerate(csizes):
        if s < 50:
            continue
        ys, xs = np.where(clabels == i + 1)
        ym = float(ys.mean())
        if ym < 60:
            y0, y1, loc = 41, 51, "Living Room North"
        elif ym < 100:
            y0, y1, loc = 72, 82, "Bedroom NE North"
        else:
            y0, y1, loc = 919, 930, "South Bedrooms"
        x0 = int(xs.min()) - 1
        x1 = int(xs.max()) + 2
        raw_windows.append({"px": [x0, y0, x1, y1], "location": loc})
        win_mask[y0:y1, x0:x1] = True

    # Ensure windows sit strictly where walls aren't already solid, then tighten each span
    win_mask = win_mask & (~clean_wall)
    for w in raw_windows:
        x0, y0, x1, y1 = w["px"]
        ym = 0.5 * (y0 + y1)
        mid_y0 = max(y0, int(math.floor(ym - 1.8)))
        mid_y1 = min(y1, int(math.ceil(ym + 1.8)))
        mid_clear = np.all(win_mask[mid_y0:mid_y1, x0:x1], axis=0)
        if np.any(mid_clear):
            cols = np.where(mid_clear)[0]
            x0, x1 = x0 + int(cols.min()), x0 + int(cols.max()) + 1
        elif np.any(win_mask[y0:y1, x0:x1]):
            _, xs_w = np.where(win_mask[y0:y1, x0:x1])
            x0, x1 = x0 + int(xs_w.min()), x0 + int(xs_w.max()) + 1
        else:
            continue
        w["px"] = [x0, y0, x1, y1]
        windows.append(w)

    windows.sort(key=lambda w: (w["px"][1], w["px"][0]))
    for idx, w in enumerate(windows, start=1):
        w["id"] = f"window_{idx:02d}"

    # Opening header mask (doorways + closets)
    opening_mask = np.zeros_like(clean_wall)
    for op in openings:
        x0, y0, x1, y1 = op["px"]
        opening_mask[y0:y1, x0:x1] = True
    opening_mask = opening_mask & (~clean_wall)

    # Seal exterior perimeter to flood-fill interior walkable space
    barrier = clean_wall | win_mask
    for op in openings:
        if op["id"] in ("top_balcony_door", "main_entry_door", "bot_balcony_door"):
            x0, y0, x1, y1 = op["px"]
            barrier[y0:y1, x0:x1] = True

    ext_labels, _ = ndimage.label(~barrier)
    exterior = ext_labels == ext_labels[0, 0]
    interior_floor = (~barrier) & (~exterior)

    return clean_wall, windows, win_mask, opening_mask, interior_floor


def build_fixtures(
    wood_mesh: MeshBuilder,
    stone_mesh: MeshBuilder,
    steel_mesh: MeshBuilder,
    fixture_white_mesh: MeshBuilder,
    glass_mesh: MeshBuilder,
    dark_metal_mesh: MeshBuilder,
    shelf_mesh: MeshBuilder,
    anchors: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build exact-footprint 3D fixed kitchen, bath, laundry, and built-in shelf fixtures."""
    meta: list[dict[str, Any]] = []

    x_nk_west = anchors["x_nk_west"]
    y_sink_north = anchors["y_sink_north"]
    y_isl_north = anchors["y_isl_north"]
    y_isl_south = anchors["y_isl_south"]
    x_pb_in = anchors["x_pb_in"]
    x_shelf_front = anchors["x_shelf_front"]
    shelf_cfg = anchors["shelf_cfg"]

    def add_cabinet(name: str, px: list[float], y0_ft: float, y1_ft: float, counter_top: bool = True) -> None:
        x0, z0, x1, z1 = px
        y0_safe = max(y0_ft, 0.005)
        if counter_top:
            wood_mesh.add_box_px(x0, y0_safe, z0, x1, y1_ft - 0.122, z1)
            stone_mesh.add_box_px(x0, y1_ft - 0.12, z0, x1, y1_ft, z1)
        else:
            wood_mesh.add_box_px(x0, y0_safe, z0, x1, y1_ft, z1)
        meta.append({"name": name, "px": px, "y_ft": [y0_ft, y1_ft]})

    # --- Kitchen --- (inset wall-adjacent faces by 0.15 px and base y=0.005 to avoid z-fighting)
    # North counter + upper cabinets
    add_cabinet("Kitchen North Counter", [x_nk_west + 1.0, 250.15, 363.85, 264.0], 0.0, 3.0, counter_top=True)
    add_cabinet("Kitchen North Upper Cabinets", [x_nk_west + 1.0, 250.15, 363.85, 261.0], 4.5, 7.5, counter_top=False)
    # East north counter + upper cabinets
    add_cabinet("Kitchen East-North Counter", [341, 264.05, 363.85, 317.95], 0.0, 3.0, counter_top=True)
    add_cabinet("Kitchen East-North Upper Cabinets", [350, 264.05, 363.85, 317.95], 4.5, 7.5, counter_top=False)
    # Refrigerator (REF)
    steel_mesh.add_box_px(339, 0.005, 318, 363.85, 6.0, 355)
    add_cabinet("Cabinet Above Refrigerator", [339, 318, 363.85, 355], 6.05, 7.5, counter_top=False)
    meta.append({"name": "Refrigerator (REF)", "px": [339, 318, 364, 355], "y_ft": [0.0, 6.0]})

    # East south counters + Range/Oven (clear stub wall row 372 -> start at 373.15)
    add_cabinet("Kitchen East-Mid Counter", [341.15, 373.15, 363.85, 399.95], 0.0, 3.0, counter_top=True)
    steel_mesh.add_box_px(340, 0.005, 400, 363.85, 3.0, 434)  # Range / Oven
    dark_metal_mesh.add_box_px(342, 3.005, 402, 360, 3.06, 432)  # Cooktop surface
    for bx, bz in [(346, 408), (346, 425), (355, 408), (355, 425)]:
        dark_metal_mesh.add_cylinder_y(px_to_m_x(bx), px_to_m_z(bz), ft_to_m(3.062), ft_to_m(3.11), ft_to_m(0.22), 14)
    meta.append({"name": "Range / Oven", "px": [340, 400, 364, 434], "y_ft": [0.0, 3.1]})
    add_cabinet("Kitchen East-South Counter", [341, 434.05, 363.85, 461.85], 0.0, 3.0, counter_top=True)
    add_cabinet("Kitchen East-South Upper Cabinets", [350, 373.15, 363.85, 461.85], 4.5, 7.5, counter_top=False)

    # Island / Breakfast Bar with West overhang
    wood_mesh.add_box_px(268, 0.005, y_isl_north, 295, 2.878, y_isl_south)
    stone_mesh.add_box_px(256, 2.88, y_isl_north, 295, 3.0, y_isl_south)
    # Microwave (MW) built into island
    dark_metal_mesh.add_box_px(278, 1.4, y_isl_south - 19.0, 294, 2.5, y_isl_south - 1.0)
    meta.append({"name": "Kitchen Island + MW", "px": [256, round(y_isl_north, 2), 295, round(y_isl_south, 2)], "y_ft": [0.0, 3.0]})

    # West Sink + DW counter (clear shifted stub wall at y_sink_north + 13)
    sink_z0 = y_sink_north + 13.15
    sink_ym = 0.5 * (sink_z0 + 443.85)
    add_cabinet("Kitchen Sink & DW Counter", [270.15, sink_z0, 295, 443.85], 0.0, 3.0, counter_top=True)
    steel_mesh.add_box_px(273, 3.005, sink_ym - 13.0, 290, 3.035, sink_ym + 13.0)  # Sink rim
    dark_metal_mesh.add_box_px(275, 3.045, sink_ym - 11.0, 288, 3.06, sink_ym + 11.0)  # Sink basin dark interior
    steel_mesh.add_cylinder_y(px_to_m_x(272), px_to_m_z(sink_ym), ft_to_m(3.04), ft_to_m(3.9), ft_to_m(0.06), 10)
    meta.append({"name": "Kitchen Sink + DW", "px": [269, round(sink_z0, 2), 295, 444], "y_ft": [0.0, 3.0]})

    # --- Dining Built-In Floor-to-Ceiling Shelf (between West columns) ---
    if shelf_cfg.get("enabled", False):
        sx0 = 100.15
        sx1 = x_shelf_front - 0.15
        sz0 = 297.15
        sz1 = 428.85
        bays = max(1, int(shelf_cfg.get("bays", 3)))
        shelf_heights = [float(v) for v in shelf_cfg.get("shelf_heights_ft", [1.75, 3.15, 4.55, 5.95, 7.35])]
        top_ft = CEILING_FT - 0.005 if shelf_cfg.get("floor_to_ceiling", True) else min(CEILING_FT - 0.005, float(shelf_cfg.get("height_ft", CEILING_FT)))
        plinth_top = 0.35
        crown_bot = top_ft - 0.295

        # Back panel, bottom plinth, and top crown fascia (disjoint in X and Y)
        shelf_mesh.add_box_px(sx0, 0.005, sz0, 100.95, top_ft, sz1)
        shelf_mesh.add_box_px(101.0, 0.005, sz0, sx1, plinth_top, sz1)
        shelf_mesh.add_box_px(101.0, crown_bot, sz0, sx1, top_ft, sz1)

        # Vertical outer & bay-divider panels
        panel_t = 1.0
        centers = [sz0 + panel_t * 0.5 + i * ((sz1 - sz0 - panel_t) / bays) for i in range(bays + 1)]
        for c in centers:
            shelf_mesh.add_box_px(101.0, plinth_top + 0.005, c - panel_t * 0.5, sx1, crown_bot - 0.005, c + panel_t * 0.5)

        # Horizontal shelves inside each bay
        for b in range(bays):
            bz0 = centers[b] + panel_t * 0.5 + 0.04
            bz1 = centers[b + 1] - panel_t * 0.5 - 0.04
            for sh_ft in shelf_heights:
                if plinth_top + 0.06 < sh_ft < crown_bot - 0.06:
                    shelf_mesh.add_box_px(101.0, sh_ft - 0.045, bz0, sx1 - 0.2, sh_ft + 0.045, bz1)

        meta.append({"name": "Dining Built-In Shelf (Floor-to-Ceiling)", "px": [100, 297, x_shelf_front, 429], "y_ft": [0.0, CEILING_FT]})

    # --- Primary Bathroom ---
    pb_east = x_pb_in - 0.15
    pb_inner_e = pb_east - 4.85
    # Bathtub (north wall)
    fixture_white_mesh.add_box_px(114.15, 0.005, 469.15, pb_east, 1.65, 473)
    fixture_white_mesh.add_box_px(114.15, 0.005, 491, pb_east, 1.65, 494.85)
    fixture_white_mesh.add_box_px(114.15, 0.005, 473.02, 120, 1.65, 490.98)
    fixture_white_mesh.add_box_px(pb_inner_e, 0.005, 473.02, pb_east, 1.65, 490.98)
    fixture_white_mesh.add_box_px(120.02, 0.005, 473.02, pb_inner_e - 0.02, 0.35, 490.98)
    meta.append({"name": "Primary Bath Tub", "px": [114, 469, x_pb_in, 495], "y_ft": [0.0, 1.65]})
    # Double-Sink Vanity
    wood_mesh.add_box_px(114.15, 0.005, 498, 136, 2.748, 548)
    stone_mesh.add_box_px(114.15, 2.75, 498, 136, 2.88, 548)
    fixture_white_mesh.add_box_px(118, 2.885, 505, 132, 2.95, 520)
    fixture_white_mesh.add_box_px(118, 2.885, 527, 132, 2.95, 542)
    steel_mesh.add_box_px(114.2, 3.4, 500, 115.5, 6.4, 546)  # Vanity mirror
    meta.append({"name": "Primary Bath Double Vanity", "px": [114, 498, 136, 548], "y_ft": [0.0, 2.95]})
    # Toilet
    fixture_white_mesh.add_box_px(114.15, 0.005, 558, 123, 2.55, 576)  # Tank
    fixture_white_mesh.add_box_px(123.02, 0.005, 560, 138, 1.35, 574)  # Bowl
    meta.append({"name": "Primary Bath Toilet", "px": [114, 558, 138, 576], "y_ft": [0.0, 2.55]})
    # Glass Shower
    stone_mesh.add_box_px(138.15, 0.005, 582, pb_east, 0.35, 613.85)
    glass_mesh.add_box_px(138.15, 0.355, 582, 140, 6.8, 613.85)
    glass_mesh.add_box_px(140.02, 0.355, 582, pb_east, 6.8, 584)
    meta.append({"name": "Primary Bath Shower", "px": [138, 582, x_pb_in, 614], "y_ft": [0.0, 6.8]})

    # --- Hall Bathroom ---
    fixture_white_mesh.add_box_px(256.15, 0.005, 563, 265, 2.55, 581)
    fixture_white_mesh.add_box_px(265.02, 0.005, 565, 280, 1.35, 579)
    wood_mesh.add_box_px(256.15, 0.005, 594, 275, 2.748, 616)
    stone_mesh.add_box_px(256.15, 2.75, 594, 275, 2.88, 616)
    fixture_white_mesh.add_box_px(259, 2.885, 598, 272, 2.95, 612)
    stone_mesh.add_box_px(256.15, 0.005, 618, 320.85, 0.35, 648.85)
    glass_mesh.add_box_px(256.15, 0.355, 618, 320.85, 6.8, 620)
    meta.append({"name": "Hall Bath Fixtures", "px": [256, 563, 321, 649], "y_ft": [0.0, 6.8]})

    # --- En-Suite Bath NE ---
    fixture_white_mesh.add_box_px(484, 0.005, 377, 493, 2.55, 395)
    fixture_white_mesh.add_box_px(469, 0.005, 379, 483.98, 1.35, 393)
    wood_mesh.add_box_px(475, 0.005, 406, 493, 2.748, 428)
    stone_mesh.add_box_px(475, 2.75, 406, 493, 2.88, 428)
    fixture_white_mesh.add_box_px(478, 2.885, 410, 490, 2.95, 424)
    stone_mesh.add_box_px(424.15, 0.005, 430, 493, 0.35, 460.85)
    glass_mesh.add_box_px(424.15, 0.355, 430, 493, 6.8, 432)
    meta.append({"name": "Bath NE Fixtures", "px": [424, 377, 493, 461], "y_ft": [0.0, 6.8]})

    # --- Washer / Dryer (W/D) ---
    fixture_white_mesh.add_box_px(252, 0.005, 524, 284, 5.8, 548)
    dark_metal_mesh.add_box_px(257, 1.2, 523.5, 279, 2.4, 523.95)
    dark_metal_mesh.add_box_px(257, 3.8, 523.5, 279, 5.0, 523.95)
    meta.append({"name": "Washer / Dryer (W/D)", "px": [252, 524, 284, 548], "y_ft": [0.0, 5.8]})

    return meta


def build_doors_and_windows(
    win_frame_mesh: MeshBuilder,
    win_glass_mesh: MeshBuilder,
    door_mesh: MeshBuilder,
    railing_metal_mesh: MeshBuilder,
    railing_glass_mesh: MeshBuilder,
    windows: list[dict[str, Any]],
    openings: list[dict[str, Any]],
) -> None:
    """Create 3D window frames/glazing, hinged/closet door panels, and balcony guardrails."""
    # 11 Exterior Windows (2'0" to 8'0")
    frame_thick_ft = 0.16
    for w in windows:
        x0, y0, x1, y1 = w["px"]
        fx0 = x0 + 0.05
        fx1 = x1 - 0.05
        ym = 0.5 * (y0 + y1)
        half_d = 1.6  # px depth (~1.5 in)
        stile_w = min(2.0, 0.25 * (fx1 - fx0))
        y_bot0 = WIN_SILL_FT + 0.005
        y_bot1 = WIN_SILL_FT + frame_thick_ft
        y_top0 = WIN_HEAD_FT - frame_thick_ft
        y_top1 = WIN_HEAD_FT - 0.005
        # Non-overlapping perimeter frame (rails span full width; stiles sit strictly between rails)
        win_frame_mesh.add_box_px(fx0, y_bot0, ym - half_d, fx1, y_bot1, ym + half_d)
        win_frame_mesh.add_box_px(fx0, y_top0, ym - half_d, fx1, y_top1, ym + half_d)
        win_frame_mesh.add_box_px(fx0, y_bot1 + 0.002, ym - half_d, fx0 + stile_w, y_top0 - 0.002, ym + half_d)
        win_frame_mesh.add_box_px(fx1 - stile_w, y_bot1 + 0.002, ym - half_d, fx1, y_top0 - 0.002, ym + half_d)
        # Glass pane (clear of double-sided inner frame faces)
        win_glass_mesh.add_box_px(fx0 + stile_w + 0.03, y_bot1 + 0.004, ym - 0.35, fx1 - stile_w - 0.03, y_top0 - 0.004, ym + 0.35)

    # 18 Doors (hinged panels slightly ajar at 22 deg; closet double bi-fold/sliding panels)
    door_thick_m = ft_to_m(0.14)  # 1.68 in
    door_y0_ft = 0.02
    door_y1_ft = DOOR_HEAD_FT - 0.02
    for op in openings:
        if op["kind"] == "hinged":
            hx, hz = px_to_m_x(op["hinge_px"][0]), px_to_m_z(op["hinge_px"][1])
            width_m = op["width_px"] * PX_TO_M
            c_deg = op["closed_angle_deg"]
            s_deg = op["swing_dir_deg"]
            # Shortest angular interpolation by 24 deg toward swing_dir
            diff = ((s_deg - c_deg + 180.0) % 360.0) - 180.0
            ajar_deg = c_deg + 0.28 * diff
            door_mesh.add_rotated_box(
                hx,
                hz,
                ft_to_m(door_y0_ft),
                ft_to_m(door_y1_ft),
                0.0,
                -door_thick_m * 0.5,
                width_m,
                door_thick_m * 0.5,
                math.radians(ajar_deg),
            )
        else:
            x0, y0, x1, y1 = op["px"]
            if op["orientation"] == "horizontal":
                ym = 0.5 * (y0 + y1)
                xm = 0.5 * (x0 + x1)
                door_mesh.add_box_px(x0 + 1, door_y0_ft, ym - 0.8, xm - 0.3, door_y1_ft, ym + 0.4)
                door_mesh.add_box_px(xm + 0.3, door_y0_ft, ym - 0.4, x1 - 1, door_y1_ft, ym + 0.8)
            else:
                xm = 0.5 * (x0 + x1)
                ym = 0.5 * (y0 + y1)
                door_mesh.add_box_px(xm - 0.8, door_y0_ft, y0 + 1, xm + 0.4, door_y1_ft, ym - 0.3)
                door_mesh.add_box_px(xm - 0.4, door_y0_ft, ym + 0.3, xm + 0.8, door_y1_ft, y1 - 1)

    # Balcony Railings (3'6" high metal handrail + posts + translucent glass panels)
    rail_h = 3.5
    post_top = rail_h - 0.152
    rail_bot = rail_h - 0.15
    # Top Balcony: px = [374, 40, 504, 72] (clear walls at x=374, x=504, z=71)
    for px_post in [(375.1, 41), (375.1, 69.8), (418, 41), (461, 41), (502.9, 41), (502.9, 69.8)]:
        railing_metal_mesh.add_box_px(px_post[0] - 0.8, -0.045, px_post[1] - 0.8, px_post[0] + 0.8, post_top, px_post[1] + 0.8)
    railing_metal_mesh.add_box_px(374.15, rail_bot, 40, 503.85, rail_h, 42)  # North handrail
    railing_metal_mesh.add_box_px(374.15, rail_bot, 42.02, 376, rail_h, 70.8)  # West handrail
    railing_metal_mesh.add_box_px(502, rail_bot, 42.02, 503.85, rail_h, 70.8)  # East handrail
    railing_glass_mesh.add_box_px(376.1, 0.1, 40.6, 501.9, rail_bot - 0.05, 41.3)
    railing_glass_mesh.add_box_px(374.6, 0.1, 42.1, 375.3, rail_bot - 0.05, 68.9)
    railing_glass_mesh.add_box_px(502.6, 0.1, 42.1, 503.3, rail_bot - 0.05, 68.9)

    # Bottom Balcony: px = [389, 929, 561, 982] (clear walls at z=930)
    for px_post in [(390.1, 931.2), (390.1, 981), (433, 981), (476, 981), (519, 981), (559.9, 981), (559.9, 931.2)]:
        railing_metal_mesh.add_box_px(px_post[0] - 0.8, -0.045, px_post[1] - 0.8, px_post[0] + 0.8, post_top, px_post[1] + 0.8)
    railing_metal_mesh.add_box_px(389.15, rail_bot, 980, 560.85, rail_h, 982)  # South handrail
    railing_metal_mesh.add_box_px(389.15, rail_bot, 930.2, 391, rail_h, 979.98)  # West handrail
    railing_metal_mesh.add_box_px(559, rail_bot, 930.2, 560.85, rail_h, 979.98)  # East handrail
    railing_glass_mesh.add_box_px(391.1, 0.1, 980.6, 558.9, rail_bot - 0.05, 981.3)
    railing_glass_mesh.add_box_px(389.6, 0.1, 932.1, 390.3, rail_bot - 0.05, 979.9)
    railing_glass_mesh.add_box_px(559.6, 0.1, 932.1, 560.3, rail_bot - 0.05, 979.9)


def export_glb(path: Path, meshes: list[MeshBuilder], materials: list[dict[str, Any]]) -> None:
    """Serialize meshes & PBR materials into a strict glTF 2.0 binary (.glb)."""
    bin_chunks: list[bytes] = []
    buffer_views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    gltf_meshes: list[dict[str, Any]] = []
    nodes: list[dict[str, Any]] = []

    offset = 0
    for mesh in meshes:
        if not mesh.indices:
            continue
        pos_arr = np.asarray(mesh.positions, dtype=np.float32)
        norm_arr = np.asarray(mesh.normals, dtype=np.float32)
        idx_arr = np.asarray(mesh.indices, dtype=np.uint32)

        pmin = [float(x) for x in pos_arr.min(axis=0)]
        pmax = [float(x) for x in pos_arr.max(axis=0)]

        pos_bytes = pos_arr.tobytes()
        norm_bytes = norm_arr.tobytes()
        idx_bytes = idx_arr.tobytes()

        # Position bufferView + accessor
        bv_pos = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(pos_bytes), "target": 34962})
        bin_chunks.append(pos_bytes)
        offset += len(pos_bytes)
        acc_pos = len(accessors)
        accessors.append(
            {
                "bufferView": bv_pos,
                "componentType": 5126,  # FLOAT
                "count": len(pos_arr),
                "type": "VEC3",
                "min": pmin,
                "max": pmax,
            }
        )

        # Normal bufferView + accessor
        bv_norm = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(norm_bytes), "target": 34962})
        bin_chunks.append(norm_bytes)
        offset += len(norm_bytes)
        acc_norm = len(accessors)
        accessors.append(
            {
                "bufferView": bv_norm,
                "componentType": 5126,
                "count": len(norm_arr),
                "type": "VEC3",
            }
        )

        # Index bufferView + accessor
        bv_idx = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(idx_bytes), "target": 34963})
        bin_chunks.append(idx_bytes)
        offset += len(idx_bytes)
        acc_idx = len(accessors)
        accessors.append(
            {
                "bufferView": bv_idx,
                "componentType": 5125,  # UNSIGNED_INT
                "count": len(idx_arr),
                "type": "SCALAR",
            }
        )

        mesh_idx = len(gltf_meshes)
        gltf_meshes.append(
            {
                "name": mesh.name,
                "primitives": [
                    {
                        "attributes": {"POSITION": acc_pos, "NORMAL": acc_norm},
                        "indices": acc_idx,
                        "material": mesh.material_index,
                    }
                ],
            }
        )
        nodes.append({"name": mesh.name, "mesh": mesh_idx})

    bin_blob = b"".join(bin_chunks)
    bin_pad = (-len(bin_blob)) % 4
    if bin_pad:
        bin_blob += b"\x00" * bin_pad

    gltf_doc = {
        "asset": {
            "version": "2.0",
            "generator": "home-misc build_model.py (1 unit = 1 meter, scale 12.5 px/ft)",
        },
        "scene": 0,
        "scenes": [{"name": "Apartment", "nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "materials": materials,
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }

    json_bytes = json.dumps(gltf_doc, separators=(",", ":")).encode("utf-8")
    json_pad = (-len(json_bytes)) % 4
    if json_pad:
        json_bytes += b" " * json_pad

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_blob)
    header = struct.pack("<III", 0x46546C67, 2, total_len)
    json_chunk = struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
    bin_chunk = struct.pack("<II", len(bin_blob), 0x004E4942) + bin_blob

    path.write_bytes(header + json_chunk + bin_chunk)


def export_obj(
    obj_path: Path,
    mtl_path: Path,
    meshes: list[MeshBuilder],
    materials: list[dict[str, Any]],
) -> None:
    """Write Wavefront OBJ/MTL with named object layers in meters."""
    mtl_lines = ["# Apartment Materials"]
    for mat in materials:
        pbr = mat["pbrMetallicRoughness"]
        r, g, b, a = pbr["baseColorFactor"]
        mtl_lines.append(f"newmtl {mat['name']}")
        mtl_lines.append(f"Kd {r:.4f} {g:.4f} {b:.4f}")
        mtl_lines.append(f"Ka {r*0.25:.4f} {g*0.25:.4f} {b*0.25:.4f}")
        mtl_lines.append(f"d {a:.4f}")
        mtl_lines.append("illum 2\n")
    mtl_path.write_text("\n".join(mtl_lines), encoding="utf-8")

    obj_lines = [
        "# Exact-dimension 3D apartment model extracted from floorplan.jpeg",
        "# Units: meters (1 ft = 0.3048 m, calibration = 12.5000 px/ft)",
        "# Coordinate frame: +X East, +Y Up (0 = interior floor), +Z South",
        f"mtllib {mtl_path.name}",
    ]
    v_offset = 1
    for mesh in meshes:
        if not mesh.indices:
            continue
        obj_lines.append(f"o {mesh.name}")
        obj_lines.append(f"usemtl {mesh.material_name}")
        for px, py, pz in mesh.positions:
            obj_lines.append(f"v {px:.5f} {py:.5f} {pz:.5f}")
        for nx, ny, nz in mesh.normals:
            obj_lines.append(f"vn {nx:.5f} {ny:.5f} {nz:.5f}")
        for i in range(0, len(mesh.indices), 3):
            a = mesh.indices[i] + v_offset
            b = mesh.indices[i + 1] + v_offset
            c = mesh.indices[i + 2] + v_offset
            obj_lines.append(f"f {a}//{a} {b}//{b} {c}//{c}")
        v_offset += len(mesh.positions)
    obj_path.write_text("\n".join(obj_lines) + "\n", encoding="utf-8")


def build_room_specs(anchors: dict[str, Any]) -> list[dict[str, Any]]:
    """Build exact room metadata comparing printed floorplan labels against 3D CAD spans."""
    x_nk_west = anchors["x_nk_west"]
    x_pb_in = anchors["x_pb_in"]
    x_wic_in = anchors["x_wic_in"]
    rooms_raw = [
        ("living_room", "Living Room", "21' x 16'", [100, 51, 364, 244], [21.0, 16.0], "living"),
        ("dining_area", "Dining Area", "13' x 20'8\"", [100, 244, 263, 517], [13.0, 20 + 8 / 12], "dining"),
        ("kitchen", "Kitchen", "8'2\" x 15'2\"", [x_nk_west, 250, 364, 444], [8 + 5 / 12, 15 + 2 / 12], "kitchen"),
        ("bedroom_ne", "Bedroom (NE)", "10' x 20'", [371, 82, 494, 334], [10.0, 20.0], "bedroom"),
        ("bath_ne", "En-Suite Bath (NE)", "—", [424, 370, 494, 462], [5.6, 7.36], "bath"),
        ("foyer", "Foyer", "23' x 4'", [184, 468, 465, 517], [23.0, 4.0], "hall"),
        ("coat_closet", "Coat Closet", "7' x 8'", [470, 531, 551, 631], [7.0, 8.0], "closet"),
        ("primary_bath", "Primary Bath", "—", [114, 468, x_pb_in, 615], [round((x_pb_in - 114) / PX_PER_FT, 2), 11.76], "bath"),
        ("hall_bath", "Hall Bath", "—", [256, 556, 321, 650], [5.2, 7.52], "bath"),
        ("wic", "WIC", "6'3\" x 6'", [100, 621, x_wic_in, 699], [round((x_wic_in - 100) / PX_PER_FT, 2), 6.0], "closet"),
        ("primary_bedroom", "Primary Bedroom", "12' x 17'", [100, 705, 248, 919], [12.0, 17.0], "bedroom"),
        ("bedroom_mid", "Bedroom (Center)", "10'3\" x 17'6\"", [256, 685, 382, 919], [10.25, 17.5], "bedroom"),
        ("bedroom_se", "Bedroom (SE)", "13' x 22'2\"", [389, 636, 551, 919], [13.0, 22 + 2 / 12], "bedroom"),
        ("balcony_top", "Balcony (North)", "—", [374, 40, 504, 72], [10.4, 2.56], "balcony"),
        ("balcony_bot", "Balcony (South)", "—", [389, 929, 561, 982], [13.76, 4.24], "balcony"),
    ]
    out: list[dict[str, Any]] = []
    for rid, name, printed, px, target_ft, kind in rooms_raw:
        x0, y0, x1, y1 = px
        w_ft = (x1 - x0) / PX_PER_FT
        d_ft = (y1 - y0) / PX_PER_FT
        out.append(
            {
                "id": rid,
                "name": name,
                "kind": kind,
                "printed_label": printed,
                "px": px,
                "bounds_m": [
                    round(px_to_m_x(x0), 5),
                    round(px_to_m_z(y0), 5),
                    round(px_to_m_x(x1), 5),
                    round(px_to_m_z(y1), 5),
                ],
                "center_m": [round(px_to_m_x(0.5 * (x0 + x1)), 5), 0.0, round(px_to_m_z(0.5 * (y0 + y1)), 5)],
                "measured_ft": [round(w_ft, 3), round(d_ft, 3)],
                "measured_str": f"{fmt_ft_in(w_ft)} x {fmt_ft_in(d_ft)}",
                "target_ft": [round(target_ft[0], 3), round(target_ft[1], 3)],
                "area_sqft": round(w_ft * d_ft, 1),
            }
        )
    return out


def main() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    arr = np.array(Image.open(FLOORPLAN_PATH).convert("RGB"))
    H, W, _ = arr.shape

    meas = load_measurements()
    has_measurements = bool(meas)
    anchors = compute_layout_anchors(meas)
    openings = get_openings(anchors) if has_measurements else [dict(op) for op in OPENINGS]

    clean_wall, windows, win_mask, opening_mask, interior_floor = extract_masks(
        arr, anchors, openings, has_measurements
    )

    materials = [
        {"name": "WallPlaster", "pbrMetallicRoughness": {"baseColorFactor": [0.94, 0.93, 0.90, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.85}},
        {"name": "HardwoodFloor", "pbrMetallicRoughness": {"baseColorFactor": [0.76, 0.62, 0.45, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.62}},
        {"name": "CeramicTile", "pbrMetallicRoughness": {"baseColorFactor": [0.85, 0.87, 0.88, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.45}},
        {"name": "BalconyConcrete", "pbrMetallicRoughness": {"baseColorFactor": [0.64, 0.65, 0.66, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.90}},
        {"name": "WindowFrame", "pbrMetallicRoughness": {"baseColorFactor": [0.16, 0.18, 0.21, 1.0], "metallicFactor": 0.4, "roughnessFactor": 0.45}},
        {"name": "GlassPane", "pbrMetallicRoughness": {"baseColorFactor": [0.55, 0.82, 0.92, 0.32], "metallicFactor": 0.1, "roughnessFactor": 0.1}, "alphaMode": "BLEND", "doubleSided": True},
        {"name": "DoorWood", "pbrMetallicRoughness": {"baseColorFactor": [0.82, 0.77, 0.70, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.55}},
        {"name": "CabinetWood", "pbrMetallicRoughness": {"baseColorFactor": [0.62, 0.50, 0.37, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.55}},
        {"name": "CounterStone", "pbrMetallicRoughness": {"baseColorFactor": [0.92, 0.92, 0.91, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.32}},
        {"name": "BrushedSteel", "pbrMetallicRoughness": {"baseColorFactor": [0.74, 0.76, 0.78, 1.0], "metallicFactor": 0.75, "roughnessFactor": 0.32}},
        {"name": "PorcelainWhite", "pbrMetallicRoughness": {"baseColorFactor": [0.97, 0.97, 0.98, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.22}},
        {"name": "DarkMetal", "pbrMetallicRoughness": {"baseColorFactor": [0.18, 0.19, 0.21, 1.0], "metallicFactor": 0.6, "roughnessFactor": 0.42}},
    ]
    mat_idx = {m["name"]: i for i, m in enumerate(materials)}

    walls_mesh = MeshBuilder("Walls_Main", "WallPlaster", mat_idx["WallPlaster"])
    floor_wood_mesh = MeshBuilder("Floor_Wood", "HardwoodFloor", mat_idx["HardwoodFloor"])
    floor_tile_mesh = MeshBuilder("Floor_Tile", "CeramicTile", mat_idx["CeramicTile"])
    floor_balcony_mesh = MeshBuilder("Floor_Balcony", "BalconyConcrete", mat_idx["BalconyConcrete"])
    win_frame_mesh = MeshBuilder("Window_Frames", "WindowFrame", mat_idx["WindowFrame"])
    win_glass_mesh = MeshBuilder("Windows_Glass", "GlassPane", mat_idx["GlassPane"])
    doors_mesh = MeshBuilder("Doors", "DoorWood", mat_idx["DoorWood"])
    railing_metal_mesh = MeshBuilder("Balcony_Railings", "DarkMetal", mat_idx["DarkMetal"])
    railing_glass_mesh = MeshBuilder("Balcony_Glass", "GlassPane", mat_idx["GlassPane"])
    cabinet_wood_mesh = MeshBuilder("Fixtures_Cabinets", "CabinetWood", mat_idx["CabinetWood"])
    dining_shelf_mesh = MeshBuilder("Fixtures_DiningShelf", "CabinetWood", mat_idx["CabinetWood"])
    counter_stone_mesh = MeshBuilder("Fixtures_Counters", "CounterStone", mat_idx["CounterStone"])
    steel_mesh = MeshBuilder("Fixtures_Steel", "BrushedSteel", mat_idx["BrushedSteel"])
    porcelain_mesh = MeshBuilder("Fixtures_Porcelain", "PorcelainWhite", mat_idx["PorcelainWhite"])
    dark_metal_mesh = MeshBuilder("Fixtures_DarkMetal", "DarkMetal", mat_idx["DarkMetal"])

    # 1. Watertight multi-band walls (includes sills under windows & lintels above windows/doors)
    wall_bands = [
        (0.0, WIN_SILL_FT, clean_wall | win_mask),
        (WIN_SILL_FT, DOOR_HEAD_FT, clean_wall),
        (DOOR_HEAD_FT, WIN_HEAD_FT, clean_wall | opening_mask),
        (WIN_HEAD_FT, CEILING_FT, clean_wall | win_mask | opening_mask),
    ]
    build_watertight_band_mesh(walls_mesh, wall_bands)

    # 2. Segmented interior floor slab (-0.5' to 0.0')
    tile_zone = np.zeros_like(interior_floor)
    tile_zone[249:468, 256:365] = True  # Kitchen
    tile_zone[467:616, 113:anchors["x_pb_in"]] = True  # Primary Bath
    tile_zone[555:651, 255:323] = True  # Hall Bath
    tile_zone[368:463, 422:495] = True  # En-Suite Bath NE

    tile_mask = interior_floor & tile_zone
    # Place hardwood under remaining interior AND under wall footprints cleanly disjoint from tile
    wood_mask = (interior_floor | clean_wall | win_mask | opening_mask) & (~tile_mask)
    build_watertight_band_mesh(floor_tile_mesh, [(SLAB_BOTTOM_FT, 0.0, tile_mask)])
    build_watertight_band_mesh(floor_wood_mesh, [(SLAB_BOTTOM_FT, 0.0, wood_mask)])

    # 3. Balconies (-0.495' to -0.05', clear of exterior walls & Floor_Wood)
    floor_balcony_mesh.add_box_px(374.1, SLAB_BOTTOM_FT + 0.005, 40, 503.9, -0.05, 71.0)
    floor_balcony_mesh.add_box_px(389.1, SLAB_BOTTOM_FT + 0.005, 930.0, 560.9, -0.05, 982)

    # 4. Windows, Doors & Balcony Railings
    build_doors_and_windows(
        win_frame_mesh,
        win_glass_mesh,
        doors_mesh,
        railing_metal_mesh,
        railing_glass_mesh,
        windows,
        openings,
    )

    # 5. Built-in Kitchen, Bath & Dining Shelf Fixtures
    fixtures_meta = build_fixtures(
        cabinet_wood_mesh,
        counter_stone_mesh,
        steel_mesh,
        porcelain_mesh,
        win_glass_mesh,
        dark_metal_mesh,
        dining_shelf_mesh,
        anchors,
    )

    all_meshes = [
        walls_mesh,
        floor_wood_mesh,
        floor_tile_mesh,
        floor_balcony_mesh,
        win_frame_mesh,
        win_glass_mesh,
        doors_mesh,
        railing_metal_mesh,
        railing_glass_mesh,
        cabinet_wood_mesh,
        dining_shelf_mesh,
        counter_stone_mesh,
        steel_mesh,
        porcelain_mesh,
        dark_metal_mesh,
    ]

    glb_path = MODEL_DIR / "apartment_exact.glb"
    obj_path = MODEL_DIR / "apartment_exact.obj"
    mtl_path = MODEL_DIR / "apartment_exact.mtl"
    spec_path = MODEL_DIR / "apartment_spec.json"

    export_glb(glb_path, all_meshes, materials)
    export_obj(obj_path, mtl_path, all_meshes, materials)

    # Extract 2D wall rectangles for fast client-side collision & magnetic wall snapping
    wall_rects_px = greedy_2d_rects(clean_wall)
    if anchors["shelf_cfg"].get("enabled", False):
        wall_rects_px.append((100, 297, anchors["x_shelf_front"], 429))
    wall_rects_m = [
        [
            round(px_to_m_x(x0), 5),
            round(px_to_m_z(y0), 5),
            round(px_to_m_x(x1), 5),
            round(px_to_m_z(y1), 5),
        ]
        for x0, y0, x1, y1 in wall_rects_px
    ]

    iy, ix = np.where(interior_floor)
    net_sqft = float(interior_floor.sum()) / (PX_PER_FT ** 2)
    gross_sqft = float((interior_floor | clean_wall | win_mask | opening_mask).sum()) / (PX_PER_FT ** 2)

    openings_spec = []
    for op in openings:
        item = dict(op)
        x0, y0, x1, y1 = op["px"]
        item["bounds_m"] = [
            round(px_to_m_x(x0), 5),
            round(px_to_m_z(y0), 5),
            round(px_to_m_x(x1), 5),
            round(px_to_m_z(y1), 5),
        ]
        if op["kind"] == "hinged":
            item["hinge_m"] = [round(px_to_m_x(op["hinge_px"][0]), 5), round(px_to_m_z(op["hinge_px"][1]), 5)]
            item["width_m"] = round(op["width_px"] * PX_TO_M, 5)
            item["width_ft"] = round(op["width_px"] / PX_PER_FT, 3)
        openings_spec.append(item)

    windows_spec = []
    for w in windows:
        x0, y0, x1, y1 = w["px"]
        windows_spec.append(
            {
                **w,
                "bounds_m": [
                    round(px_to_m_x(x0), 5),
                    round(px_to_m_z(y0), 5),
                    round(px_to_m_x(x1), 5),
                    round(px_to_m_z(y1), 5),
                ],
                "width_ft": round((x1 - x0) / PX_PER_FT, 3),
                "sill_ft": WIN_SILL_FT,
                "head_ft": WIN_HEAD_FT,
            }
        )

    spec = {
        "image_size_px": [W, H],
        "calibration": {
            "px_per_ft": PX_PER_FT,
            "ft_to_m": FT_TO_M,
            "px_to_m": PX_TO_M,
            "center_px": [CENTER_PX_X, CENTER_PX_Y],
            "default_ceiling_ft": CEILING_FT,
            "door_head_ft": DOOR_HEAD_FT,
            "window_sill_ft": WIN_SILL_FT,
            "window_head_ft": WIN_HEAD_FT,
            "floorplan_bounds_m": [
                round(px_to_m_x(0), 5),
                round(px_to_m_z(0), 5),
                round(px_to_m_x(W), 5),
                round(px_to_m_z(H), 5),
            ],
        },
        "measurements": meas,
        "area": {
            "net_interior_sqft": round(net_sqft, 1),
            "gross_interior_sqft": round(gross_sqft, 1),
            "interior_px_bbox": [int(ix.min()), int(iy.min()), int(ix.max()), int(iy.max())],
        },
        "rooms": build_room_specs(anchors),
        "windows": windows_spec,
        "openings": openings_spec,
        "fixtures": fixtures_meta,
        "wall_rects_m": wall_rects_m,
    }
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")

    total_tris = sum(len(m.indices) // 3 for m in all_meshes)
    print(f"Wrote {glb_path} ({glb_path.stat().st_size:,} bytes, {total_tris:,} triangles)")
    print(f"Wrote {obj_path} ({obj_path.stat().st_size:,} bytes)")
    print(f"Wrote {spec_path} ({len(wall_rects_m)} wall rects, {len(windows_spec)} windows, {len(openings_spec)} openings)")
    print(f"Net interior floor area: {net_sqft:.1f} sq ft | Gross area: {gross_sqft:.1f} sq ft")


if __name__ == "__main__":
    main()
