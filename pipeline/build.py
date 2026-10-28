#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SyndicoScope - construit les données et les pages, d'un département ou de la France.

Un département, extrait par l'API tabulaire (au plus 50 000 lignes) :

    python -X utf8 -I pipeline/build.py --departement 13 --sortie build/13

  Écrit dans <sortie> :
    cache/      extraits et réponses d'API (reprise : rien n'est rappelé s'il est déjà là)
    donnees.json, contours.json, journal.txt
    site/index.html        page complète, autonome (données intégrées)
    artifact/index.html    fragment sans doctype, html, head ni body, + donnees.json et contours.json

Plusieurs départements, ou la France, par un passage en flux sur les deux fichiers nationaux :

    python -X utf8 -I pipeline/build.py --departements 13,2A,973 --sortie build/national
    python -X utf8 -I pipeline/build.py --tous --sortie build/national

  Le réseau d'abord, sans calcul lourd (annuaire, BODACC, contours ; reprise au lancement suivant) :

    python -X utf8 -I pipeline/build.py --tous --sortie build/national --reseau-seul --budget-appels 150

  Écrit dans <sortie> :
    cache/                       commun à tous les départements : annuaire (un SIRET, un appel), BODACC
                                 (un SIREN, un appel), contours simplifiés ; repris d'une exécution à l'autre
                                 sur le poste, jamais dans le cache d'Actions (le flux mensuel moissonne à neuf)
    departements/                répartition des deux fichiers nationaux (repartition.json, immats.tsv,
                                 national_par_siret.json) ; par département, <code>/cache/ (extraits),
                                 donnees.json, contours.json, indicateurs_departement.json
    site/                        fichiers à publier : manifest.json, d/, g/, immat/, communes.*.json
                                 (contrat : docs/contrat-des-donnees.md)
    controles.json, publication.json, journal.txt

  Un contrôle bloquant en échec arrête l'exécution avant l'écriture du manifest (spec § 9.3).

Le registre est déclaratif : l'outil restitue des déclarations et des taux de base, jamais l'état du droit.
"""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import os
import re
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # -I n'ajoute pas le dossier du script

import bodacc         # noqa: E402
import contours       # noqa: E402
import entreprises    # noqa: E402
import indicateurs    # noqa: E402
import national       # noqa: E402
import publier        # noqa: E402
import rnic           # noqa: E402
import rendu          # noqa: E402
from commun import (Client, ErreurFatale, Journal, VERSION, ddate, dire, ecrire_json, horodatage,  # noqa: E402
                    lire_json, maintenant, moins_mois, verifier_memoire)

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Drapeaux d'une copropriété (bits). Ni état ni date de mandat par copropriété dans le fichier publié :
# seulement des indicateurs dérivés, à la date des données.
DR_QP, DR_AIDEE, DR_RESIDENCE = 1, 2, 4
DR_FIN_PASSEE = 8          # « Mandat en cours » dont la date de fin déclarée est passée
DR_ABSENTE = 16            # présente au T3 2025, absente aujourd'hui (coordonnées et zone du T3)
DR_EN_COURS_DATEE = 32     # « Mandat en cours » avec une date de fin déclarée (dénominateur du drapeau 8)
DR_MAJ_12, DR_MAJ_18 = 64, 128   # « Mandat en cours », fiche non mise à jour depuis plus de 12 / 18 mois,
                                 # jamais posé quand les dates du registre ne permettent pas de le mesurer
DR_MAJ_CONNUE = 256        # « Mandat en cours » dont la date de dernière mise à jour est renseignée
                           # (dénominateur des drapeaux 64 et 128 ; meta.maj, contrat des données)
DRAPEAUX = {"qp": DR_QP, "aidee": DR_AIDEE, "residence": DR_RESIDENCE, "fin_passee": DR_FIN_PASSEE,
            "absente": DR_ABSENTE, "en_cours_datee": DR_EN_COURS_DATEE, "maj_12": DR_MAJ_12,
            "maj_18": DR_MAJ_18, "maj_connue": DR_MAJ_CONNUE}
REPR_PUBLIES = {rnic.BENEVOLE: "syndic bénévole", rnic.NON_CONNU: "type de syndic non connu, ou aucun syndic déclaré",
                rnic.PRO_SANS_SIRET: "syndic professionnel sans SIRET", rnic.ABSENTE: "absente du fichier"}


def empreintes_identites(lignes, idx):
    """Empreintes (sha256) des noms de représentants non professionnels, calculées AVANT blanchiment.
    Elles servent au contrôle de publication sans conserver un seul nom."""
    out = set()
    for l in lignes:
        if (l.get(rnic.NOM["type"][idx]) or "").strip().lower() != "professionnel":
            nom = entreprises.normaliser(l.get(rnic.NOM["raison"][idx]) or "")
            if len(nom.split()) >= 2:
                out.add(hashlib.sha256(nom.encode("utf-8")).hexdigest())
    return out


def extraire(client, j, cache, dept, reprise):
    res = {}
    empreintes = set(lire_json(os.path.join(cache, "empreintes_non_pro.json"), []) or [])
    for cle, rid, idx, nom in (("Q", rnic.RID_Q, 0, "rnic_quotidienne"), ("T", rnic.RID_T, 1, "rnic_t3_2025")):
        chemin = os.path.join(cache, "%s_dept%s.csv" % (nom, dept))
        stats_p = chemin.replace(".csv", ".stats.json")
        if reprise and os.path.exists(chemin) and os.path.exists(stats_p):
            lignes = rnic.lire_extrait(chemin)
            stats = lire_json(stats_p)
            j.ecrire("EXTRACTION", nom, "reprise depuis le cache", "lignes=%d" % len(lignes))
        else:
            rnic.verifier_swagger(client, j, rid, idx)
            # le blanchiment a lieu dans extraire_departement ; les empreintes se calculent juste avant
            lignes, stats = rnic.extraire_departement(
                client, j, rid, idx, dept, observer=lambda l, i: empreintes.update(empreintes_identites([l], i)))
            rnic.ecrire_extrait(chemin, lignes, idx)
            ecrire_json(stats_p, stats)
        res[cle] = (lignes, stats, idx)
        dire("   %s : %d lignes" % (nom, len(lignes)))
    ecrire_json(os.path.join(cache, "empreintes_non_pro.json"), sorted(empreintes))
    return res


def _perime(entree, jours):
    """Une réponse en cache plus vieille que `jours` jours est rappelée (0 : jamais)."""
    if not jours:
        return False
    try:
        h = dt.datetime.fromisoformat(str(entree.get("heure") or ""))
    except ValueError:
        return True
    if h.tzinfo is None:
        h = h.astimezone()
    return (maintenant() - h).days >= jours


def appels_externes(client, j, cache, sirets, sirens, reprise, rafraichir_jours=0, budget_s=None):
    """DINUM par SIRET et BODACC par SIREN, en parallèle (hôtes différents), caches incrémentaux.

    Un cache commun à tous les départements d'une exécution : un SIRET, un SIREN, un seul appel.
    `rafraichir_jours` : rappelle les réponses plus anciennes. `budget_s` : au-delà, les appels
    s'arrêtent ; une réponse manquante arrête alors l'exécution (reprise au lancement suivant,
    le cache étant gardé), une réponse seulement ancienne est gardée telle quelle.

    Le BODACC compare le commercant de chaque annonce détaillée aux noms de l'annuaire (identite) : il
    attend que l'annuaire ait répondu pour tous les SIRET du SIREN. Une réponse en cache d'un format
    antérieur qui a une famille d'alerte est complétée (bodacc.details, une requête)."""
    p_din, p_bod = os.path.join(cache, "dinum.json"), os.path.join(cache, "bodacc.json")
    din = (lire_json(p_din, {}) or {}) if reprise else {}
    bod = (lire_json(p_bod, {}) or {}) if reprise else {}
    erreurs = collections.Counter()
    fin = time.monotonic() + budget_s if budget_s else None
    restants = {}
    par_siren = collections.defaultdict(list)
    for s in sirets:
        par_siren[s[:9]].append(s)
    annuaire = threading.Condition()
    annuaire_fini = []

    def identite(siren):
        """{"ei", "noms"} d'un SIREN pour bodacc.details : noms d'une société lus dans les fiches de l'annuaire ;
        ceux d'un entrepreneur individuel lus à part et oubliés (entreprises.noms_transitoires)."""
        with annuaire:
            annuaire.wait_for(lambda: annuaire_fini or all(x in din for x in par_siren[siren]))
            fiches = [din[x] for x in par_siren[siren] if (din.get(x) or {}).get("trouve")]
        if not fiches:
            return {"ei": None, "noms": ()}
        if any(f.get("ei") for f in fiches):
            try:
                return {"ei": True, "noms": entreprises.noms_transitoires(client, siren)}
            except Exception as e:   # concordance inconnue : l'annonce reste non contrôlée
                j.ecrire("ERREUR", "noms transitoires", type(e).__name__, str(e)[:160])
                return {"ei": True, "noms": ()}
        noms = set()
        for f in fiches:
            noms.update(x for x in (f.get("nom"), f.get("nom_complet"), f.get("sigle")) if x)
            for e in (f.get("etab"), f.get("siege")):
                noms.update((e or {}).get("enseignes") or ())
        return {"ei": False, "noms": sorted(noms)}

    def fiche_annuaire(s):
        try:
            return entreprises.fiche_siret(client, s)
        finally:
            with annuaire:
                annuaire.notify_all()

    def annonces(s):
        e = bod.get(s)
        if e is not None and not _perime(e, rafraichir_jours) and bodacc.a_completer(e):
            return bodacc.details(client, e, identite)
        return bodacc.annonces_siren(client, s, identite)

    def boucle(nom, cles, fn, store, chemin):
        try:
            _boucle(nom, cles, fn, store, chemin)
        finally:
            if nom == "dinum":
                with annuaire:
                    annuaire_fini.append(True)
                    annuaire.notify_all()

    def _boucle(nom, cles, fn, store, chemin):
        manquants = [k for k in cles if k not in store or _perime(store[k], rafraichir_jours)
                     or (nom == "bodacc" and bodacc.a_completer(store[k]))]
        j.ecrire("APPELS", nom, "demandes=%d" % len(cles), "en cache=%d" % (len(cles) - len(manquants)),
                 "a rappeler=%d" % len(manquants))
        for i, k in enumerate(manquants, 1):
            if fin and time.monotonic() > fin:
                restants[nom] = [x for x in manquants[i - 1:] if x not in store]
                j.ecrire("BUDGET", nom, "temps d'appels epuise", "restant=%d" % (len(manquants) - i + 1),
                         "dont sans reponse=%d" % len(restants[nom]))
                break
            try:
                store[k] = fn(k)
            except Exception as e:   # un échec isolé ne doit pas tout arrêter ; repris au prochain lancement
                erreurs[nom] += 1
                j.ecrire("ERREUR", nom, k, type(e).__name__, str(e)[:160])
            if i % 50 == 0:
                ecrire_json(chemin, store)
                dire("   %s : %d / %d" % (nom, i, len(manquants)))
        ecrire_json(chemin, store)

    fils = [threading.Thread(target=boucle, args=("dinum", sirets, fiche_annuaire, din, p_din)),
            threading.Thread(target=boucle, args=("bodacc", sirens, annonces, bod, p_bod))]
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    j.ecrire("APPELS", "termine", "erreurs=%s" % dict(erreurs), "appels=%s" % client.appels)
    manque = sum(len(v) for v in restants.values())
    if manque:
        raise ErreurFatale("budget d'appels epuise : %d reponses manquent encore (cache garde, relancer pour reprendre)"
                           % manque)
    return din, bod


