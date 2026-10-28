# -*- coding: utf-8 -*-
"""Passage national sur des fichiers d'essai : codes de département, répartition, blanchiment,
comptes par SIRET, index des numéros, reprise.

    python -X utf8 -I -m unittest discover -s tests -v
"""
import csv
import hashlib
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))

import national   # noqa: E402
import rnic       # noqa: E402
from commun import Journal, ecrire_json, lire_json   # noqa: E402
from entreprises import normaliser      # noqa: E402

SIRET_A = "12345678900012"
SIRET_B = "98765432100034"


class ClientFactice:
    """Le passage national ne lit ici que des fichiers locaux : aucun appel réseau."""
    curl = False
    ctx = None


def ecrire_csv(chemin, idx, lignes):
    """Fichier au format brut du registre : les colonnes de rnic.COLONNES dans le désordre, plus
    des colonnes qui ne doivent jamais être gardées (adresse, nom d'usage, identification)."""
    noms = [c[1 + idx] for c in rnic.COLONNES]
    entete = ["adresse_reference", "nom_usage_copropriete"] + noms[::-1] + ["identification_representant_legal"]
    with open(chemin, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(entete)
        for l in lignes:
            if l is None:   # ligne malformée
                w.writerow(["trop", "court"])
                continue
            v = {c[1 + idx]: l.get(c[0], "") for c in rnic.COLONNES}
            v.update({"adresse_reference": l.get("_adresse", "1 rue de l'Essai"), "nom_usage_copropriete": "LES ESSAIS",
                      "identification_representant_legal": "IDENTITE A NE PAS GARDER"})
            w.writerow([v[h] for h in entete])


def ligne(immat, dept, arr, typ="professionnel", raison="", siret="", lots="10", etat="Mandat en cours"):
    return {"immat": immat, "dept": dept, "arr": arr, "type": typ, "raison": raison, "siret": siret,
            "lots": lots, "etat": etat, "maj": "2026-09-01", "periode": "Avant 1949"}


QUOTIDIENNE = [
    ligne("AA0000001", "13", "13201", raison="CABINET ESSAI", siret=SIRET_A, lots="12"),
    ligne("AA0000002", "13", "13202", typ="bénévole", raison="Jean Dupont", siret="11111111111111"),
    ligne("AA0000003", "2A", "2A004", raison="SYNDIC CORSE", siret=SIRET_B, lots="7"),
    ligne("AA0000004", "20", "2B033", typ="non connu"),
    ligne("AA0000005", "", "97302", typ="", etat="Pas de mandat en cours"),
    ligne("AA0000006", "", "", typ="bénévole", raison="Marie Martin"),
    None,
    ligne("AA0000001", "13", "13201", raison="CABINET ESSAI", siret=SIRET_A, lots="12"),
    ligne("AA0000003", "2A", "2A004", raison="AUTRE SYNDIC", siret=SIRET_B, lots="9"),     # variante : gardée
    ligne("AA0000003", "2A", "2A004", raison="AUTRE SYNDIC", siret=SIRET_B, lots="9"),     # copie de la variante
    dict(ligne("AA0000002", "13", "13202", typ="bénévole", raison="Jean Dupont", siret="11111111111111"),
         _adresse="2 rue Autre"),   # identique sur les colonnes gardées, pas sur l'adresse : variante
]
T3 = [
    ligne("AA0000001", "13", "13201", raison="CABINET ESSAI", siret=SIRET_A),
    ligne("AA0000009", "13", "13203", raison="CABINET ESSAI", siret=SIRET_A),
    ligne("AA0000003", "2B", "2B033", raison="SYNDIC CORSE", siret=SIRET_B),
]


class CodesDepartement(unittest.TestCase):
    def test_codes(self):
        cas = [(("13", ""), "13"), (("1", ""), "01"), (("2A", ""), "2A"), (("2b", ""), "2B"),
               (("20", "2A004"), "2A"), (("20", ""), ""), (("971", ""), "971"), (("976", ""), "976"),
               (("975", ""), ""), (("", "97302"), "973"), (("", "13201"), "13"), (("00", ""), ""),
               (("", "75056"), "75"), (("", "2B033"), "2B"), (("x", "y"), "")]
        for (v, arr), attendu in cas:
            self.assertEqual(national.dep_normalise(v, arr), attendu, (v, arr))

    def test_ordre(self):
        self.assertEqual(sorted(["2B", "21", "19", "971", "2A", "01", "95"], key=national.cle_departement),
                         ["01", "19", "2A", "2B", "21", "95", "971"])

    def test_noms(self):
        self.assertEqual(len(national.NOMS_DEPARTEMENTS), 101)
        self.assertTrue(all(national.dep_normalise(c) == c for c in national.NOMS_DEPARTEMENTS))

    def test_collectivites_d_outre_mer(self):
        # valeurs brutes « département|commune » des lignes sans département, quotidienne du 28/10/2026
        valeurs = {"978|978": 203, "|978": 188, "|977": 66, "|": 43, "|975": 1, "non |": 5}
        self.assertEqual(national.collectivites(valeurs), {"975": 1, "977": 66, "978": 391})
        self.assertEqual(national.collectivites(None), {})
        self.assertTrue(all(national.dep_normalise(c) == "" for c in national.COLLECTIVITES))


class Repartition(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="syndicoscope_essai_")
        self.q = os.path.join(self.dir, "q.csv")
        self.t = os.path.join(self.dir, "t.csv")
        ecrire_csv(self.q, 0, QUOTIDIENNE)
        ecrire_csv(self.t, 1, T3)
        self.infos = {"Q": {"rid": "q", "url_source": "essai-q", "date_fichier": "2026-10-28", "fichier_local": self.q},
                      "T": {"rid": "t", "url_source": "essai-t", "date_fichier": "2025-10-29", "fichier_local": self.t}}
        self.racine = os.path.join(self.dir, "departements")
        self.j = Journal(os.path.join(self.dir, "journal.txt"))

    def tearDown(self):
        self.j.fermer()
        shutil.rmtree(self.dir, ignore_errors=True)

    def extrait(self, dep, nom="rnic_quotidienne"):
        chemin = os.path.join(self.racine, dep, "cache", "%s_dept%s.csv" % (nom, dep))
        with open(chemin, encoding="utf-8", newline="") as f:
            r = csv.reader(f, delimiter=";")
            return next(r), list(r)

    def test_repartition_complete(self):
        rep = national.repartir(ClientFactice(), self.j, self.infos, self.racine)
        self.assertEqual(rep["departements"], ["13", "2A", "2B", "973"])
        q = rep["Q"]
        # lignes lues (comparées au témoin), malformées, doublons identiques écartés, doublons différents écartés
        self.assertEqual((q["lignes"], q["lignes_malformees"], q["doublons_ecartes"], q["lignes_variantes"],
                          q["numeros_a_variantes"], q["lignes_gardees"]), (10, 1, 2, 2, 2, 8))
        self.assertEqual(q["doublons_ecartes_par_departement"], {"13": 1, "2A": 1})
        self.assertEqual(q["lignes_variantes_par_departement"], {"13": 1, "2A": 1})
        self.assertEqual(q["departements"], {"13": 3, "2A": 2, "2B": 1, "973": 1, "inconnu": 1})
        self.assertEqual(q["numeros_conformes"], 8)
        st13 = lire_json(os.path.join(self.racine, "13", "cache", "rnic_quotidienne_dept13.stats.json"))
        self.assertEqual((st13["lignes"], st13["doublons_ecartes"], st13["lignes_variantes"]), (3, 1, 1))
        # date de dernière mise à jour par jour (lignes gardées) : [fiches, dont hors « Mandat en cours »]
        self.assertEqual(q["maj_par_jour"], {"2026-09-01": [8, 1]})
        self.assertEqual(q["maj_sirets_par_jour"], {"2026-09-01": 2})   # SIRET_A et SIRET_B ; pas le bénévole
        self.assertEqual(st13["maj_par_jour"], {"2026-09-01": [3, 0]})
        self.assertNotIn("maj_par_jour_departement", q)
        self.assertEqual((q["masse"]["dates"], q["masse"]["plancher"], q["masse"]["signalees"],
                          q["masse"]["departements_sans_une_date"]), (["2026-09-01"], "2026-09-01", [], {}))
        self.assertEqual(lire_json(os.path.join(self.racine, "repartition.json"))["Q"]["masse"], q["masse"])
        self.assertFalse(os.path.exists(os.path.join(self.racine, "inconnu")))
        # seules les colonnes de rnic.COLONNES, dans leur ordre ; identité du bénévole retirée
        entete, lignes = self.extrait("13")
        self.assertEqual(entete, [c[1] for c in rnic.COLONNES])
        with open(os.path.join(self.racine, "13", "cache", "rnic_quotidienne_dept13.csv"), encoding="utf-8") as f:
            texte = f.read()
        for interdit in ("Jean Dupont", "11111111111111", "rue de l'Essai", "rue Autre", "LES ESSAIS", "IDENTITE"):
            self.assertNotIn(interdit, texte)
        self.assertIn("CABINET ESSAI", texte)
        self.assertEqual(len(lignes), 3)
        # empreinte du nom retiré, pour le contrôle de publication
        emp = lire_json(os.path.join(self.racine, "13", "cache", "empreintes_non_pro.json"))
        self.assertEqual(emp, [hashlib.sha256(normaliser("Jean Dupont").encode("utf-8")).hexdigest()])
        # comptes nationaux par SIRET (quotidienne, doublons identiques écartés, variante gardée)
        nat = lire_json(os.path.join(self.racine, "national_par_siret.json"))
        self.assertEqual(nat["par_siret"], {SIRET_A: [1, 12], SIRET_B: [2, 16]})
        self.assertEqual(nat["stats"]["controle"], "OK")
        # 973 n'existe que dans la quotidienne : extrait T3 vide, en-tête compris
        entete_t, lignes_t = self.extrait("973", "rnic_t3_2025")
        self.assertEqual((entete_t, lignes_t), ([c[2] for c in rnic.COLONNES], []))
        # numéro -> département : celui d'aujourd'hui, puis les copropriétés du T3 seul
        paires = dict(national.lire_immats(self.racine))
        self.assertEqual(paires["AA0000003"], "2A")
        self.assertEqual(paires["AA0000009"], "13")
        self.assertNotIn("AA0000006", paires)
        c = rep["comparaison"]
        self.assertEqual((c["departement_change"], c["t3_seulement"]), (1, 1))
        self.assertEqual(c["departement_change_detail"], {"2B->2A": 1})
        self.assertEqual(national.sirets_departements(self.racine, ["13", "2A"]), [SIRET_A, SIRET_B])

    def test_garder_et_reprise(self):
        national.repartir(ClientFactice(), self.j, self.infos, self.racine, garder={"13"})
        self.assertEqual(sorted(os.listdir(self.racine)),
                         ["13", "immats.tsv", "national_par_siret.json", "repartition.json"])
        self.assertTrue(national.repartition_a_jour(self.racine, self.infos, ["13"]))
        self.assertFalse(national.repartition_a_jour(self.racine, self.infos, ["13", "2A"]))
        self.assertFalse(national.repartition_a_jour(self.racine, self.infos, None))
        autre = {k: dict(v) for k, v in self.infos.items()}
        autre["Q"]["date_fichier"] = "2026-10-29"
        self.assertFalse(national.repartition_a_jour(self.racine, autre, ["13"]))
        # une répartition d'une version antérieure (sans comptes par jour) est refaite
        p = os.path.join(self.racine, "repartition.json")
        m = lire_json(p)
        del m["marqueur"]["schema"]
        ecrire_json(p, m)
        self.assertFalse(national.repartition_a_jour(self.racine, self.infos, ["13"]))

    def test_essai_limite_non_repris(self):
        rep = national.repartir(ClientFactice(), self.j, self.infos, self.racine, limite_lignes=2)
        self.assertEqual(rep["Q"]["lignes"], 2)
        self.assertIsNone(rep["Q"]["sha256_brut"])
        self.assertFalse(national.repartition_a_jour(self.racine, self.infos))

    def test_colonne_absente(self):
        with open(self.q, "w", encoding="utf-8", newline="") as f:
            f.write('"numero_immatriculation","type_syndic"\n"AA0000001","professionnel"\n')
        with self.assertRaises(national.ErreurFatale):
            national.repartir(ClientFactice(), self.j, self.infos, self.racine)


if __name__ == "__main__":
    unittest.main()
