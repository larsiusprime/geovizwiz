#!/usr/bin/env python
"""
Authoritative print-readiness check for exported STL/OBJ models.

Reports the strict-manifold verdict (watertight + consistent winding + positive
volume = a valid solid), independent of the app's own self-check. This is the
ground-truth geometric gate; the actual slicer (PrusaSlicer) is the ground-truth
*printability* gate, which is more lenient.

Requires: pip install trimesh
Usage:    python tools/verify-stl.py model.stl [more.stl ...]
Exit code: 0 if every file is a valid solid, 1 otherwise.
"""
import sys

try:
    import trimesh
except ImportError:
    sys.exit("trimesh not installed — run: pip install trimesh")


def check(path: str) -> bool:
    m = trimesh.load(path)
    ok = bool(m.is_volume)
    print(f"{path}")
    print(f"  triangles  : {len(m.faces)}")
    print(f"  bodies     : {m.body_count}")
    print(f"  watertight : {m.is_watertight}")
    print(f"  winding OK : {m.is_winding_consistent}")
    print(f"  valid solid: {ok}  (watertight + consistent winding + positive volume)")
    if ok:
        print(f"  volume(mm3): {round(m.volume, 2)}")
    bounds = m.bounds
    print(f"  size (mm)  : {[round(d, 2) for d in (bounds[1] - bounds[0])]}")
    print(f"  => {'PASS (strict manifold solid)' if ok else 'FAIL (not a strict manifold -- slicers usually still repair and print)'}")
    return ok


if __name__ == "__main__":
    paths = sys.argv[1:]
    if not paths:
        sys.exit(__doc__)
    results = [check(p) for p in paths]
    sys.exit(0 if all(results) else 1)