# Le registre mélange deux vocabulaires de périodes qui se chevauchent (« De 1949 à 1974 » et
# « DE_1949_A_1960 ») : le filtre « comparables » les range dans quatre classes qui contiennent
# chacune entièrement les périodes déclarées (contrôlé à la construction de la table).
CLASSES_CONSTRUCTION = [["Avant 1949", 0, 1948], ["De 1949 à 1974", 1949, 1974],
                        ["De 1975 à 2000", 1975, 2000], ["À partir de 2001", 2001, 9999]]
# Tranches de taille du filtre « comparables », sur le nombre total de lots.
TAILLES_FILTRE = [["2 à 10 lots", 0, 10], ["11 à 49 lots", 11, 49], ["50 à 199 lots", 50, 199],
                  ["200 lots et plus", 200, None]]


def periode_table():
    """Périodes déclarées distinctes, dans l'ordre chronologique : [libellé, début, fin, classe]."""
    vus = sorted(set(rnic.PERIODES.values()))

    def libelle(lo, hi):
        if lo == 0:
            return "avant %d" % (hi + 1)
        if hi == 9999:
            return "à partir de %d" % lo
        return "de %d à %d" % (lo, hi)

    def classe(lo, hi):
        for i, (_, a, b) in enumerate(CLASSES_CONSTRUCTION):
            if a <= lo and hi <= b:
                return i
        raise ValueError("période %d-%d hors des classes de construction" % (lo, hi))
    return [[libelle(lo, hi), lo, hi, classe(lo, hi)] for lo, hi in vus]


def r4(x):
    return None if x is None else round(x, 4)


def bureau(e):
    if not e:
        return None
    return {"lat": e.get("lat"), "lon": e.get("lon"), "commune": e.get("libelle_commune"), "zone": e.get("commune"),
            "siege": e.get("est_siege"), "etat": e.get("etat"), "precision": e.get("precision"), "siret": e.get("siret")}


def journal_groupes(j, din, groupes):
    """Premiers mots partagés hors liste de marques : à relire pour compléter entreprises.RESEAUX."""
    pm = collections.defaultdict(set)
    for f in din.values():
        if f.get("trouve") and not f.get("ei"):
            m = entreprises.premier_mot(f)
            if m:
                pm[m].add(f["siren"])
    candidats = sorted((m, len(s)) for m, s in pm.items() if len(s) > 1 and not entreprises.marque({"nom": m}))
    j.ecrire("GROUPES", "groupes presumes=%d" % len({g[0] for g in groupes.values()}),
             "societes groupees=%d" % len(groupes), "premiers mots partages hors liste=%s" % candidats)


