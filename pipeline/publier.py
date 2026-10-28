# -*- coding: utf-8 -*-
"""SyndicoScope - fichiers publiés de l'exécution nationale (spécification § 9.2).

<sortie>/site/ reçoit :
  manifest.json                      sommaire, seul fichier à nom fixe (à relire à chaque visite)
  d/<code>.<empreinte>.json          données d'un département, au format de donnees.json
  g/<code>.<empreinte>.json          contours de ses communes et arrondissements (format de contours.json)
  c/<type>-<code>.<empreinte>.json   jeux complémentaires d'un département, s'il en a (meta.complements)
  immat/<préfixe>.<empreinte>.json   index fragmenté numéro d'immatriculation -> département
  communes.<empreinte>.json          index national des zones (communes et arrondissements)

L'empreinte est le début du SHA-256 du contenu : un nom ne change que si le contenu change, et le
navigateur peut garder le fichier sans le redemander. Contrat : docs/contrat-des-donnees.md.

Contrôles bloquants, avant que le manifest ne soit écrit : tailles, champs publiés, coordonnées
arrondies, syndics masqués (entrepreneurs individuels, syndics non trouvés à l'annuaire) sans aucun de
leurs numéros, aucune dénomination publiée égale au nom d'un
représentant non professionnel du département (empreintes calculées avant blanchiment).
"""
import collections
import gzip
import hashlib
import json
import os
import re

from entreprises import normaliser

SCHEMA = 1
LONGUEUR_EMPREINTE = 10
CHAMPS_COPROS = ["immat", "lat", "lon", "zone", "lots", "periode", "syndic", "drapeaux", "syndic_t3", "retention"]
MOTIF_IMMAT = "^[A-Z]{2}[0-9]{7}$"
BUDGETS = {"d_octets": 6_000_000, "d_gzip": 1_500_000, "fragment": 100_000, "manifest": 30_000}
SEUILS_ALERTE = {"g_octets": 3_000_000, "g_gzip": 1_000_000, "communes_gzip": 600_000}
# Clés qui trahiraient une adresse, une personne ou l'état d'un mandat : jamais dans un fichier publié.
CLES_INTERDITES = {"adresse", "adresse_reference", "nom_usage", "nom_usage_copropriete", "representant",
                   "identification_representant_legal", "raison_sociale_representant_legal", "dirigeants",
                   "prenom", "prenoms", "nom_naissance", "date_naissance", "listepersonnes",
                   "date_fin_dernier_mandat", "date_fin", "mandat_en_cours", "reference_cadastrale", "parcelle"}
# Syndics masqués (build.masquer) : entrepreneurs individuels (ei) et syndics professionnels que l'annuaire
# ne connaît ni par leur SIRET ni par leur SIREN (nt). Publiés sous une clé de pseudonyme à la place du SIREN
# (ei-N, nt-N) et un libellé fixe à la place du nom, sans rien de ce qui suit.
MASQUES = {"ei": "Entrepreneur individuel",
           "nt": "Syndic professionnel non identifié au répertoire des entreprises"}
CLE_MASQUE = re.compile(r"(ei|nt)-[1-9]\d*")
CHAMPS_MASQUES = ("siret", "sigle", "enseignes", "bureau", "siege", "creation", "bodacc", "finances", "groupe",
                  "dirigee_par")
CHAMPS_NULS = CHAMPS_MASQUES + ("judilibre",)   # contrôlés : judilibre s'ajoute après le masquage, par SIREN
LIBELLES_FIXES = {normaliser(n) for n in MASQUES.values()}
NUMEROS = re.compile(r"(?<!\d)\d{9}(?:\d{5})?(?!\d)")   # SIREN ou SIRET dans un texte


