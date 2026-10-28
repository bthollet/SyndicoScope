# -*- coding: utf-8 -*-
"""Registre national d'immatriculation des copropriétés (RNIC, Anah, Licence Ouverte 2.0),
lu par l'API tabulaire de data.gouv.fr.

Deux ressources, deux schémas de noms de colonnes (un filtre écrit pour l'une rend 400 sur l'autre) :
- la quotidienne, état courant, noms courts ;
- la photographie « T3 2025 », noms longs ; son fichier est daté du 29/10/2025 (un an d'écart).

Pièges mesurés, tous traités ici :
- `code_officiel_commune` est un code postal dans la quotidienne et un code INSEE dans le T3 ;
  seule `code_officiel_arrondissement_commune` porte le code INSEE dans les deux.
- la période de construction mélange deux vocabulaires : harmonisée en intervalles d'années ;
- `type_syndic` est nul dans la quotidienne là où le T3 écrit « non connu » ;
- booléens `true/false/null` (quotidienne) contre `oui/non/non connu` (T3) : un nul n'est pas un faux ;
- l'état « Mandat expiré sans successeur déclaré » vide les champs du représentant.

Confidentialité : les champs d'identité du représentant sont blanchis pour toute fiche qui n'est
pas tenue par un professionnel, AVANT toute écriture sur disque. Ni adresse, ni nom d'usage,
ni `identification_representant_legal` ne sont jamais demandés.
"""
import collections
import csv
import hashlib
import io
import re
import urllib.parse

from commun import ErreurAPI, ErreurFatale, ddate, dfloat, dint, horodatage

API = "https://tabular-api.data.gouv.fr/api/resources"
RID_Q = "3ea8e2c3-0038-464a-b17e-cd5c91f65ce2"   # actualisation quotidienne (noms courts)
RID_T = "cc062fa7-4a80-449c-ab73-d2856b455ec9"   # photographie T3 2025 (noms longs)
JEU = "registre-national-dimmatriculation-des-coproprietes"

# (nom canonique, colonne de la quotidienne, colonne du T3)
COLONNES = [
    ("immat", "numero_immatriculation", "numero_d_immatriculation"),
    ("type", "type_syndic", "type_de_syndic_benevole_professionnel_non_connu"),
    ("raison", "raison_sociale_representant_legal", "raison_sociale_du_representant_legal"),
    ("siret", "siret_representant_legal", "siret_du_representant_legal"),
    ("etat", "mandat_en_cours", "mandat_en_cours_dans_la_copropriete"),
    ("fin", "date_fin_dernier_mandat", "date_de_fin_du_dernier_mandat"),
    ("maj", "date_derniere_maj", "date_de_la_derniere_maj"),
    ("date_immat", "date_immatriculation", "date_d_immatriculation"),
    ("date_reglement", "date_reglement_copropriete", "date_du_reglement_de_copropriete"),
    ("lots", "nombre_total_lots", "nombre_total_de_lots"),
    ("lots_hab", "nombre_lots_habitation", "nombre_de_lots_a_usage_d_habitation"),
    ("periode", "periode_construction", "periode_de_construction"),
    ("commune", "code_officiel_commune", "code_officiel_commune"),
    ("nom_commune", "nom_officiel_commune", "nom_officiel_commune"),
    ("arr", "code_officiel_arrondissement_commune", "code_officiel_arrondissement_commune"),
    ("nom_arr", "nom_officiel_arrondissement_commune", "nom_officiel_arrondissement_commune"),
    ("dept", "code_officiel_departement", "code_officiel_departement"),
    ("qp", "code_qp_2024", "code_qp_2024"),
    ("aidee", "copro_aidee", "copro_aidee"),
    ("residence", "residence_service", "residence_service"),
    ("coop", "syndicat_cooperatif", "syndicat_cooperatif"),
    ("principal", "syndicat_principal_ou_secondaire", "syndicat_principal_ou_syndicat_secondaire"),
    ("lat", "latitude", "lat"),
    ("lon", "longitude", "long"),
]
NOM = {c[0]: (c[1], c[2]) for c in COLONNES}
IDENTITE = ("raison",)   # blanchie hors professionnels ; le SIRET d'un non-professionnel aussi

