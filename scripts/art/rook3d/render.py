"""Render Rook from the model at 8 facings, 32x32, as toon-lit, palette-locked, outlined pixel sprites (Blender 4.x, headless).

    blender --background --factory-startup --python scripts/art/rook3d/render.py -- --out <dir>

Two Cycles passes per frame, both with one sample and no anti-aliasing (a pixel is covered or it is not):
  1. part ID: every part is an emission color that encodes its ID;
  2. light: every part is white diffuse, lit by one sun fixed to the camera (from the top, a little right and front).
Python then turns the light value into 3 toon steps, picks the color from the part's ramp (palettes.json, colors of target.json only),
and paints the outline: every edge pixel of the silhouette becomes the near-black of its part. Nothing is edited by hand.
"""
import json
import math
import os
import struct
import sys
import zlib

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rook_model as rm  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGV[ARGV.index("--out") + 1] if "--out" in ARGV else os.path.join(HERE, "out")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

FACINGS = {"s": 0, "se": 45, "e": 90, "ne": 135, "n": 180, "nw": 225, "w": 270, "sw": 315}  # model yaw, degrees
FIELD = {"size": 32, "margin": 8, "pitch": 20.0, "target_h": 31}
BATTLE = {"w": 79, "h": 68, "pitch": 16.0, "yaw": 72.0, "ppu": 19.0, "origin": (39, 62)}
TOON = (0.30, 0.66)  # light value thresholds between dark/mid and mid/light
AMBIENT = 0.12
LIGHT_DIR = Vector((0.5, -0.45, 0.75)).normalized()  # toward the light, in camera-rig space (x right, -y toward the camera)


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


# ---------------------------------------------------------------------------------------------------------------- png io
def write_png(path, w, h, rgba):
    """Deterministic RGBA PNG: rgba is a list of h rows, each a list of w (r, g, b, a)."""
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in rgba)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)


def load_png(path):
    """Read an 8-bit PNG through Blender: returns (w, h, rows of (r, g, b, a) 0..255), row 0 on top. Colors are raw (Non-Color)."""
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    img.alpha_mode = "STRAIGHT"
    w, h = img.size
    px = list(img.pixels)
    rows = []
    for y in range(h):
        yy = h - 1 - y
        rows.append([tuple(int(round(px[(yy * w + x) * 4 + k] * 255)) for k in range(4)) for x in range(w)])
    bpy.data.images.remove(img)
    return w, h, rows


# ---------------------------------------------------------------------------------------------------------------- scene
def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = 1
    cy.use_adaptive_sampling = False
    cy.use_denoising = False
    cy.filter_width = 0.01
    cy.max_bounces = 0
    cy.seed = 0
    cy.use_animated_seed = False
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.render.image_settings.compression = 0
    sc.render.threads_mode = "FIXED"
    sc.render.threads = 1
    sc.view_settings.view_transform = "Raw"
    sc.view_settings.look = "None"
    sc.display_settings.display_device = "sRGB"
    sc.render.dither_intensity = 0.0
    sc.render.resolution_percentage = 100
    world = bpy.data.worlds.new("w")
    world.use_nodes = False
    world.color = (0, 0, 0)
    sc.world = world
    return sc


