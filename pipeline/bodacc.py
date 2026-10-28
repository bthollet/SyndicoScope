# -*- coding: utf-8 -*-
"""BODACC (DILA), jeu `annonces-commerciales` de l'API Opendatasoft, depuis 2008.

Par SIREN : nombre d'annonces par famille, puis le détail daté des familles qui comptent pour un
conseil syndical. Mesuré le 28/10/2026 : dans une annonce « Ventes et cessions », le SIREN cherché
par `registre` est celui de l'ACQUÉREUR (le cédant figure dans `listeprecedentproprietaire`) ;
ces annonces sont donc des achats de fonds, une information et non une alerte.

Seules les procédures collectives sont une alerte. Rien n'est lu de `listepersonnes` ni du
complément de jugement (noms de personnes) : on ne garde que la date, la famille et la nature.

Rattachement (règle du 28/10/2026) : une annonce n'est rattachée à un SIREN que si son champ
`registre` le porte, chiffres normalisés ; une mention du numéro dans le texte ne suffit pas, une
concordance de nom non plus. La requête `registre like "<SIREN>"` ne rend que celles-là (mesuré :
ni préfixe ni suffixe ne répondent) ; le contrôle est refait sur chaque annonce détaillée, qui
garde dans le cache son `id`, son `registre` et son `commercant` (dénomination, ou nom d'une
personne) pour qu'on puisse la vérifier. Ces trois champs ne sont jamais publiés. Le registre
lui-même peut se tromper : le 08/09/2011, une procédure collective porte au registre le SIREN d'un
syndic qui publie encore, et au champ commercant une autre société.
"""
import json
import re
import urllib.parse

from commun import horodatage

URL = "https://www.bodacc.fr/api/explore/v2.1/catalog/datasets/annonces-commerciales/records"
FORMAT = 2   # 2 : annonces détaillées contrôlées sur `registre`, avec id, registre et commercant (28/10/2026)
FAMILLES_DETAILLEES = r"collective|radiation|vente|cession"


def porte_siren(registre, siren):
    """Vrai si l'une des valeurs du champ `registre` est ce SIREN, chiffres normalisés."""
    valeurs = registre if isinstance(registre, list) else [registre]
    return any(re.sub(r"\D", "", str(v or "")) == siren for v in valeurs)


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
    return details(client, res)


def details(client, res):
    """Annonces datées des familles détaillées d'une réponse (procédures collectives, radiations, ventes et
    cessions), contrôlées une à une sur `registre` ; remplace celles de `res` et le rend. Sert aussi à
    compléter une réponse en cache d'un format antérieur (une requête)."""
    siren = res["siren"]
    res.update({"procedures": [], "radiations": [], "achats": [], "ecartees": 0, "format": FORMAT})
    cibles = [f for f in res["familles"] if re.search(FAMILLES_DETAILLEES, f, re.I)]
    if not cibles:
        return res
    w2 = 'registre like "%s" and (%s)' % (siren, " or ".join('familleavis_lib="%s"' % f for f in cibles))
    url2 = _q({"where": w2, "select": "id,dateparution,familleavis_lib,typeavis_lib,jugement,registre,commercant",
               "order_by": "dateparution", "limit": 100})
    for r in client.get_json(url2).get("results", []):
        if not porte_siren(r.get("registre"), siren):
            res["ecartees"] += 1
            continue
        fam = r.get("familleavis_lib") or ""
        item = {"date": (r.get("dateparution") or "")[:10], "type": r.get("typeavis_lib") or "",
                "id": r.get("id"), "registre": r.get("registre"), "commercant": r.get("commercant")}
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
