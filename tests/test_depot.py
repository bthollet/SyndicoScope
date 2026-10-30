# -*- coding: utf-8 -*-
"""Le dépôt ne suit aucune donnée produite ou téléchargée (spécification § 9.5) : rien sous build/
ni data/, aucun extrait, aucun fichier de plus de 1 Mo hors des exceptions ci-dessous.

    python -X utf8 -I -m unittest discover -s tests -v
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, "scripts"))

import verifier_secrets   # noqa: E402
# Page « Contentieux des copropriétés à Marseille », publiée telle quelle sur GitHub Pages depuis docs/ :
# exception connue à la règle des 1 Mo et des fichiers de données, à trancher (voir docs/contrat-des-donnees.md).
EXCEPTIONS = {"docs/jurisprudence/index.html", "docs/jurisprudence/donnees/decisions_releve.csv",
              "docs/jurisprudence/donnees/correspondance_syndics.csv"}
# Page nationale à la racine du site, à la place de la page du 13 (décision de Brice, 30/10/2026, 6 h 16, « Il devait
# remplacer le site ») : un fichier par département et l'index des communes, assemblés sur le poste, dont certains
# dépassent 1 Mo ; même exception, jusqu'au déploiement par le flux.
EXCEPTIONS_PREFIXES = ("docs/dep/", "docs/communes.")
EXTENSIONS_DONNEES = (".csv", ".tsv", ".parquet", ".zip", ".gz", ".7z", ".sqlite", ".db")


@unittest.skipUnless(shutil.which("git") and os.path.isdir(os.path.join(RACINE, ".git")), "pas de dépôt git")
class Depot(unittest.TestCase):
    def suivis(self):
        r = subprocess.run(["git", "-C", RACINE, "ls-files", "-z"], capture_output=True, check=True)
        return [p for p in r.stdout.decode("utf-8").split("\0") if p]

    def test_aucune_donnee_suivie(self):
        fautifs = []
        for p in self.suivis():
            if p in EXCEPTIONS or p.startswith(EXCEPTIONS_PREFIXES):
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


class MotifsLocaux(unittest.TestCase):
    """Motifs locaux (demande du 28/10/2026) : minuscules Unicode, et phrases autorisées « ! ». Mots fictifs :
    les vrais motifs ne s'écrivent pas dans le dépôt, le crochet les refuserait."""
    FICHIER = "# commentaire\n!quinconce immobilier\nvésanie\nquinconce\n!\n"

    def setUp(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        self.chemin = os.path.join(d, "motifs.txt")
        with open(self.chemin, "w", encoding="utf-8") as f:
            f.write(self.FICHIER)
        self.motifs = verifier_secrets.lire_motifs(self.chemin)
        self.message = os.path.join(d, "COMMIT_EDITMSG")

    def regles(self, texte, encodage="utf-8"):
        return [(n, r) for _, n, r in verifier_secrets.examiner("f.md", texte.encode(encodage), self.motifs)]

    def test_lecture(self):
        self.assertEqual(self.motifs, verifier_secrets.Motifs(["vésanie", "quinconce"], ["quinconce immobilier"]))

    def test_capitales_accentuees(self):
        self.assertEqual(self.regles("Une VÉSANIE.\n"), [(1, "motif local n° 1")])
        self.assertEqual(self.regles("x\nVÉSANIE\n"), [(2, "motif local n° 1")])        # forme décomposée
        self.assertEqual(self.regles("VÉSANIE\n", "cp1252"), [(1, "motif local n° 1")])   # fichier Windows

    def test_phrase_autorisee(self):
        self.assertEqual(self.regles("QUINCONCE IMMOBILIER, syndic.\n"), [])
        self.assertEqual(self.regles("résidence Quinconce\n"), [(1, "motif local n° 2")])
        self.assertEqual(self.regles("Quinconce Immobilier\nrésidence QUINCONCE\n"), [(2, "motif local n° 2")])
        self.assertEqual(self.regles("quinconce immobilierquinconce\n"), [(1, "motif local n° 2")])

    def test_rien_n_est_affiche(self):
        for _, _, regle in verifier_secrets.examiner("f.md", "VÉSANIE QUINCONCE".encode(), self.motifs):
            self.assertNotRegex(regle.lower(), "vésanie|quinconce|immobilier")

    def test_message_de_commit(self):
        with open(self.message, "w", encoding="utf-8") as f:
            f.write("Titre : QUINCONCE IMMOBILIER\n\nrésidence Quinconce\n# vésanie, commentaire ignoré\n")
        trouve = verifier_secrets.mode_message(self.message, self.motifs)
        self.assertEqual([(n, r) for _, n, r in trouve], [(3, "motif local n° 2")])

    def test_liste_simple(self):   # appel sans fichier de motifs : une liste de motifs interdits
        self.assertEqual(verifier_secrets.examiner("f.md", "VÉSANIE".encode(), ["vésanie"]),
                         [("f.md", 1, "motif local n° 1")])


if __name__ == "__main__":
    unittest.main()
