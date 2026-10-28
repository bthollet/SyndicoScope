# -*- coding: utf-8 -*-
"""Lecture nationale du registre des copropriétés : un seul passage en flux sur chacun des deux
fichiers complets (quotidienne et photographie T3 2025), qui répartit les lignes par département.

Pourquoi les fichiers complets, et non l'API tabulaire (spec § 9.3) : l'API refuse un extrait de plus
de 50 000 lignes (HTTP 403, mesuré le 28/10/2026) et pagine à 200 lignes ; la France entière y
demanderait des milliers d'appels. Les fichiers complets (environ 410 et 450 Mo) se lisent en flux :
la mémoire reste de quelques centaines de Mo, et rien du fichier brut n'est écrit sur disque.
Les en-têtes des fichiers bruts portent les mêmes noms de colonnes que l'API tabulaire (vérifié le
28/10/2026) : rnic.COLONNES vaut pour les deux.

Sorties, pour chaque département retenu, dans <departements>/<code>/cache/ : les mêmes fichiers que
l'extraction par département de build.py (rnic_quotidienne_dept<code>.csv, rnic_t3_2025_dept<code>.csv,
leurs .stats.json, empreintes_non_pro.json), que build.py reprend tels quels. Plus, une fois pour la
France, dans <departements>/ : les comptes par SIRET de syndic professionnel (national_par_siret.json),
le département de chaque numéro d'immatriculation (immats.tsv) et le bilan du passage
(repartition.json, écrit en dernier).

Confidentialité : la même que l'extraction par département. L'identité de tout représentant non
professionnel est retirée AVANT écriture ; seules les colonnes de rnic.COLONNES sont gardées :
ni adresse, ni nom d'usage, ni identification du représentant, ni parcelle.
"""
import collections
import csv
import hashlib
import io
import itertools
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request

import indicateurs
import rnic
from commun import UA, ErreurFatale, dint, ecrire_json, horodatage, lire_json

JEU_API = "https://www.data.gouv.fr/api/1/datasets/%s/" % rnic.JEU
NOMS_SOURCES = {"Q": ("rnic_quotidienne", 0), "T": ("rnic_t3_2025", 1)}
INCONNU = "inconnu"
MOTIF_IMMAT = r"[A-Z]{2}\d{7}"
SEPARATEUR = "\x1f"   # sépare les colonnes dans l'empreinte d'une ligne
JOUR = re.compile(r"\d{4}-\d\d-\d\d")
# Version de repartition.json : une répartition d'une version antérieure est refaite (2 : comptes par jour
# de la date de dernière mise à jour et dates de masse ; 3 : SIRET distincts par jour et dates signalées ;
# 28/10/2026).
SCHEMA_REPARTITION = 3

# Code officiel géographique ; 69 couvre le Rhône et la Métropole de Lyon, comme dans le registre.
NOMS_DEPARTEMENTS = {
    "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
    "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube", "11": "Aude",
    "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal", "16": "Charente",
    "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud", "2B": "Haute-Corse",
    "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs", "26": "Drôme",
    "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard", "31": "Haute-Garonne", "32": "Gers",
    "33": "Gironde", "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire",
    "38": "Isère", "39": "Jura", "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire",
    "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère",
    "49": "Maine-et-Loire", "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne",
    "54": "Meurthe-et-Moselle", "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
    "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône",
    "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
    "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
    "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse", "85": "Vendée",
    "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort",
    "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise",
    "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte",
}


def cle_departement(code):
    """Ordre usuel : 01 à 19, 2A, 2B, 21 à 95, puis 971 à 976."""
    return (len(code) == 3, {"2A": "20.1", "2B": "20.2"}.get(code, code))


