# -*- coding: utf-8 -*-
"""Jeux complémentaires d'un département : recherche, page autonome, fragment (demande du 28/10/2026).

    python -X utf8 -I -m unittest discover -s tests -v
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))

import rendu   # noqa: E402

GABARIT = "<title>essai</title><style>/*CSS*/</style>\n<!-- CORPS -->\n<main></main>\n<!--DONNEES--><script>/*JS*/</script>\n"


class Complements(unittest.TestCase):
    def setUp(self):
        self.racine = tempfile.mkdtemp(prefix="syndicoscope_essai_")
        site = os.path.join(self.racine, "site")
        os.makedirs(os.path.join(site, "vendor"))
        for nom, texte in (("index.html", GABARIT), ("style.css", ""), ("app.js", ""),
                           (os.path.join("vendor", "leaflet-1.9.4.css"), "")):
            with open(os.path.join(site, nom), "w", encoding="utf-8") as f:
                f.write(texte)
        self.base = os.path.join(self.racine, rendu.DOSSIER_COMPLEMENTS)

    def tearDown(self):
        shutil.rmtree(self.racine, ignore_errors=True)

    def poser(self, nom, texte):
        os.makedirs(os.path.join(self.base, nom), exist_ok=True)
        with open(os.path.join(self.base, nom, nom + ".json"), "w", encoding="utf-8") as f:
            f.write(texte)

    def test_absents(self):
        self.assertEqual(rendu.lire_complements(self.racine, "13"), {})
        os.makedirs(self.base)
        self.assertEqual(rendu.lire_complements(self.racine, "13"), {})

    def test_trouves_et_ecartes(self):
        self.poser("penal_13", '{"n": 2}')
        self.poser("jurisprudence_13", '{"decisions": ["</script><!--"]}')
        self.poser("jurisprudence_2A", '{"n": 1}')   # autre département
        self.poser("Mauvais Nom_13", '{"n": 1}')     # type hors motif
        self.poser("penal_113", '{"n": 1}')          # ne finit pas par « _13 » : ignoré
        os.makedirs(os.path.join(self.base, "vide_13"))
        self.assertEqual(list(rendu.lire_complements(self.racine, "13")), ["jurisprudence", "penal"])
        self.assertEqual(rendu.lire_complements(self.racine, "2A"), {"jurisprudence": {"n": 1}})

    def test_illisible(self):
        self.poser("penal_13", '{"n": ')
        with self.assertRaises(ValueError):
            rendu.lire_complements(self.racine, "13")

    def test_page_et_fragment(self):
        sortie = os.path.join(self.racine, "sortie")
        comp = {"jurisprudence": {"decisions": ["</script><!--"]}}
        rendu.rendre(self.racine, sortie, {"meta": {"complements": ["jurisprudence"]}}, {"features": []}, comp)
        with open(os.path.join(sortie, "site", "index.html"), encoding="utf-8") as f:
            page = f.read()
        balise = '<script type="application/json" id="complement-jurisprudence">'
        self.assertEqual(page.count(balise), 1)
        contenu = page.split(balise, 1)[1].split("</script>", 1)[0]
        self.assertEqual(json.loads(contenu), comp["jurisprudence"])   # « </script> » échappé, relu tel quel
        fragment = os.path.join(sortie, "artifact", "complement-jurisprudence.json")
        with open(fragment, encoding="utf-8") as f:
            self.assertEqual(json.load(f), comp["jurisprudence"])
        # le jeu disparaît : la page ne l'embarque plus, le fragment ne le garde pas
        rendu.rendre(self.racine, sortie, {"meta": {"complements": []}}, {"features": []})
        with open(os.path.join(sortie, "site", "index.html"), encoding="utf-8") as f:
            self.assertNotIn("complement-", f.read())
        self.assertFalse(os.path.exists(fragment))


if __name__ == "__main__":
    unittest.main()
