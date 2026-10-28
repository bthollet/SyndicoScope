# -*- coding: utf-8 -*-
"""BODACC (DILA), jeu `annonces-commerciales` de l'API Opendatasoft, depuis 2008.

Par SIREN : nombre d'annonces par famille, puis le détail daté des familles qui comptent pour un
conseil syndical. Mesuré le 28/10/2026 : dans une annonce « Ventes et cessions », le SIREN cherché
par `registre` est celui de l'ACQUÉREUR (le cédant figure dans `listeprecedentproprietaire`) ;
ces annonces sont donc des achats de fonds, une information et non une alerte.

Seules les procédures collectives sont une alerte. Rien n'est lu de `listepersonnes` ni du
complément de jugement (noms de personnes) : on ne garde que la date, la famille et la nature.

Rattachement (règles du 28/10/2026) : une annonce n'est rattachée à un SIREN que si son champ
`registre` le porte, chiffres normalisés ; une mention du numéro dans le texte ne suffit pas. La
requête `registre like "<SIREN>"` ne rend que celles-là (mesuré : ni préfixe ni suffixe ne
répondent) ; le contrôle est refait sur chaque annonce détaillée. Le registre lui-même peut se
tromper : le 08/09/2011, une procédure collective porte au registre le SIREN d'un syndic qui publie
encore, et au champ commercant une autre société. Une annonce d'alerte (procédure collective,
radiation) n'est donc publiée que si son `commercant` concorde aussi avec la dénomination, le sigle
ou une enseigne (`commercant_concorde`, calculé au moissonnage), et si elle ne précède pas la
création de la société (publiables). Une annonce écartée ne s'affiche jamais, pas même dans les
comptes par famille ; elle est comptée, et son `id` reste dans le cache pour relecture.

Le cache garde de chaque annonce détaillée son `id` et son `registre`, et son `commercant` pour une
société seulement : pour un entrepreneur individuel, c'est le nom de la personne, qui n'est ni
stocké ni publié ; seul le booléen de concordance est gardé. Rien de cela n'est publié.
"""
import collections
import json
import re
import unicodedata
import urllib.parse

from commun import horodatage

URL = "https://www.bodacc.fr/api/explore/v2.1/catalog/datasets/annonces-commerciales/records"
FORMAT = 3   # 3 : annonces détaillées contrôlées sur registre, concordance du commercant calculée (28/10/2026)
FAMILLES_DETAILLEES = r"collective|radiation|vente|cession"
ALERTES = {"procedures": r"collective", "radiations": r"radiation"}
# Formes juridiques retirées avant de comparer deux noms (sigles, puis libellés développés).
FORMES = re.compile(r"\b(?:SOCIETE (?:PAR ACTIONS SIMPLIFIEE|A RESPONSABILITE LIMITEE|ANONYME|CIVILE(?: IMMOBILIERE)?|"
                    r"EN NOM COLLECTIF)(?: UNIPERSONNELLE)?|ENTREPRISE UNIPERSONNELLE A RESPONSABILITE LIMITEE|"
                    r"SASU|SAS|SARL|SA|EURL|SCI|SNC|SCS|SCA|SCP|SCM|SC|SELARL|SELAS|SEL|GIE|SEM|SAEM|SPL|SCOP|EIRL|EI)\b")


def porte_siren(registre, siren):
    """Vrai si l'une des valeurs du champ `registre` est ce SIREN, chiffres normalisés."""
    valeurs = registre if isinstance(registre, list) else [registre]
    return any(re.sub(r"\D", "", str(v or "")) == siren for v in valeurs)