def dep_normalise(v, arr=""):
    """Code de département : 01 à 95, 2A, 2B, 971 à 974 et 976 (975 est une collectivité d'outre-mer).
    Repli sur le code INSEE de l'arrondissement ou de la commune quand la colonne est vide ou porte
    l'ancien code corse « 20 »."""
    v = (v or "").strip().upper()
    if re.fullmatch(r"\d", v):
        v = "0" + v
    if re.fullmatch(r"\d\d|2A|2B|97[12346]", v) and v not in ("20", "00", "96", "97", "98", "99"):
        return v
    a = (arr or "").strip().upper()
    if re.fullmatch(r"97[12346]\d\d", a):
        return a[:3]
    if re.fullmatch(r"(\d\d|2A|2B)\d{3}", a) and a[:2] not in ("20", "00", "96", "97", "98", "99"):
        return a[:2]
    return ""


# Collectivités d'outre-mer présentes dans le registre : sans département, donc non publiées (28/10/2026).
COLLECTIVITES = {"975": "Saint-Pierre-et-Miquelon", "977": "Saint-Barthélemy", "978": "Saint-Martin"}


def collectivites(valeurs):
    """Lignes sans département qui relèvent d'une collectivité d'outre-mer, d'après les valeurs brutes
    « département|commune » relevées par repartir_source (sans_departement_valeurs) : {code: lignes}."""
    out = collections.Counter()
    for v, n in (valeurs or {}).items():
        code = next((x[:3] for x in v.split("|") if x[:3] in COLLECTIVITES), None)
        if code:
            out[code] += n
    return dict(sorted(out.items()))


def _date_url(url):
    m = re.search(r"/(\d{8})-(\d{6})/", url or "")
    return ("%s-%s-%s" % (m.group(1)[:4], m.group(1)[4:6], m.group(1)[6:])) if m else ""


def decouvrir(client, j, obj=None):
    """Identifiants des deux ressources, redécouverts depuis la fiche du jeu de données (spec § 9.3) ;
    repli sur les identifiants connus si la fiche ne les nomme plus comme attendu."""
    trouves = {}
    try:
        obj = obj if obj is not None else client.get_json(JEU_API)
        for r in obj.get("resources") or []:
            titre = r.get("title") or ""
            if re.search(r"actualisation quotidienne", titre, re.I):
                trouves.setdefault("Q", r.get("id"))
            elif re.search(r"T3 2025", titre) and re.search(r"nouveau format", titre, re.I):
                trouves.setdefault("T", r.get("id"))
    except Exception as e:   # la fiche est un confort : les identifiants connus suffisent
        j.ecrire("RESSOURCES", "fiche du jeu illisible", type(e).__name__, str(e)[:160])
    rids = {"Q": trouves.get("Q") or rnic.RID_Q, "T": trouves.get("T") or rnic.RID_T}
    j.ecrire("RESSOURCES", "quotidienne=%s" % rids["Q"], "t3=%s" % rids["T"],
             "decouvertes=%s" % sorted(trouves), "repli=%s" % sorted(set(rids) - set(trouves)))
    return rids


def infos_ressources(client, j):
    """Les deux fichiers sources : adresse, taille et date d'après la fiche du jeu, qui fait foi.
    Le nombre de lignes annoncé par l'API tabulaire sert de témoin, s'il porte sur le même fichier
    (elle moissonne la quotidienne une à deux heures après sa mise en ligne)."""
    try:
        obj = client.get_json(JEU_API)
    except Exception as e:
        j.ecrire("RESSOURCES", "fiche du jeu illisible", type(e).__name__, str(e)[:160])
        obj = {}
    rids = decouvrir(client, j, obj)
    par_id = {r.get("id"): r for r in obj.get("resources") or []}
    infos = {}
    for cle, rid in rids.items():
        r = par_id.get(rid) or {}
        info = {"rid": rid, "titre": r.get("title"), "url_source": r.get("url") or "",
                "octets_annonces": r.get("filesize"), "modifiee_le": r.get("last_modified"),
                "total_lignes": None, "temoin": "", "consultee_le": horodatage()}
        try:
            t = rnic.info_ressource(client, rid)
            if not info["url_source"]:
                info["url_source"] = t.get("url_source") or ""
            if t.get("url_source") == info["url_source"]:
                info["total_lignes"] = t.get("total_lignes")
                info["temoin"] = "API tabulaire, meme fichier"
            else:
                info["temoin"] = "API tabulaire sur un autre fichier (%s)" % (t.get("date_fichier") or "?")
        except Exception as e:
            info["temoin"] = "API tabulaire illisible (%s)" % type(e).__name__
        info["date_fichier"] = _date_url(info["url_source"])
        if not info["url_source"]:
            raise ErreurFatale("adresse du fichier %s introuvable (fiche du jeu et API tabulaire)" % cle)
        infos[cle] = info
        j.ecrire("RESSOURCES", cle, info["url_source"], "date=%s" % info["date_fichier"],
                 "octets=%s" % info["octets_annonces"], "temoin=%s" % info["temoin"],
                 "lignes annoncees=%s" % info["total_lignes"])
    return infos


