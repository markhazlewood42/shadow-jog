"""Rook as a low-poly model, built from code, with a rig and keyframed motions (Blender 4.x Python).

Nothing here is downloaded: every vertex is made by this file. Units: Rook is about 3.3 tall, feet on z = 0, front toward -Y,
Rook's left side toward +X (the katana sheath is at his left hip, as in the given frame).
Each mesh carries a part tag from `scripts/art/pipeline/decompose.mjs` PARTS (plus 'blade' for the drawn katana of the battle poses).
"""
import math

import bpy
import bmesh
from mathutils import Matrix, Vector, Euler

PARTS = ["hair", "skin", "lenses", "beard", "coat", "sleeves", "zipper", "hands", "legs", "boots", "sheath", "guard", "wrap", "blade"]
PART_ID = {p: i + 1 for i, p in enumerate(PARTS)}  # 0 is empty


# ---------------------------------------------------------------------------------------------------------------- meshes
def _finish(obj, part, bone, bevel=0.0, smooth=True):
    obj["part"] = part
    obj["bone"] = bone
    if bevel:
        m = obj.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = 2
        m.limit_method = "NONE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def box(name, part, bone, c, size, bevel=0.1, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=c)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.rotation_euler = Euler([math.radians(a) for a in rot])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return _finish(o, part, bone, bevel)


def ball(name, part, bone, c, radii, rot=(0, 0, 0), segs=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1.0, location=c)
    o = bpy.context.active_object
    o.name = name
    o.scale = radii
    o.rotation_euler = Euler([math.radians(a) for a in rot])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return _finish(o, part, bone)


def rod(name, part, bone, p0, p1, thick):
    """A box between two points in the XZ plane (long axis from p0 to p1)."""
    d = p1 - p0
    ang = math.degrees(math.atan2(d.x, d.z))  # turn about +Y that takes +Z onto d
    return box(name, part, bone, tuple((p0 + p1) / 2), (thick, thick, d.length), bevel=0.04, rot=(0, ang, 0))


def build_meshes():
    """All parts at the rest pose. Returns {name: object}."""
    o = {}
    # head (bone 'head')
    o["hair"] = ball("hair", "hair", "head", (0, 0.24, 2.62), (0.72, 0.58, 0.64))
    o["face"] = ball("face", "skin", "head", (0, -0.1, 2.28), (0.54, 0.52, 0.56))
    o["beard"] = ball("beard", "beard", "head", (0, -0.28, 2.0), (0.42, 0.36, 0.3))
    o["glasses"] = box("glasses", "lenses", "head", (0, -0.6, 2.38), (0.86, 0.14, 0.28), bevel=0.04)
    # torso (bone 'spine')
    o["coat"] = box("coat", "coat", "spine", (0, 0.0, 1.45), (1.5, 0.85, 1.1), bevel=0.14)
    o["skirt"] = box("skirt", "coat", "pelvis", (0, 0.0, 0.98), (1.7, 0.9, 0.5), bevel=0.12)
    o["zipper"] = box("zipper", "zipper", "spine", (0, -0.47, 1.42), (0.42, 0.06, 1.0), bevel=0.02)
    # arms (bones upperarm/forearm, L is +X)
    for s, side in ((1, "L"), (-1, "R")):
        o["upper" + side] = box("upper" + side, "sleeves", "upperarm." + side, (1.0 * s, 0, 1.6), (0.46, 0.52, 0.8), bevel=0.1)
        o["fore" + side] = box("fore" + side, "sleeves", "forearm." + side, (1.0 * s, 0, 0.98), (0.42, 0.46, 0.62), bevel=0.1)
        o["hand" + side] = ball("hand" + side, "hands", "forearm." + side, (1.0 * s, 0, 0.6), (0.24, 0.24, 0.24), segs=8, rings=6)
        # legs
        o["thigh" + side] = box("thigh" + side, "legs", "thigh." + side, (0.3 * s, 0, 0.72), (0.52, 0.52, 0.5), bevel=0.08)
        o["shin" + side] = box("shin" + side, "legs", "shin." + side, (0.3 * s, 0, 0.4), (0.46, 0.46, 0.2), bevel=0.05)
        o["boot" + side] = box("boot" + side, "boots", "shin." + side, (0.3 * s, -0.04, 0.17), (0.54, 0.72, 0.36), bevel=0.1)
    # katana on the back: sheath from the left hip (+X, low) up to the hilt over the right shoulder (-X, high)
    p0, p1, p2 = Vector((0.65, 0.62, 0.85)), Vector((-0.75, 0.62, 2.25)), Vector((-1.3, 0.62, 2.8))
    o["sheath"] = rod("sheath", "sheath", "spine", p0, p1, 0.24)
    o["guard"] = rod("guard", "guard", "spine", p1 - (p2 - p1).normalized() * 0.04, p1 + (p2 - p1).normalized() * 0.1, 0.48)
    o["wrap"] = rod("wrap", "wrap", "spine", p1 + (p2 - p1).normalized() * 0.1, p2, 0.22)
    # drawn katana (battle poses only), modelled at the origin along +Z; the handle is z -0.55 to 0, the blade 0 to 2.5
    o["blade"] = box("blade", "blade", "weapon", (0, 0, 1.3), (0.1, 0.34, 2.5), bevel=0.02)
    o["bguard"] = box("bguard", "guard", "weapon", (0, 0, 0.0), (0.3, 0.5, 0.1), bevel=0.03)
    o["bwrap"] = box("bwrap", "wrap", "weapon", (0, 0, -0.28), (0.2, 0.22, 0.56), bevel=0.04)
    return o


