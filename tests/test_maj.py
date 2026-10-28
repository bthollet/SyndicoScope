# -*- coding: utf-8 -*-
"""Mises à jour de la fiche : base « Mandat en cours », dates de masse, plancher et mesurabilité
(meta.maj, docs/contrat-des-donnees.md).

    python -X utf8 -I -m unittest discover -s tests -v
"""
import datetime as dt
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))

import indicateurs   # noqa: E402

D = dt.date.fromisoformat


class Fiche:
    def __init__(self, maj, etat=0, fin=None, repr="12345678900012"):
        self.maj, self.etat, self.fin, self.repr = (D(maj) if maj else None), etat, fin, repr


# Le registre en miniature : quelques fiches anciennes, deux jours qui effacent ce qui précède (23 et
# 24/08/2025), puis des samedis chargés, dont un surtout hors mandat en cours, qui n'effacent rien.
JOURS = {"2020-10-11": [1, 1], "2025-08-19": [5, 2], "2025-08-23": [200, 160], "2025-08-24": [1800, 1670],
         "2025-09-06": [40, 38], "2026-07-11": [250, 4], "2026-09-05": [280, 200], "2026-10-03": [540, 77],
         "2026-10-04": [510, 89], "2026-10-24": [100, 20]}
TOTAL = sum(v[0] for v in JOURS.values())


class DatesDeMasse(unittest.TestCase):
    def test_seuls_les_jours_qui_effacent_le_passe(self):
        self.assertEqual(indicateurs.dates_de_masse(JOURS), ["2025-08-23", "2025-08-24"])

    def test_premier_jour_de_la_serie_ecarte_par_le_seuil(self):
        # le 11/10/2020 « précède » tout ce qui suit, mais ne porte qu'une fiche : moins de 1 %
        self.assertEqual(indicateurs.dates_de_masse({"2020-10-11": [1, 1], "2026-10-03": [500, 9]}), ["2026-10-03"])
        self.assertEqual(indicateurs.dates_de_masse({}), [])

    def test_dates_signalees(self):
        # au moins 1 % des fiches datées sans effacer le passé : comptées, mais signalées
        masse = indicateurs.dates_de_masse(JOURS)
        self.assertEqual(indicateurs.dates_signalees(JOURS, masse),
                         ["2025-09-06", "2026-07-11", "2026-09-05", "2026-10-03", "2026-10-04", "2026-10-24"])

    def test_jours(self):
        rows = [Fiche("2025-08-24"), Fiche("2025-08-24", etat=3, repr=1), Fiche(None),
                Fiche("2025-08-24", repr="98765432100034"), Fiche("2025-08-24")]
        self.assertEqual(indicateurs.jours_maj(rows), {"2025-08-24": [4, 1]})
        self.assertEqual(indicateurs.sirets_par_jour(rows), {"2025-08-24": 2})


class Mesurabilite(unittest.TestCase):
    def test_plancher_du_24_aout_2025(self):
        self.assertEqual(indicateurs.mesurabilite(D("2026-10-28"), D("2025-08-24")), {12: True, 18: False})
        self.assertEqual(indicateurs.premier_jour_mesurable(D("2025-08-24"), 12), D("2026-08-25"))
        self.assertEqual(indicateurs.premier_jour_mesurable(D("2025-08-24"), 18), D("2027-02-25"))

    def test_egalite_stricte(self):
        # date_ref - 18 mois = plancher : une fiche datée du plancher a pu être mise à jour bien avant
        self.assertFalse(indicateurs.mesurabilite(D("2027-02-24"), D("2025-08-24"))[18])
        self.assertTrue(indicateurs.mesurabilite(D("2027-02-25"), D("2025-08-24"))[18])

    def test_fin_de_mois(self):
        self.assertEqual(indicateurs.premier_jour_mesurable(D("2025-08-31"), 18), D("2027-03-01"))

    def test_sans_plancher(self):
        self.assertEqual(indicateurs.mesurabilite(D("2026-10-28"), None), {12: True, 18: True})


class Diligence(unittest.TestCase):
    def test_base_mandat_en_cours_et_plancher(self):
        rows = [Fiche("2025-08-24"), Fiche("2025-09-30"), Fiche("2026-10-01"), Fiche("2025-08-24", etat=3),
                Fiche("2024-01-01", etat=2), Fiche(None)]
        d = indicateurs.diligence(rows, D("2026-10-28"), D("2025-08-24"))
        self.assertEqual(d["maj_12"], [2, 3])   # ni « pas de mandat », ni « expiré », ni la fiche sans date
        self.assertIsNone(d["maj_18"])          # non mesurable : jamais un zéro trompeur
        self.assertEqual(indicateurs.diligence(rows, D("2026-10-28"))["maj_18"], [0, 3])


class Contrat(unittest.TestCase):
    def test_meta_maj(self):
        m = indicateurs.meta_maj(D("2026-10-28"), ["2025-08-23", "2025-08-24"], JOURS, ["2026-10-03", "2026-11-01"],
                                 {"2026-10-03": 312})
        self.assertEqual(set(m), {"base", "date_ref", "plancher", "dates_de_masse", "dates_signalees", "mesurable",
                                  "mesurable_a_partir_du"})
        self.assertEqual(m["dates_signalees"], [{"date": "2026-10-03", "n": 540, "part": round(540 / TOTAL, 4),
                                                 "part_sans_mandat": round(77 / 540, 4), "siret_distincts": 312}])
        self.assertEqual((m["base"], m["date_ref"], m["plancher"]), ("mandat_en_cours", "2026-10-28", "2025-08-24"))
        self.assertEqual(m["mesurable"], {"12": True, "18": False})
        self.assertIs(m["mesurable"]["18"], False)   # la page teste « === false »
        self.assertEqual(m["mesurable_a_partir_du"], {"12": "2026-08-25", "18": "2027-02-25"})
        self.assertEqual(m["dates_de_masse"][1], {"date": "2025-08-24", "n": 1800, "part": round(1800 / TOTAL, 4),
                                                  "part_sans_mandat": round(1670 / 1800, 4)})
        self.assertEqual(json.loads(json.dumps(m)), m)

    def test_departement_sans_fiche_a_une_date_de_masse(self):
        m = indicateurs.meta_maj(D("2026-10-28"), ["2025-08-23", "2025-08-24"], {"2025-08-24": [3, 3], "2026-10-03": [9, 0]})
        self.assertEqual([x["date"] for x in m["dates_de_masse"]], ["2025-08-24"])
        self.assertEqual(m["plancher"], "2025-08-24")   # le plancher est celui de la France

    def test_aucune_date_de_masse(self):
        m = indicateurs.meta_maj(D("2026-10-28"), [], JOURS)
        self.assertEqual((m["plancher"], m["dates_de_masse"], m["dates_signalees"], m["mesurable"],
                          m["mesurable_a_partir_du"]),
                         (None, [], [], {"12": True, "18": True}, {"12": None, "18": None}))


if __name__ == "__main__":
    unittest.main()
