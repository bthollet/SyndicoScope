# -*- coding: utf-8 -*-
"""Contours des communes et des arrondissements municipaux (IGN, Admin Express, servis par
geo.api.gouv.fr), simplifiés pour servir de fond de carte sans tuiles.

Simplification de Douglas-Peucker sur chaque anneau (tolérance en degrés, longitudes corrigées
du cosinus de la latitude), coordonnées arrondies, centroïde de surface du plus grand polygone.
"""
import math
import urllib.parse

from commun import horodatage
from rnic import commune_plein_exercice

URL = "https://geo.api.gouv.fr"


def telecharger(client, dept):
    u1 = "%s/departements/%s/communes?%s" % (URL, dept, urllib.parse.urlencode({"format": "geojson", "geometry": "contour"}))
    u2 = "%s/communes?%s" % (URL, urllib.parse.urlencode({"codeDepartement": dept, "type": "arrondissement-municipal",
                                                          "format": "geojson", "geometry": "contour"}))
    return {"communes": client.get_json(u1), "arrondissements": client.get_json(u2),
            "urls": [u1, u2], "heure": horodatage()}


def _dp(points, eps, k):
    """Douglas-Peucker itératif ; points = [(lon, lat), ...] ; k = facteur des longitudes."""
    n = len(points)
    if n < 4:
        return points
    garder = [False] * n
    garder[0] = garder[-1] = True
    pile = [(0, n - 1)]
    while pile:
        a, b = pile.pop()
        ax, ay = points[a][0] * k, points[a][1]
        bx, by = points[b][0] * k, points[b][1]
        dx, dy = bx - ax, by - ay
        norme = math.hypot(dx, dy)
        dmax, imax = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i][0] * k, points[i][1]
            if norme == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norme
            if d > dmax:
                dmax, imax = d, i
        if dmax > eps and imax > 0:
            garder[imax] = True
            pile.append((a, imax))
            pile.append((imax, b))
    return [p for p, g in zip(points, garder) if g]


def _aire_centroide(anneau, k):
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(anneau, anneau[1:]):
        x1k, x2k = x1 * k, x2 * k
        c = x1k * y2 - x2k * y1
        a += c
        cx += (x1k + x2k) * c
        cy += (y1 + y2) * c
    if a == 0:
        return 0.0, anneau[0][0], anneau[0][1]
    return abs(a) / 2.0, cx / (3.0 * a) / k, cy / (3.0 * a)


def simplifier_geometrie(geom, eps, nd):
    if geom["type"] == "Polygon":
        polys = [geom["coordinates"]]
    elif geom["type"] == "MultiPolygon":
        polys = geom["coordinates"]
    else:
        return None, None
    lat0 = polys[0][0][0][1]
    k = math.cos(math.radians(lat0))
    sortie, meilleur = [], (-1.0, None, None)
    for poly in polys:
        anneaux = []
        for j, anneau in enumerate(poly):
            pts = [(round(x, nd), round(y, nd)) for x, y in _dp([tuple(p[:2]) for p in anneau], eps, k)]
            dedup = [pts[0]] + [p for i, p in enumerate(pts[1:], 1) if p != pts[i - 1]]
            if len(dedup) >= 4:
                anneaux.append([list(p) for p in dedup])
            elif j == 0:
                anneaux = []
                break
        if anneaux:
            sortie.append(anneaux)
            aire, cx, cy = _aire_centroide([tuple(p) for p in anneaux[0]], k)
            if aire > meilleur[0]:
                meilleur = (aire, cx, cy)
    if not sortie:
        return None, None
    g = {"type": "Polygon", "coordinates": sortie[0]} if len(sortie) == 1 else {"type": "MultiPolygon", "coordinates": sortie}
    return g, (round(meilleur[2], 5), round(meilleur[1], 5))


def construire(brut, eps=0.00025, nd=5):
    """FeatureCollection compacte : communes (sauf celles découpées en arrondissements) et arrondissements.
    Rend (geojson, zones) ; zones = [{code, nom, type, parent, centre}]."""
    arr = brut["arrondissements"].get("features", [])
    def parent_de(p):
        return p.get("codeParent") or p.get("commune") or commune_plein_exercice(p.get("code"))
    parents = {parent_de(f["properties"]) for f in arr}
    parents.discard(None)
    feats, zones = [], []
    for f in brut["communes"].get("features", []):
        p = f["properties"]
        g, centre = simplifier_geometrie(f["geometry"], eps, nd)
        if not g:
            continue
        decoupee = p["code"] in parents
        zones.append({"code": p["code"], "nom": p["nom"], "type": "commune", "parent": None, "centre": centre,
                      "decoupee": decoupee})
        if not decoupee:
            feats.append({"type": "Feature", "properties": {"code": p["code"], "nom": p["nom"], "type": "commune"},
                          "geometry": g})
    for f in arr:
        p = f["properties"]
        g, centre = simplifier_geometrie(f["geometry"], eps, nd)
        if not g:
            continue
        parent = parent_de(p)
        zones.append({"code": p["code"], "nom": p["nom"], "type": "arrondissement", "parent": parent,
                      "centre": centre, "decoupee": False})
        feats.append({"type": "Feature", "properties": {"code": p["code"], "nom": p["nom"], "type": "arrondissement",
                                                        "parent": parent}, "geometry": g})
    return {"type": "FeatureCollection", "features": feats}, zones
