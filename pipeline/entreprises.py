# -*- coding: utf-8 -*-
"""Annuaire des entreprises de la DINUM (recherche-entreprises.api.gouv.fr, Licence Ouverte 2.0).

Un appel par SIRET déclaré au registre des copropriétés (`q=<siret>`) : il rend l'établissement
déclaré, le siège et la fiche de la société. Repli sur `q=<siren>` si le SIRET est introuvable.

Confidentialité, sans exception :
- le tableau `dirigeants` n'est jamais conservé ; on n'en tire que les dirigeants PERSONNES MORALES,
  commissaires aux comptes exclus (ils ne disent rien d'un groupe) ;
- un entrepreneur individuel est une personne physique : ni nom, ni enseigne, et la position de son
  établissement est arrondie à 0,01° (environ 1 km) dès la mise en cache ;
- une unité à diffusion partielle est traitée comme un entrepreneur individuel.
"""
import re
import unicodedata
import urllib.parse

from commun import horodatage

URL = "https://recherche-entreprises.api.gouv.fr/search"

# Catégories juridiques INSEE (niveau III) les plus courantes chez les syndics ; sinon le code.
FORMES = {
    "1000": "Entrepreneur individuel",
    "5202": "Société en nom collectif", "5306": "Société en commandite simple",
    "5308": "Société en commandite par actions",
    "5410": "SARL nationale", "5415": "SARL d'économie mixte", "5422": "SARL immobilière pour le commerce et l'industrie",
    "5426": "SARL immobilière de gestion", "5443": "SARL coopérative de construction",
    "5458": "SARL coopérative ouvrière de production", "5460": "SARL coopérative",
    "5485": "Société d'exercice libéral à responsabilité limitée", "5498": "SARL unipersonnelle",
    "5499": "Société à responsabilité limitée (SARL)",
    "5505": "SA à participation ouvrière", "5515": "SA d'économie mixte", "5546": "SA d'HLM",
    "5547": "SA coopérative de production d'HLM", "5558": "SA coopérative ouvrière de production",
    "5560": "SA coopérative", "5585": "Société d'exercice libéral à forme anonyme",
    "5599": "SA à conseil d'administration", "5615": "SA d'économie mixte à directoire",
    "5646": "SA d'HLM à directoire", "5647": "Société coopérative de production d'HLM à directoire",
    "5699": "SA à directoire",
    "5710": "Société par actions simplifiée (SAS)",
    "5785": "Société d'exercice libéral par actions simplifiée", "5800": "Société européenne",
    "6220": "Groupement d'intérêt économique", "6540": "Société civile immobilière",
    "6541": "SCI de construction-vente", "6543": "Société civile coopérative de construction",
    "6585": "Société civile professionnelle", "6589": "Société civile de moyens", "6599": "Autre société civile",
    "7210": "Commune", "7346": "Communauté de communes", "7348": "Communauté d'agglomération",
    "7364": "Syndicat mixte", "4110": "Établissement public national industriel et commercial",
    "4140": "Établissement public local industriel et commercial",
    "9220": "Association déclarée", "9260": "Autre personne morale de droit privé",
}

# Tranches d'effectifs salariés (INSEE)
EFFECTIFS = {
    "NN": "aucun salarié (unité non employeuse)", "00": "0 salarié", "01": "1 ou 2 salariés",
    "02": "3 à 5 salariés", "03": "6 à 9 salariés", "11": "10 à 19 salariés", "12": "20 à 49 salariés",
    "21": "50 à 99 salariés", "22": "100 à 199 salariés", "31": "200 à 249 salariés",
    "32": "250 à 499 salariés", "41": "500 à 999 salariés", "42": "1 000 à 1 999 salariés",
    "51": "2 000 à 4 999 salariés", "52": "5 000 à 9 999 salariés", "53": "10 000 salariés et plus",
}

# Marques de groupes INTÉGRÉS de syndics (filiales d'une même maison) : une même marque relie des
# sociétés distinctes en un « groupe présumé ». Les réseaux de FRANCHISE (agences indépendantes sous
# une enseigne commune) n'y figurent pas : deux franchisés sont des concurrents. Les noms de famille
# en sont exclus (homonymes). Liste explicite, à compléter au vu du journal du pipeline, qui y écrit
# les premiers mots partagés par plusieurs sociétés et absents de la liste.
RESEAUX = ["FONCIA", "CITYA", "NEXITY", "ORALIA", "SERGIC", "IMMO DE FRANCE", "SQUARE HABITAT",
           "ICADE", "GESTRIM", "LOISELET ET DAIGREMONT", "LOISELET DAIGREMONT", "URBANIA"]