def make_materials(meshes):
    mats = {}
    for part, pid in rm.PART_ID.items():
        m = bpy.data.materials.new("id_" + part)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (pid / 255.0, 0, 0, 1)
        em.inputs["Strength"].default_value = 1.0
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs[0], out.inputs[0])
        mats[part] = m
    for ob in meshes.values():
        ob.data.materials.append(mats[ob["part"]])
    white = bpy.data.materials.new("white")
    white.use_nodes = True
    nt = white.node_tree
    nt.nodes.clear()
    df = nt.nodes.new("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = (1, 1, 1, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(df.outputs[0], out.inputs[0])
    return white


def make_camera_and_sun():
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.14159
    sun_data.angle = 0.0
    sun = bpy.data.objects.new("sun", sun_data)
    sc.collection.objects.link(sun)
    sun.rotation_euler = (-LIGHT_DIR).to_track_quat("-Z", "Y").to_euler()
    return cam, sun


def aim_camera(cam, pitch_deg, ppu, size_px, focus):
    """Orthographic camera looking at `focus` from the front (-Y) and above by `pitch_deg`; `ppu` pixels per model unit."""
    p = math.radians(pitch_deg)
    dist = 20.0
    cam.location = Vector(focus) + Vector((0, -math.cos(p), math.sin(p))) * dist
    d = Vector(focus) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = size_px[0] / ppu
    cam.data.clip_start, cam.data.clip_end = 0.1, 100.0
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = size_px


def render_pass(path, override):
    sc = bpy.context.scene
    bpy.context.view_layer.material_override = override
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return load_png(path)


# ---------------------------------------------------------------------------------------------------------------- compose
def toon_step(v):
    return 0 if v < TOON[0] else (1 if v < TOON[1] else 2)


def compose(idpass, lightpass, ramps, edges):
    """Return (rgba rows, label rows) from the two passes. Alpha is 0 or 255."""
    w, h, ids = idpass
    _, _, lit = lightpass
    names = rm.PARTS
    labels = [[None] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b, a = ids[y][x]
            if a >= 128 and r > 0:
                labels[y][x] = names[r - 1]
    out = [[(0, 0, 0, 0)] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            p = labels[y][x]
            if not p:
                continue
            v = min(1.0, lit[y][x][0] / 255.0 + AMBIENT)
            out[y][x] = hexrgb(ramps[p][toon_step(v)]) + (255,)
    # outline: the silhouette's edge pixels (4-neighborhood to transparent) take the near-black of their part
    for y in range(h):
        for x in range(w):
            p = labels[y][x]
            if not p:
                continue
            edge = any(not (0 <= yy < h and 0 <= xx < w) or labels[yy][xx] is None for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
            if edge:
                out[y][x] = hexrgb(edges[p]) + (255,)
    return out, labels


def bbox(labels):
    ys = [y for y, row in enumerate(labels) if any(row)]
    xs = [x for row in labels for x, v in enumerate(row) if v]
    if not ys:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def crop_window(rows, labels, x0, y0, w, h):
    def cut(g, empty):
        return [[g[y][x] if 0 <= y < len(g) and 0 <= x < len(g[0]) else empty for x in range(x0, x0 + w)] for y in range(y0, y0 + h)]
    return cut(rows, (0, 0, 0, 0)), cut(labels, None)


# ---------------------------------------------------------------------------------------------------------------- main
def main():
    setup_scene()
    meshes = rm.build_meshes()
    white = make_materials(meshes)
    rig = rm.build_rig(meshes)
    frames = rm.keyframe_motions(rig)
    cam, sun = make_camera_and_sun()
    pal = json.load(open(os.path.join(HERE, "palettes.json")))
    work = os.path.join(OUT, "_work")
    os.makedirs(work, exist_ok=True)
    sc = bpy.context.scene

    def show(back_katana, drawn_katana):
        for k, ob in meshes.items():
            hide = (k in rm.FIELD_ONLY and not back_katana) or (k in rm.BATTLE_ONLY and not drawn_katana)
            ob.hide_render = hide

    def shoot(frame, yaw, pitch, ppu, size_px, focus, ramp_key, back_katana, drawn_katana, tag):
        sc.frame_set(frame)
        rig.rotation_euler = (0, 0, math.radians(yaw))
        show(back_katana, drawn_katana)
        aim_camera(cam, pitch, ppu, size_px, focus)
        bpy.context.view_layer.update()
        a = render_pass(os.path.join(work, tag + "_id.png"), None)
        b = render_pass(os.path.join(work, tag + "_light.png"), white)
        return compose(a, b, pal[ramp_key]["ramps"], pal[ramp_key]["edge"])

    # fit: the pixels-per-unit that makes the passing-pose s facing 31 px tall (found once per run, deterministic)
    S, M = FIELD["size"], FIELD["margin"]
    big = S + 2 * M
    focus = (0, 0, 1.6)
    ppu = 10.0
    for _ in range(3):
        rows, labs = shoot(frames["walk"][0], 0, FIELD["pitch"], ppu, (big, big), focus, "walk", True, False, "fit")
        bb = bbox(labs)
        ppu = ppu * FIELD["target_h"] / (bb[3] - bb[1] + 1)
    manifest = {"ppu": ppu, "pitch": FIELD["pitch"], "light": list(LIGHT_DIR), "toon": list(TOON), "frames": []}

    for facing, yaw in FACINGS.items():
        for i, f in enumerate(frames["walk"]):
            rows, labs = shoot(f, yaw, FIELD["pitch"], ppu, (big, big), focus, "walk", True, False, "f")
            bb = bbox(labs)
            cx = (bb[0] + bb[2]) / 2.0
            # the window: x so the body origin column (the camera center) lands on column 16, y so the bottom row is row 30
            x0 = M
            y0 = bb[3] - 30
            rows, labs = crop_window(rows, labs, x0, y0, S, S)
            name = f"{facing}_walk{i}"
            write_png(os.path.join(OUT, "frames", name + ".png"), S, S, rows)
            json.dump([[v for v in r] for r in labs], open(os.path.join(OUT, "frames", name + ".labels.json"), "w"))
            manifest["frames"].append({"name": name, "facing": facing, "kind": "walk", "index": i, "size": [S, S], "palette": "walk", "yaw": yaw})

    W, H = BATTLE["w"], BATTLE["h"]
    ox, oy = BATTLE["origin"]
    bw, bh = W + 40, H + 40
    # the camera looks at the model origin (the ground point under Rook), which is the center of the big canvas;
    # the window is cut so that point lands on pixel (ox, oy)
    for pose in ("ready", "downSwing"):
        rows, labs = shoot(frames[pose], BATTLE["yaw"], BATTLE["pitch"], BATTLE["ppu"], (bw, bh), (0, 0, 0), "battle", False, True, "b")
        rows, labs = crop_window(rows, labs, bw // 2 - ox, bh // 2 - oy, W, H)
        name = f"battle_{pose}"
        write_png(os.path.join(OUT, "frames", name + ".png"), W, H, rows)
        json.dump(labs, open(os.path.join(OUT, "frames", name + ".labels.json"), "w"))
        manifest["frames"].append({"name": name, "facing": "e", "kind": "battle", "pose": pose, "size": [W, H], "palette": "battle", "yaw": BATTLE["yaw"]})

    # tag the model-space left hip side for the katana check: the katana's 3D centroid per facing, projected to camera x (px)
    kat = Vector((((0.65 - 0.75 - 1.3) / 3.0), 0.62, ((0.85 + 2.25 + 2.8) / 3.0)))
    for facing, yaw in FACINGS.items():
        a = math.radians(yaw)
        x_cam = kat.x * math.cos(a) - kat.y * math.sin(a)  # rotation about Z by yaw, then camera right = +X
        manifest.setdefault("katana_cam_x", {})[facing] = round(x_cam * ppu, 3)
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
    # blender saves a scratch .blend1? no; clean the passes
    for fn in os.listdir(work):
        os.remove(os.path.join(work, fn))
    os.rmdir(work)


main()
