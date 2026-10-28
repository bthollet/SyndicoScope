# -*- coding: utf-8 -*-
"""BODACC (DILA), jeu `annonces-commerciales` de l'API Opendatasoft, depuis 2008.

Par SIREN : nombre d'annonces par famille, puis le détail daté des familles qui comptent pour un
conseil syndical. Mesuré le 28/10/2026 : dans une annonce « Ventes et cessions », le SIREN cherché
par `registre` est celui de l'ACQUÉREUR (le cédant figure dans `listeprecedentproprietaire`) ;
ces annonces sont donc des achats de fonds, une information et non une alerte.

Seules les procédures collectives sont une alerte. Rien n'est lu de `listepersonnes` ni du
complément de jugement (noms de personnes) : on ne garde que la date, la famille et la nature.
"""
import json
import re
import urllib.parse

from commun import horodatage

URL = "https://www.bodacc.fr/api/explore/v2.1/catalog/datasets/annonces-commerciales/records"


def _q(params):
    return URL + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


def depots_des_comptes(client, siren):
    """Avis de dépôt des comptes (famille « dpc »), dix ans au plus. Le champ `depot` est une chaîne JSON :
    on n'en garde que dateCloture, typeDepot et le début de descriptif (mention de confidentialité).
    La date de parution n'est pas la date de dépôt au greffe."""
    url = _q({"where": 'registre like "%s" and familleavis="dpc"' % siren,
              "select": "dateparution,typeavis_lib,depot", "order_by": "dateparution desc", "limit": 100})
    out = []
    for r in client.get_json(url).get("results", []):
        d = r.get("depot")
        try:
            d = json.loads(d) if isinstance(d, str) else (d or {})
        except ValueError:
            d = {}
        out.append({"parution": (r.get("dateparution") or "")[:10], "type": r.get("typeavis_lib") or "",
                    "cloture": str(d.get("dateCloture") or "")[:10], "depot": str(d.get("typeDepot") or ""),
                    "descriptif": str(d.get("descriptif") or "")[:200]})
    return out


def annonces_siren(client, siren):
    where = 'registre like "%s"' % siren
    url1 = _q({"where": where, "select": "familleavis_lib,count(*) as n,min(dateparution) as premiere,"
                                         "max(dateparution) as derniere",
               "group_by": "familleavis_lib", "limit": 100})
    familles = {}
    for r in client.get_json(url1).get("results", []):
        familles[r.get("familleavis_lib") or "(sans famille)"] = {
            "n": r.get("n") or 0, "premiere": (r.get("premiere") or "")[:10], "derniere": (r.get("derniere") or "")[:10]}
    res = {"siren": siren, "heure": horodatage(), "url": url1, "familles": familles,
           "procedures": [], "radiations": [], "achats": [], "depots": []}
    if any(re.search(r"d[ée]p[ôo]t", f, re.I) for f in familles):
        res["depots"] = depots_des_comptes(client, siren)
    cibles = [f for f in familles if re.search(r"collective|radiation|vente|cession", f, re.I)]
    if not cibles:
        return res
    w2 = where + " and (" + " or ".join('familleavis_lib="%s"' % f for f in cibles) + ")"
    url2 = _q({"where": w2, "select": "dateparution,familleavis_lib,typeavis_lib,jugement",
               "order_by": "dateparution", "limit": 100})
    for r in client.get_json(url2).get("results", []):
        fam = r.get("familleavis_lib") or ""
        item = {"date": (r.get("dateparution") or "")[:10], "type": r.get("typeavis_lib") or ""}
        if re.search(r"collective", fam, re.I):
            nature = ""
            jg = r.get("jugement")
            if jg:
                try:
                    jg = json.loads(jg) if isinstance(jg, str) else jg
                    nature = str(jg.get("nature") or jg.get("famille") or "")[:120]
                except (ValueError, AttributeError):
                    nature = ""
            item["nature"] = nature
            res["procedures"].append(item)
        elif re.search(r"radiation", fam, re.I):
            res["radiations"].append(item)
        else:
            res["achats"].append(item)
    return res
