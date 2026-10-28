# -*- coding: utf-8 -*-
"""Syndics masqués : le SIREN d'un entrepreneur individuel, et le SIRET d'un syndic que l'annuaire ne
connaît pas, ne sortent jamais de la chaîne (demandes du 28/10/2026).

Deux niveaux : le masquage lui-même (build.masquer, build.numeros_masques, publier.controler_masquage),
puis, sur les sorties du poste s'il y en a, aucun syndic masqué identifiable : ni SIREN de 9 chiffres, ni
SIRET, ni bureau, ni date de création, ni aucun vrai numéro masqué (lu dans le cache local de l'annuaire) ou
nom déclaré au registre nulle part dans les fichiers. L'intégration continue n'a pas de sorties : ce second
test s'y saute.

    python -X utf8 -I -m unittest discover -s tests -v
"""
import csv
import glob
import json
import os
import re
import sys
import unittest

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, "pipeline"))

import build     # noqa: E402
import publier   # noqa: E402
import rnic      # noqa: E402


def syndic(siren, ei, trouve=True, **k):
    s = {"siret": siren + "00012", "siren": siren, "nom": "" if ei or not trouve else "CABINET ESSAI",
         "ei": ei, "trouve": trouve, "sigle": None, "enseignes": None, "forme": "Entrepreneur individuel" if ei else "SAS",
         "tranche": "01", "effectif": "1 ou 2 salariés", "creation": "2001-01-01",
         "bureau": {"lat": 43.3, "lon": 5.4, "commune": "Marseille", "siret": siren + "00012"}, "siege": None,
         "bodacc": {"total": 2, "derniere": "2020-01-01"}, "finances": None, "groupe": None, "dirigee_par": None,
         "national": {"copros_siren": 3, "lots_siren": 40}}
    s.update(k)
    return s


class Masquage(unittest.TestCase):
    def test_cle_stable_dans_l_ordre_du_siren(self):
        s = [syndic("900000002", True), syndic("100000001", False), syndic("800000001", True),
             syndic("900000002", True, siret="90000000200020"), syndic("700000003", False, trouve=False),
             syndic("300000004", False, trouve=False)]
        self.assertEqual(build.masquer(s), {"ei": 2, "nt": 2})
        self.assertEqual([x["siren"] for x in s], ["ei-2", "100000001", "ei-1", "ei-2", "nt-2", "nt-1"])
        for x in s[:1] + s[2:]:
            for k in publier.CHAMPS_NULS:
                self.assertIsNone(x.get(k), k)
            self.assertEqual(x["nom"], publier.MASQUES[publier.masque(x)])
            self.assertEqual((x["tranche"], x["effectif"], x["national"]["lots_siren"]), ("01", "1 ou 2 salariés", 40))
        self.assertEqual((s[0]["ei"], s[0]["forme"]), (True, "Entrepreneur individuel"))
        self.assertEqual((s[4]["ei"], s[4]["trouve"]), (False, False))
        self.assertEqual((s[1]["creation"], s[1]["siret"]), ("2001-01-01", "10000000100012"))   # une société garde tout
        d = {"syndics": s, "copros": {"champs": publier.CHAMPS_COPROS, "lignes": []}}
        self.assertEqual(publier.controler_masquage(d, {"900000002", "800000001", "700000003", "300000004"},
                                                    {"70000000300012", "30000000400012"}), [])

    def test_numeros_masques(self):
        din = {"90000000200012": {"siret": "90000000200012", "siren": "900000002", "trouve": True, "ei": True},
               "10000000100012": {"siret": "10000000100012", "siren": "100000001", "trouve": True, "ei": False},
               "70000000300012": {"siret": "70000000300012", "siren": "700000003", "trouve": False},
               # même SIREN qu'une société publiée : seul le SIRET est masqué
               "10000000100020": {"siret": "10000000100020", "siren": "100000001", "trouve": False}}
        self.assertEqual(build.numeros_masques(din),
                         ({"900000002", "700000003"}, {"70000000300012", "10000000100020"}))
        # un SIRET sans réponse est publié comme non trouvé : masqué de même
        self.assertEqual(build.numeros_masques(din, ["10000000100012", "50000000500012"]),
                         ({"500000005"}, {"50000000500012"}))


def sorties():
    """(chemin, fichier de données ou page, département) des sorties du poste."""
    out = []
    b13 = os.path.join(RACINE, "build", "13")
    for p in ("donnees.json", os.path.join("artifact", "donnees.json"), os.path.join("site", "index.html")):
        out.append((os.path.join(b13, p), b13))
    nat = os.path.join(RACINE, "build", "national")
    for p in glob.glob(os.path.join(nat, "site", "d", "*.json")):
        out.append((p, os.path.join(nat, "departements", os.path.basename(p).split(".")[0])))
    for p in glob.glob(os.path.join(nat, "departements", "*", "site", "index.html")):
        out.append((p, os.path.dirname(os.path.dirname(p))))
    return [(p, d) for p, d in out if os.path.exists(p)]


def identites_masquees(dossier_dep, sirens):
    """Noms déclarés au registre par les représentants professionnels dont le SIREN est masqué (un SIRET
    masqué dont le SIREN est celui d'une société publiée peut porter le nom de cette société)."""
    noms = set()
    for p in glob.glob(os.path.join(dossier_dep, "cache", "rnic_*_dept*.csv")):
        idx = 1 if "t3" in os.path.basename(p) else 0
        with open(p, encoding="utf-8", newline="") as f:
            for l in csv.DictReader(f, delimiter=";"):
                s = rnic.chiffres(l.get(rnic.NOM["siret"][idx]))
                if s[:9] in sirens:
                    nom = (l.get(rnic.NOM["raison"][idx]) or "").strip()
                    if len(nom) >= 5:
                        noms.add(nom)
    return noms


class SortiesLocales(unittest.TestCase):
    def test_aucun_syndic_masque_identifiable(self):
        fichiers = sorties()
        sirens, sirets = set(), set()
        for p in (os.path.join(RACINE, "build", "13", "cache", "dinum.json"),
                  os.path.join(RACINE, "build", "national", "cache", "dinum.json")):
            if os.path.exists(p):
                with open(p, encoding="utf-8") as f:
                    a, b = build.numeros_masques(json.load(f))
                sirens |= a
                sirets |= b
        if not fichiers or not (sirens or sirets):
            self.skipTest("pas de sortie locale à examiner")
        noms = {}
        for p, dep_dir in fichiers:
            with open(p, encoding="utf-8") as f:
                texte = f.read()
            # aucun vrai numéro masqué, seul ou en tête d'un SIRET ; les messages ne citent aucun identifiant
            numeros = publier.NUMEROS.findall(texte)
            fuites = ({x[:9] for x in numeros} & sirens) | (set(numeros) & sirets)
            self.assertEqual(len(fuites), 0, "%s : %d numéros masqués" % (p, len(fuites)))
            if dep_dir not in noms:
                noms[dep_dir] = identites_masquees(dep_dir, sirens)
            self.assertEqual(sum(1 for n in noms[dep_dir] if n in texte), 0, "%s : nom masqué publié" % p)
            if not p.endswith(".json"):
                continue
            for s in json.loads(texte).get("syndics") or []:
                if publier.masque(s):
                    self.assertFalse(re.fullmatch(r"\d{9}", str(s.get("siren"))), p)
                    for k in ("siret", "bureau", "siege", "creation"):
                        self.assertIsNone(s.get(k), "%s : %s" % (p, k))


if __name__ == "__main__":
    unittest.main()
