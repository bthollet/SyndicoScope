# -*- coding: utf-8 -*-
"""Fichiers publiés : noms à empreinte, index fragmenté des numéros, contrôles de publication,
manifest et écarts au mois précédent.

    python -X utf8 -I -m unittest discover -s tests -v
"""
import hashlib
import json
import os
import random
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))

import publier                      # noqa: E402
from entreprises import normaliser  # noqa: E402


def chercher(manifest, lire, numero):
    """Ce que fera la page : le préfixe le plus long présent dans le manifest, puis le suffixe."""
    im = manifest["immat"]
    import re
    if not re.fullmatch(im["regex"], numero):
        if not im["autres"]:
            return None
        frag = lire(im["autres"])
        return next((d for d, v in frag["d"].items() if numero in v), None)
    for k in range(6, 2, -1):
        h = im["fragments"].get(numero[:k])
        if h:
            frag = lire(im["modele"].replace("{prefixe}", numero[:k]).replace("{empreinte}", h))
            n = int(numero[k:])
            return next((d for d, v in frag["d"].items() if n in v), None)
    return None


def donnees_minimales(**syndic):
    s = {"siret": "12345678900012", "siren": "123456789", "nom": "CABINET ESSAI", "ei": False, "trouve": True,
         "sigle": None, "enseignes": None, "groupe": None, "dirigee_par": None, "bureau": None, "siege": None}
    s.update(syndic)
    return {"meta": {"chiffres": {"copros_auj": 1, "copros_t3": 1}, "zones": []},
            "syndics": [s],
            "copros": {"champs": list(publier.CHAMPS_COPROS),
                       "lignes": [["AA0000001", 43.2965, 5.3698, 0, 12, 0, 0, 0, 0, 0]]}}


def empreinte(nom):
    return hashlib.sha256(normaliser(nom).encode("utf-8")).hexdigest()


class Fragments(unittest.TestCase):
    def test_index_complet_et_borne(self):
        rnd = random.Random(1)
        numeros = {"%s%07d" % (rnd.choice(["AA", "AB", "AC"]), rnd.randrange(10 ** 7)) for _ in range(30000)}
        paires = [(n, rnd.choice(["13", "2A", "973"])) for n in sorted(numeros)] + [("XX12", "13")]
        frags, autres = publier.fragments_immat(paires, budget=4000)
        self.assertEqual(autres, {"p": "", "d": {"13": ["XX12"]}})
        self.assertTrue(all(len(publier.serialiser(f)) <= 4000 for f in frags.values()))
        self.assertEqual(sum(len(v) for f in frags.values() for v in f["d"].values()), len(numeros))
        # aucun préfixe n'est le début d'un autre : la recherche du plus long préfixe est sans ambiguïté
        prefixes = sorted(frags)
        self.assertFalse(any(b.startswith(a) for a, b in zip(prefixes, prefixes[1:])))
        site = tempfile.mkdtemp(prefix="syndicoscope_essai_")
        try:
            manifest = {"immat": {"regex": publier.MOTIF_IMMAT, "modele": "immat/{prefixe}.{empreinte}.json",
                                  "fragments": {}, "autres": None}}
            for p, f in frags.items():
                e = publier.ecrire_hache(site, "immat", p, f)
                manifest["immat"]["fragments"][p] = e["fichier"].rsplit(".", 2)[1]
            manifest["immat"]["autres"] = publier.ecrire_hache(site, "immat", "autres", autres)["fichier"]

            def lire(rel):
                with open(os.path.join(site, *rel.split("/")), encoding="utf-8") as f:
                    return json.load(f)
            attendu = dict(paires)
            for n in rnd.sample(sorted(numeros), 300) + ["XX12"]:
                self.assertEqual(chercher(manifest, lire, n), attendu[n], n)
            self.assertIsNone(chercher(manifest, lire, "AD0000001"))
        finally:
            shutil.rmtree(site, ignore_errors=True)

    def test_noms_a_empreinte(self):
        site = tempfile.mkdtemp(prefix="syndicoscope_essai_")
        try:
            a = publier.ecrire_hache(site, "d", "13", {"x": 1})
            b = publier.ecrire_hache(site, "d", "13", {"x": 1})
            c = publier.ecrire_hache(site, "d", "13", {"x": 2})
            self.assertEqual(a, b)
            self.assertNotEqual(a["fichier"], c["fichier"])
            self.assertRegex(a["fichier"], r"^d/13\.[0-9a-f]{10}\.json$")
            with open(os.path.join(site, "d", a["fichier"][2:]), "rb") as f:
                self.assertEqual(f.read(), b'{"x":1}')
        finally:
            shutil.rmtree(site, ignore_errors=True)


