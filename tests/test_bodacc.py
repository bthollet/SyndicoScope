# -*- coding: utf-8 -*-
"""BODACC : une annonce n'est rattachée à un SIREN que si son champ registre le porte, chiffres normalisés
(règle du 28/10/2026) ; id, registre et commercant restent dans le cache, jamais dans le fichier publié.

    python -X utf8 -I -m unittest discover -s tests -v
"""
import os
import sys
import unittest
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))

import bodacc   # noqa: E402


class ClientFactice:
    def __init__(self, annonces):
        self.annonces = annonces
        self.urls = []

    def get_json(self, url):
        self.urls.append(urllib.parse.unquote(url))
        return {"results": self.annonces}


class Rattachement(unittest.TestCase):
    def test_porte_siren(self):
        self.assertTrue(bodacc.porte_siren(["327 918 231", "327918231"], "327918231"))
        self.assertTrue(bodacc.porte_siren("327 918 231", "327918231"))
        for registre in (["32791823"], ["3279182310"], ["123 456 789"], [], None, ["RCS Marseille"]):
            self.assertFalse(bodacc.porte_siren(registre, "327918231"), registre)

    def test_details_controles_un_a_un(self):
        annonces = [
            {"id": "A1", "dateparution": "2011-09-08", "familleavis_lib": "Procédures collectives",
             "typeavis_lib": "Avis initial", "jugement": '{"nature": "Jugement d\'ouverture"}',
             "registre": ["327 918 231", "327918231"], "commercant": "SOCIETE ESSAI"},
            {"id": "A2", "dateparution": "2012-01-02", "familleavis_lib": "Procédures collectives",
             "typeavis_lib": "Avis initial", "registre": ["123 456 789"], "commercant": "AUTRE"},
            {"id": "A3", "dateparution": "2015-05-05", "familleavis_lib": "Ventes et cessions",
             "typeavis_lib": "Avis initial", "registre": ["327918231"], "commercant": "SOCIETE ESSAI"}]
        res = {"siren": "327918231", "familles": {"Procédures collectives": {"n": 2}, "Ventes et cessions": {"n": 1},
                                                  "Dépôts des comptes": {"n": 9}}}
        c = ClientFactice(annonces)
        bodacc.details(c, res)
        self.assertEqual((len(res["procedures"]), len(res["achats"]), res["ecartees"], res["format"]),
                         (1, 1, 1, bodacc.FORMAT))
        p = res["procedures"][0]
        self.assertEqual((p["id"], p["commercant"], p["nature"]), ("A1", "SOCIETE ESSAI", "Jugement d'ouverture"))
        self.assertIn('registre like "327918231"', c.urls[0])
        self.assertIn("registre,commercant", c.urls[0])

    def test_sans_famille_detaillee(self):
        c = ClientFactice([])
        res = bodacc.details(c, {"siren": "327918231", "familles": {"Dépôts des comptes": {"n": 3}}})
        self.assertEqual((res["procedures"], res["ecartees"], c.urls), ([], 0, []))


if __name__ == "__main__":
    unittest.main()