# Périodes de construction : deux vocabulaires (mesuré le 28/10/2026), ramenés à des intervalles.
PERIODES = {
    "AVANT_1949": (0, 1948), "Avant 1949": (0, 1948),
    "DE_1949_A_1960": (1949, 1960), "DE_1961_A_1974": (1961, 1974), "De 1949 à 1974": (1949, 1974),
    "DE_1975_A_1993": (1975, 1993), "De 1975 à 1977": (1975, 1977), "De 1978 à 1982": (1978, 1982),
    "De 1983 à 1988": (1983, 1988), "De 1989 à 2000": (1989, 2000), "DE_1994_A_2000": (1994, 2000),
    "DE_2001_A_2010": (2001, 2010), "De 2001 à 2005": (2001, 2005), "De 2006 à 2012": (2006, 2012),
    "De 2013 à 2021": (2013, 2021), "APRES_2010": (2011, 9999), "A_COMPTER_DE_2011": (2011, 9999),
    "À compter de 2022": (2022, 9999),
}
PERIODES_INCONNUES = {"", "Inconnue", "NON_CONNUE", "non connu", "non renseigné", "Non connue"}

ETATS = {"mandat en cours": 0, "mandat expiré avec successeur déclaré": 1,
         "mandat expiré sans successeur déclaré": 2, "pas de mandat en cours": 3}
ETATS_LIB = ["Mandat en cours", "Mandat expiré avec successeur déclaré",
             "Mandat expiré sans successeur déclaré", "Pas de mandat en cours"]

# Représentant, codes négatifs (un indice >= 0 désigne un syndic professionnel)
BENEVOLE, NON_CONNU, SANS_SYNDIC, PRO_SANS_SIRET, ABSENTE = -1, -2, -3, -4, -9
REPR_LIB = {BENEVOLE: "syndic bénévole", NON_CONNU: "type de syndic non connu",
            SANS_SYNDIC: "aucun syndic déclaré", PRO_SANS_SIRET: "professionnel sans SIRET",
            ABSENTE: "absente du fichier"}


def chiffres(v):
    return re.sub(r"\D", "", str(v or ""))


def booleen(v):
    """Trois états : True, False, None (un nul n'est pas un faux)."""
    s = str(v or "").strip().lower()
    if s in ("true", "t", "1", "oui", "vrai"):
        return True
    if s in ("false", "f", "0", "non", "faux"):
        return False
    return None


def url_tab(rid, route, *params):
    """(clé, valeur) -> clé=valeur ; chaîne seule -> drapeau SANS signe égal (agrégats)."""
    morceaux = []
    for p in params:
        if isinstance(p, tuple):
            morceaux.append(urllib.parse.quote(p[0], safe="_") + "=" + urllib.parse.quote(str(p[1]), safe=",:"))
        else:
            morceaux.append(p)
    return "%s/%s/%s" % (API, rid, route) + ("?" + "&".join(morceaux) if morceaux else "")


def verifier_swagger(client, journal, rid, idx):
    """Le swagger (YAML) de la ressource fait autorité sur les noms de colonnes."""
    st, corps = client.get("%s/%s/swagger/" % (API, rid), delai=180)
    if st != 200:
        raise ErreurFatale("swagger %s : HTTP %d" % (rid, st))
    texte = corps.decode("utf-8", "replace")
    absentes = [c[1 + idx] for c in COLONNES
                if not re.search(r"name:\s*%s__(exact|groupby)\b" % re.escape(c[1 + idx]), texte)]
    journal.ecrire("SWAGGER", rid, "colonnes=%d" % len(COLONNES), "absentes=%s" % (absentes or "aucune"),
                   "sha256=" + hashlib.sha256(corps).hexdigest())
    if absentes:
        raise ErreurFatale("Colonnes absentes du swagger %s : %s" % (rid, absentes))


def info_ressource(client, rid):
    meta = client.get_json("%s/%s/" % (API, rid))
    prof = client.get_json("%s/%s/profile/" % (API, rid))
    src = meta.get("url", "")
    m = re.search(r"/(\d{8})-(\d{6})/", src)
    return {"rid": rid, "url_source": src,
            "date_fichier": ("%s-%s-%s" % (m.group(1)[:4], m.group(1)[4:6], m.group(1)[6:])) if m else "",
            "total_lignes": (prof.get("profile") or {}).get("total_lines"),
            "moissonnee_le": meta.get("created_at", ""), "consultee_le": horodatage()}