def masquer(syndics):
    """Syndics masqués (demandes du 28/10/2026) : leur SIREN ne sort jamais de la chaîne. Celui d'un
    entrepreneur individuel mène à la personne ; un SIRET que l'annuaire ne connaît ni par lui-même ni par
    son SIREN peut être celui d'une personne non diffusible, ou un numéro mal saisi. Clé de pseudonyme stable
    dans le département (ei-1, ei-2… ; nt-1, nt-2…, dans l'ordre du SIREN), qui se décale quand un syndic
    arrive ou part ; libellé fixe ; ni SIRET, sigle, enseigne, bureau, siège, date de création ; ni annonces
    du BODACC (une date et un département suffisent à retrouver l'annonce, donc le nom), ni comptes, ni
    groupe, ni dirigeants. Restent ei, trouve, forme, tranche, effectif et les comptes nationaux de
    copropriétés et de lots. Rend le nombre de SIREN masqués par type : {"ei": n, "nt": n}."""
    par_type = {t: sorted({r["siren"] for r in syndics if publier.masque(r) == t}) for t in publier.MASQUES}
    cles = {(t, s): "%s-%d" % (t, i) for t, sirens in par_type.items() for i, s in enumerate(sirens, 1)}
    for r in syndics:
        t = publier.masque(r)
        if t:
            r.update(dict.fromkeys(publier.CHAMPS_MASQUES), siren=cles[(t, r["siren"])], nom=publier.MASQUES[t])
    return {t: len(s) for t, s in par_type.items()}


def numeros_masques(din, sirets=None):
    """Numéros qui ne sortent jamais de la chaîne, lus dans le cache local de l'annuaire : (SIREN, SIRET).
    SIREN des entrepreneurs individuels et des syndics non trouvés, sauf celui qu'une société publiée porte
    aussi ; SIRET des non trouvés. `sirets` : ceux d'un département ou d'un passage (tout le cache sinon) ;
    un SIRET sans réponse est traité comme non trouvé, ainsi que composer le publie."""
    fiches = [din.get(s) or {"siret": s, "siren": s[:9]} for s in (din if sirets is None else sirets)]
    publies = {f.get("siren") for f in fiches if f.get("trouve") and not f.get("ei")}
    sirens = {f.get("siren") or f["siret"][:9] for f in fiches if f.get("ei") or not f.get("trouve")}
    return sirens - publies, {f["siret"] for f in fiches if not f.get("trouve")}


def bodacc_publie(b, creation):
    """Champ bodacc publié d'un syndic et annonces d'alerte écartées (bodacc.publiables) : (champ, écartées).
    id, registre et commercant restent dans le cache (contrôle du rattachement), jamais publiés. Achats de
    fonds lus dans les comptes par famille (la liste détaillée peut être tronquée)."""
    if b is None:
        return None, collections.Counter()
    gardees, familles, ecart = bodacc.publiables(b, creation)
    achats = [v for f, v in b["familles"].items() if re.search(r"vente|cession", f, re.I)]
    return {
        "total": sum(v["n"] for v in familles.values()),
        "familles": {k: v["n"] for k, v in familles.items()},
        "premiere": min((v["premiere"] for v in familles.values() if v["premiere"]), default=None),
        "derniere": max((v["derniere"] for v in familles.values() if v["derniere"]), default=None),
        "procedures": [{k: x.get(k, "") for k in ("date", "type", "nature")} for x in gardees["procedures"]],
        "radiations": [x["date"] for x in gardees["radiations"]],
        "achats": sum(v["n"] for v in achats),
        "dernier_achat": max((v["derniere"] for v in achats if v["derniere"]), default=None),
        "heure": b.get("heure")}, ecart


def ecartees_publiees(c):
    """Comptes publiés des annonces d'alerte écartées (motifs de bodacc.publiables)."""
    return {"ecartees_nom_discordant": c.get("nom_discordant", 0), "ecartees_avant_creation": c.get("avant_creation", 0),
            "non_controlees": c.get("non_controlee", 0)}