FIELD_ONLY = ("sheath", "guard", "wrap")  # the back katana; hidden in battle poses
BATTLE_ONLY = ("blade", "bguard", "bwrap")


# ---------------------------------------------------------------------------------------------------------------- rig
BONES = {
    # name: (head, tail, parent)
    "root": ((0, 0, 0), (0, 0, 0.3), None),
    "pelvis": ((0, 0, 0.95), (0, 0, 1.2), "root"),
    "spine": ((0, 0, 1.2), (0, 0, 1.9), "pelvis"),
    "head": ((0, 0, 1.9), (0, 0, 3.3), "spine"),
    "thigh.L": ((0.3, 0, 0.95), (0.3, 0, 0.5), "pelvis"),
    "shin.L": ((0.3, 0, 0.5), (0.3, 0, 0.0), "thigh.L"),
    "thigh.R": ((-0.3, 0, 0.95), (-0.3, 0, 0.5), "pelvis"),
    "shin.R": ((-0.3, 0, 0.5), (-0.3, 0, 0.0), "thigh.R"),
    "upperarm.L": ((1.0, 0, 1.92), (1.0, 0, 1.22), "spine"),
    "forearm.L": ((1.0, 0, 1.22), (1.0, 0, 0.6), "upperarm.L"),
    "upperarm.R": ((-1.0, 0, 1.92), (-1.0, 0, 1.22), "spine"),
    "forearm.R": ((-1.0, 0, 1.22), (-1.0, 0, 0.6), "upperarm.R"),
    "weapon": ((0, 0, 0), (0, 0, 0.5), "root"),
}
ARM_LEN = (0.7, 0.62)  # upper arm and forearm lengths


def build_rig(meshes):
    arm_data = bpy.data.armatures.new("rook_rig")
    rig = bpy.data.objects.new("rook_rig", arm_data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, par) in BONES.items():
        b = arm_data.edit_bones.new(name)
        b.head, b.tail = Vector(h), Vector(t)
        b.roll = 0.0
        if par:
            b.parent = arm_data.edit_bones[par]
    bpy.ops.object.mode_set(mode="OBJECT")
    for name, ob in meshes.items():
        bone = ob["bone"]
        vg = ob.vertex_groups.new(name=bone)
        vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
        mod = ob.modifiers.new("rig", "ARMATURE")
        mod.object = rig
        ob.parent = rig
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return rig


# ---------------------------------------------------------------------------------------------------------------- motions
def _rest_matrix(rig, name):
    return rig.data.bones[name].matrix_local.to_3x3()


def rot_local(rig, name, axis, deg):
    """A pose-bone quaternion for a turn of `deg` about the rest-frame `axis` ('x', 'y', 'z') of the bone's parent chain."""
    R = _rest_matrix(rig, name)
    ax = {"x": Vector((1, 0, 0)), "y": Vector((0, 1, 0)), "z": Vector((0, 0, 1))}[axis]
    turn = Matrix.Rotation(math.radians(deg), 3, ax)
    return (R.inverted() @ turn @ R).to_quaternion()


def reset_pose(rig):
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)


def set_pose(rig, spec):
    """spec: {bone: [(axis, deg), ...] or ('loc', (x, y, z))}. Turns compose in the order given."""
    reset_pose(rig)
    for name, ops in spec.items():
        pb = rig.pose.bones[name]
        q = pb.rotation_quaternion.copy()
        for kind, v in ops:
            if kind == "loc":
                pb.location = Vector(v)
            else:
                q = q @ rot_local(rig, name, kind, v)
        pb.rotation_quaternion = q


def _solve_arm(rig, side, target, pole=(0, 0, -1)):
    """Point the two arm bones so the hand ends at `target` (armature space). Two-bone analytic solve, elbow toward `pole`."""
    up = rig.pose.bones["upperarm." + side]
    fo = rig.pose.bones["forearm." + side]
    shoulder = Vector(BONES["upperarm." + side][0])
    # shoulder follows the spine pose, so work from its current pose-space head
    shoulder = up.head.copy()
    t = Vector(target) - shoulder
    d = min(t.length, (ARM_LEN[0] + ARM_LEN[1]) * 0.999)
    dirn = t.normalized()
    a, b = ARM_LEN
    cos_a = max(-1.0, min(1.0, (a * a + d * d - b * b) / (2 * a * d)))
    ang = math.acos(cos_a)
    pole_v = (Vector(pole) - dirn * Vector(pole).dot(dirn)).normalized()
    elbow_dir = (dirn * math.cos(ang) + pole_v * math.sin(ang)).normalized()
    elbow = shoulder + elbow_dir * a
    hand = shoulder + dirn * d
    for pb, h, tl in ((up, shoulder, elbow), (fo, elbow, hand)):
        y = (tl - h).normalized()
        # bone Y axis along the segment, keep X as close to the armature X as possible
        x = Vector((1, 0, 0)) - y * y.x
        if x.length < 1e-4:
            x = Vector((0, 1, 0))
        x.normalize()
        z = x.cross(y).normalized()
        x = y.cross(z).normalized()
        m = Matrix(((x.x, y.x, z.x, h.x), (x.y, y.y, z.y, h.y), (x.z, y.z, z.z, h.z), (0, 0, 0, 1)))
        pb.matrix = m
        bpy.context.view_layer.update()