def serialiser(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def taille_gzip(octets):
    return len(gzip.compress(octets, compresslevel=9, mtime=0))


def ecrire_hache(site, dossier, nom, obj):
    """Écrit obj sous <dossier>/<nom>.<empreinte>.json ; rend le chemin publié et les tailles."""
    b = serialiser(obj)
    h = hashlib.sha256(b).hexdigest()
    rel = "%s%s.%s.json" % (dossier + "/" if dossier else "", nom, h[:LONGUEUR_EMPREINTE])
    chemin = os.path.join(site, *rel.split("/"))
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    if not os.path.exists(chemin):   # même nom, même contenu
        with open(chemin + ".tmp", "wb") as f:
            f.write(b)
        os.replace(chemin + ".tmp", chemin)
    return {"fichier": rel, "octets": len(b), "octets_gzip": taille_gzip(b), "sha256": h}


def _chaines(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from _chaines(v)
    elif isinstance(x, (list, tuple)):
        for v in x:
            yield from _chaines(v)


def _cles(x, out):
    if isinstance(x, dict):
        for k, v in x.items():
            out.add(k)
            _cles(v, out)
    elif isinstance(x, list):
        for v in x:
            _cles(v, out)
    return out


def masque(s):
    """Masquage dû à un syndic : « ei » (entrepreneur individuel), « nt » (non trouvé à l'annuaire) ou None."""
    if s.get("ei"):
        return "ei"
    return None if s.get("trouve") else "nt"


def controler_masquage(donnees, sirens=None, sirets=None):
    """Syndics masqués (build.masquer) : clé ei-N ou nt-N, libellé fixe, ni identifiant, ni lieu, ni date de
    création, ni annonce. Si `sirens` (les vrais SIREN, connus de la seule chaîne locale) est donné, aucun
    d'eux nulle part dans le fichier, seul ou en tête d'un SIRET ; si `sirets` est donné, aucun de ces SIRET.
    Rend la liste des erreurs, sans aucun identifiant."""
    erreurs, mal = [], collections.Counter()
    for s in donnees.get("syndics") or []:
        t, cle = masque(s), str(s.get("siren") or "")
        if t and (not cle.startswith(t + "-") or not CLE_MASQUE.fullmatch(cle) or s.get("nom") != MASQUES[t]
                  or any(s.get(k) for k in CHAMPS_NULS)):
            mal[t] += 1
        elif not t and CLE_MASQUE.fullmatch(cle):
            mal["cle"] += 1
    if mal["ei"]:
        erreurs.append("%d entrepreneurs individuels mal masques" % mal["ei"])
    if mal["nt"]:
        erreurs.append("%d syndics non trouves a l'annuaire mal masques" % mal["nt"])
    if mal["cle"]:
        erreurs.append("%d syndics publies sous une cle de pseudonyme sans etre masques" % mal["cle"])
    return erreurs + controler_numeros("le fichier", donnees, sirens, sirets)


def controler_numeros(ou, obj, sirens=None, sirets=None):
    """Aucun numéro masqué dans `obj` sérialisé : SIREN seul ou en tête d'un SIRET, SIRET entier. Vaut pour
    donnees.json comme pour un jeu complémentaire. Rend la liste des erreurs, comptées, jamais citées."""
    if not sirens and not sirets:
        return []
    erreurs = []
    numeros = NUMEROS.findall(serialiser(obj).decode("utf-8"))
    n = len({x[:9] for x in numeros} & set(sirens or ()))
    if n:
        erreurs.append("%d SIREN de syndics masques presents dans %s" % (n, ou))
    n = len(set(numeros) & set(sirets or ()))
    if n:
        erreurs.append("%d SIRET de syndics masques presents dans %s" % (n, ou))
    return erreurs


def controler_departement(donnees, empreintes, a_verifier=None, masques=None):
    """Contrôles de publication d'un département. Rend (erreurs bloquantes, alertes). Les messages ne
    nomment personne et ne citent aucun identifiant (ils peuvent finir dans un journal public
    d'intégration continue) ; les SIRET à vérifier vont dans la liste `a_verifier`, si elle est donnée.
    `masques` : (SIREN, SIRET) qui ne doivent pas sortir (build.numeros_masques)."""
    erreurs, alertes = controler_masquage(donnees, *(masques or (None, None))), []
    interdites = sorted(_cles(donnees, set()) & CLES_INTERDITES)
    if interdites:
        erreurs.append("cles interdites publiees : %s" % interdites)
    champs = (donnees.get("copros") or {}).get("champs")
    if champs != CHAMPS_COPROS:
        erreurs.append("champs des coproprietes inattendus : %s" % champs)
    mal = 0
    for l in (donnees.get("copros") or {}).get("lignes") or []:
        if len(l) != len(CHAMPS_COPROS) or not isinstance(l[0], str) or \
                any(x is not None and (isinstance(x, bool) or not isinstance(x, (int, float))) for x in l[1:]) or \
                any(x is not None and round(x, 4) != x for x in l[1:3]):
            mal += 1
    if mal:
        erreurs.append("%d lignes de coproprietes hors format (types, coordonnees non arrondies)" % mal)
    nom_pro, nom_autre = set(), set()
    for s in donnees.get("syndics") or []:
        noms = [s.get("nom"), s.get("sigle")] + list(s.get("enseignes") or []) + list(s.get("dirigee_par") or [])
        if s.get("groupe"):
            noms.append(s["groupe"].get("libelle"))
        societe = bool(s.get("trouve")) and not s.get("ei")
        for ch in noms:
            n = normaliser(ch or "")
            if len(n.split()) < 2 or n in LIBELLES_FIXES:
                continue
            if hashlib.sha256(n.encode("utf-8")).hexdigest() in empreintes:
                (nom_pro if societe else nom_autre).add(s.get("siret"))
    if nom_autre:
        erreurs.append("%d syndics publient un nom egal a celui d'un representant non professionnel"
                       % len(nom_autre))
    if nom_pro:
        alertes.append("%d societes de l'annuaire portent un nom aussi declare par un representant non "
                       "professionnel (societe declaree comme benevole ?)" % len(nom_pro))
    if a_verifier is not None:
        a_verifier.extend(sorted(nom_autre | nom_pro))
    return erreurs, alertes


def bbox(geojson, lignes=()):
    """[lat min, lon min, lat max, lon max] du territoire (contours), à défaut des copropriétés."""
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")
    for f in (geojson or {}).get("features") or []:
        g = f.get("geometry") or {}
        polys = [g.get("coordinates")] if g.get("type") == "Polygon" else (g.get("coordinates") or [])
        for poly in polys:
            for x, y in poly[0]:
                x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
    if x0 == float("inf"):
        for l in lignes:
            if l[1] is not None and l[2] is not None:
                y0, y1, x0, x1 = min(y0, l[1]), max(y1, l[1]), min(x0, l[2]), max(x1, l[2])
    if x0 == float("inf"):
        return None
    return [round(y0, 4), round(x0, 4), round(y1, 4), round(x1, 4)]


def publier_departement(site, dep, nom, donnees, geojson, empreintes, complements=None, masques=None):
    """Écrit d/ et g/ d'un département après contrôle, et c/ pour ses jeux complémentaires. Rend (entrée du
    manifest, erreurs, alertes, détail) ; le détail (local, jamais publié) porte les empreintes des fichiers
    et les SIRET à vérifier."""
    a_verifier = []
    erreurs, alertes = controler_departement(donnees, empreintes, a_verifier, masques)
    for typ, obj in sorted((complements or {}).items()):
        erreurs += controler_numeros("le jeu complementaire %s" % typ, obj, *(masques or (None, None)))
    entree = {"nom": nom}
    detail = {"siret_a_verifier": a_verifier}
    if erreurs:
        return entree, erreurs, alertes, detail
    d = ecrire_hache(site, "d", dep, donnees)
    g = ecrire_hache(site, "g", dep, geojson)
    if complements:   # meta.complements dit lesquels ; ici, où les trouver
        entree["complements"] = {}
        for typ, obj in sorted(complements.items()):
            c = ecrire_hache(site, "c", "%s-%s" % (typ, dep), obj)
            entree["complements"][typ] = {"fichier": c["fichier"], "octets": c["octets"],
                                          "empreinte": c["sha256"][:LONGUEUR_EMPREINTE]}
    if d["octets"] > BUDGETS["d_octets"] or d["octets_gzip"] > BUDGETS["d_gzip"]:
        erreurs.append("donnees %s : %d octets, %d compresses (budget %d / %d)"
                       % (dep, d["octets"], d["octets_gzip"], BUDGETS["d_octets"], BUDGETS["d_gzip"]))
    if g["octets"] > SEUILS_ALERTE["g_octets"] or g["octets_gzip"] > SEUILS_ALERTE["g_gzip"]:
        alertes.append("contours %s : %d octets, %d compresses (repere %d / %d)"
                       % (dep, g["octets"], g["octets_gzip"], SEUILS_ALERTE["g_octets"], SEUILS_ALERTE["g_gzip"]))
    ch = donnees["meta"]["chiffres"]
    # le manifest tient sous 30 Ko pour 101 départements (mesuré : 30,6 Ko avec les copropriétés du T3 et le
    # nombre de lignes, qui restent dans le détail local et dans meta.chiffres du fichier du département)
    entree.update({"d": d["fichier"], "d_octets": d["octets"], "d_gzip": d["octets_gzip"],
                   "g": g["fichier"], "g_octets": g["octets"], "g_gzip": g["octets_gzip"],
                   "bbox": bbox(geojson, donnees["copros"]["lignes"]),
                   "copros": ch["copros_auj"], "syndics": len(donnees["syndics"])})
    detail.update({"d_sha256": d["sha256"], "g_sha256": g["sha256"], "copros_t3": ch["copros_t3"],
                   "lignes": len(donnees["copros"]["lignes"])})
    return entree, erreurs, alertes, detail


def fragments_immat(paires, budget=BUDGETS["fragment"], depart=3, maximum=6):
    """Index numéro -> département, fragmenté par préfixe. Un préfixe de `depart` caractères est
    allongé d'un caractère tant que son fragment dépasse `budget` octets (au plus `maximum`).
    Fragment : {"p": préfixe, "d": {département: [suffixes]}} ; le suffixe (numéro privé de son
    préfixe) est un entier, les numéros conformes ayant tous 9 caractères. Les numéros hors motif
    vont dans un fragment « autres », en entier et en chaînes. Rend ({préfixe: fragment}, autres)."""
    motif = re.compile(MOTIF_IMMAT)
    groupes = collections.defaultdict(list)
    autres = collections.defaultdict(list)
    for im, dep in paires:
        if motif.fullmatch(im):
            groupes[im[:depart]].append((im, dep))
        else:
            autres[dep].append(im)

    def fragment(p, items):
        par_dep = collections.defaultdict(list)
        for im, dep in items:
            par_dep[dep].append(int(im[len(p):]))
        return {"p": p, "d": {d: sorted(v) for d, v in sorted(par_dep.items())}}

    out = {}
    pile = sorted(groupes.items(), reverse=True)
    while pile:
        p, items = pile.pop()
        frag = fragment(p, items)
        if len(serialiser(frag)) <= budget or len(p) >= maximum:
            out[p] = frag
            continue
        sous = collections.defaultdict(list)
        for im, dep in items:
            sous[im[:len(p) + 1]].append((im, dep))
        pile.extend(sorted(sous.items(), reverse=True))
    autres_frag = {"p": "", "d": {d: sorted(v) for d, v in sorted(autres.items())}} if autres else None
    return out, autres_frag


def index_communes(par_dep):
    """Index national des zones, en colonnes : code, nom, type (c commune, a arrondissement), parent,
    département, centre (lat, lon au 1e-4) et découpage en arrondissements (1/0)."""
    cols = {k: [] for k in ("code", "nom", "type", "parent", "dep", "lat", "lon", "decoupee")}
    for dep, zones in par_dep:
        for z in zones:   # [code, nom, type, parent, lat, lon, decoupee] (meta.zones de donnees.json)
            cols["code"].append(z[0])
            cols["nom"].append(z[1])
            cols["type"].append("a" if z[2] == "arrondissement" else "c")
            cols["parent"].append(z[3])
            cols["dep"].append(dep)
            cols["lat"].append(None if z[4] is None else round(z[4], 4))
            cols["lon"].append(None if z[5] is None else round(z[5], 4))
            cols["decoupee"].append(1 if z[6] else 0)
    return dict(schema=SCHEMA, **cols)


def finaliser(site, entrees, zones_par_dep, paires_immat, infos, repartition, date_reference, date_t3,
              version, genere_le, maj=None, france=None):
    """Index des numéros, index des zones, manifest. `maj` : meta.maj de la France (dates de masse comptées
    sur toute la quotidienne). `france` : comptes ajoutés au bloc « france » (syndics, collectivités
    d'outre-mer non publiées). Rend (manifest, erreurs, alertes, détail)."""
    erreurs, alertes = [], []
    frags, autres = fragments_immat(paires_immat)
    publies = {}
    total = conformes = 0
    for p, frag in sorted(frags.items()):
        e = ecrire_hache(site, "immat", p, frag)
        if e["octets"] > BUDGETS["fragment"]:
            erreurs.append("fragment %s : %d octets (budget %d)" % (p, e["octets"], BUDGETS["fragment"]))
        publies[p] = e["fichier"].rsplit(".", 2)[1]
        n = sum(len(v) for v in frag["d"].values())
        total += n
        conformes += n
    autres_e = None
    if autres:
        autres_e = ecrire_hache(site, "immat", "autres", autres)
        total += sum(len(v) for v in autres["d"].values())
    index = index_communes(zones_par_dep)
    com = ecrire_hache(site, "", "communes", index)
    if com["octets_gzip"] > SEUILS_ALERTE["communes_gzip"]:
        alertes.append("index des communes : %d octets compresses (repere %d)"
                       % (com["octets_gzip"], SEUILS_ALERTE["communes_gzip"]))
    q, t = repartition["Q"], repartition["T"]
    # doublons écartés (lignes identiques sur toutes les colonnes) et variantes gardées, par département :
    # [quotidienne, T3], seulement là où il y en a
    for dep, e in entrees.items():
        dbl = [(q.get("doublons_ecartes_par_departement") or {}).get(dep, 0),
               (t.get("doublons_ecartes_par_departement") or {}).get(dep, 0)]
        var = [(q.get("lignes_variantes_par_departement") or {}).get(dep, 0),
               (t.get("lignes_variantes_par_departement") or {}).get(dep, 0)]
        if any(dbl):
            e["doublons_ecartes"] = dbl
        if any(var):
            e["variantes"] = var

    def source(info, s, *extra):
        out = {"url": info.get("url_source"), "date_fichier": info.get("date_fichier"), "lignes": s.get("lignes"),
               "lignes_gardees": s.get("lignes_gardees", s.get("lignes")), "doublons_ecartes": s.get("doublons_ecartes"),
               "variantes": s.get("lignes_variantes"), "octets": s.get("octets"), "sha256": s.get("sha256_brut")}
        out.update({k: s.get(k) for k in extra})
        return out
    manifest = {
        "schema": SCHEMA, "version": version, "genere_le": genere_le,
        "date_reference": date_reference, "date_t3": date_t3,
        "sources": {"rnic_quotidienne": source(infos["Q"], q, "derniere_maj"), "rnic_t3": source(infos["T"], t)},
        "france": dict({"copros": q.get("lignes_gardees", q.get("lignes")),
                        "copros_t3": t.get("lignes_gardees", t.get("lignes")),
                        "departements_vus": len(repartition.get("departements") or []),
                        "departements_publies": len(entrees),
                        "sans_departement": (q.get("departements") or {}).get("inconnu", 0)}, **(france or {})),
        "immat": {"regex": MOTIF_IMMAT, "conformes": conformes, "total": total,
                  "modele": "immat/{prefixe}.{empreinte}.json", "fragments": publies,
                  "autres": autres_e["fichier"] if autres_e else None},
        "communes": {"fichier": com["fichier"], "zones": len(index["code"]),
                     "octets": com["octets"], "octets_gzip": com["octets_gzip"]},
        "maj": maj,
        "departements": entrees,
    }
    # 101 départements, projection du 28/10/2026 : 27,7 Ko, dont 2,4 Ko pour maj (22 dates signalées, environ
    # 110 octets chacune) ; l'alerte prévient avant que le budget ne bloque la publication
    taille = len(serialiser(manifest))
    if taille > BUDGETS["manifest"]:
        erreurs.append("manifest : %d octets (budget %d)" % (taille, BUDGETS["manifest"]))
    elif taille > 0.9 * BUDGETS["manifest"]:
        alertes.append("manifest : %d octets, plus de 90 %% du budget (%d)" % (taille, BUDGETS["manifest"]))
    detail = {"fragments": len(publies), "fragment_max": max((len(serialiser(f)) for f in frags.values()), default=0),
              "prefixes": dict(collections.Counter(len(p) for p in publies)), "autres": total - conformes,
              "manifest_octets": taille, "communes": com}
    return manifest, erreurs, alertes, detail


def ecrire_manifest(site, manifest):
    """Écrit manifest.json, puis retire de site/ les fichiers qu'il ne désigne plus."""
    with open(os.path.join(site, "manifest.json.tmp"), "wb") as f:
        f.write(serialiser(manifest))
    os.replace(os.path.join(site, "manifest.json.tmp"), os.path.join(site, "manifest.json"))
    gardes = {manifest["communes"]["fichier"]}
    for e in manifest["departements"].values():
        gardes |= {e.get("d"), e.get("g")} | {c["fichier"] for c in (e.get("complements") or {}).values()}
    for p, h in manifest["immat"]["fragments"].items():
        gardes.add("immat/%s.%s.json" % (p, h))
    if manifest["immat"].get("autres"):
        gardes.add(manifest["immat"]["autres"])
    retires = 0
    for dossier in ("d", "g", "c", "immat", ""):
        base = os.path.join(site, dossier) if dossier else site
        if not os.path.isdir(base):
            continue
        for nom in os.listdir(base):
            rel = (dossier + "/" + nom) if dossier else nom
            if not os.path.isfile(os.path.join(base, nom)) or rel in gardes or rel == "manifest.json":
                continue
            if dossier or re.fullmatch(r"communes\.[0-9a-f]+\.json", nom):
                os.remove(os.path.join(base, nom))
                retires += 1
    return retires


def comparer(manifest, precedent, seuil_france=0.03, seuil_dep=0.10, plancher=50):
    """Écarts au manifest précédent (spec § 9.3) : France à ±3 %, chaque département à ±10 % s'il
    bouge d'au moins `plancher` copropriétés. Rend la liste des écarts (vide si tout va bien)."""
    ecarts = []
    if not precedent:
        return ecarts
    a = (precedent.get("france") or {}).get("copros")
    b = (manifest.get("france") or {}).get("copros")
    if a and b is not None and abs(b - a) / a > seuil_france:
        ecarts.append("France : %d coproprietes, %d le mois precedent (%+.1f %%)" % (b, a, 100.0 * (b - a) / a))
    avant = precedent.get("departements") or {}
    for dep, e in (manifest.get("departements") or {}).items():
        p = avant.get(dep)
        if not p or not p.get("copros"):
            continue
        x, y = p["copros"], e.get("copros") or 0
        if abs(y - x) / x > seuil_dep and abs(y - x) >= plancher:
            ecarts.append("%s : %d coproprietes, %d le mois precedent (%+.1f %%)" % (dep, y, x, 100.0 * (y - x) / x))
    return ecarts