def composer(dep, sortie, date_txt, exemple, ex, infos, din, bod, geo, zones, national, j, groupes=None,
             nom_departement=None, masse=None, signalees=None):
    """Données publiées d'un département. `groupes` : groupes de sociétés calculés une fois pour toute
    l'exécution (mode national) ; à défaut, calculés ici sur les fiches de `din`. `masse`, `signalees` :
    dates de masse et dates signalées de la France (passage national) ; à défaut, les mêmes règles sur les
    fiches du seul département."""
    date_ref = dt.date.fromisoformat(date_txt) if date_txt else maintenant().date()
    date_t3 = ddate(infos["T"]["date_fichier"]) or date_ref
    lignesQ, statsQ, _ = ex["Q"]
    lignesT, statsT, _ = ex["T"]
    Q = [rnic.construire_fiche(l, 0) for l in lignesQ]
    T = [rnic.construire_fiche(l, 1) for l in lignesT]
    IQ = {f.immat: f for f in Q}
    IT = {f.immat: f for f in T}
    jours = indicateurs.jours_maj(Q)
    if masse is None:
        masse = indicateurs.dates_de_masse(jours)
        signalees = indicateurs.dates_signalees(jours, masse)
        j.ecrire("MAJ", dep, "dates de masse et signalees tirees du seul departement (pas de comptes nationaux)",
                 masse, signalees)
    plancher = ddate(max(masse)) if masse else None
    mes = indicateurs.mesurabilite(date_ref, plancher)
    if len(IQ) != len(Q) or len(IT) != len(T):
        # Rien n'est tranché ici : le passage national n'écarte que les lignes identiques sur toutes les
        # colonnes du fichier ; ce qui reste (même numéro, contenu différent) est publié tel quel et signalé.
        j.ecrire("ALERTE", dep, "doublons de numero d'immatriculation", "Q %d/%d" % (len(IQ), len(Q)), "T3 %d/%d" % (len(IT), len(T)))
    if rnic.PERIODES_NON_RECONNUES:
        j.ecrire("ALERTE", dep, "periodes non reconnues", dict(rnic.PERIODES_NON_RECONNUES))

    if groupes is None:
        groupes = entreprises.regrouper(din)
        journal_groupes(j, din, groupes)
    sirets = sorted({f.repr for f in Q + T if isinstance(f.repr, str)})

    # --- syndics
    idx_de = {s: i for i, s in enumerate(sirets)}
    Q_par = collections.defaultdict(list)
    T_par = collections.defaultdict(list)
    for f in Q:
        if isinstance(f.repr, str):
            Q_par[f.repr].append(f)
    for f in T:
        if isinstance(f.repr, str):
            T_par[f.repr].append(f)
    nat_siret = (national or {}).get("par_siret", {})
    nat_siren = collections.defaultdict(lambda: [0, 0, 0])
    for s_, (nc, nl) in nat_siret.items():
        a = nat_siren[s_[:9]]
        a[0] += nc
        a[1] += nl
        a[2] += 1
    syndics = []
    local = {}   # indicateurs du département par SIRET : fichier local, non publié
    non_trouves = 0
    ecartees, sirens_ecarts = collections.Counter(), set()
    for s in sirets:
        d = din.get(s) or {}
        b = bod.get(s[:9])
        trouve = bool(d.get("trouve"))
        non_trouves += 0 if trouve else 1
        ei = bool(d.get("ei"))
        b_pub, ecart = bodacc_publie(b, d.get("date_creation"))
        if b is not None and not publier.masque({"ei": ei, "trouve": trouve}) and s[:9] not in sirens_ecarts:
            sirens_ecarts.add(s[:9])   # un SIREN compté une fois ; masqué, son BODACC n'est pas publié
            ecartees.update(ecart)
        nom = "" if ei or not trouve else (d.get("nom") or d.get("nom_complet") or "")   # masquer() pose les libellés
        fin = d.get("finances") or {}
        an = max(fin) if fin else None
        g = groupes.get(s[:9])
        etab, siege = bureau(d.get("etab")), bureau(d.get("siege"))
        if etab and siege and etab.get("siret") == siege.get("siret"):
            siege = None
        enseignes = sorted({x for e in (d.get("etab"), d.get("siege")) if e and e.get("enseignes") for x in e["enseignes"]}) if not ei else []
        pq, pt = Q_par.get(s, []), T_par.get(s, [])
        rec = {
            "siret": s, "siren": s[:9], "nom": nom, "ei": ei, "trouve": trouve,
            "sigle": None if ei else d.get("sigle"), "enseignes": enseignes or None,
            "forme": entreprises.forme(d.get("nature_juridique")) if trouve else "", "nature": d.get("nature_juridique"),
            "forme_courte": entreprises.forme_courte(d.get("nature_juridique")) if trouve else "",
            "creation": d.get("date_creation"), "tranche": d.get("tranche_effectif"),
            "effectif": entreprises.effectif(d.get("tranche_effectif")) if trouve else "", "effectif_annee": d.get("annee_effectif"),
            "categorie": d.get("categorie"), "etat": d.get("etat"), "naf": d.get("naf"),
            "etab_ouverts": d.get("nb_etab_ouverts"),
            "finances": {"annee": an, "ca": fin[an].get("ca"), "resultat": fin[an].get("resultat_net")} if an else None,
            "bureau": etab, "siege": siege,
            "groupe": {"id": g[0], "libelle": g[1], "preuves": g[2]} if g else None,
            "dirigee_par": sorted({x.get("denomination") or x["siren"] for x in (d.get("dirigeants_pm") or [])}) or None,
            "dinum": {"mode": d.get("mode"), "heure": d.get("heure")},
            "bodacc": b_pub,
            "national": {"copros_siret": (nat_siret.get(s) or [0, 0])[0], "lots_siret": (nat_siret.get(s) or [0, 0])[1],
                         "copros_siren": nat_siren[s[:9]][0], "lots_siren": nat_siren[s[:9]][1],
                         "sirets_du_siren": nat_siren[s[:9]][2]} if nat_siret else None,
            # champs prévus, calculés en P1 : dépôt des comptes (BODACC) et taux d'encadrement (DINUM + RNIC)
            "comptes": None, "encadrement": None,
        }
        syndics.append(rec)
        local[s] = {"auj": dict(indicateurs.profil(pq), **indicateurs.diligence(pq, date_ref, plancher)),
                    "t3": dict(indicateurs.profil(pt), **indicateurs.diligence(pt, date_t3, plancher)),
                    "ret": indicateurs.retention(s, pt, pq, IQ, IT, groupes)}
    masques = masquer(syndics)
    j.ecrire("SYNDICS", "sirets=%d" % len(sirets), "non trouves a la DINUM=%d (SIREN %d)" % (non_trouves, masques["nt"]),
             "entrepreneurs individuels=%d (SIRET %d)" % (masques["ei"], sum(1 for r in syndics if r["ei"])))

    # --- zones et copropriétés
    zone_idx = {z["code"]: i for i, z in enumerate(zones)}
    ptable = periode_table()
    pidx = {(lo, hi): i for i, (_, lo, hi, _c) in enumerate(ptable)}
    CAT = {c: i for i, c in enumerate(indicateurs.CAT_RETENTION)}
    zones_inconnues = collections.Counter()

    def code_repr(f):
        """Indice du syndic professionnel, sinon code. « Aucun syndic déclaré » est fondu dans
        « non connu » : la page n'en a pas besoin, et l'état du mandat d'une copropriété n'est pas publié."""
        if f is None:
            return rnic.ABSENTE
        if isinstance(f.repr, str):
            return idx_de[f.repr]
        return rnic.NON_CONNU if f.repr == rnic.SANS_SYNDIC else f.repr

    def zi(code):
        if code in zone_idx:
            return zone_idx[code]
        zones_inconnues[code] += 1
        return -1

    s12, s18 = moins_mois(date_ref, 12), moins_mois(date_ref, 18)
    lignes = []
    for f in Q:
        t = IT.get(f.immat)
        dr = 0
        dr |= DR_QP if f.qp else 0
        dr |= DR_AIDEE if f.aidee else 0
        dr |= DR_RESIDENCE if f.residence else 0
        if f.etat == 0 and f.fin:
            dr |= DR_EN_COURS_DATEE | (DR_FIN_PASSEE if f.fin < date_ref else 0)
        if f.etat == 0 and f.maj:
            dr |= DR_MAJ_CONNUE | (DR_MAJ_12 if mes[12] and f.maj < s12 else 0) | \
                (DR_MAJ_18 if mes[18] and f.maj < s18 else 0)
        lignes.append([f.immat, r4(f.lat), r4(f.lon), zi(f.zone), f.lots, pidx.get(f.iv, -1) if f.iv else -1,
                       code_repr(f), dr, code_repr(t),
                       CAT[indicateurs.categorie_retention(t.repr, t, IQ, groupes)] if (t and isinstance(t.repr, str)) else -1])
    for t in T:   # présentes au T3, absentes aujourd'hui : coordonnées et zone du T3
        if t.immat in IQ:
            continue
        lignes.append([t.immat, r4(t.lat), r4(t.lon), zi(t.zone), t.lots, pidx.get(t.iv, -1) if t.iv else -1,
                       rnic.ABSENTE, DR_ABSENTE | (DR_QP if t.qp else 0), code_repr(t),
                       CAT["absente"] if isinstance(t.repr, str) else -1])
    if zones_inconnues:
        j.ecrire("ALERTE", "codes de zone absents des contours", dict(zones_inconnues.most_common(20)))

    geoloc = sum(1 for f in Q if f.lat is not None and f.lon is not None)
    motif_ok = sum(1 for f in Q if re.fullmatch(r"[A-Z]{2}\d{7}", f.immat))
    j.ecrire("CONTROLES", "numeros conformes a 2 lettres + 7 chiffres : %d sur %d" % (motif_ok, len(Q)))
    base = {"auj": indicateurs.base_niveau(Q, date_ref, plancher), "t3": indicateurs.base_niveau(T, date_t3, plancher),
            "retention": indicateurs.base_retention(T, IQ, groupes)}
    maj = indicateurs.meta_maj(date_ref, masse, jours, signalees or (), indicateurs.sirets_par_jour(Q))
    dg = base["auj"]["toutes"]["diligence"]
    j.ecrire("MAJ", dep, "base (mandat en cours, date connue)=%d" % sum(1 for f in Q if f.etat == 0 and f.maj),
             "maj_12=%s" % dg["maj_12"], "maj_18=%s" % dg["maj_18"], "plancher=%s" % maj["plancher"],
             "mesurable=%s" % maj["mesurable"], "dates de masse=%s" % [(x["date"], x["n"]) for x in maj["dates_de_masse"]])
    ecrire_json(os.path.join(os.path.abspath(sortie), "indicateurs_departement.json"),
                {"date_reference": date_ref.isoformat(), "date_t3": date_t3.isoformat(), "base": base,
                 "par_siret": local}, compact=True)
    if exemple and exemple not in zone_idx:
        exemple = None
    if not exemple:
        cpt = collections.Counter(zones[l[3]]["code"] for l in lignes if l[3] >= 0 and l[1] is not None and l[6] != rnic.ABSENTE)
        arrs = [(n, c) for c, n in cpt.items() if zones[zone_idx[c]]["type"] == "arrondissement"]
        exemple = max(arrs)[1] if arrs else (max((n, c) for c, n in cpt.items())[1] if cpt else None)
    din_dep = [din[s] for s in sirets if s in din]
    bod_dep = [bod[s] for s in sorted({x[:9] for x in sirets}) if s in bod]
    meta = {
        "version": VERSION, "departement": dep, "nom_departement": nom_departement, "genere_le": horodatage(),
        "date_reference": date_ref.isoformat(), "date_t3": date_t3.isoformat(),
        "periodes": ptable, "classes_construction": CLASSES_CONSTRUCTION, "tailles": TAILLES_FILTRE,
        "representants": {str(k): v for k, v in REPR_PUBLIES.items()},
        "drapeaux": DRAPEAUX,
        "maj": maj,
        "complements": [],   # jeux complémentaires embarqués avec la page (rendu.lire_complements)
        "retention": indicateurs.CAT_RETENTION, "gains": indicateurs.CAT_GAIN,
        "zones": [[z["code"], z["nom"], z["type"], z["parent"], z["centre"][0] if z["centre"] else None,
                   z["centre"][1] if z["centre"] else None, z["decoupee"]] for z in zones],
        "exemple": exemple,
        "motif_immat": {"regex": "^[A-Z]{2}[0-9]{7}$", "conformes": motif_ok, "total": len(Q)},
        "chiffres": {"copros_auj": len(Q), "copros_t3": len(T), "geolocalisees_auj": geoloc,
                     "absentes_auj": len(lignes) - len(Q), "syndics_pro": len(sirets),
                     "syndics_pro_auj": len(Q_par), "syndics_pro_t3": len(T_par),
                     "dinum_trouves": len(sirets) - non_trouves, "sirens": len({s[:9] for s in sirets}),
                     "masques": masques},
        "sources": {
            "rnic_quotidienne": {k: infos["Q"].get(k) for k in ("url_source", "date_fichier", "total_lignes", "consultee_le")},
            "rnic_t3": {k: infos["T"].get(k) for k in ("url_source", "date_fichier", "total_lignes", "consultee_le")},
            "extraction_quotidienne": {k: statsQ.get(k) for k in ("heure", "lignes", "meta_total", "controle")},
            "extraction_t3": {k: statsT.get(k) for k in ("heure", "lignes", "meta_total", "controle")},
            "dinum": {"premier": min((d.get("heure") or "" for d in din_dep), default=""),
                      "dernier": max((d.get("heure") or "" for d in din_dep), default="")},
            "bodacc": dict({"premier": min((b.get("heure") or "" for b in bod_dep), default=""),
                            "dernier": max((b.get("heure") or "" for b in bod_dep), default="")},
                           **ecartees_publiees(ecartees)),
            "contours": {"heure": geo.get("heure")},
            "national": {k: ((national or {}).get("stats") or {}).get(k) for k in ("heure", "lignes", "meta_total", "controle")},
        },
        # contexte de zone prévu (P1, P2) : repère de prix par commune, signalements SignalConso
        "contexte": {"prix": None, "signalconso": None},
    }
    return {"meta": meta, "syndics": syndics, "copros": {"champs": list(publier.CHAMPS_COPROS), "lignes": lignes}}


