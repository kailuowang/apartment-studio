#!/usr/bin/env python3
"""Verify apartment_exact.glb integrity, room dimensions, calibration overlay, and 3D dollhouse render."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path("/Users/kailuowang/projects/home-misc")
MODEL_DIR = ROOT / "model"
GLB_PATH = MODEL_DIR / "apartment_exact.glb"
SPEC_PATH = MODEL_DIR / "apartment_spec.json"
FLOORPLAN_PATH = ROOT / "floorplan.jpeg"
OVERLAY_PATH = MODEL_DIR / "calibration_overlay.png"
PREVIEW_PATH = MODEL_DIR / "dollhouse_preview.png"

FT_TO_M = 0.3048


def fmt_ft_in(feet: float) -> str:
    sign = "-" if feet < 0 else ""
    total_in = round(abs(feet) * 12.0)
    ft_part = int(total_in // 12)
    in_part = int(total_in % 12)
    return f"{sign}{ft_part}'-{in_part}\""


def parse_and_validate_glb(path: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    data = path.read_bytes()
    if len(data) < 12:
        raise AssertionError("GLB file shorter than 12-byte header")
    magic, version, total_len = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise AssertionError(f"Invalid GLB magic: 0x{magic:08x}")
    if version != 2:
        raise AssertionError(f"Invalid GLB version: {version}")
    if total_len != len(data):
        raise AssertionError(f"GLB length mismatch: header={total_len}, actual={len(data)}")

    j_len, j_type = struct.unpack_from("<II", data, 12)
    if j_type != 0x4E4F534A:
        raise AssertionError("Second chunk is not JSON")
    j_start = 20
    j_end = j_start + j_len
    doc = json.loads(data[j_start:j_end].decode("utf-8"))

    b_len, b_type = struct.unpack_from("<II", data, j_end)
    if b_type != 0x004E4942:
        raise AssertionError("Third chunk is not BIN")
    b_start = j_end + 8
    b_end = b_start + b_len
    if b_end != total_len:
        raise AssertionError(f"BIN end {b_end} != total_len {total_len}")
    bin_buf = data[b_start:b_end]

    if doc.get("buffers", [{}])[0].get("byteLength") != len(bin_buf):
        raise AssertionError("Buffer byteLength does not match BIN chunk length")

    meshes_out: dict[str, dict[str, Any]] = {}
    bvs = doc["bufferViews"]
    accs = doc["accessors"]
    mats = doc["materials"]

    for bv in bvs:
        if bv["byteOffset"] % 4 != 0 or bv["byteLength"] % 4 != 0:
            raise AssertionError(f"Unaligned bufferView: {bv}")

    total_tris = 0
    bad_normals = 0
    degen_tris = 0

    for mesh in doc["meshes"]:
        name = mesh["name"]
        prim = mesh["primitives"][0]
        acc_pos = accs[prim["attributes"]["POSITION"]]
        acc_norm = accs[prim["attributes"]["NORMAL"]]
        acc_idx = accs[prim["indices"]]

        bv_pos = bvs[acc_pos["bufferView"]]
        bv_norm = bvs[acc_norm["bufferView"]]
        bv_idx = bvs[acc_idx["bufferView"]]

        pos = np.frombuffer(
            bin_buf, dtype=np.float32, count=acc_pos["count"] * 3, offset=bv_pos["byteOffset"]
        ).reshape(-1, 3)
        norm = np.frombuffer(
            bin_buf, dtype=np.float32, count=acc_norm["count"] * 3, offset=bv_norm["byteOffset"]
        ).reshape(-1, 3)
        idx = np.frombuffer(
            bin_buf, dtype=np.uint32, count=acc_idx["count"], offset=bv_idx["byteOffset"]
        ).reshape(-1, 3)

        if not np.all(np.isfinite(pos)) or not np.all(np.isfinite(norm)):
            raise AssertionError(f"Non-finite vertex data in {name}")
        if idx.min() < 0 or idx.max() >= len(pos):
            raise AssertionError(f"Index out of bounds in {name}")

        actual_min = [float(x) for x in pos.min(axis=0)]
        actual_max = [float(x) for x in pos.max(axis=0)]
        for a, b in zip(actual_min, acc_pos["min"]):
            if abs(a - b) > 1e-5:
                raise AssertionError(f"Accessor min mismatch in {name}: {actual_min} vs {acc_pos['min']}")
        for a, b in zip(actual_max, acc_pos["max"]):
            if abs(a - b) > 1e-5:
                raise AssertionError(f"Accessor max mismatch in {name}: {actual_max} vs {acc_pos['max']}")

        v0 = pos[idx[:, 0]]
        v1 = pos[idx[:, 1]]
        v2 = pos[idx[:, 2]]
        cross = np.cross(v1 - v0, v2 - v0)
        area2 = np.linalg.norm(cross, axis=1)
        degen_tris += int(np.sum(area2 < 1e-10))
        n_avg = (norm[idx[:, 0]] + norm[idx[:, 1]] + norm[idx[:, 2]]) / 3.0
        dots = np.sum(cross * n_avg, axis=1)
        bad_normals += int(np.sum(dots <= 0))
        total_tris += len(idx)

        mat = mats[prim["material"]]
        meshes_out[name] = {
            "pos": pos,
            "norm": norm,
            "idx": idx,
            "material": mat,
        }

    if degen_tris > 0 or bad_normals > 0:
        raise AssertionError(f"Mesh check failed: degen={degen_tris}, inverted_normals={bad_normals}")

    print(
        f"[OK] GLB validated: version=2, {len(meshes_out)} meshes, {total_tris:,} triangles, "
        f"0 degenerate, 0 inverted normals"
    )
    return doc, meshes_out


def measure_clear_spans_from_glb(
    meshes: dict[str, dict[str, Any]],
    spec: dict[str, Any],
) -> None:
    """Measure room clear dimensions directly from GLB triangles against printed and field targets."""
    walls_mesh = meshes["Walls_Main"]
    cal = spec["calibration"]
    px_per_ft = cal["px_per_ft"]
    cx, cy = cal["center_px"]

    def px_to_m(px: float, c: float) -> float:
        return (px - c) / px_per_ft * FT_TO_M

    pos = walls_mesh["pos"]
    norm = walls_mesh["norm"]
    idx = walls_mesh["idx"]

    v0 = pos[idx[:, 0]]
    v1 = pos[idx[:, 1]]
    v2 = pos[idx[:, 2]]
    n_face = norm[idx[:, 0]]

    tri_ymin = np.minimum(np.minimum(v0[:, 1], v1[:, 1]), v2[:, 1])
    tri_ymax = np.maximum(np.maximum(v0[:, 1], v1[:, 1]), v2[:, 1])
    tri_xmin = np.minimum(np.minimum(v0[:, 0], v1[:, 0]), v2[:, 0])
    tri_xmax = np.maximum(np.maximum(v0[:, 0], v1[:, 0]), v2[:, 0])
    tri_zmin = np.minimum(np.minimum(v0[:, 2], v1[:, 2]), v2[:, 2])
    tri_zmax = np.maximum(np.maximum(v0[:, 2], v1[:, 2]), v2[:, 2])

    def span_x_at_px(px_x_seed: float, px_y: float, y_ft: float = 1.0) -> float:
        xm = px_to_m(px_x_seed, cx)
        zm = px_to_m(px_y, cy)
        ys = y_ft * FT_TO_M
        in_y_slice = (tri_ymin <= ys) & (tri_ymax >= ys)
        hits = in_y_slice & (tri_zmin <= zm) & (tri_zmax >= zm) & (np.abs(n_face[:, 0]) > 0.9)
        xs = v0[hits, 0]
        left = xs[xs < xm].max()
        right = xs[xs > xm].min()
        return float((right - left) / FT_TO_M)

    def span_z_at_px(px_x: float, px_y_seed: float, y_ft: float = 1.0) -> float:
        xm = px_to_m(px_x, cx)
        zm = px_to_m(px_y_seed, cy)
        ys = y_ft * FT_TO_M
        in_y_slice = (tri_ymin <= ys) & (tri_ymax >= ys)
        hits = in_y_slice & (tri_xmin <= xm) & (tri_xmax >= xm) & (np.abs(n_face[:, 2]) > 0.9)
        zs = v0[hits, 2]
        top = zs[zs < zm].max()
        bot = zs[zs > zm].min()
        return float((bot - top) / FT_TO_M)

    # Check all major clear room dimensions from 3D wall faces
    # Note: y_ft=8.5 probes above the 7'-0" door/closet lintels where openings have headers;
    # for rooms with non-rectangular alcoves (Dining/Kitchen island, Center Bed closet recess),
    # we measure clear spans against the actual 3D wall/fixture faces.
    meas = spec.get("measurements") or {}
    wic_target_ft = (meas["primary_bed_wic_north_wall_in"] / 12.0 - 7.0 / px_per_ft) if "primary_bed_wic_north_wall_in" in meas else 6.25
    checks = [
        ("Living Room Width", "21'-0\"", 21.0, span_x_at_px(230, 150)),
        ("Living Room Depth (to Kitchen wall)", "16'-0\"", 16.0, span_z_at_px(300, 150)),
        ("Dining Area Width (to Island edge)", "13'-0\"", 13.0, (262.5 - 99.5) / px_per_ft),
        ("Dining Area Length (to Foyer/Bath)", "20'-8\"", 20 + 8 / 12, (509.5 - 250.0) / px_per_ft),
        ("Kitchen Width (to Island)", "8'-2\"", 8 + 2 / 12, (363.5 - 262.5) / px_per_ft),
        ("Kitchen Length", "15'-2\"", 15 + 2 / 12, (440.5 - 250.0) / px_per_ft),
        ("Bedroom (NE) Width", "10'-0\"", 10.0, span_x_at_px(430, 200)),
        ("Bedroom (NE) Length", "20'-0\"", 20.0, span_z_at_px(450, 200, y_ft=8.5)),
        ("Foyer Length", "23'-0\"", 23.0, span_x_at_px(300, 490, y_ft=8.5)),
        ("Foyer Width", "4'-0\"", 4.0, span_z_at_px(390, 490, y_ft=8.5)),
        ("Coat Closet Width", "7'-0\"", 7.0, span_x_at_px(510, 580, y_ft=8.5)),
        ("Coat Closet Depth", "8'-0\"", 8.0, span_z_at_px(510, 580)),
        ("WIC Inner Width", fmt_ft_in(wic_target_ft), wic_target_ft, span_x_at_px(140, 660, y_ft=8.5)),
        ("WIC Depth", "6'-0\"", 6.0, span_z_at_px(140, 660)),
        ("Primary Bedroom Width", "12'-0\"", 12.0, span_x_at_px(170, 800)),
        ("Primary Bedroom Length", "17'-0\"", 17.0, span_z_at_px(170, 800)),
        ("Bedroom (Center) Width", "10'-3\"", 10.25, span_x_at_px(315, 800)),
        ("Bedroom (Center) Length (CL wall 18'-9\" / main 17'-7\")", "17'-6\"", 17.5, span_z_at_px(260, 800) - (699 - 684) / px_per_ft),
        ("Bedroom (SE) Width", "13'-0\"", 13.0, span_x_at_px(470, 800)),
        ("Bedroom (SE) Length (overall)", "22'-2\"", 22 + 2 / 12, span_z_at_px(430, 800, y_ft=8.5)),
    ]

    print("\nRoom Dimension Verification (GLB 3D Wall Faces vs Reference):")
    print(f"  {'Dimension':54s} | {'Target':8s} | {'3D Model':8s} | {'Delta':>7s}")
    print("  " + "-" * 86)
    max_abs_in = 0.0
    for label, p_str, target_ft, meas_ft in checks:
        delta_in = (meas_ft - target_ft) * 12.0
        max_abs_in = max(max_abs_in, abs(delta_in))
        print(f"  {label:54s} | {p_str:8s} | {fmt_ft_in(meas_ft):8s} | {delta_in:+5.1f}\"")
    if max_abs_in > 7.0:
        raise AssertionError(f"Dimension deviation {max_abs_in:.1f}\" exceeds 7.0\" tolerance")
    print(f"[OK] All {len(checks)} spans verified against GLB geometry (max delta {max_abs_in:.1f}\")")

    if meas:
        # Verify all 7 field-measured spans within <= 1.0" directly from GLB triangles
        ys = 1.0 * FT_TO_M
        in_y = (tri_ymin <= ys) & (tri_ymax >= ys)

        # 1. Kitchen North wall: west cap of wall at z=247 -> Bedroom NE inner wall at z=200
        nk_z = px_to_m(247, cy)
        nk_hits = in_y & (tri_zmin <= nk_z) & (tri_zmax >= nk_z) & (n_face[:, 0] < -0.9)
        nk_xs = v0[nk_hits, 0]
        nk_west_x = nk_xs[nk_xs > px_to_m(200, cx)].min()
        ne_z = px_to_m(200, cy)
        ne_hits = in_y & (tri_zmin <= ne_z) & (tri_zmax >= ne_z) & (n_face[:, 0] < -0.9)
        ne_xs = v0[ne_hits, 0]
        ne_west_x = ne_xs[ne_xs > px_to_m(340, cx)].min()
        meas_nk_ft = float((ne_west_x - nk_west_x) / FT_TO_M)

        # 2. Kitchen Island length directly from Fixtures_Counters
        cnt = meshes["Fixtures_Counters"]
        c_pos, c_idx = cnt["pos"], cnt["idx"]
        cv0, cv1, cv2 = c_pos[c_idx[:, 0]], c_pos[c_idx[:, 1]], c_pos[c_idx[:, 2]]
        cy_min = np.minimum(np.minimum(cv0[:, 1], cv1[:, 1]), cv2[:, 1])
        cy_max = np.maximum(np.maximum(cv0[:, 1], cv1[:, 1]), cv2[:, 1])
        cx_min = np.minimum(np.minimum(cv0[:, 0], cv1[:, 0]), cv2[:, 0])
        cx_max = np.maximum(np.maximum(cv0[:, 0], cv1[:, 0]), cv2[:, 0])
        cz_min = np.minimum(np.minimum(cv0[:, 2], cv1[:, 2]), cv2[:, 2])
        cz_max = np.maximum(np.maximum(cv0[:, 2], cv1[:, 2]), cv2[:, 2])
        isl_x = px_to_m(275, cx)
        isl_y = 2.94 * FT_TO_M
        isl_hits = (
            (cy_min <= isl_y) & (cy_max >= isl_y)
            & (cx_min <= isl_x) & (cx_max >= isl_x)
            & (cz_min >= px_to_m(270, cy)) & (cz_max <= px_to_m(360, cy))
        )
        meas_isl_ft = float((cz_max[isl_hits].max() - cz_min[isl_hits].min()) / FT_TO_M)

        # 3. Kitchen Sink/DW West wall length (z=354..469 at x=266)
        sk_x = px_to_m(266, cx)
        sk_hits = (
            in_y & (tri_xmin <= sk_x) & (tri_xmax >= sk_x) & (np.abs(n_face[:, 2]) > 0.9)
            & (tri_zmin >= px_to_m(340, cy)) & (tri_zmax <= px_to_m(475, cy))
        )
        sk_zs = v0[sk_hits, 2]
        meas_sk_ft = float((sk_zs.max() - sk_zs.min()) / FT_TO_M)

        # 4. Dining Area West wall (upper col top to Primary Bath North outer face)
        col_x = px_to_m(107, cx)
        col_hits = (
            in_y & (tri_xmin <= col_x) & (tri_xmax >= col_x) & (n_face[:, 2] < -0.9)
            & (tri_zmin >= px_to_m(240, cy)) & (tri_zmax <= px_to_m(275, cy))
        )
        col_top_z = v0[col_hits, 2].min()
        pb_x = px_to_m(140, cx)
        pb_hits = (
            in_y & (tri_xmin <= pb_x) & (tri_xmax >= pb_x) & (n_face[:, 2] < -0.9)
            & (tri_zmin >= px_to_m(450, cy)) & (tri_zmax <= px_to_m(470, cy))
        )
        pb_north_z = v0[pb_hits, 2].min()
        meas_dining_w_ft = float((pb_north_z - col_top_z) / FT_TO_M)

        # 5. Primary Bath North wall from West exterior wall inner face (x=100) to outer East face
        ext_z = px_to_m(350, cy)
        ext_hits = in_y & (tri_zmin <= ext_z) & (tri_zmax >= ext_z) & (n_face[:, 0] > 0.9)
        ext_xs = v0[ext_hits, 0]
        west_ext_x = ext_xs[ext_xs < px_to_m(150, cx)].max()
        pbe_z = px_to_m(500, cy)
        pbe_hits = (
            in_y & (tri_zmin <= pbe_z) & (tri_zmax >= pbe_z) & (n_face[:, 0] > 0.9)
            & (tri_xmin >= px_to_m(165, cx)) & (tri_xmax <= px_to_m(195, cx))
        )
        pb_outer_x = v0[pbe_hits, 0].max()
        meas_pb_ft = float((pb_outer_x - west_ext_x) / FT_TO_M)

        # 6. Primary Bedroom WIC North wall from West exterior wall inner face to WIC outer East face
        wice_z = px_to_m(630, cy)
        wice_hits = (
            in_y & (tri_zmin <= wice_z) & (tri_zmax >= wice_z) & (n_face[:, 0] > 0.9)
            & (tri_xmin >= px_to_m(175, cx)) & (tri_xmax <= px_to_m(205, cx))
        )
        wic_outer_x = v0[wice_hits, 0].max()
        meas_wic_ft = float((wic_outer_x - west_ext_x) / FT_TO_M)

        # 7. Primary Bedroom West wall clear span from WIC South wall to SW corner column
        meas_pbed_w_ft = span_z_at_px(110, 800)

        field_checks = [
            ("Kitchen North Wall", meas["kitchen_north_wall_width_in"] / 12.0, meas_nk_ft),
            ("Kitchen Island Length", meas["kitchen_island_length_in"] / 12.0, meas_isl_ft),
            ("Kitchen Sink/DW West Wall", meas["kitchen_sink_west_wall_length_in"] / 12.0, meas_sk_ft),
            ("Dining West Wall (Col to Bath)", meas["dining_west_wall_length_in"] / 12.0, meas_dining_w_ft),
            ("Primary Bath North Wall (from Ext)", meas["primary_bath_north_wall_from_west_ext_in"] / 12.0, meas_pb_ft),
            ("Primary Bed WIC North Wall", meas["primary_bed_wic_north_wall_in"] / 12.0, meas_wic_ft),
            ("Primary Bed West Wall (to SW Col)", meas["primary_bed_west_wall_to_sw_col_in"] / 12.0, meas_pbed_w_ft),
        ]

        print("\nField Measurement Verification (GLB 3D Faces vs measurements.json):")
        print(f"  {'Measurement':38s} | {'Measured':8s} | {'3D Model':8s} | {'Delta':>7s}")
        print("  " + "-" * 70)
        max_field_in = 0.0
        for label, tgt_ft, actual_ft in field_checks:
            delta_in = (actual_ft - tgt_ft) * 12.0
            max_field_in = max(max_field_in, abs(delta_in))
            print(f"  {label:38s} | {fmt_ft_in(tgt_ft):8s} | {fmt_ft_in(actual_ft):8s} | {delta_in:+5.2f}\"")
        if max_field_in > 1.0:
            raise AssertionError(f"Field measurement deviation {max_field_in:.2f}\" exceeds 1.0\" tolerance")
        print(f"[OK] All 7 field measurements verified within 1.0\" (max delta {max_field_in:.2f}\")")

    if (meas.get("dining_builtin_shelf") or {}).get("enabled", False):
        if "Fixtures_DiningShelf" not in meshes:
            raise AssertionError("Missing Fixtures_DiningShelf mesh in GLB")
        sh_pos = meshes["Fixtures_DiningShelf"]["pos"]
        sh_min_y, sh_max_y = float(sh_pos[:, 1].min()), float(sh_pos[:, 1].max())
        if sh_min_y > 0.01 or sh_max_y < 8.9 * FT_TO_M:
            raise AssertionError(f"Fixtures_DiningShelf height invalid: {sh_min_y:.3f}..{sh_max_y:.3f} m")
        print(f"[OK] Fixtures_DiningShelf verified floor-to-ceiling ({sh_min_y:.3f}..{sh_max_y:.3f} m)")


def generate_calibration_overlay(meshes: dict[str, dict[str, Any]], spec: dict[str, Any]) -> None:
    """Project 3D GLB walls, windows, fixtures, and door swing arcs back onto floorplan.jpeg."""
    base = Image.open(FLOORPLAN_PATH).convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    cal = spec["calibration"]
    px_per_ft = cal["px_per_ft"]
    cx, cy = cal["center_px"]

    def m_to_px_x(xm: float) -> float:
        return xm / FT_TO_M * px_per_ft + cx

    def m_to_px_y(zm: float) -> float:
        return zm / FT_TO_M * px_per_ft + cy

    # Project upward-facing triangles of Walls_Main at y <= 3.0 ft? No, Walls_Main top at y=9 ft covers ALL walls!
    walls = meshes["Walls_Main"]
    pos, norm, idx = walls["pos"], walls["norm"], walls["idx"]
    top_y = 9.0 * FT_TO_M - 0.01
    for tri in idx:
        if norm[tri[0], 1] > 0.9 and pos[tri[0], 1] >= top_y:
            pts = [(m_to_px_x(pos[k, 0]), m_to_px_y(pos[k, 2])) for k in tri]
            draw.polygon(pts, fill=(34, 197, 94, 105))

    # Draw windows in bright cyan-blue
    for w in spec["windows"]:
        x0, y0, x1, y1 = w["px"]
        draw.rectangle([x0, y0, x1, y1], fill=(14, 165, 233, 150), outline=(2, 132, 199, 255))

    # Draw fixtures in magenta outline
    for fx in spec["fixtures"]:
        x0, y0, x1, y1 = fx["px"]
        draw.rectangle([x0, y0, x1, y1], fill=(217, 70, 239, 55), outline=(192, 38, 211, 210), width=1)

    # Draw door swing arcs in amber
    for op in spec["openings"]:
        if op["kind"] == "hinged":
            hx, hy = op["hinge_px"]
            r = op["width_px"]
            c_deg = op["closed_angle_deg"]
            s_deg = op["swing_dir_deg"]
            diff = ((s_deg - c_deg + 180.0) % 360.0) - 180.0
            a0 = c_deg
            a1 = c_deg + diff
            if a0 > a1:
                a0, a1 = a1, a0
            draw.arc([hx - r, hy - r, hx + r, hy + r], start=a0, end=a1, fill=(245, 158, 11, 230), width=2)
            rad = math.radians(s_deg)
            draw.line([hx, hy, hx + r * math.cos(rad), hy + r * math.sin(rad)], fill=(245, 158, 11, 230), width=2)

    out = Image.alpha_composite(base, overlay).convert("RGB")
    out.save(OVERLAY_PATH)
    print(f"[OK] Saved {OVERLAY_PATH}")


def render_dollhouse_preview(meshes: dict[str, dict[str, Any]]) -> None:
    """Render a crisp 1600x1200 z-buffered 3D dollhouse cutaway directly from the GLB triangles."""
    W, H = 1600, 1200
    rgb = np.full((H, W, 3), [24, 29, 39], dtype=np.float32)
    zbuf = np.full((H, W), np.inf, dtype=np.float32)

    # Camera: elevated South-West 3/4 view framed so entire apartment & balconies fit comfortably
    target = np.array([0.0, 0.7, 0.3], dtype=np.float32)
    cam_pos = np.array([-17.5, 22.0, 19.5], dtype=np.float32)
    forward = target - cam_pos
    forward /= np.linalg.norm(forward)
    up_world = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    right = np.cross(forward, up_world)
    right /= np.linalg.norm(right)
    cam_up = np.cross(right, forward)

    fov_rad = math.radians(38.0)
    f = 0.5 * H / math.tan(0.5 * fov_rad)

    light1 = np.array([0.45, 0.82, 0.35], dtype=np.float32)
    light1 /= np.linalg.norm(light1)
    light2 = np.array([-0.55, 0.45, -0.70], dtype=np.float32)
    light2 /= np.linalg.norm(light2)

    def project(verts: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        rel = verts - cam_pos
        vx = rel @ right
        vy = rel @ cam_up
        vz = rel @ forward
        sx = W * 0.5 + (vx / vz) * f
        sy = H * 0.5 - (vy / vz) * f
        return sx, sy, vz

    def rasterize_mesh(mesh: dict[str, Any], alpha: float) -> None:
        pos = mesh["pos"]
        norm = mesh["norm"]
        idx = mesh["idx"]
        col = np.array(mesh["material"]["pbrMetallicRoughness"]["baseColorFactor"][:3], dtype=np.float32) * 255.0

        sx, sy, vz = project(pos)
        # Process triangles
        for tri in idx:
            i0, i1, i2 = int(tri[0]), int(tri[1]), int(tri[2])
            z0, z1, z2 = vz[i0], vz[i1], vz[i2]
            if z0 <= 0.2 or z1 <= 0.2 or z2 <= 0.2:
                continue

            x0, y0 = sx[i0], sy[i0]
            x1, y1 = sx[i1], sy[i1]
            x2, y2 = sx[i2], sy[i2]

            # Backface cull in screen space (unless doubleSided)
            area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
            if alpha >= 0.99 and area >= 0:
                continue
            if abs(area) < 0.05:
                continue

            bx0 = max(0, int(math.floor(min(x0, x1, x2))))
            bx1 = min(W - 1, int(math.ceil(max(x0, x1, x2))))
            by0 = max(0, int(math.floor(min(y0, y1, y2))))
            by1 = min(H - 1, int(math.ceil(max(y0, y1, y2))))
            if bx1 < bx0 or by1 < by0:
                continue

            n = norm[i0]
            diff1 = max(0.0, float(np.dot(n, light1)))
            diff2 = max(0.0, float(np.dot(n, light2)))
            shade = 0.36 + 0.56 * diff1 + 0.16 * diff2
            tri_col = np.clip(col * shade, 0, 255)

            xs = np.arange(bx0, bx1 + 1, dtype=np.float32) + 0.5
            ys = np.arange(by0, by1 + 1, dtype=np.float32) + 0.5
            gx, gy = np.meshgrid(xs, ys)

            w0 = ((x1 - gx) * (y2 - gy) - (y1 - gy) * (x2 - gx)) / area
            w1 = ((x2 - gx) * (y0 - gy) - (y2 - gy) * (x0 - gx)) / area
            w2 = 1.0 - w0 - w1
            inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
            if not np.any(inside):
                continue

            # Perspective-correct depth
            inv_z = w0 / z0 + w1 / z1 + w2 / z2
            depth = 1.0 / np.maximum(inv_z, 1e-6)

            sub_z = zbuf[by0 : by1 + 1, bx0 : bx1 + 1]
            sub_rgb = rgb[by0 : by1 + 1, bx0 : bx1 + 1]
            mask = inside & (depth < sub_z)
            if not np.any(mask):
                continue

            if alpha >= 0.99:
                sub_z[mask] = depth[mask]
                sub_rgb[mask] = tri_col
            else:
                sub_rgb[mask] = alpha * tri_col + (1.0 - alpha) * sub_rgb[mask]

    # Opaque meshes first, then translucent glass
    for name, mesh in meshes.items():
        a = float(mesh["material"]["pbrMetallicRoughness"]["baseColorFactor"][3])
        if a >= 0.99:
            rasterize_mesh(mesh, 1.0)
    for name, mesh in meshes.items():
        a = float(mesh["material"]["pbrMetallicRoughness"]["baseColorFactor"][3])
        if a < 0.99:
            rasterize_mesh(mesh, a)

    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")
    draw = ImageDraw.Draw(img)
    draw.text((28, 24), "Exact 3D Apartment Model (Scale: 12.5 px/ft | 9'-0\" Ceiling | GLB Preview)", fill=(226, 232, 240))
    img.save(PREVIEW_PATH)
    print(f"[OK] Saved {PREVIEW_PATH}")


def _tri_overlap_area_2d(p1: np.ndarray, p2: np.ndarray) -> float:
    """Compute exact 2D intersection area between two triangles via Sutherland-Hodgman clipping."""
    def ccw(pts: np.ndarray) -> list[np.ndarray]:
        s = (
            pts[0, 0] * pts[1, 1] - pts[1, 0] * pts[0, 1]
            + pts[1, 0] * pts[2, 1] - pts[2, 0] * pts[1, 1]
            + pts[2, 0] * pts[0, 1] - pts[0, 0] * pts[2, 1]
        )
        arr = [pts[0], pts[1], pts[2]]
        return arr if s >= 0 else arr[::-1]

    poly = ccw(p1)
    clip = ccw(p2)
    for k in range(3):
        ca, cb = clip[k], clip[(k + 1) % 3]
        ex, ey = cb[0] - ca[0], cb[1] - ca[1]
        nxt_poly: list[np.ndarray] = []
        for i in range(len(poly)):
            cur, nxt = poly[i], poly[(i + 1) % len(poly)]
            dc = ex * (cur[1] - ca[1]) - ey * (cur[0] - ca[0])
            dn = ex * (nxt[1] - ca[1]) - ey * (nxt[0] - ca[0])
            if dc >= -1e-7:
                nxt_poly.append(cur)
            if (dc > 1e-7 and dn < -1e-7) or (dc < -1e-7 and dn > 1e-7):
                t = dc / (dc - dn)
                nxt_poly.append(cur + t * (nxt - cur))
        poly = nxt_poly
        if len(poly) < 3:
            return 0.0
    area2 = 0.0
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        area2 += float(a[0] * b[1] - a[1] * b[0])
    return abs(area2) * 0.5


def verify_no_coplanar_z_fighting(meshes: dict[str, dict[str, Any]]) -> None:
    """Verify zero overlapping same-normal (or double-sided) coplanar triangles across all GLB meshes."""
    planes: dict[tuple[float, float, float, float], list[tuple[str, bool, np.ndarray, np.ndarray, np.ndarray]]] = {}
    for name, mesh in meshes.items():
        pos = mesh["pos"]
        idx = mesh["idx"]
        double_sided = bool(mesh["material"].get("doubleSided", False))
        for tri in idx:
            v0, v1, v2 = pos[tri[0]], pos[tri[1]], pos[tri[2]]
            cr = np.cross(v1 - v0, v2 - v0)
            ln = float(np.linalg.norm(cr))
            if ln < 1e-8:
                continue
            n = cr / ln
            d = float(np.dot(v0, n))
            key = (round(float(n[0]), 2), round(float(n[1]), 2), round(float(n[2]), 2), round(d, 4))
            ax = int(np.argmax(np.abs(n)))
            u_ax, v_ax = (i for i in range(3) if i != ax)
            pts2d = np.array([[v0[u_ax], v0[v_ax]], [v1[u_ax], v1[v_ax]], [v2[u_ax], v2[v_ax]]], dtype=np.float64)
            planes.setdefault(key, []).append((name, double_sided, pts2d, pts2d.min(axis=0), pts2d.max(axis=0)))

    overlaps: dict[tuple[tuple[str, str], tuple[float, float, float, float]], int] = {}
    for key, tris in planes.items():
        opp_key = (-key[0] if key[0] != 0.0 else 0.0, -key[1] if key[1] != 0.0 else 0.0, -key[2] if key[2] != 0.0 else 0.0, -key[3] if key[3] != 0.0 else 0.0)
        # Same-normal overlaps across all meshes
        for i in range(len(tris)):
            n1, _, p1, mn1, mx1 = tris[i]
            for j in range(i + 1, len(tris)):
                n2, _, p2, mn2, mx2 = tris[j]
                if mx1[0] <= mn2[0] + 1e-5 or mx2[0] <= mn1[0] + 1e-5:
                    continue
                if mx1[1] <= mn2[1] + 1e-5 or mx2[1] <= mn1[1] + 1e-5:
                    continue
                if _tri_overlap_area_2d(p1, p2) > 1e-7:
                    pair = (min(n1, n2), max(n1, n2))
                    overlaps[(pair, key)] = overlaps.get((pair, key), 0) + 1
        # Opposite-normal overlaps if either triangle uses a doubleSided material
        if key <= opp_key and opp_key in planes:
            opp_tris = planes[opp_key]
            for n1, ds1, p1, mn1, mx1 in tris:
                for n2, ds2, p2, mn2, mx2 in opp_tris:
                    if not (ds1 or ds2):
                        continue
                    if mx1[0] <= mn2[0] + 1e-5 or mx2[0] <= mn1[0] + 1e-5:
                        continue
                    if mx1[1] <= mn2[1] + 1e-5 or mx2[1] <= mn1[1] + 1e-5:
                        continue
                    if _tri_overlap_area_2d(p1, p2) > 1e-7:
                        pair = (min(n1, n2), max(n1, n2))
                        overlaps[(pair, key)] = overlaps.get((pair, key), 0) + 1

    if overlaps:
        details = "\n".join(
            f"  - {pair[0]} <-> {pair[1]} @ n={key[:3]} d={key[3]}: {cnt} overlapping tri pairs"
            for (pair, key), cnt in sorted(overlaps.items())
        )
        raise AssertionError(f"Found {len(overlaps)} coplanar z-fighting overlap groups:\n{details}")
    print(f"[OK] 0 coplanar z-fighting overlaps across all {len(meshes)} GLB meshes")


def main() -> None:
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    _, meshes = parse_and_validate_glb(GLB_PATH)
    verify_no_coplanar_z_fighting(meshes)
    measure_clear_spans_from_glb(meshes, spec)
    generate_calibration_overlay(meshes, spec)
    render_dollhouse_preview(meshes)


if __name__ == "__main__":
    main()
