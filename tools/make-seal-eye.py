#!/usr/bin/env python3
"""
Generuje Oko pieczęci: migdałowa powieka (piksele 1×1 jak heksagram) z tęczówką
w postaci lampy strojeniowej 6E5 „magic eye” (piksele 0.5×0.5).

Tęczówka: zielony ekran z prążkami anody, jasny pierścień, ciemna katoda.
Cień wiązki (u góry) zwęża się od OUT OF TUNE (~110°) do IN TUNE (~8°) —
czysty CSS (warstwy .shadow z --k), żadnego JS.

    python3 tools/make-seal-eye.py      # nadpisuje blok <g class="seal-eye"> w index.html i en/index.html
"""
import math
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [ROOT / "index.html", ROOT / "en" / "index.html"]

# --- Powieka: kontur ze starego oka, bez wystających pikseli (20,16) i (20,24);
#     dziury w środku górnej i dolnej krawędzi domknięte. -----------------------
EDGE_RUNS = [(16, 17, 9), (15, 18, 2), (24, 18, 2), (14, 19, 1), (26, 19, 1), (13, 20, 1), (27, 20, 1),
             (14, 21, 1), (26, 21, 1), (15, 22, 2), (24, 22, 2), (16, 23, 9)]
INTERIOR_RUNS = [(17, 18, 7), (15, 19, 11), (14, 20, 13), (15, 21, 11), (17, 22, 7)]

CX = CY = 20.5          # środek piksela (20,20)
R_IRIS = 3.4            # promień lampy (w jednostkach pieczęci)
RIM = 0.5               # jasny pierścień
CAP = 0.8               # katoda
RAY_DEG = 12            # szerokość prążka anody
SHADOW_UP = -90         # cień wiązki skierowany w górę
# kąty cienia: od rozstrojonego do nastrojonego (kolejne warstwy znikają)
ANGLES = [110, 96, 82, 68, 56, 44, 34, 24, 16, 8]


def cells(runs):
    return {(x + i, y) for x, y, w in runs for i in range(w)}


EDGE, INTERIOR = cells(EDGE_RUNS), cells(INTERIOR_RUNS)


def half_cells():
    """wszystkie półpiksele wnętrza powieki: (hx, hy, d, offset_kąta_od_osi_cienia)"""
    for hy in range(2 * 17, 2 * 24):
        for hx in range(2 * 13, 2 * 28):
            if (hx // 2, hy // 2) not in INTERIOR:
                continue
            px, py = (hx + .5) / 2 - CX, (hy + .5) / 2 - CY
            d = math.hypot(px, py)
            ang = math.degrees(math.atan2(py, px))
            off = abs(((ang - SHADOW_UP) + 180) % 360 - 180)
            yield hx, hy, d, ang, off


def in_shadow(d, off, deg):
    return CAP < d <= R_IRIS - RIM and off <= deg / 2


def base_class(d, ang):
    if d > R_IRIS:
        return "pupil"                       # ciemne białko oka
    if d > R_IRIS - RIM:
        return "edge"                        # pierścień lampy
    if d <= CAP:
        return "pupil"                       # katoda
    if int((ang + 360) // RAY_DEG) % 2 == 0 and d > CAP + 1.0:
        return "ray"                         # prążki anody
    return "lens"                            # ekran fluorescencyjny


def rle(grid, ind, extra=""):
    """grid: {(hx,hy): cls} -> <rect> w poziomych seriach (półpiksele)"""
    out, f = [], (lambda v: "%g" % v)
    for hy in sorted({k[1] for k in grid}):
        xs = sorted(x for x, y in grid if y == hy)
        i = 0
        while i < len(xs):
            c, j = grid[(xs[i], hy)], i
            while j + 1 < len(xs) and xs[j + 1] == xs[j] + 1 and grid[(xs[j + 1], hy)] == c:
                j += 1
            cls = f' class="{c}"' if c else ""
            out.append(f'{ind}<rect{cls} x="{f(xs[i] / 2)}" y="{f(hy / 2)}" width="{f((j - i + 1) / 2)}" height="0.5"{extra}/>')
            i = j + 1
    return out


def build():
    ind = "          "
    lines = [f'{ind}<g class="seal-eye">',
             f'{ind}<!-- Oko: powieka + tęczówka-lampa 6E5. Generuje tools/make-seal-eye.py — nie edytuj ręcznie. -->']
    for x, y, w in EDGE_RUNS:
        lines.append(f'{ind}<rect class="edge" x="{x}" y="{y}" width="{w}" height="1"/>')
    base, layers = {}, [dict() for _ in ANGLES]
    for hx, hy, d, ang, off in half_cells():
        base[(hx, hy)] = base_class(d, ang)
        # warstwa k = piksele cienia przy ANGLES[k], których nie ma już przy ANGLES[k+1]
        for k, deg in enumerate(ANGLES):
            nxt = ANGLES[k + 1] if k + 1 < len(ANGLES) else None
            if in_shadow(d, off, deg) and (nxt is None or not in_shadow(d, off, nxt)):
                layers[k][(hx, hy)] = None
                break
    lines += rle(base, ind)
    lines.append(f'{ind}<g class="shadow">')
    for k, layer in enumerate(layers):
        last = k == len(layers) - 1
        if not layer:
            continue
        cls = "tuned" if last else "tune"
        lines.append(f'{ind}<g class="{cls}" style="--k:{k}">')
        lines += rle(layer, ind)
        lines.append(f'{ind}</g>')
    lines.append(f'{ind}</g>')
    lines.append(f'{ind}</g>')
    return "\n".join(lines) + "\n"


def main():
    pat = re.compile(r'          <g class="seal-eye">.*?(?=        </svg>)', re.S)
    block = build()
    for src in FILES:
        html = src.read_text(encoding="utf-8")
        if len(pat.findall(html)) != 1:
            raise SystemExit(f"Nie znaleziono dokładnie jednego bloku <g class=\"seal-eye\"> w {src}")
        src.write_text(pat.sub(lambda m: block, html), encoding="utf-8")
        print(f"{src.relative_to(ROOT)}: Oko przebudowane")


if __name__ == "__main__":
    main()