def ajouter_judilibre(donnees, jl):
    """Comptes de décisions par SIREN (judilibre_local.py), pour les syndics qui en ont."""
    if not jl:
        return False
    par_siren = jl.get("par_siren", {})
    for s in donnees["syndics"]:
        v = par_siren.get(s["siren"])
        s["judilibre"] = v if v else None
    donnees["meta"]["sources"]["judilibre"] = jl.get("meta")
    return True


def masse_nationale(j, chemin):
    """Dates de masse et dates signalées de la France, lues dans le repartition.json d'un passage national
    complet : (masse, signalees) ; (None, None) sinon (composer applique alors les mêmes règles aux fiches
    du seul département)."""
    rep = lire_json(chemin) if chemin and os.path.exists(chemin) else None
    m = ((rep or {}).get("Q") or {}).get("masse")
    if not m or rep.get("essai_limite") or (rep.get("marqueur") or {}).get("schema") != national.SCHEMA_REPARTITION:
        j.ecrire("MAJ", "pas de comptes nationaux utilisables dans %s" % chemin)
        return None, None
    j.ecrire("MAJ", "dates de masse et signalees nationales lues dans %s" % chemin, m["dates"], m["signalees"],
             "quotidienne du %s" % ((rep.get("marqueur") or {}).get("Q") or {}).get("date_fichier"))
    return m["dates"], m["signalees"]


def complements(dep, donnees, j, lire=True):
    """Jeux complémentaires du département (rendu.lire_complements) ; meta.complements en donne la liste.
    `lire` faux (--sans-complements) : donnees_complementaires/ n'est pas ouvert, la liste reste vide."""
    if not lire:
        donnees["meta"]["complements"] = []
        j.ecrire("COMPLEMENTS", dep, "non lus (--sans-complements)")
        return {}
    try:
        comp = rendu.lire_complements(RACINE, dep)
    except ValueError as e:
        raise ErreurFatale(str(e))
    donnees["meta"]["complements"] = sorted(comp)
    for typ, obj in comp.items():
        b = publier.serialiser(obj)
        j.ecrire("COMPLEMENTS", dep, typ, "octets=%d" % len(b), "sha256=%s" % hashlib.sha256(b).hexdigest())
    return comp


def executer_departement(args, sortie, j):
    """Un département, extrait par l'API tabulaire (au plus 50 000 lignes), ou ses pages seules. Dans les
    deux cas, le masquage des syndics est contrôlé (publier.controler_masquage) avant toute écriture."""
    cache = os.path.join(sortie, "cache")
    os.makedirs(cache, exist_ok=True)
    if args.rendu_seul:
        donnees = lire_json(os.path.join(sortie, "donnees.json"))
        geojson = lire_json(os.path.join(sortie, "contours.json"))
        if not donnees or not geojson:
            raise ErreurFatale("rendu seul : donnees.json ou contours.json absent")
        din = lire_json(os.path.join(cache, "dinum.json"))
        if din:
            masques = numeros_masques(din)
        else:
            masques = (None, None)
            j.ecrire("ALERTE", "rendu seul : pas de cache local de l'annuaire ; masquage controle sur la structure, "
                     "sans balayage des numeros")
        avant = donnees["meta"].get("complements")
        comp = complements(args.departement, donnees, j, not args.sans_complements)
        ecrire = donnees["meta"]["complements"] != avant   # le fichier dit ce que la page embarque
    else:
        verifier_memoire(j, "demarrage")
        client = Client(j)
        reprise = not args.neuf
        dire("1/5 registre des copropriétés : métadonnées et extraction du département")
        p_inf = os.path.join(cache, "ressources.json")
        infos = lire_json(p_inf) if reprise else None
        if not infos:
            infos = {"Q": rnic.info_ressource(client, rnic.RID_Q), "T": rnic.info_ressource(client, rnic.RID_T)}
            ecrire_json(p_inf, infos)
        verifier_memoire(j, "avant extraction")
        ex = extraire(client, j, cache, args.departement, reprise)
        verifier_memoire(j, "apres extraction")
        p_nat = os.path.join(cache, "national_par_siret.json")
        agregat = lire_json(p_nat) if reprise else None
        if not agregat:
            agg, st_nat = rnic.extraire_national_sirets(client, j)
            agregat = {"stats": st_nat, "par_siret": agg}
            ecrire_json(p_nat, agregat, compact=True)
        fiches = [rnic.construire_fiche(l, i) for (ls, _, i) in ex.values() for l in ls]
        sirets = sorted({f.repr for f in fiches if isinstance(f.repr, str)})
        sirens = sorted({s[:9] for s in sirets})
        del fiches
        dire("2/5 annuaire des entreprises (%d SIRET) et BODACC (%d SIREN)" % (len(sirets), len(sirens)))
        verifier_memoire(j, "avant appels externes")
        din, bod = appels_externes(client, j, cache, sirets, sirens, reprise)
        manque = sum(1 for s in sirets if s not in din)
        if manque:   # sans réponse, un syndic serait publié comme « non identifié au répertoire »
            raise ErreurFatale("annuaire : %d SIRET sans reponse (erreurs d'appel) ; relancer pour reprendre" % manque)
        dire("3/5 contours")
        p_geo = os.path.join(cache, "contours_brut.json")
        geo = lire_json(p_geo) if reprise else None
        if not geo:
            geo = contours.telecharger(client, args.departement)
            ecrire_json(p_geo, geo)
        geojson, zones = contours.construire(geo)
        dire("4/5 indicateurs")
        verifier_memoire(j, "avant calculs")
        masse, signalees = masse_nationale(j, args.repartition or REPARTITION_LOCALE)
        donnees = composer(args.departement, sortie, args.date, args.exemple, ex, infos, din, bod, geo, zones,
                           agregat, j, nom_departement=national.NOMS_DEPARTEMENTS.get(args.departement),
                           masse=masse, signalees=signalees)
        masques = numeros_masques(din, sirets)
        comp = complements(args.departement, donnees, j, not args.sans_complements)
        ecrire = True
        ecrire_json(os.path.join(sortie, "contours.json"), geojson, compact=True)
        j.ecrire("APPELS", "total", client.appels)
    if args.judilibre and ajouter_judilibre(donnees, lire_json(args.judilibre)):
        ecrire = True
    erreurs = publier.controler_masquage(donnees, *masques)
    for typ, obj in sorted(comp.items()):
        erreurs += publier.controler_numeros("le jeu complementaire %s" % typ, obj, *masques)
    if erreurs:
        raise ErreurFatale("; ".join(erreurs))
    if ecrire:
        ecrire_json(os.path.join(sortie, "donnees.json"), donnees, compact=True)
    dire("5/5 pages")
    rendu.rendre(RACINE, sortie, donnees, geojson, comp)


