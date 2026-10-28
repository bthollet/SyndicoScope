# -*- coding: utf-8 -*-
"""Le dépôt ne suit aucune donnée produite ou téléchargée (spécification § 9.5) : rien sous build/
ni data/, aucun extrait, aucun fichier de plus de 1 Mo hors des exceptions ci-dessous.

    python -X utf8 -I -m unittest discover -s tests -v
"""
import os
import shutil
import subprocess
import sys
import unittest

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, "scripts"))

import verifier_secrets   # noqa: E402
# Page « Contentieux des copropriétés à Marseille », publiée telle quelle sur GitHub Pages depuis docs/ :
# exception connue à la règle des 1 Mo et des fichiers de données, à trancher (voir docs/contrat-des-donnees.md).
EXCEPTIONS = {"docs/jurisprudence/index.html", "docs/jurisprudence/donnees/decisions_releve.csv",
              "docs/jurisprudence/donnees/correspondance_syndics.csv"}
EXTENSIONS_DONNEES = (".csv", ".tsv", ".parquet", ".zip", ".gz", ".7z", ".sqlite", ".db")


@unittest.skipUnless(shutil.which("git") and os.path.isdir(os.path.join(RACINE, ".git")), "pas de dépôt git")
class Depot(unittest.TestCase):
    def suivis(self):
        r = subprocess.run(["git", "-C", RACINE, "ls-files", "-z"], capture_output=True, check=True)
        return [p for p in r.stdout.decode("utf-8").split("\0") if p]

    def test_aucune_donnee_suivie(self):
        fautifs = []
        for p in self.suivis():
            if p in EXCEPTIONS:
                continue
            if p.split("/")[0] in ("build", "data") or p.lower().endswith(EXTENSIONS_DONNEES):
                fautifs.append(p)
            elif os.path.exists(os.path.join(RACINE, p)) and os.path.getsize(os.path.join(RACINE, p)) > 1_000_000:
                fautifs.append(p)
        self.assertEqual(fautifs, [])


class JeuxComplementaires(unittest.TestCase):
    """Aucun .json de donnees_complementaires/ n'entre dans le dépôt : le crochet pre-commit le refuse."""
    def test_refus_du_crochet(self):
        ex = verifier_secrets.examiner
        self.assertTrue(ex("donnees_complementaires/jurisprudence_13/jurisprudence_13.json", b"{}", []))
        self.assertTrue(ex("donnees_complementaires/penal_13/sous/autre.JSON", b"{}", []))
        self.assertEqual(ex("donnees_complementaires/jurisprudence_13/consolider_jurisprudence.py", b"x = 1\n", []), [])
        self.assertEqual(ex("site/donnees.json", b"{}", []), [])


if __name__ == "__main__":
    unittest.main()