MOTS_GENERIQUES = {
    "CABINET", "AGENCE", "SOCIETE", "STE", "IMMOBILIER", "IMMOBILIERE", "IMMOBILIERES", "IMMO", "GESTION",
    "SYNDIC", "SYNDICS", "ADMINISTRATION", "ADMINISTRATEUR", "GROUPE", "COMPAGNIE", "OFFICE", "CENTRE",
    "CONSEIL", "CONSEILS", "SERVICE", "SERVICES", "PROVENCE", "MARSEILLE", "MEDITERRANEE", "MEDITERRANEENNE",
    "SUD", "AZUR", "COTE", "FRANCE", "PATRIMOINE", "HABITAT", "RESIDENCE", "RESIDENCES", "SARL", "SAS",
    "SCI", "SCP", "EURL", "SELARL", "SASU", "LES", "LA", "LE", "DES", "DE", "DU", "ET", "AIX", "TRANSACTION",
    "TRANSACTIONS", "INTERNATIONAL", "PARTNERS", "ASSOCIES", "REGIE", "LOGEMENT", "LOGEMENTS", "GERANCE",
    "SYNDICAT", "COPROPRIETE", "COPROPRIETES", "BUREAU", "ETUDE", "IMMEUBLE", "IMMEUBLES",
}