class Controles(unittest.TestCase):
    def test_propre(self):
        self.assertEqual(publier.controler_departement(donnees_minimales(), set()), ([], []))

    def test_coordonnees_non_arrondies(self):
        d = donnees_minimales()
        d["copros"]["lignes"][0][1] = 43.29651
        self.assertTrue(publier.controler_departement(d, set())[0])

    def test_cle_interdite(self):
        d = donnees_minimales()
        d["syndics"][0]["adresse"] = "1 rue de l'Essai"
        self.assertTrue(publier.controler_departement(d, set())[0])

    def test_entrepreneur_individuel(self):
        mal = donnees_minimales(ei=True, nom="Jean Dupont")
        self.assertTrue(publier.controler_departement(mal, set())[0])
        bien = donnees_minimales(ei=True, nom="Entrepreneur individuel", siren="ei-1", siret=None)
        self.assertEqual(publier.controler_departement(bien, {empreinte("Entrepreneur individuel")}), ([], []))
        # un vrai SIREN, un SIRET, un bureau même approché, une date de création : bloquant
        for k, v in (("siren", "123456789"), ("siret", "12345678900012"), ("creation", "2001-01-01"),
                     ("bureau", {"precision": "approchee", "lat": 43.3, "lon": 5.37}), ("bodacc", {"total": 1})):
            d = donnees_minimales(ei=True, nom="Entrepreneur individuel", siren="ei-1", siret=None)
            d["syndics"][0][k] = v
            self.assertTrue(publier.controler_departement(d, set())[0], k)

    def test_siren_d_entrepreneur_individuel_nulle_part(self):
        d = donnees_minimales(ei=True, nom="Entrepreneur individuel", siren="ei-1", siret=None)
        self.assertEqual(publier.controler_masquage(d, {"987654321"}), [])
        d["copros"]["note"] = "voir 98765432100017"   # en tête d'un SIRET, n'importe où dans le fichier
        self.assertTrue(publier.controler_masquage(d, {"987654321"}))

    def test_non_trouve_a_l_annuaire(self):
        nom = publier.MASQUES["nt"]
        bien = donnees_minimales(trouve=False, nom=nom, siren="nt-1", siret=None)
        self.assertEqual(publier.controler_departement(bien, {empreinte(nom)}), ([], []))
        for k, v in (("siren", "123456789"), ("siren", "ei-1"), ("nom", "Société non trouvée à l'annuaire des entreprises"),
                     ("siret", "12345678900012"), ("bureau", {"lat": 43.3, "lon": 5.37}), ("creation", "2001-01-01"),
                     ("finances", {"annee": "2024"}), ("dirigee_par", ["SOCIETE MERE"])):
            d = donnees_minimales(trouve=False, nom=nom, siren="nt-1", siret=None)
            d["syndics"][0][k] = v
            self.assertTrue(publier.controler_masquage(d), (k, v))
        # un SIRET masqué nulle part ; un autre SIRET du même SIREN n'est pas visé quand seul le SIRET l'est
        d = donnees_minimales(trouve=False, nom=nom, siren="nt-1", siret=None)
        d["copros"]["note"] = "voir 98765432100017"
        self.assertTrue(publier.controler_masquage(d, None, {"98765432100017"}))
        self.assertEqual(publier.controler_masquage(d, None, {"98765432100025"}), [])

    def test_cle_de_pseudonyme_sans_masquage(self):
        self.assertTrue(publier.controler_masquage(donnees_minimales(siren="nt-2")))

    def test_jeu_complementaire_sans_numero_masque(self):
        site = tempfile.mkdtemp(prefix="syndicoscope_essai_")
        try:
            g = {"type": "FeatureCollection", "features": []}
            masques = ({"987654321"}, {"11122233300044"})
            for comp, n in (({"penal": {"syndics": {"123456789": 1}}}, 0),
                            ({"penal": {"syndics": {"987654321": 1}}}, 1),
                            ({"penal": {"note": "voir 11122233300044"}}, 1)):
                _, err, _, _ = publier.publier_departement(site, "13", "Bouches-du-Rhône", donnees_minimales(), g,
                                                           set(), comp, masques)
                self.assertEqual(len(err), n, err)
        finally:
            shutil.rmtree(site, ignore_errors=True)

    def test_nom_de_representant_non_professionnel(self):
        # un nom de personne publié hors annuaire : bloquant (et le masquage, ici incomplet, aussi)
        d = donnees_minimales(trouve=False, nom=publier.MASQUES["nt"], siren="nt-1", siret=None,
                              enseignes=["Jean Dupont"])
        erreurs, _ = publier.controler_departement(d, {empreinte("Jean Dupont")})
        self.assertTrue(any("nom egal" in e for e in erreurs), erreurs)
        # une société de l'annuaire déclarée ailleurs comme représentant non professionnel : alerte
        d = donnees_minimales()
        erreurs, alertes = publier.controler_departement(d, {empreinte("CABINET ESSAI")})
        self.assertEqual(erreurs, [])
        self.assertTrue(alertes)