class _LecteurHache(io.RawIOBase):
    """Enveloppe d'un flux binaire : compte les octets et calcule leur empreinte au passage."""

    def __init__(self, brut):
        self.brut = brut
        self.h = hashlib.sha256()
        self.n = 0

    def readable(self):
        return True

    def readinto(self, b):
        data = self.brut.read(len(b))
        n = len(data)
        b[:n] = data
        self.h.update(data)
        self.n += n
        return n


def ouvrir(client, source, j):
    """Flux texte d'un fichier distant (sans copie sur disque) ou local (archive de référence, jeu
    d'essai). TLS toujours vérifié : contexte du client (certifi s'il existe), sinon curl."""
    if os.path.exists(source):
        brut = open(source, "rb")
        fermer = brut.close
    else:
        brut = fermer = None
        if not client.curl:
            req = urllib.request.Request(source, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            try:
                rep = urllib.request.urlopen(req, timeout=300, context=client.ctx)
                if rep.status != 200:
                    raise ErreurFatale("flux %s : HTTP %d" % (source, rep.status))
                brut, fermer = rep, rep.close
            except urllib.error.HTTPError as e:
                raise ErreurFatale("flux %s : HTTP %d" % (source, e.code))
            except urllib.error.URLError as e:
                if not shutil.which("curl"):
                    raise
                j.ecrire("FLUX", "echec TLS ou reseau en Python (%s) : repli sur curl, verification conservee"
                         % type(e.reason).__name__)
        if brut is None:
            exe = shutil.which("curl")
            if not exe:
                raise ErreurFatale("ni Python ni curl ne peuvent lire %s" % source)
            p = subprocess.Popen([exe, "-sS", "-L", "--fail", "-A", UA, source], stdout=subprocess.PIPE)
            brut = p.stdout

            def fermer():
                p.stdout.close()
                if p.wait() != 0:
                    raise ErreurFatale("curl a echoue sur %s (code %s)" % (source, p.returncode))
    hache = _LecteurHache(brut)
    texte = io.TextIOWrapper(io.BufferedReader(hache, 1 << 20), encoding="utf-8-sig", newline="")
    return texte, hache, fermer


class _Ecrivains:
    """Un fichier d'extrait par département, ouvert à la première ligne, au format de rnic.ecrire_extrait."""

    def __init__(self, racine, nom, idx):
        self.racine, self.nom, self.idx = racine, nom, idx
        self.entete = [c[1 + idx] for c in rnic.COLONNES]
        self.fichiers = {}

    def chemin(self, dep):
        return os.path.join(self.racine, dep, "cache", "%s_dept%s.csv" % (self.nom, dep))

    def ecrire(self, dep, valeurs):
        e = self.fichiers.get(dep)
        if e is None:
            os.makedirs(os.path.dirname(self.chemin(dep)), exist_ok=True)
            f = open(self.chemin(dep) + ".tmp", "w", encoding="utf-8", newline="")
            w = csv.writer(f, delimiter=";", lineterminator="\n")
            w.writerow(self.entete)
            e = self.fichiers[dep] = (f, w)
        e[1].writerow(valeurs)

    def vide(self, dep):
        """Un département vu dans l'autre fichier seulement : extrait vide, en-tête compris."""
        if dep not in self.fichiers:
            os.makedirs(os.path.dirname(self.chemin(dep)), exist_ok=True)
            with open(self.chemin(dep) + ".tmp", "w", encoding="utf-8", newline="") as f:
                csv.writer(f, delimiter=";", lineterminator="\n").writerow(self.entete)
            self.fichiers[dep] = None

    def fermer(self, valider=True):
        """Ferme les extraits ; ils ne remplacent les précédents que si le passage est allé à son terme."""
        for dep, e in self.fichiers.items():
            if e:
                e[0].close()
            if valider:
                os.replace(self.chemin(dep) + ".tmp", self.chemin(dep))


def _empreinte_nom(nom):
    from entreprises import normaliser   # import tardif : entreprises importe commun, pas rnic
    n = normaliser(nom)
    return hashlib.sha256(n.encode("utf-8")).hexdigest() if len(n.split()) >= 2 else None


def repartir_source(client, j, cle, info, racine, controle_memoire=None, limite_lignes=None, garder=None):
    """Un passage sur un fichier national. `garder` : départements dont on écrit l'extrait (tous si None ;
    les comptes portent toujours sur la France). Rend (comptes par département, statistiques,
    agrégat par SIRET pour la quotidienne, empreintes par département, numéro -> département)."""
    nom, idx = NOMS_SOURCES[cle]
    source = info.get("fichier_local") or info["url_source"]
    t0, heure = time.monotonic(), horodatage()
    texte, hache, fermer = ouvrir(client, source, j)
    premiere = texte.readline()   # virgule dans les fichiers nationaux, point-virgule dans nos extraits
    lecteur = csv.reader(itertools.chain([premiere], texte),
                         delimiter=";" if premiere.count(";") > premiere.count(",") else ",")
    entete = [h.strip().strip('"').strip() for h in next(lecteur)]
    pos = {h: i for i, h in enumerate(entete)}
    voulues = [c[1 + idx] for c in rnic.COLONNES]
    absentes = [c for c in voulues if c not in pos]
    if absentes:
        fermer()
        raise ErreurFatale("%s : colonnes absentes du fichier : %s" % (nom, absentes))
    ip = [pos[c] for c in voulues]
    col = {c[0]: k for k, c in enumerate(rnic.COLONNES)}   # nom canonique -> rang dans l'extrait
    k_type, k_raison, k_siret, k_dept, k_arr = col["type"], col["raison"], col["siret"], col["dept"], col["arr"]
    k_etat, k_lots, k_immat, k_maj = col["etat"], col["lots"], col["immat"], col["maj"]
    ecr = _Ecrivains(racine, nom, idx)
    par_dep = collections.Counter()
    controles = collections.defaultdict(collections.Counter)
    etats = collections.Counter()
    empreintes = collections.defaultdict(set)
    inconnus_bruts = collections.Counter()
    ecartes_dep = collections.Counter()     # lignes identiques à une ligne déjà lue, écartées
    variantes_dep = collections.Counter()   # même numéro, contenu différent : gardées, comptées
    agg, sans_siret, n_pro = {}, 0, 0
    n, malformees, conformes = 0, 0, 0
    numeros = {}     # numéro -> (département, empreinte de la ligne entière) : doublons, index, comparaison
    variantes = {}   # numéro -> empreintes de ses autres lignes gardées (contenu différent)
    # date de dernière mise à jour, par jour : [fiches, dont hors « Mandat en cours »], France et départements
    jours = collections.defaultdict(lambda: [0, 0])
    jours_dep = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    sirets_jour = collections.defaultdict(set)   # France : SIRET de syndics professionnels par jour (comptés)
    maj_max = ""
    motif = re.compile(MOTIF_IMMAT)
    termine = False
    try:
        for ligne in lecteur:
            if not ligne:
                continue
            if len(ligne) != len(entete):
                malformees += 1
                continue
            n += 1
            if controle_memoire and n % 100000 == 0:
                controle_memoire("%s, %d lignes" % (nom, n))
            v = [ligne[i] for i in ip]
            im = (v[k_immat] or "").strip().upper()
            dep = dep_normalise(v[k_dept], v[k_arr]) or INCONNU
            # Doublons (règle du 28/10/2026) : une ligne identique sur TOUTES les colonnes du fichier à une
            # ligne déjà lue est écartée ; une ligne de même numéro au contenu différent est gardée et
            # comptée, sans rien trancher. Identité : empreinte BLAKE2b de 128 bits de la ligne entière.
            emp = hashlib.blake2b(SEPARATEUR.join(ligne).encode("utf-8"), digest_size=16).digest()
            vu = numeros.get(im)
            if vu is not None:
                if emp == vu[1] or emp in variantes.get(im, ()):
                    ecartes_dep[dep] += 1
                    if limite_lignes and n >= limite_lignes:
                        break
                    continue
                variantes.setdefault(im, set()).add(emp)
                variantes_dep[dep] += 1
            else:
                numeros[im] = (dep, emp)
            if dep == INCONNU:
                inconnus_bruts["%s|%s" % (v[k_dept].strip()[:4], v[k_arr].strip()[:3])] += 1
            typ = (v[k_type] or "").strip().lower()
            c = controles[dep]
            c["type=" + (typ or "(nul)")] += 1
            etats[(v[k_etat] or "").strip().lower() or "(nul)"] += 1
            a_siret = len(rnic.chiffres(v[k_siret])) == 14
            if typ != "professionnel":
                if (v[k_raison] or "").strip():
                    c["identite_hors_pro_blanchie"] += 1
                    e = _empreinte_nom(v[k_raison])
                    if e:
                        empreintes[dep].add(e)
                v[k_raison] = ""
                v[k_siret] = ""
            else:
                if not a_siret:
                    c["pro_sans_siret_valide"] += 1
                if cle == "Q":
                    n_pro += 1
                    s = rnic.chiffres(v[k_siret])
                    if len(s) == 14:
                        a = agg.setdefault(s, [0, 0])
                        a[0] += 1
                        a[1] += dint(v[k_lots]) or 0
                    else:
                        sans_siret += 1
            if motif.fullmatch(im):
                conformes += 1
            m = (v[k_maj] or "").strip()[:10]
            if JOUR.fullmatch(m):
                maj_max = max(maj_max, m)
                hors = 0 if (v[k_etat] or "").strip().lower() == "mandat en cours" else 1
                a, b = jours[m], jours_dep[dep][m]
                a[0] += 1
                a[1] += hors
                b[0] += 1
                b[1] += hors
                if typ == "professionnel" and a_siret:
                    sirets_jour[m].add(rnic.chiffres(v[k_siret]))
            if dep != INCONNU and (garder is None or dep in garder):
                ecr.ecrire(dep, v)
            par_dep[dep] += 1
            if limite_lignes and n >= limite_lignes:
                break
        termine = True
    finally:
        ecr.fermer(valider=termine)
        try:
            fermer()
        except ErreurFatale:
            if termine and not limite_lignes:
                raise
    duree = time.monotonic() - t0
    attendu = info.get("total_lignes")
    controle = "OK" if (limite_lignes or attendu is None or n == attendu) else "ECART"
    inconnus = [e for e in etats if e not in rnic.ETATS and e != "(nul)"]
    ecartes, n_variantes = sum(ecartes_dep.values()), sum(variantes_dep.values())
    stats = {"source": source, "heure": heure, "duree_s": round(duree, 1), "octets": hache.n,
             "sha256_brut": hache.h.hexdigest() if not limite_lignes else None,
             "lignes": n, "total_lignes_annonce": attendu, "temoin": info.get("temoin"), "controle": controle,
             "lignes_gardees": n - ecartes, "doublons_ecartes": ecartes,
             "doublons_ecartes_par_departement": dict(sorted(ecartes_dep.items(), key=lambda x: cle_departement(x[0]))),
             "lignes_variantes": n_variantes, "numeros_a_variantes": len(variantes),
             "lignes_variantes_par_departement": dict(sorted(variantes_dep.items(), key=lambda x: cle_departement(x[0]))),
             "lignes_malformees": malformees, "etats_mandat": dict(sorted(etats.items())),
             "etats_inconnus": inconnus, "numeros_conformes": conformes, "derniere_maj": maj_max or None,
             # 100 valeurs : de quoi compter toutes les collectivités d'outre-mer (5 valeurs le 28/10/2026)
             "sans_departement_valeurs": dict(inconnus_bruts.most_common(100)),
             "departements": dict(sorted(par_dep.items(), key=lambda x: cle_departement(x[0]))),
             "essai_limite": limite_lignes,
             "maj_par_jour": dict(sorted(jours.items())),
             "maj_sirets_par_jour": {d: len(s) for d, s in sorted(sirets_jour.items())},
             # retiré par repartir() après usage : chaque département le garde dans son .stats.json
             "maj_par_jour_departement": {d: dict(sorted(v.items())) for d, v in jours_dep.items()}}
    j.ecrire("REPARTITION", nom, "lignes=%d" % n, "annonce=%s" % attendu, "controle=%s" % controle,
             "departements=%d" % len(par_dep), "sans departement=%d" % par_dep.get(INCONNU, 0),
             "malformees=%d" % malformees, "doublons identiques ecartes=%d" % ecartes,
             "meme numero, contenu different, gardees=%d (%d numeros)" % (n_variantes, len(variantes)),
             "conformes=%d" % conformes, "octets=%d" % hache.n, "%.0f s" % duree)
    j.ecrire("DOUBLONS", nom, "ecartes par departement", stats["doublons_ecartes_par_departement"])
    if n_variantes:
        j.ecrire("DOUBLONS", nom, "variantes gardees par departement", stats["lignes_variantes_par_departement"])
    if inconnus:
        j.ecrire("ALERTE", nom, "etats de mandat inconnus", inconnus)
    nat = None
    if cle == "Q":
        somme = sum(a[0] for a in agg.values()) + sans_siret
        nat = {"stats": {"methode": "passage complet du fichier quotidien, doublons identiques ecartes",
                         "heure": heure, "meta_total": n_pro, "somme_des_comptes": somme,
                         "sans_siret_valide": sans_siret, "sirets": len(agg),
                         "controle": "OK" if somme == n_pro else "ECART"},
               "par_siret": agg}
    # un fichier de statistiques par département écrit, au format de l'extraction par l'API
    for dep, nb in par_dep.items():
        if dep != INCONNU and (garder is None or dep in garder):
            d_stats = {"url": source, "heure": heure, "lignes": nb, "meta_total": nb, "controle": "OK",
                       "methode": "passage complet du fichier national", "sha256_brut_national": stats["sha256_brut"],
                       "doublons_ecartes": ecartes_dep.get(dep, 0), "lignes_variantes": variantes_dep.get(dep, 0),
                       "controles": dict(sorted(controles[dep].items())),
                       "maj_par_jour": stats["maj_par_jour_departement"].get(dep, {})}
            ecrire_json(ecr.chemin(dep).replace(".csv", ".stats.json"), d_stats)
    return par_dep, stats, nat, empreintes, ecr, numeros


def masse(j, par_dep, france, sirets=None, premiers=10):
    """Dates de masse et dates signalées de la quotidienne (indicateurs, sur les comptes de la France), et ce
    qu'en disent les départements : ceux où une date de masse manque, ceux où la même règle, appliquée à
    leurs seuls comptes, donnerait d'autres dates. Les comptes ne nomment personne."""
    dates = indicateurs.dates_de_masse(france)
    total = sum(v[0] for v in france.values())
    deps = sorted((d for d in par_dep if d != INCONNU), key=cle_departement)
    absentes = {d: [x for x in dates if not (par_dep[d].get(x) or [0])[0]] for d in deps}
    autres = {d: indicateurs.dates_de_masse(par_dep[d]) for d in deps}
    out = {"seuil": indicateurs.SEUIL_MASSE, "dates": dates, "plancher": max(dates) if dates else None,
           "signalees": indicateurs.dates_signalees(france, dates), "fiches_datees": total,
           "premiers_jours": [[d, v[0], round(v[0] / total, 4), round(v[1] / v[0], 4), (sirets or {}).get(d, 0)]
                              for d, v in sorted(france.items(), key=lambda x: (-x[1][0], x[0]))[:premiers]],
           "departements": len(deps),
           "departements_sans_une_date": {d: v for d, v in absentes.items() if v},
           "departements_regle_differente": {d: v for d, v in autres.items() if v != dates}}
    j.ecrire("MASSE", "dates de masse=%s" % dates, "plancher=%s" % out["plancher"], "fiches datees=%d" % total,
             "dates signalees=%s" % out["signalees"],
             "departements ou une date manque=%s" % (out["departements_sans_une_date"] or "aucun"),
             "regle departementale differente=%s" % (out["departements_regle_differente"] or "aucun"))
    j.ecrire("MASSE", "jours les plus charges [date, fiches, part, part hors mandat en cours, SIRET distincts]",
             out["premiers_jours"])
    return out


def repartir(client, j, infos, racine, controle_memoire=None, limite_lignes=None, garder=None):
    """Les deux passages, puis les extraits vides, les empreintes et l'index des numéros.
    Rend {"Q": stats, "T": stats, "departements": [...], "garder": [...] ou None, "comparaison": {...}}."""
    res, ecrivains, deps, emp, numeros = {}, {}, set(), collections.defaultdict(set), {}
    for cle in ("Q", "T"):
        par_dep, stats, nat, e, ecr, numeros[cle] = repartir_source(
            client, j, cle, infos[cle], racine, controle_memoire, limite_lignes, garder)
        res[cle] = stats
        ecrivains[cle] = ecr
        deps |= set(par_dep)
        for d, s in e.items():
            emp[d] |= s
        if nat:
            ecrire_json(os.path.join(racine, "national_par_siret.json"), nat, compact=True)
    deps.discard(INCONNU)
    ecrits = deps if garder is None else deps & set(garder)
    res["Q"]["masse"] = masse(j, res["Q"].pop("maj_par_jour_departement"), res["Q"]["maj_par_jour"],
                              res["Q"]["maj_sirets_par_jour"])
    res["T"].pop("maj_par_jour_departement")
    for cle in ("Q", "T"):
        nom, idx = NOMS_SOURCES[cle]
        for d in sorted(ecrits):
            if os.path.exists(ecrivains[cle].chemin(d)):
                continue
            e = _Ecrivains(racine, nom, idx)
            e.vide(d)
            e.fermer()
            ecrire_json(e.chemin(d).replace(".csv", ".stats.json"),
                        {"url": res[cle]["source"], "heure": res[cle]["heure"], "lignes": 0, "meta_total": 0,
                         "controle": "OK", "methode": "passage complet du fichier national", "controles": {}})
    for d in ecrits:
        ecrire_json(os.path.join(racine, d, "cache", "empreintes_non_pro.json"), sorted(emp.get(d, ())))
    # Numéro -> département : la quotidienne d'abord (où la copropriété est aujourd'hui), puis les
    # copropriétés présentes au T3 seulement. Les numéros dont le département diffère entre les deux
    # fichiers sont comptés : la page les trouve dans le département d'aujourd'hui.
    q = {im: v[0] for im, v in numeros.pop("Q").items()}   # pop : chaque table quitte la mémoire aussitôt
    t = {im: v[0] for im, v in numeros.pop("T").items()}
    changes = collections.Counter((t[im], dq) for im, dq in q.items() if im in t and t[im] != dq)
    t_seules = sum(1 for im in t if im not in q)
    p = os.path.join(racine, "immats.tsv")
    with open(p + ".tmp", "w", encoding="utf-8", newline="\n") as f:
        for im, d in q.items():
            if im and d != INCONNU:
                f.write("%s\t%s\n" % (im, d))
        for im, d in t.items():
            if im and d != INCONNU and im not in q:
                f.write("%s\t%s\n" % (im, d))
    os.replace(p + ".tmp", p)
    res["comparaison"] = {"numeros_quotidienne": len(q), "numeros_t3": len(t), "t3_seulement": t_seules,
                          "quotidienne_seulement": sum(1 for im in q if im not in t),
                          "departement_change": sum(changes.values()),
                          "departement_change_detail": {"%s->%s" % k: v for k, v in changes.most_common(15)}}
    j.ecrire("REPARTITION", "comparaison des fichiers", res["comparaison"])
    del q, t
    res["departements"] = sorted(deps, key=cle_departement)
    res["garder"] = sorted(garder, key=cle_departement) if garder is not None else None
    # écrit en dernier : sans lui, la répartition est refaite au prochain lancement
    ecrire_json(os.path.join(racine, "repartition.json"),
                {"marqueur": marqueur(infos), "heure": horodatage(), "essai_limite": limite_lignes,
                 "Q": res["Q"], "T": res["T"], "departements": res["departements"], "garder": res["garder"],
                 "comparaison": res["comparaison"]})
    return res


def sirets_departements(racine, deps):
    """SIRET des syndics professionnels déclarés dans les extraits des départements (les deux fichiers),
    lus en flux : un SIRET, un appel à l'annuaire, quel que soit le nombre de départements."""
    out = set()
    for dep in deps:
        for nom, idx in (("rnic_quotidienne", 0), ("rnic_t3_2025", 1)):
            chemin = os.path.join(racine, dep, "cache", "%s_dept%s.csv" % (nom, dep))
            if not os.path.exists(chemin):
                continue
            c_type, c_siret = rnic.NOM["type"][idx], rnic.NOM["siret"][idx]
            with open(chemin, encoding="utf-8", newline="") as f:
                for l in csv.DictReader(f, delimiter=";"):
                    if (l.get(c_type) or "").strip().lower() == "professionnel":
                        s = rnic.chiffres(l.get(c_siret))
                        if len(s) == 14:
                            out.add(s)
    return sorted(out)


def lire_immats(racine):
    """Paires (numéro, département) écrites par repartir()."""
    with open(os.path.join(racine, "immats.tsv"), encoding="utf-8") as f:
        for ligne in f:
            im, _, d = ligne.rstrip("\n").partition("\t")
            if im and d:
                yield im, d


def marqueur(infos):
    """Ce qui identifie une répartition : sa version, les deux fichiers sources et leurs dates."""
    out = {k: {"rid": infos[k].get("rid"), "url_source": infos[k].get("url_source"),
               "date_fichier": infos[k].get("date_fichier"), "fichier_local": infos[k].get("fichier_local")}
           for k in ("Q", "T")}
    out["schema"] = SCHEMA_REPARTITION
    return out


def repartition_a_jour(racine, infos, garder=None):
    """Vrai si le dernier passage a lu les mêmes fichiers, jusqu'au bout, et a écrit les départements voulus."""
    m = lire_json(os.path.join(racine, "repartition.json"))
    if not m or m.get("marqueur") != marqueur(infos) or m.get("essai_limite"):
        return False
    if not os.path.exists(os.path.join(racine, "immats.tsv")):
        return False
    ecrits = m.get("garder")
    return ecrits is None or (garder is not None and set(garder) <= set(ecrits))
