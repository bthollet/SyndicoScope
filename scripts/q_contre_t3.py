#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Les fiches datées d'un jour signalé sont-elles de vraies mises à jour ? Mesure par comparaison au T3 2025.

Question. Certains jours portent à eux seuls plus de 1 % des fiches datées de la France (dates signalées,
contrat des données § 10) : le 3 et le 4/10/2026, par exemple, 103 659 fiches. Une saisie en masse qui
re-daterait des fiches sans rien y changer ferait passer pour « à jour » des copropriétés qui ne le sont
pas, et sous-estimerait l'indicateur maj_12.

Méthode. Pour chaque fiche « Mandat en cours » de la quotidienne dont la date de dernière mise à jour est
renseignée, on retrouve la même copropriété (numéro d'immatriculation) dans le T3 2025, photographie figée
du 29/10/2025, et l'on regarde si un champ déclaratif a changé entre les deux : date de fin du mandat,
nombre total de lots, SIRET du représentant. On compare la part des fiches changées entre cinq classes de
date de mise à jour : les jours examinés (--jours), les autres dates signalées, les autres jours postérieurs
au T3, les jours antérieurs au T3, les dates de masse (23 et 24/08/2025, où rien ne doit avoir changé).
Les fiches absentes du T3 sont comptées à part.

Lecture. Un champ changé depuis le T3 suppose une déclaration postérieure au 29/10/2025, donc de moins de
douze mois au 28/10/2026 : si les jours examinés ont la même part de fiches changées que les jours
ordinaires, ce sont de vraies mises à jour. Une fiche sans changement visible peut aussi en être une (une
déclaration qui confirme) : la mesure borne la sous-estimation possible, elle ne la mesure pas. Le jour
du changement n'est pas connu, seulement qu'il a eu lieu entre les deux fichiers.

Résultat du 28/10/2026 (quotidienne du 28/10/2026) : date de fin ou lots changés pour 74,3 % des fiches
des 3 et 4/10/2026 (86 530 fiches présentes au T3), contre 72,5 % pour les autres jours postérieurs au T3
(76 671), 76,0 % pour les autres dates signalées (170 900) et 0,0 % pour les dates de masse (16 403).

Données. Les extraits par département écrits par le passage national (pipeline/build.py --tous), lus
département par département : quelques dizaines de Mo de mémoire, une quinzaine de secondes. Le script
n'écrit que des comptes, jamais une ligne, un numéro ni un nom.

    python -X utf8 -I scripts/q_contre_t3.py --departements build/national/departements
"""
import argparse
import collections
import csv
import glob
import json
import os
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, "pipeline"))

import rnic   # noqa: E402

COL = {c[0]: (c[1], c[2]) for c in rnic.COLONNES}
CLASSES = ["1 jours examines", "2 autres dates signalees", "3 autres jours apres le T3", "4 jours avant le T3",
           "5 dates de masse"]


def valeur(ligne, canon, idx):
    v = (ligne.get(COL[canon][idx]) or "").strip()
    if canon == "lots":
        try:
            return str(int(float(v)))
        except ValueError:
            return v
    return v


def mesurer(racine, jours, masse, signalees, date_t3):
    """Comptes par classe de date de mise à jour (Counter par classe)."""
    def classe(d):
        if d in jours:
            return CLASSES[0]
        if d in masse:
            return CLASSES[4]
        if d in signalees:
            return CLASSES[1]
        return CLASSES[2] if d > date_t3 else CLASSES[3]

    res = collections.defaultdict(collections.Counter)
    for chemin_q in sorted(glob.glob(os.path.join(racine, "*", "cache", "rnic_quotidienne_dept*.csv"))):
        t3 = {}
        with open(chemin_q.replace("rnic_quotidienne", "rnic_t3_2025"), encoding="utf-8", newline="") as f:
            for l in csv.DictReader(f, delimiter=";"):
                t3[valeur(l, "immat", 1).upper()] = (valeur(l, "fin", 1)[:10], valeur(l, "lots", 1),
                                                     rnic.chiffres(valeur(l, "siret", 1)))
        with open(chemin_q, encoding="utf-8", newline="") as f:
            for l in csv.DictReader(f, delimiter=";"):
                d = valeur(l, "maj", 0)[:10]
                if valeur(l, "etat", 0).lower() != "mandat en cours" or len(d) != 10:
                    continue
                c = res[classe(d)]
                c["fiches"] += 1
                t = t3.get(valeur(l, "immat", 0).upper())
                if t is None:
                    c["absentes_du_t3"] += 1
                    continue
                fin, lots, siret = valeur(l, "fin", 0)[:10], valeur(l, "lots", 0), rnic.chiffres(valeur(l, "siret", 0))
                c["au_t3"] += 1
                c["fin_changee"] += fin != t[0]
                c["fin_avancee"] += bool(fin and t[0] and fin > t[0])
                c["lots_changes"] += lots != t[1]
                c["siret_change"] += siret != t[2]
                c["fin_ou_lots"] += fin != t[0] or lots != t[1]
                c["un_des_trois"] += fin != t[0] or lots != t[1] or siret != t[2]
    return res


def principal():
    ap = argparse.ArgumentParser(description="Fiches d'un jour signalé contre le T3 2025 : part des champs changés")
    ap.add_argument("--departements", default=os.path.join(RACINE, "build", "national", "departements"),
                    help="dossier de la répartition nationale (repartition.json et extraits par département)")
    ap.add_argument("--jours", default="2026-10-03,2026-10-04",
                    help="jours examinés, AAAA-MM-JJ séparés par des virgules (défaut : les 3 et 4/10/2026)")
    ap.add_argument("--json", help="écrire aussi les comptes dans ce fichier")
    args = ap.parse_args()
    with open(os.path.join(args.departements, "repartition.json"), encoding="utf-8") as f:
        rep = json.load(f)
    m = rep["Q"].get("masse") or {}
    date_t3 = ((rep.get("marqueur") or {}).get("T") or {}).get("date_fichier") or "2025-10-29"
    jours = {x.strip() for x in args.jours.split(",") if x.strip()}
    res = mesurer(args.departements, jours, set(m.get("dates") or ()), set(m.get("signalees") or ()), date_t3)
    print("quotidienne du %s, T3 du %s ; jours examines : %s" % (((rep.get("marqueur") or {}).get("Q") or {})
                                                                 .get("date_fichier"), date_t3, sorted(jours)))
    print("classe | fiches | absentes du T3 | au T3 | fin changee | fin avancee | lots changes | SIRET change "
          "| fin ou lots | un des trois")
    for k in CLASSES:
        c = res.get(k) or collections.Counter()
        a = max(c["au_t3"], 1)
        print("%s | %d | %d | %d | %s" % (k, c["fiches"], c["absentes_du_t3"], c["au_t3"], " | ".join(
            "%.1f %%" % (100 * c[x] / a) for x in ("fin_changee", "fin_avancee", "lots_changes", "siret_change",
                                                    "fin_ou_lots", "un_des_trois"))))
    if args.json:
        with open(args.json, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"date_t3": date_t3, "jours": sorted(jours), "classes": {k: dict(res.get(k) or {}) for k in CLASSES}},
                      f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    principal()
