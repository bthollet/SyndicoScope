# -*- coding: utf-8 -*-
"""Contrôle d'une page assemblée à part (scripts/controler_page.py) : numéros masqués, clés interdites.

    python -X utf8 -I -m unittest discover -s tests -v
"""
import os
import sys
import unittest

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, "scripts"))
sys.path.insert(0, os.path.join(RACINE, "pipeline"))

import build             # noqa: E402
import controler_page    # noqa: E402
import publier           # noqa: E402

DIN = {"30000000400017": {"siret": "30000000400017", "siren": "300000004", "trouve": True, "ei": True},
       "50000000600012": {"siret": "50000000600012", "siren": "500000006", "trouve": False},
       "12345678900012": {"siret": "12345678900012", "siren": "123456789", "trouve": True, "ei": False}}


class ControlePage(unittest.TestCase):
    def setUp(self):
        self.sirens, self.sirets = build.numeros_masques(DIN)

    def ex(self, texte):
        return controler_page.examiner(texte, self.sirens, self.sirets, publier.CLES_INTERDITES)

    def test_page_propre(self):
        self.assertEqual(self.ex('{"siren":"123456789","siret":"12345678900012","nom":"CABINET ESSAI"}'), (0, []))

    def test_numeros_masques(self):
        self.assertEqual(self.ex('{"siren":"300000004"}')[0], 1)
        self.assertEqual(self.ex("SIRET 30000000400099")[0], 1)       # en tête d'un SIRET
        self.assertEqual(self.ex("SIREN 300 000 004")[0], 1)          # par groupes de trois
        self.assertEqual(self.ex('"50000000600012"')[0], 1)           # SIRET d'un non trouvé
        self.assertEqual(self.ex("3000000040001")[0], 0)              # 13 chiffres : pas un numéro

    def test_cles_interdites(self):
        self.assertEqual(self.ex('{"procedures":[{"date":"2011-09-08","commercant":"X"}]}')[1], ["commercant"])
        self.assertEqual(self.ex("le commercant du BODACC")[1], [])   # le mot seul n'est pas une clé


if __name__ == "__main__":
    unittest.main()