class Manifest(unittest.TestCase):
    def test_bbox(self):
        g = {"features": [{"geometry": {"type": "Polygon", "coordinates": [[[5.0, 43.0], [5.5, 43.4], [5.2, 43.1]]]}},
                          {"geometry": {"type": "MultiPolygon",
                                        "coordinates": [[[[4.9, 43.2], [5.1, 43.5], [5.0, 43.3]]]]}}]}
        self.assertEqual(publier.bbox(g), [43.0, 4.9, 43.5, 5.5])
        self.assertEqual(publier.bbox({"features": []}, [["AA0000001", 43.1, 5.2]]), [43.1, 5.2, 43.1, 5.2])

    def test_finaliser_et_menage(self):
        site = tempfile.mkdtemp(prefix="syndicoscope_essai_")
        try:
            d = donnees_minimales()
            d["meta"]["zones"] = [["13055", "Marseille", "commune", None, 43.2965, 5.3698, True],
                                  ["13201", "Marseille 1er", "arrondissement", "13055", 43.30, 5.38, False]]
            g = {"type": "FeatureCollection", "features": []}
            entree, err, alr, _ = publier.publier_departement(site, "13", "Bouches-du-Rhône", d, g, set(),
                                                              {"jurisprudence": {"decisions": [1, 2]}})
            self.assertEqual((err, alr), ([], []))
            c = entree["complements"]["jurisprudence"]
            self.assertRegex(c["fichier"], r"^c/jurisprudence-13\.[0-9a-f]{10}\.json$")
            self.assertEqual((c["octets"], c["empreinte"]), (len(b'{"decisions":[1,2]}'), c["fichier"].split(".")[1]))
            perime = os.path.join(site, "d", "13.0123456789.json")
            with open(perime, "w") as f:
                f.write("{}")
            infos = {"Q": {"url_source": "q", "date_fichier": "2026-10-28"},
                     "T": {"url_source": "t", "date_fichier": "2025-10-29"}}
            rep = {"Q": {"lignes": 1, "departements": {"13": 1}}, "T": {"lignes": 1}, "departements": ["13"]}
            maj = {"base": "mandat_en_cours", "plancher": None}
            france = {"syndics": {"sirets": 1, "ei": 0, "nt": 0}, "collectivites_outre_mer": {"978": 2}}
            m, err, alr, det = publier.finaliser(site, {"13": entree}, [("13", d["meta"]["zones"])],
                                                 [("AA0000001", "13")], infos, rep, "2026-10-28", "2025-10-29",
                                                 "0.1", "2026-10-28T17:00:00+01:00", maj, france)
            self.assertEqual(err, [])
            self.assertEqual(m["communes"]["zones"], 2)
            self.assertEqual(m["departements"]["13"]["copros"], 1)
            self.assertEqual(m["maj"], maj)
            self.assertEqual((m["france"]["copros"], m["france"]["syndics"], m["france"]["collectivites_outre_mer"]),
                             (1, france["syndics"], {"978": 2}))
            self.assertEqual(publier.ecrire_manifest(site, m), 1)
            self.assertFalse(os.path.exists(perime))
            for rel in (m["departements"]["13"]["d"], m["departements"]["13"]["g"], m["communes"]["fichier"], c["fichier"]):
                self.assertTrue(os.path.exists(os.path.join(site, *rel.split("/"))), rel)
            with open(os.path.join(site, "manifest.json"), encoding="utf-8") as f:
                self.assertEqual(json.load(f), m)
        finally:
            shutil.rmtree(site, ignore_errors=True)

    def test_ecarts(self):
        avant = {"france": {"copros": 1000}, "departements": {"13": {"copros": 600}, "48": {"copros": 100}}}
        apres = {"france": {"copros": 1020}, "departements": {"13": {"copros": 610}, "48": {"copros": 120}}}
        self.assertEqual(publier.comparer(apres, avant), [])          # 48 : +20 %, mais moins de 50
        apres["departements"]["13"]["copros"] = 700
        self.assertEqual(len(publier.comparer(apres, avant)), 1)      # 13 : +16,7 % et +100
        apres["france"]["copros"] = 1100
        self.assertEqual(len(publier.comparer(apres, avant)), 2)      # France : +10 %
        self.assertEqual(publier.comparer(apres, None), [])


if __name__ == "__main__":
    unittest.main()