def lire_csv(texte):
    premiere = texte.split("\n", 1)[0]
    sep = ";" if premiere.count(";") > premiere.count(",") else ","
    return list(csv.DictReader(io.StringIO(texte, newline=""), delimiter=sep))


def blanchir(ligne, idx):
    """Retire l'identité du représentant de toute fiche non tenue par un professionnel."""
    typ = (ligne.get(NOM["type"][idx]) or "").strip().lower()
    if typ != "professionnel":
        for c in IDENTITE + ("siret",):
            col = NOM[c][idx]
            if ligne.get(col):
                ligne[col] = ""
    return ligne


def extraire_departement(client, journal, rid, idx, dept, observer=None):
    """Extraction complète du département en un appel `data/csv/` filtré, contrôlée contre meta.total.
    Rend (lignes blanchies, statistiques de contrôle établies AVANT blanchiment). `observer(ligne, idx)`
    voit chaque ligne avant blanchiment (calcul d'empreintes) et ne doit rien en conserver en clair."""
    filtre = (NOM["dept"][idx] + "__exact", dept)
    colonnes = [c[1 + idx] for c in COLONNES]
    total = client.get_json(url_tab(rid, "data/", filtre, ("page_size", 1), ("columns", NOM["immat"][idx])))["meta"]["total"]
    url = url_tab(rid, "data/csv/", filtre, ("columns", ",".join(colonnes)))
    heure = horodatage()
    st, corps = client.get(url, delai=900)
    if st != 200:
        raise ErreurAPI("extraction %s : HTTP %d" % (rid, st))
    sha = hashlib.sha256(corps).hexdigest()
    lignes = lire_csv(corps.decode("utf-8-sig"))
    del corps
    controles = collections.Counter()
    for l in lignes:
        typ = (l.get(NOM["type"][idx]) or "").strip().lower() or "(nul)"
        controles["type=" + typ] += 1
        a_siret = len(chiffres(l.get(NOM["siret"][idx]))) == 14
        if typ != "professionnel" and (l.get(NOM["raison"][idx]) or "").strip():
            controles["identite_hors_pro_blanchie"] += 1
        if typ == "professionnel" and not a_siret:
            controles["pro_sans_siret_valide"] += 1
        if observer:
            observer(l, idx)
        blanchir(l, idx)
    if len(lignes) != total:
        raise ErreurFatale("%s : %d lignes extraites pour meta.total = %d" % (rid, len(lignes), total))
    stats = {"url": url, "heure": heure, "lignes": len(lignes), "meta_total": total, "controle": "OK",
             "sha256_brut": sha, "controles": dict(sorted(controles.items()))}
    journal.ecrire("EXTRACTION", rid, "lignes=%d" % len(lignes), "meta.total=%d" % total, "controle=OK",
                   "sha256_brut=" + sha, "controles=%s" % stats["controles"])
    return lignes, stats


def extraire_national_sirets(client, journal):
    """Copropriétés et lots par SIRET de syndic professionnel, France entière, dans la quotidienne.

    Mesuré le 28/10/2026 : `data/csv/` refuse au-delà de 50 000 lignes (HTTP 403 « Output is too long »).
    On pagine donc un `groupby` trié par SIRET (page_size 200), en ne demandant la page suivante qu'après
    une page pleine (l'offset ne dépasse jamais le total), et on contrôle que la somme des comptes
    égale meta.total des fiches professionnelles."""
    filtre = ("type_syndic__exact", "professionnel")
    total = client.get_json(url_tab(RID_Q, "data/", filtre, ("page_size", 1),
                                    ("columns", "numero_immatriculation")))["meta"]["total"]
    heure = horodatage()
    agg, somme, sans_siret, page = {}, 0, 0, 1
    while True:
        obj = client.get_json(url_tab(RID_Q, "data/", filtre, "siret_representant_legal__groupby",
                                      ("siret_representant_legal__sort", "asc"), "numero_immatriculation__count",
                                      "nombre_total_lots__sum", ("page_size", 200), ("page", page)))
        lignes = obj.get("data") or []
        for r in lignes:
            n = r.get("numero_immatriculation__count") or 0
            somme += n
            s = chiffres(r.get("siret_representant_legal"))
            if len(s) != 14:
                sans_siret += n
                continue
            a = agg.setdefault(s, [0, 0])
            a[0] += n
            a[1] += int(r.get("nombre_total_lots__sum") or 0)
        if len(lignes) < 200:
            break
        page += 1
    stats = {"methode": "groupby pagine par SIRET", "heure": heure, "pages": page, "meta_total": total,
             "somme_des_comptes": somme, "sans_siret_valide": sans_siret,
             "controle": "OK" if somme == total else "ECART", "sirets": len(agg)}
    journal.ecrire("EXTRACTION", "nationale par SIRET", "pages=%d" % page, "somme=%d" % somme,
                   "meta.total=%d" % total, "controle=%s" % stats["controle"], "sirets=%d" % len(agg))
    return agg, stats