def normaliser(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    return re.sub(r"[^0-9A-Z]+", " ", s).strip()


def _f(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def _etablissement(e, ei):
    if not e:
        return None
    lat, lon = _f(e.get("latitude")), _f(e.get("longitude"))
    if ei and lat is not None and lon is not None:
        lat, lon = round(lat, 2), round(lon, 2)
    return {
        "siret": e.get("siret"), "lat": lat, "lon": lon, "precision": "approchee" if ei else "exacte",
        "commune": e.get("commune"), "libelle_commune": e.get("libelle_commune"),
        "est_siege": bool(e.get("est_siege")), "etat": e.get("etat_administratif"),
        "naf": e.get("activite_principale"),
        "enseignes": None if ei else (e.get("liste_enseignes") or None),
    }


def fiche_siret(client, siret):
    """Fiche d'un SIRET : société, établissement déclaré, siège. Aucune personne physique."""
    siren = siret[:9]
    url = URL + "?" + urllib.parse.urlencode({"q": siret, "page": 1, "per_page": 1})
    obj = client.get_json(url)
    res = [r for r in obj.get("results", []) if r.get("siren") == siren]
    mode = "siret"
    if not res:
        url = URL + "?" + urllib.parse.urlencode({"q": siren, "page": 1, "per_page": 1})
        obj = client.get_json(url)
        res = [r for r in obj.get("results", []) if r.get("siren") == siren]
        mode = "siren"
    base = {"siret": siret, "siren": siren, "trouve": bool(res), "mode": mode, "heure": horodatage()}
    if not res:
        return base
    r = res[0]
    comp = r.get("complements") or {}
    nj = str(r.get("nature_juridique") or "")
    diffusion_partielle = str(r.get("statut_diffusion") or "O").upper() == "P"
    ei = nj.startswith("1") or bool(comp.get("est_entrepreneur_individuel")) or diffusion_partielle
    etab = None
    for e in r.get("matching_etablissements") or []:
        if e.get("siret") == siret:
            etab = e
    siege = r.get("siege") or {}
    pm = []
    for d in r.get("dirigeants") or []:   # seuls les dirigeants personnes morales, hors commissaires aux comptes
        if d.get("type_dirigeant") != "personne morale":
            continue
        q = str(d.get("qualite") or "")
        if re.search(r"commissaire|comptes", q, re.I):
            continue
        if d.get("siren"):
            pm.append({"siren": d.get("siren"), "denomination": d.get("denomination"), "qualite": q})
    fin = {}
    for annee, v in (r.get("finances") or {}).items():
        if isinstance(v, dict):
            fin[str(annee)] = {"ca": v.get("ca"), "resultat_net": v.get("resultat_net")}
    base.update({
        "ei": ei, "diffusion_partielle": diffusion_partielle,
        "nom": None if ei else (r.get("nom_raison_sociale") or r.get("nom_complet")),
        "nom_complet": None if ei else r.get("nom_complet"),
        "sigle": None if ei else r.get("sigle"),
        "nature_juridique": nj, "date_creation": r.get("date_creation"),
        "tranche_effectif": r.get("tranche_effectif_salarie"), "annee_effectif": r.get("annee_tranche_effectif_salarie"),
        "categorie": r.get("categorie_entreprise"), "etat": r.get("etat_administratif"),
        "naf": r.get("activite_principale"), "nb_etab": r.get("nombre_etablissements"),
        "nb_etab_ouverts": r.get("nombre_etablissements_ouverts"),
        "finances": fin, "dirigeants_pm": pm,
        "etab": _etablissement(etab, ei), "siege": _etablissement(siege, ei),
    })
    return base


def forme(nj):
    return FORMES.get(str(nj or ""), ("code %s" % nj) if nj else "")


def forme_courte(nj):
    """Libellé court pour le tableau : SAS, SARL, SA… ; sinon le libellé complet. La nomenclature INSEE
    ne distingue pas SAS et SASU (le code 5720 n'existe pas) : une SASU est écrite « SAS »."""
    nj = str(nj or "")
    courtes = {"5710": "SAS", "5499": "SARL", "5498": "SARL", "5485": "SELARL", "5785": "SELAS",
               "5585": "SELAFA", "5202": "SNC", "1000": "Entrepreneur individuel"}
    if nj in courtes:
        return courtes[nj]
    if nj[:2] in ("55", "56"):
        return "SA"
    if nj[:2] == "54":
        return "SARL"
    if nj[:2] == "65":
        return "Société civile"
    return forme(nj)


def effectif(tr):
    return EFFECTIFS.get(str(tr or ""), "non renseigné")


def marque(fiche):
    """Marque de réseau reconnue dans la dénomination, le sigle ou les enseignes, sinon None."""
    if not fiche or fiche.get("ei"):
        return None
    textes = [fiche.get("nom"), fiche.get("nom_complet"), fiche.get("sigle")]
    for e in (fiche.get("etab"), fiche.get("siege")):
        if e and e.get("enseignes"):
            textes += e["enseignes"]
    t = " " + " ".join(normaliser(x) for x in textes if x) + " "
    for m in RESEAUX:
        if (" " + m.strip() + " ") in t:
            return m.strip()
    return None


def premier_mot(fiche):
    mots = [m for m in normaliser(fiche.get("nom") or "").split() if len(m) >= 4 and m not in MOTS_GENERIQUES]
    return mots[0] if mots else None


def regrouper(fiches):
    """Groupes présumés de sociétés (SIREN) : dirigeant personne morale commun, société dirigeant une autre,
    ou même marque de réseau. Rend {siren: (id_groupe, libellé, preuves)} pour les SIREN groupés."""
    parent = {}

    def trouver(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def unir(a, b):
        ra, rb = trouver(a), trouver(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    preuves = {}
    par_pm, par_marque = {}, {}
    sirens = {f["siren"] for f in fiches.values() if f.get("trouve")}
    for f in fiches.values():
        if not f.get("trouve") or f.get("ei"):
            continue
        s = f["siren"]
        for d in f.get("dirigeants_pm") or []:
            par_pm.setdefault(d["siren"], set()).add(s)
            if d["siren"] in sirens:   # une société syndic en dirige une autre
                unir(s, d["siren"])
                preuves.setdefault(s, set()).add("dirigée par %s" % (d.get("denomination") or d["siren"]))
        m = marque(f)
        if m:
            par_marque.setdefault(m, set()).add(s)
    for pm, membres in par_pm.items():
        if len(membres) > 1:
            membres = sorted(membres)
            for s in membres[1:]:
                unir(membres[0], s)
            nom_pm = next((d.get("denomination") for f in fiches.values() for d in (f.get("dirigeants_pm") or [])
                           if d["siren"] == pm and d.get("denomination")), pm)
            for s in membres:
                preuves.setdefault(s, set()).add("même dirigeant société : %s" % nom_pm)
    for m, membres in par_marque.items():
        if len(membres) > 1:
            membres = sorted(membres)
            for s in membres[1:]:
                unir(membres[0], s)
            for s in membres:
                preuves.setdefault(s, set()).add("même marque : %s" % m)
    comps = {}
    for s in set(parent):
        comps.setdefault(trouver(s), set()).add(s)
    res = {}
    for i, (racine, membres) in enumerate(sorted(comps.items())):
        if len(membres) < 2:
            continue
        marques = sorted({marque(f) for f in fiches.values() if f.get("siren") in membres and marque(f)})
        if marques:
            libelle = " / ".join(marques)
        else:
            libelle = "groupe de %d sociétés" % len(membres)
        for s in membres:
            res[s] = (racine, libelle, sorted(preuves.get(s, [])))
    return res
