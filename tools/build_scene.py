"""
Builds src/scene_data.js for the live app from assets/reference.webp.

It works out, at 480x380:
  scene.png   R,G = brush direction for everything that is NOT sky (sky is driven live by the physics)
              B   = sky mask (255 = sky)
  region.png  R   = region class * 32   (0 sky, 1 far hills, 2 near hills, 3 bushes, 4 village/ground, 5 cypress)
and embeds them, plus the reference itself, as data URLs so index.html works when double-clicked.

Run:  venv\\Scripts\\python.exe tools\\build_scene.py          (add --debug to write overlay pngs)
"""
import base64
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "reference.webp")
OUT = os.path.join(ROOT, "src", "scene_data.js")
DEBUG = "--debug" in sys.argv
SW, SH = 480, 380
ASPECT = 960 / 760

ref = cv2.imread(SRC)
assert ref is not None, SRC
ref = cv2.resize(ref, (960, 760), interpolation=cv2.INTER_AREA)
small = cv2.resize(ref, (SW, SH), interpolation=cv2.INTER_AREA)
u = (np.arange(SW) + 0.5) / SW
v = (np.arange(SH) + 0.5) / SH
U, V = np.meshgrid(u, v)
rng = np.random.default_rng(1889)


def curve(points, blur=0.010):
    pu, pv = zip(*points)
    col = np.interp(u, pu, pv).astype(np.float32)
    col = cv2.GaussianBlur(col.reshape(1, -1), (0, 0), SW * blur).reshape(-1)
    return col


# ridge lines, traced from the painting (v as a function of u)
hz1 = curve([(0, 0.73), (0.12, 0.75), (0.25, 0.71), (0.38, 0.725), (0.47, 0.705), (0.56, 0.665), (0.64, 0.63),
             (0.72, 0.645), (0.80, 0.60), (0.90, 0.545), (1.0, 0.50)])
hz2 = curve([(0, 0.80), (0.34, 0.80), (0.44, 0.765), (0.56, 0.74), (0.70, 0.705), (0.85, 0.665), (1.0, 0.625)])
hzb = curve([(0, 1.6), (0.34, 1.6), (0.43, 0.775), (0.65, 0.74), (1.0, 0.705)])
hzv = curve([(0, 1.6), (0.37, 1.6), (0.41, 0.865), (0.60, 0.875), (1.0, 0.89)])