def _weapon_pose(rig, grip, direction, roll_axis=(1, 0, 0)):
    """Place the katana: handle origin at `grip`, blade along `direction` (armature space)."""
    pb = rig.pose.bones["weapon"]
    y = Vector(direction).normalized()
    x = (Vector(roll_axis) - y * Vector(roll_axis).dot(y)).normalized()
    z = x.cross(y).normalized()
    m = Matrix(((x.x, y.x, z.x, grip[0]), (x.y, y.y, z.y, grip[1]), (x.z, y.z, z.z, grip[2]), (0, 0, 0, 1)))
    pb.matrix = m
    bpy.context.view_layer.update()


# Walk: 0 = passing (given pose: feet closest), 1 = contact, 2 = passing (other leg), 3 = contact (other leg). X turns, negative = forward.
def walk_specs():
    def frame(l_th, l_sh, r_th, r_sh, arm, bob):
        return {
            "pelvis": [("loc", (0, 0, bob))],
            "thigh.L": [("x", l_th)], "shin.L": [("x", l_sh)],
            "thigh.R": [("x", r_th)], "shin.R": [("x", r_sh)],
            "upperarm.L": [("x", arm)], "upperarm.R": [("x", -arm)],
            "forearm.L": [("x", -abs(arm) * 0.3)], "forearm.R": [("x", -abs(arm) * 0.3)],
        }
    return [
        frame(0, 0, -24, 38, 0, 0.05),
        frame(-30, 4, 24, 10, 26, -0.04),
        frame(-24, 38, 0, 0, 0, 0.05),
        frame(24, 10, -30, 4, -26, -0.04),
    ]


def battle_specs(rig):
    """Two poses: 'ready' (guard, blade up and forward) and 'downSwing' (strike, blade down and forward)."""
    out = {}
    # body stance (armature space; front is -Y)
    stance = {
        "pelvis": [("loc", (0, 0, -0.18))],
        "spine": [("x", -14)],
        "head": [("x", 8)],
        "thigh.L": [("x", 30), ("z", 14)], "shin.L": [("x", -34)],
        "thigh.R": [("x", -40), ("z", -10)], "shin.R": [("x", 46)],
    }
    out["ready"] = (stance, (0.1, -0.95, 1.55), (0.0, -0.5, 0.86))
    stance2 = {
        "pelvis": [("loc", (0, -0.1, -0.3))],
        "spine": [("x", -30)],
        "head": [("x", 14)],
        "thigh.L": [("x", 36), ("z", 14)], "shin.L": [("x", -36)],
        "thigh.R": [("x", -56), ("z", -10)], "shin.R": [("x", 62)],
    }
    out["downSwing"] = (stance2, (0.0, -0.8, 1.35), (0.0, -0.62, -0.78))
    return out


def apply_battle(rig, spec):
    stance, grip, direction = spec
    set_pose(rig, stance)
    bpy.context.view_layer.update()
    _weapon_pose(rig, grip, direction)
    d = Vector(direction).normalized()
    g = Vector(grip)
    # right hand toward the guard end, left hand on the pommel end of the handle
    _solve_arm(rig, "R", g - d * 0.12 + Vector((-0.04, 0, 0)), pole=(-0.6, 0.3, -1.0))
    _solve_arm(rig, "L", g - d * 0.42 + Vector((0.04, 0, 0)), pole=(0.6, 0.3, -1.0))


def key_all(rig, frame):
    for pb in rig.pose.bones:
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("rotation_quaternion", frame=frame)


def keyframe_motions(rig):
    """Insert the motions as keyframes of one timeline. Returns {'walk': [f1..f4], 'ready': f, 'downSwing': f}."""
    sc = bpy.context.scene
    walk_frames = []
    for i, spec in enumerate(walk_specs()):
        set_pose(rig, spec)
        key_all(rig, 1 + i)
        walk_frames.append(1 + i)
    frames = {"walk": walk_frames}
    for k, (name, spec) in enumerate(battle_specs(rig).items()):
        apply_battle(rig, spec)
        key_all(rig, 11 + k)
        frames[name] = 11 + k
    if rig.animation_data and rig.animation_data.action:
        for fc in rig.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "CONSTANT"
    sc.frame_start, sc.frame_end = 1, 12
    return frames