def ecrire_extrait(chemin, lignes, idx):
    with open(chemin, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=[c[1 + idx] for c in COLONNES], delimiter=";",
                           extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for l in lignes:
            w.writerow(l)


def lire_extrait(chemin):
    with open(chemin, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


class Fiche:
    __slots__ = ("immat", "type", "pro", "raison", "siret", "etat", "fin", "maj", "date_immat", "date_reglement",
                 "lots", "lots_hab", "periode", "iv", "commune", "nom_commune", "arr", "nom_arr", "zone",
                 "dept", "qp", "aidee", "residence", "coop", "principal", "lat", "lon", "repr")


PERIODES_NON_RECONNUES = collections.Counter()


def zone_insee(arr, commune, idx):
    """Clé géographique : code INSEE de l'arrondissement municipal ou de la commune.
    `code_officiel_arrondissement_commune` est l'INSEE dans les deux ressources ; `code_officiel_commune`
    n'est utilisable qu'en repli dans le T3 (c'est un code postal dans la quotidienne)."""
    a = (arr or "").strip()
    if re.fullmatch(r"\d[\dAB]\d{3}", a):
        return a
    c = (commune or "").strip()
    return c if idx == 1 and re.fullmatch(r"\d[\dAB]\d{3}", c) else ""


def commune_plein_exercice(code):
    """Ramène un arrondissement municipal (Marseille, Lyon, Paris) à sa commune."""
    if re.fullmatch(r"132(0[1-9]|1[0-6])", code or ""):
        return "13055"
    if re.fullmatch(r"6938[1-9]", code or ""):
        return "69123"
    if re.fullmatch(r"751(0[1-9]|1[0-9]|20)", code or ""):
        return "75056"
    return code or ""


def construire_fiche(l, idx):
    def g(c):
        v = l.get(NOM[c][idx])
        return "" if v is None else str(v).strip()
    f = Fiche()
    f.immat = g("immat").upper()
    f.type = g("type").lower()
    f.pro = f.type == "professionnel"
    f.raison = g("raison") if f.pro else ""
    s = chiffres(g("siret"))
    f.siret = s if (len(s) == 14 and f.pro) else ""
    e = g("etat").lower()
    f.etat = ETATS.get(e, -1)
    f.fin = ddate(g("fin"))
    f.maj = ddate(g("maj"))
    f.date_immat = ddate(g("date_immat"))
    f.date_reglement = ddate(g("date_reglement"))
    f.lots = dint(g("lots"))
    f.lots_hab = dint(g("lots_hab"))
    f.periode = g("periode")
    f.iv = PERIODES.get(f.periode)
    if f.iv is None and f.periode not in PERIODES_INCONNUES:
        PERIODES_NON_RECONNUES[f.periode] += 1
    f.commune = g("commune")
    f.nom_commune = g("nom_commune")
    f.arr = g("arr")
    f.nom_arr = g("nom_arr")
    f.zone = zone_insee(f.arr, f.commune, idx)
    f.dept = g("dept")
    f.qp = bool(g("qp"))
    f.aidee = booleen(g("aidee"))
    f.residence = booleen(g("residence"))
    f.coop = booleen(g("coop"))
    f.principal = g("principal")
    f.lat = dfloat(g("lat"))
    f.lon = dfloat(g("lon"))
    if f.lat is not None and f.lon is not None and not (-90 <= f.lat <= 90 and -180 <= f.lon <= 180):
        f.lat = f.lon = None
    # représentant : SIRET d'un professionnel, sinon code
    if f.pro and f.siret:
        f.repr = f.siret
    elif f.pro:
        f.repr = PRO_SANS_SIRET
    elif f.type in ("bénévole", "benevole"):
        f.repr = BENEVOLE
    elif f.etat in (2, 3):
        f.repr = SANS_SYNDIC
    else:
        f.repr = NON_CONNU
    return f