# ---- cypress: dark, greenish blob on the left, found from the pixels themselves
lum = small.astype(np.float32) @ np.array([0.114, 0.587, 0.299], np.float32)
b, g, r = [small[..., i].astype(np.float32) for i in range(3)]
dark = (lum < 78) & (g + 3 >= b)
CYP_BOX = [(0.10, 0.03), (0.30, 0.03), (0.30, 0.42), (0.36, 0.60), (0.50, 0.80), (0.50, 1.0), (0.10, 1.0)]
box = np.zeros((SH, SW), np.uint8)
cv2.fillPoly(box, [np.array([(int(x * SW), int(y * SH)) for x, y in CYP_BOX], np.int32)], 255)
cyp = (dark & (box > 0)).astype(np.uint8)
cyp = cv2.morphologyEx(cyp, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
cyp = cv2.morphologyEx(cyp, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
n, lab, stats, _ = cv2.connectedComponentsWithStats(cyp)
if n > 1:
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    cyp = (lab == keep).astype(np.uint8)
cyp = cv2.GaussianBlur(cyp.astype(np.float32), (0, 0), 1.2) > 0.5
print(f"cypress covers {cyp.mean() * 100:.1f}% of the picture")

# ---- region classes
cls = np.zeros((SH, SW), np.uint8)
cls[V >= hz1[None, :]] = 1
cls[V >= hz2[None, :]] = 2
cls[(V >= hzb[None, :])] = 3
cls[(V >= hzv[None, :])] = 4
cls[(U < 0.40) & (V >= hz2[None, :])] = 4
cls[cyp] = 5

# ---- brush directions for the non-sky regions (physical space: x right, y down, square pixels)
FX = np.ones((SH, SW), np.float32)
FY = np.zeros((SH, SW), np.float32)


def ridge_dir(curve_1d):
    slope = np.gradient(curve_1d, 1.0 / SW) / ASPECT
    return np.tile(slope.astype(np.float32), (SH, 1))


wave = 0.22 * np.sin(2 * np.pi * (3 * U + 2 * V)).astype(np.float32)
m1, m2 = cls == 1, cls == 2
FY = np.where(m1, ridge_dir(hz1) + wave, FY)
FY = np.where(m2 | ((cls == 4) & (U < 0.40)), ridge_dir(hz2) + 0.6 * wave, FY)
FY = np.where(cls == 4, FY + 0.15 * wave, FY)

# bushes: little whirls (curl of smooth noise)
noise = cv2.GaussianBlur(rng.standard_normal((SH, SW)).astype(np.float32), (0, 0), 7)
gy_, gx_ = np.gradient(noise)
mb = cls == 3
FX = np.where(mb, gy_, FX)
FY = np.where(mb, -gx_, FY)

# cypress: strokes hug the silhouette and flow upward in a flame-like sway
dist = cv2.distanceTransform(cyp.astype(np.uint8), cv2.DIST_L2, 5)
gdy, gdx = np.gradient(cv2.GaussianBlur(dist, (0, 0), 3))
gm = np.hypot(gdx, gdy) + 1e-6
tx, ty = -gdy / gm, gdx / gm
flip = ty > 0
tx, ty = np.where(flip, -tx, tx), np.where(flip, -ty, ty)
sway = 0.55 * np.sin(2 * np.pi * (2.4 * V + 1.3 * U) + 0.6)
w_edge = np.exp(-dist / (0.045 * SW)).astype(np.float32)
cx_ = (1 - w_edge) * sway + w_edge * tx * 1.4
cy_ = (1 - w_edge) * -1.0 + w_edge * ty * 1.4
FX = np.where(cyp, cx_, FX)
FY = np.where(cyp, cy_, FY)

mag = np.hypot(FX, FY) + 1e-6
FX, FY = FX / mag, FY / mag
sky = (cls == 0)
FX = np.where(sky, 0, FX)
FY = np.where(sky, 0, FY)

sky_mask = cv2.GaussianBlur(sky.astype(np.float32), (0, 0), 1.3)
scene = np.zeros((SH, SW, 4), np.uint8)
scene[..., 0] = np.clip((FX * 0.5 + 0.5) * 255, 0, 255)
scene[..., 1] = np.clip((FY * 0.5 + 0.5) * 255, 0, 255)
scene[..., 2] = np.clip(sky_mask * 255, 0, 255)
scene[..., 3] = 255
region = np.zeros((SH, SW, 4), np.uint8)
region[..., 0] = cls * 32
region[..., 3] = 255


def png_url(rgba):
    bgra = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)
    ok, buf = cv2.imencode(".png", bgra)
    return "data:image/png;base64," + base64.b64encode(buf).decode()


ok, jpg = cv2.imencode(".jpg", ref, [cv2.IMWRITE_JPEG_QUALITY, 93])
ref_url = "data:image/jpeg;base64," + base64.b64encode(jpg).decode()
with open(OUT, "w", encoding="utf-8") as f:
    f.write("// generated by tools/build_scene.py -- do not edit\n")
    f.write("window.SN_ASSETS = {\n")
    f.write(f'  reference: "{ref_url}",\n')
    f.write(f'  scene: "{png_url(scene)}",\n')
    f.write(f'  region: "{png_url(region)}"\n')
    f.write("};\n")
print(f"wrote {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)")

if DEBUG:
    out_dir = os.path.join(ROOT, "tools", "debug")
    os.makedirs(out_dir, exist_ok=True)
    palette = np.array([[0, 0, 0], [255, 120, 0], [0, 200, 255], [0, 255, 100], [255, 0, 200], [255, 255, 0]], np.uint8)
    over = cv2.addWeighted(small, 0.55, palette[cls], 0.45, 0)
    # draw brush directions as short ticks
    for y in range(8, SH, 14):
        for x in range(8, SW, 14):
            if cls[y, x] == 0:
                continue
            cv2.line(over, (x, y), (int(x + FX[y, x] * 7), int(y + FY[y, x] * 7)), (255, 255, 255), 1)
    cv2.imwrite(os.path.join(out_dir, "regions.png"), cv2.resize(over, (960, 760), interpolation=cv2.INTER_NEAREST))