# Empreinte de la photographie T3 2025 (fichier figé, deux ressources de même contenu sur data.gouv.fr),
# mesurée sur le fichier complet. Un fichier différent arrête l'exécution : la référence a changé.
T3_SHA256 = "6bcb9d657874db80f39393333df65975387a0c50b1f8cd20cf54d72b1c7aab11"   # 452 973 300 octets, lu le 28/10/2026
# Répartition nationale lue par défaut par le mode « un département » (dates de masse de la France).
REPARTITION_LOCALE = os.path.join(RACINE, "build", "national", "departements", "repartition.json")


def contours_departement(client, cache, dep, reprise, max_jours=180):
    """Contours simplifiés d'un département, en cache commun (quelques centaines de Ko) ; le brut de
    geo.api.gouv.fr n'est pas gardé. Rappelés au-delà de `max_jours`."""
    p = os.path.join(cache, "contours", "%s.json" % dep)
    c = lire_json(p) if reprise else None
    if c and not _perime(c, max_jours):
        return c
    geo = contours.telecharger(client, dep)
    geojson, zones = contours.construire(geo)
    c = {"heure": geo["heure"], "urls": geo["urls"], "geojson": geojson, "zones": zones}
    ecrire_json(p, c, compact=True)
    return c


def departements_demandes(args):
    if args.tous:
        return None
    out = []
    for x in args.departements.split(","):
        x = x.strip().upper()
        if not x:
            continue
        d = national.dep_normalise(x) or x
        if d not in national.NOMS_DEPARTEMENTS:
            raise SystemExit("Département inconnu : %s" % x)
        out.append(d)
    if not out:
        raise SystemExit("Aucun département demandé.")
    return sorted(set(out), key=national.cle_departement)