def mots_du_nom(nom):
    """Mots d'un nom, casse, accents, ponctuation et formes juridiques retirés (« S.C.I. » compris)."""
    s = unicodedata.normalize("NFKD", str(nom or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).upper().replace(".", "")
    s = re.sub(r"[^0-9A-Z]+", " ", s)
    return set(FORMES.sub(" ", s).split())


MOTS_VIDES = {"A", "AU", "AUX", "D", "DE", "DES", "DU", "ET", "EN", "L", "LA", "LE", "LES"}


def concorde(commercant, noms):
    """Vrai si le commercant d'une annonce est l'un des `noms` (dénomination, sigle, enseignes) : mêmes mots
    dans un ordre quelconque, ou tous les mots de l'un dans l'autre quand le plus court en a au moins deux
    hors articles et prépositions (« LES PINS » ne suffit pas à reconnaître « CABINET LES PINS »)."""
    c = mots_du_nom(commercant)
    if not c:
        return False
    for n in noms:
        m = mots_du_nom(n)
        if not m:
            continue
        petit, grand = (c, m) if len(c) <= len(m) else (m, c)
        if c == m or (len(petit - MOTS_VIDES) >= 2 and petit <= grand):
            return True
    return False


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


def annonces_siren(client, siren, identite=None):
    """Annonces d'un SIREN : comptes par famille, dépôts des comptes, annonces détaillées (details)."""
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
    return details(client, res, identite)


def details(client, res, identite=None):
    """Annonces datées des familles détaillées d'une réponse (procédures collectives, radiations, ventes et
    cessions), contrôlées une à une sur `registre` ; remplace celles de `res` et le rend. Sert aussi à
    compléter une réponse en cache d'un format antérieur (une requête). `identite(siren)` rend
    {"ei": vrai, faux ou None si inconnu, "noms": noms de l'unité, comparés puis oubliés} ; sans elle, ni
    commercant gardé ni concordance (None), et l'annonce ne sera pas publiée."""
    siren = res["siren"]
    out = {"procedures": [], "radiations": [], "achats": [], "ecartees": 0, "format": FORMAT}
    cibles = [f for f in res["familles"] if re.search(FAMILLES_DETAILLEES, f, re.I)]
    resultats, idt = [], {"ei": None, "noms": ()}
    if cibles:   # tout est lu avant d'écrire : une erreur laisse `res` intact, repris au lancement suivant
        w2 = 'registre like "%s" and (%s)' % (siren, " or ".join('familleavis_lib="%s"' % f for f in cibles))
        # par famille d'abord : « Procédures collectives » et « Radiations » passent avant « Ventes et
        # cessions », seules à pouvoir dépasser la limite (achats publiés depuis les comptes par famille)
        url2 = _q({"where": w2, "select": "id,dateparution,familleavis_lib,typeavis_lib,jugement,registre,commercant",
                   "order_by": "familleavis_lib,dateparution", "limit": 100})
        resultats = client.get_json(url2).get("results", [])
        if identite:
            idt = identite(siren)
    for r in resultats:
        if not porte_siren(r.get("registre"), siren):
            out["ecartees"] += 1
            continue
        fam = r.get("familleavis_lib") or ""
        item = {"date": (r.get("dateparution") or "")[:10], "type": r.get("typeavis_lib") or "",
                "id": r.get("id"), "registre": r.get("registre"),
                "commercant_concorde": concorde(r.get("commercant"), idt["noms"]) if idt["noms"] else None}
        if idt["ei"] is False:   # une société : son nom se garde ; celui d'une personne, jamais
            item["commercant"] = r.get("commercant")
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
            out["procedures"].append(item)
        elif re.search(r"radiation", fam, re.I):
            out["radiations"].append(item)
        else:
            out["achats"].append(item)
    res.update(out)
    return res


def a_completer(entree):
    """Réponse en cache d'un format antérieur qui a une famille d'alerte : ses annonces détaillées sont à
    refaire (une requête, details) avant d'être publiables. Sans cela, elles restent non contrôlées et
    ne sont pas publiées (publiables)."""
    return entree.get("format") != FORMAT and any(re.search("|".join(ALERTES.values()), f, re.I)
                                                  for f in entree.get("familles") or {})


def publiables(entree, creation=None):
    """Annonces d'alerte publiables d'une réponse en cache, et familles recomptées sans les écartées.
    Publiable : concordance établie (champ registre déjà contrôlé) et date non antérieure à `creation`
    (date de création de la société, AAAA-MM-JJ). Une concordance fausse écarte l'annonce
    (nom_discordant) ; absente ou inconnue (format antérieur, identité inconnue), elle l'écarte aussi
    (non_controlee). Une famille d'alerte n'est comptée que sur ses annonces publiables : une annonce
    écartée n'apparaît nulle part. Rend ({"procedures", "radiations"}, familles, écartées par motif)."""
    familles = {k: dict(v) for k, v in (entree.get("familles") or {}).items()}
    gardees, ecartees = {}, collections.Counter()
    for cle, motif in ALERTES.items():
        gardees[cle] = []
        for it in entree.get(cle) or []:
            if it.get("commercant_concorde") is None:
                ecartees["non_controlee"] += 1
            elif it["commercant_concorde"] is not True:
                ecartees["nom_discordant"] += 1
            elif creation and it.get("date") and it["date"] < creation:
                ecartees["avant_creation"] += 1
            else:
                gardees[cle].append(it)
        for f in [f for f in familles if re.search(motif, f, re.I)]:
            del familles[f]
        if gardees[cle]:
            dates = sorted(it["date"] for it in gardees[cle] if it.get("date"))
            nom = "Procédures collectives" if cle == "procedures" else "Radiations"
            familles[nom] = {"n": len(gardees[cle]), "premiere": dates[0] if dates else "",
                             "derniere": dates[-1] if dates else ""}
    return gardees, familles, ecartees