def executer_national(args, sortie, j):
    """Passage national : les deux fichiers complets lus une fois, puis chaque département, puis le site."""
    date_ref = dt.date.fromisoformat(args.date) if args.date else maintenant().date()
    racine = os.path.join(sortie, "departements")
    cache = os.path.join(sortie, "cache")
    site = os.path.join(sortie, "site")
    os.makedirs(cache, exist_ok=True)
    reprise = not args.neuf
    controles, echecs = [], []
    t_debut = time.monotonic()

    def noter(nom, ok, detail, bloquant=True):
        res = "OK" if ok else ("ECHEC" if bloquant else "ALERTE")
        controles.append({"controle": nom, "resultat": res, "detail": detail})
        j.ecrire("CONTROLE", nom, res, detail)
        if not ok and bloquant:
            echecs.append("%s : %s" % (nom, detail))

    def arreter_si_echec(etape):
        ecrire_json(os.path.join(sortie, "controles.json"), controles)
        if echecs:
            raise ErreurFatale("controles bloquants en echec (%s) : %s" % (etape, " ; ".join(echecs)))

    garder = departements_demandes(args)
    verifier_memoire(j, "demarrage")
    client = Client(j)
    dire("1/6 registre des copropriétés : fichiers nationaux")
    infos = national.infos_ressources(client, j)
    for cle, src in (("Q", args.source_q), ("T", args.source_t)):
        if src and os.path.exists(src):
            infos[cle]["fichier_local"] = os.path.abspath(src)
            infos[cle]["total_lignes"], infos[cle]["temoin"] = None, "fichier local, pas de temoin"
        elif src:
            infos[cle].update({"url_source": src, "date_fichier": national._date_url(src) or infos[cle]["date_fichier"],
                               "total_lignes": None, "temoin": "adresse imposee, pas de temoin"})
    ecrire_json(os.path.join(cache, "ressources.json"), infos)
    d_q = ddate(infos["Q"].get("date_fichier"))
    if args.fraicheur_jours:
        noter("fraicheur de la quotidienne", d_q is not None and (date_ref - d_q).days <= args.fraicheur_jours,
              "fichier du %s, reference %s, tolerance %d jours" % (d_q, date_ref, args.fraicheur_jours))
    arreter_si_echec("sources")

    if reprise and national.repartition_a_jour(racine, infos, garder):
        rep = lire_json(os.path.join(racine, "repartition.json"))
        j.ecrire("REPARTITION", "reprise : memes fichiers, passage deja fait le %s" % rep.get("heure"))
        dire("   répartition reprise (fichiers inchangés)")
    elif args.reseau_seul:   # la répartition est le calcul lourd : jamais lancée par ce mode
        raise ErreurFatale("reseau seul : pas de repartition a jour des fichiers du jour ; la faire d'abord")
    else:
        verifier_memoire(j, "avant repartition")
        rep = national.repartir(client, j, infos, racine, controle_memoire=lambda e: verifier_memoire(j, e),
                                limite_lignes=args.limite_lignes, garder=set(garder) if garder else None)
    q, t = rep["Q"], rep["T"]
    for cle, s, nom in (("Q", q, "quotidienne"), ("T", t, "T3 2025")):
        noter("lignes lues = lignes annoncees (%s)" % nom, s.get("controle") == "OK",
              "%s lues, %s annoncees (%s)" % (s.get("lignes"), s.get("total_lignes_annonce"), s.get("temoin")))
        noter("etats de mandat connus (%s)" % nom, not s.get("etats_inconnus"),
              "inconnus : %s" % (s.get("etats_inconnus") or "aucun"))
        n, mal = s.get("lignes") or 0, s.get("lignes_malformees") or 0
        noter("lignes malformees (%s)" % nom, mal <= 0.001 * max(n, 1), "%d sur %d" % (mal, n), bloquant=mal > 0.001 * max(n, 1))
        if mal:
            noter("lignes malformees, alerte (%s)" % nom, False, "%d lignes ecartees" % mal, bloquant=False)
        sd = (s.get("departements") or {}).get(national.INCONNU, 0)
        noter("lignes sans departement (%s)" % nom, sd <= 0.01 * max(n, 1), "%d sur %d ; valeurs : %s"
              % (sd, n, s.get("sans_departement_valeurs")), bloquant=sd > 0.01 * max(n, 1))
    gardees = q.get("lignes_gardees", q.get("lignes")) or 0
    noter("motif des numeros (quotidienne)", (q.get("numeros_conformes") or 0) >= 0.995 * max(gardees, 1),
          "%s conformes a %s sur %s lignes gardees" % (q.get("numeros_conformes"), publier.MOTIF_IMMAT, gardees),
          bloquant=False)
    for cle, s, nom in (("Q", q, "quotidienne"), ("T", t, "T3 2025")):
        noter("doublons identiques ecartes (%s)" % nom, not s.get("doublons_ecartes"),
              "%s lignes identiques sur toutes les colonnes a une ligne deja lue, ecartees ; par departement : %s"
              % (s.get("doublons_ecartes"), s.get("doublons_ecartes_par_departement")), bloquant=False)
        noter("meme numero, contenu different (%s)" % nom, not s.get("lignes_variantes"),
              "%s lignes gardees sans rien trancher (%s numeros) ; par departement : %s"
              % (s.get("lignes_variantes"), s.get("numeros_a_variantes"), s.get("lignes_variantes_par_departement")),
              bloquant=False)
    if not rep.get("Q", {}).get("essai_limite"):
        attendu = args.t3_sha256 or T3_SHA256
        if attendu:
            noter("empreinte du T3 2025", t.get("sha256_brut") == attendu, "lue %s, attendue %s" % (t.get("sha256_brut"), attendu))
        else:
            noter("empreinte du T3 2025", False, "reference non fixee ; lue %s" % t.get("sha256_brut"), bloquant=False)
    agregat = lire_json(os.path.join(racine, "national_par_siret.json")) or {}
    noter("comptes nationaux par SIRET", (agregat.get("stats") or {}).get("controle") == "OK", agregat.get("stats"))
    deps = rep["departements"] if garder is None else garder
    absents = [d for d in deps if d not in rep["departements"]]
    noter("departements demandes presents", not absents, "absents : %s" % (absents or "aucun"))
    ms = q.get("masse") or {}
    masse, signalees = ms.get("dates") or [], ms.get("signalees") or []
    maj_nat = indicateurs.meta_maj(date_ref, masse, q.get("maj_par_jour") or {}, signalees, q.get("maj_sirets_par_jour"))
    noter("dates de masse (quotidienne)", True, "dates %s, plancher %s, mesurable %s, a partir du %s ; dates signalees %s"
          % (masse, maj_nat["plancher"], maj_nat["mesurable"], maj_nat["mesurable_a_partir_du"], signalees),
          bloquant=False)
    if ms.get("departements_sans_une_date") or ms.get("departements_regle_differente"):
        noter("dates de masse par departement", False, "une date de masse manque : %s ; la regle appliquee au seul "
              "departement donne d'autres dates : %s" % (ms.get("departements_sans_une_date") or "aucun",
                                                         ms.get("departements_regle_differente") or "aucun"),
              bloquant=False)
    arreter_si_echec("repartition")
    if args.repartition_seule:
        dire("répartition faite et contrôlée : %d départements, %.0f s" % (len(rep["departements"]),
                                                                          time.monotonic() - t_debut))
        return

    dire("2/6 annuaire des entreprises et BODACC (cache commun aux départements)")
    sirets = national.sirets_departements(racine, deps)
    sirens = sorted({s[:9] for s in sirets})
    dire("   %d SIRET, %d SIREN" % (len(sirets), len(sirens)))
    verifier_memoire(j, "avant appels externes")
    din, bod = appels_externes(client, j, cache, sirets, sirens, reprise, args.rafraichir_jours,
                               args.budget_appels * 60 if args.budget_appels else None)
    # Un SIRET sans réponse serait publié comme « non identifié au répertoire » : bloquant. Une réponse du
    # BODACC qui manque laisse le champ bodacc vide : alerte.
    manque = sum(1 for s in sirets if s not in din)
    noter("reponses de l'annuaire completes", not manque,
          "%d SIRET sans reponse sur %d (erreurs d'appel ; relancer pour reprendre)" % (manque, len(sirets)))
    manque = sum(1 for s in sirens if s not in bod)
    noter("reponses du BODACC completes", not manque, "%d SIREN sans reponse sur %d" % (manque, len(sirens)),
          bloquant=False)
    manque = sum(1 for s in sirens if s in bod and bodacc.a_completer(bod[s]))
    noter("annonces d'alerte du BODACC controlees", not manque, "%d SIREN d'un format anterieur, annonces d'alerte "
          "non publiees (relancer pour completer)" % manque, bloquant=False)
    if args.reseau_seul:
        dire("réseau seul : contours, un département à la fois (cache commun)")
        for k, dep in enumerate(deps, 1):
            c = contours_departement(client, cache, dep, reprise)
            dire("   %s (%d/%d) : %d zones" % (dep, k, len(deps), len(c["zones"])))
            del c
        arreter_si_echec("reseau")
        j.ecrire("APPELS", "total", client.appels)
        dire("réseau terminé en %.0f s : %d SIRET, %d SIREN, %d départements" % (time.monotonic() - t_debut,
                                                                                  len(sirets), len(sirens), len(deps)))
        return
    arreter_si_echec("appels")
    groupes = entreprises.regrouper({s: din[s] for s in sirets if s in din})
    journal_groupes(j, din, groupes)
    masques = numeros_masques(din, sirets)
    jl = lire_json(args.judilibre) if args.judilibre else None

    dire("3/6 contours, indicateurs et contrôles de publication, département par département")
    entrees, zones_par_dep, detail = {}, [], {}
    for k, dep in enumerate(deps, 1):
        t0 = time.monotonic()
        nom = national.NOMS_DEPARTEMENTS.get(dep, dep)
        verifier_memoire(j, "departement %s" % dep)
        d_dir = os.path.join(racine, dep)
        ex = {}
        for cle, idx, nom_f in (("Q", 0, "rnic_quotidienne"), ("T", 1, "rnic_t3_2025")):
            chemin = os.path.join(d_dir, "cache", "%s_dept%s.csv" % (nom_f, dep))
            ex[cle] = (rnic.lire_extrait(chemin), lire_json(chemin.replace(".csv", ".stats.json")) or {}, idx)
        c = contours_departement(client, cache, dep, reprise)
        donnees = composer(dep, d_dir, args.date, args.exemple, ex, infos, din, bod, {"heure": c["heure"]},
                           c["zones"], agregat, j, groupes=groupes, nom_departement=nom, masse=masse,
                           signalees=signalees)
        ajouter_judilibre(donnees, jl)
        comp = complements(dep, donnees, j, not args.sans_complements)
        ecrire_json(os.path.join(d_dir, "donnees.json"), donnees, compact=True)
        ecrire_json(os.path.join(d_dir, "contours.json"), c["geojson"], compact=True)
        if args.pages:
            rendu.rendre(RACINE, d_dir, donnees, c["geojson"], comp)
        empreintes = set(lire_json(os.path.join(d_dir, "cache", "empreintes_non_pro.json"), []) or [])
        entree, err, alr, det = publier.publier_departement(site, dep, nom, donnees, c["geojson"], empreintes, comp,
                                                            masques)
        if det.get("siret_a_verifier"):   # journal local seulement : jamais dans un message affiché
            j.ecrire("A VERIFIER", dep, "SIRET dont un nom publie egale celui d'un representant non professionnel",
                     det["siret_a_verifier"])
        for e in err:
            noter("publication %s" % dep, False, e)
        for a in alr:
            noter("publication %s" % dep, False, a, bloquant=False)
        entrees[dep] = entree
        zones_par_dep.append((dep, donnees["meta"]["zones"]))
        det["duree_s"] = round(time.monotonic() - t0, 1)
        detail[dep] = det
        dire("   %s %s (%d/%d) : %d copropriétés, %d syndics, %s octets, %.0f s"
             % (dep, nom, k, len(deps), entree.get("copros", 0), entree.get("syndics", 0), entree.get("d_octets"),
                det["duree_s"]))
        del ex, donnees, c
    arreter_si_echec("departements")

    dire("4/6 index des numéros, index des zones, manifest")
    # Comptes de la France : syndics publiés (SIRET distincts, tous départements) et syndics masqués (SIREN
    # distincts) ; lignes des collectivités d'outre-mer, sans département, non publiées dans cette version.
    fiches = [din.get(s) or {"siren": s[:9]} for s in sirets]
    ecart = collections.Counter()
    for f in {f["siren"]: f for f in fiches if f.get("trouve") and not f.get("ei")}.values():
        ecart.update(bodacc_publie(bod.get(f["siren"]), f.get("date_creation"))[1])
    france = {"syndics": {"sirets": len(sirets),
                          "ei": len({f["siren"] for f in fiches if f.get("ei")}),
                          "nt": len({f["siren"] for f in fiches if not f.get("trouve")})},
              "bodacc": ecartees_publiees(ecart),
              "collectivites_outre_mer": national.collectivites(q.get("sans_departement_valeurs"))}
    j.ecrire("FRANCE", france)
    manifest, err, alr, det = publier.finaliser(
        site, entrees, zones_par_dep, national.lire_immats(racine), infos, rep, date_ref.isoformat(),
        (ddate(infos["T"].get("date_fichier")) or date_ref).isoformat(), VERSION, horodatage(), maj_nat, france)
    for e in err:
        noter("publication nationale", False, e)
    for a in alr:
        noter("publication nationale", False, a, bloquant=False)
    detail["national"] = det
    dire("5/6 comparaison avec la publication précédente")
    precedent = lire_json(args.precedent) if args.precedent else None
    ecarts = publier.comparer(manifest, precedent)
    noter("ecarts au mois precedent", not ecarts,
          "; ".join(ecarts) if ecarts else ("aucun" if precedent else "pas de publication precedente"))
    arreter_si_echec("publication")
    retires = publier.ecrire_manifest(site, manifest)
    detail["retires"] = retires
    ecrire_json(os.path.join(sortie, "publication.json"), detail)
    j.ecrire("APPELS", "total", client.appels)
    dire("6/6 terminé en %.0f s : %d départements, manifest %d octets, %d fichiers périmés retirés"
         % (time.monotonic() - t_debut, len(entrees), det["manifest_octets"], retires))


def principal():
    ap = argparse.ArgumentParser(description="SyndicoScope : données et pages d'un département ou de la France")
    qui = ap.add_mutually_exclusive_group(required=True)
    qui.add_argument("--departement", help="un département, extrait par l'API tabulaire (au plus 50 000 lignes)")
    qui.add_argument("--departements", help="départements séparés par des virgules (passage national, ex. 13,2A,973)")
    qui.add_argument("--tous", action="store_true", help="tous les départements (passage national)")
    ap.add_argument("--sortie", required=True)
    ap.add_argument("--neuf", action="store_true", help="ignorer le cache et tout rappeler")
    ap.add_argument("--rendu-seul", action="store_true", help="ne refaire que les pages à partir de donnees.json (--departement)")
    ap.add_argument("--exemple", help="code INSEE de la zone préchargée (par défaut : l'arrondissement ou la commune la plus fournie)")
    ap.add_argument("--date", help="date de référence AAAA-MM-JJ (par défaut : aujourd'hui)")
    ap.add_argument("--judilibre", help="fichier de comptes produit par judilibre_local.py (facultatif)")
    ap.add_argument("--sans-complements", action="store_true",
                    help="ne pas ouvrir donnees_complementaires/ (jeux en cours d'écriture ailleurs) : "
                         "meta.complements reste vide")
    ap.add_argument("--repartition", help="(--departement) repartition.json d'un passage national, d'où viennent "
                                          "les dates de masse de la France (par défaut : build/national s'il existe)")
    nat = ap.add_argument_group("passage national (--departements, --tous)")
    nat.add_argument("--pages", action="store_true", help="écrire aussi la page autonome de chaque département (essais)")
    nat.add_argument("--rafraichir-jours", type=int, default=0,
                     help="rappeler l'annuaire et le BODACC pour les réponses plus vieilles (0 : jamais)")
    nat.add_argument("--budget-appels", type=float, help="minutes d'appels à l'annuaire et au BODACC, au plus")
    nat.add_argument("--reseau-seul", action="store_true",
                     help="annuaire, BODACC et contours seulement, en cache, sans construire les départements ; "
                          "exige une répartition à jour (le calcul lourd n'est jamais lancé par ce mode)")
    nat.add_argument("--precedent", help="manifest.json de la publication précédente (contrôle des écarts)")
    nat.add_argument("--fraicheur-jours", type=int, default=3,
                     help="âge maximal du fichier quotidien, en jours (0 : pas de contrôle)")
    nat.add_argument("--source-q", help="fichier local ou adresse à lire à la place de la quotidienne")
    nat.add_argument("--source-t", help="fichier local ou adresse à lire à la place du T3 2025 (archive de référence)")
    nat.add_argument("--t3-sha256", help="empreinte attendue du T3 2025 (par défaut : celle du code)")
    nat.add_argument("--limite-lignes", type=int, help="essai : s'arrêter après N lignes de chaque fichier")
    nat.add_argument("--repartition-seule", action="store_true",
                     help="s'arrêter après la lecture des fichiers nationaux et ses contrôles (mesures)")
    args = ap.parse_args()
    if args.departement and not re.fullmatch(r"\d[\dAB]|\d{3}", args.departement):
        raise SystemExit("Département invalide : %s" % args.departement)
    if args.rendu_seul and not args.departement:
        raise SystemExit("--rendu-seul ne vaut que pour --departement.")
    sortie = os.path.abspath(args.sortie)
    if os.path.commonpath([sortie, os.path.join(RACINE, "pipeline")]) == os.path.join(RACINE, "pipeline") or \
            os.path.commonpath([sortie, os.path.join(RACINE, "site")]) == os.path.join(RACINE, "site"):
        raise SystemExit("La sortie ne doit pas être dans le code (pipeline/ ou site/).")
    os.makedirs(sortie, exist_ok=True)
    j = Journal(os.path.join(sortie, "journal.txt"))
    j.ecrire("DEBUT", "SyndicoScope %s" % VERSION,
             "departement=%s" % (args.departement or args.departements or "tous"), "python=%s" % sys.version.split()[0])
    try:
        if args.departement:
            executer_departement(args, sortie, j)
        else:
            executer_national(args, sortie, j)
        j.ecrire("FIN", "ok")
        dire("terminé : %s" % sortie)
    except ErreurFatale as e:
        j.ecrire("ARRET", str(e))
        raise SystemExit("ARRET : %s" % e)
    finally:
        j.fermer()


if __name__ == "__main__":
    principal()
