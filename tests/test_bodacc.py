# -*- coding: utf-8 -*-
"""BODACC : une annonce n'est rattachée à un SIREN que si son champ registre le porte, chiffres normalisés ;
une annonce d'alerte n'est publiée que si son commercant concorde avec le nom de la société et si elle ne
précède pas sa création (règles du 28/10/2026). id et registre restent dans le cache, et le commercant
d'une société ; celui d'un entrepreneur individuel n'est jamais gardé, seul le booléen de concordance.

    python -X utf8 -I -m unittest discover -s tests -v
"""
import json
import os
import sys
import unittest
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))

import bodacc   # noqa: E402
import build    # noqa: E402

SOCIETE = {"ei": False, "noms": ["ESSAI GESTION", "EG"]}


class ClientFactice:
    def __init__(self, annonces, erreur=None):
        self.annonces = annonces
        self.erreur = erreur
        self.urls = []

    def get_json(self, url):
        self.urls.append(urllib.parse.unquote(url))
        if self.erreur:
            raise self.erreur
        return {"results": self.annonces}


def annonce(id_, date, famille, commercant, registre=("327 918 231", "327918231"), jugement=None):
    return {"id": id_, "dateparution": date, "familleavis_lib": famille, "typeavis_lib": "Avis initial",
            "jugement": jugement, "registre": list(registre), "commercant": commercant}


class Rattachement(unittest.TestCase):
    def test_porte_siren(self):
        self.assertTrue(bodacc.porte_siren(["327 918 231", "327918231"], "327918231"))
        self.assertTrue(bodacc.porte_siren("327 918 231", "327918231"))
        for registre in (["32791823"], ["3279182310"], ["123 456 789"], [], None, ["RCS Marseille"]):
            self.assertFalse(bodacc.porte_siren(registre, "327918231"), registre)

    def test_details_controles_un_a_un(self):
        annonces = [
            annonce("A1", "2011-09-08", "Procédures collectives", "ESSAI GESTION SARL",
                    jugement='{"nature": "Jugement d\'ouverture"}'),
            annonce("A2", "2012-01-02", "Procédures collectives", "AUTRE", registre=["123 456 789"]),
            annonce("A3", "2015-05-05", "Ventes et cessions", "ESSAI GESTION")]
        res = {"siren": "327918231", "familles": {"Procédures collectives": {"n": 2}, "Ventes et cessions": {"n": 1},
                                                  "Dépôts des comptes": {"n": 9}}}
        c = ClientFactice(annonces)
        bodacc.details(c, res, lambda s: SOCIETE)
        self.assertEqual((len(res["procedures"]), len(res["achats"]), res["ecartees"], res["format"]),
                         (1, 1, 1, bodacc.FORMAT))
        p = res["procedures"][0]
        self.assertEqual((p["id"], p["commercant"], p["commercant_concorde"], p["nature"]),
                         ("A1", "ESSAI GESTION SARL", True, "Jugement d'ouverture"))
        self.assertIn('registre like "327918231"', c.urls[0])
        self.assertIn("registre,commercant", c.urls[0])
        self.assertIn("order_by=familleavis_lib,dateparution", c.urls[0])

    def test_sans_famille_detaillee(self):
        c = ClientFactice([])
        appels = []
        res = bodacc.details(c, {"siren": "327918231", "familles": {"Dépôts des comptes": {"n": 3}}},
                             lambda s: appels.append(s) or SOCIETE)
        self.assertEqual((res["procedures"], res["ecartees"], c.urls, appels), ([], 0, [], []))

    def test_erreur_laisse_la_reponse_intacte(self):
        res = {"siren": "327918231", "familles": {"Procédures collectives": {"n": 1}},
               "procedures": [{"date": "2011-09-08"}], "radiations": [], "achats": []}
        avant = json.dumps(res, sort_keys=True)
        with self.assertRaises(OSError):
            bodacc.details(ClientFactice([], erreur=OSError("coupure")), res, lambda s: SOCIETE)
        self.assertEqual(json.dumps(res, sort_keys=True), avant)
        self.assertTrue(bodacc.a_completer(res))


class Concordance(unittest.TestCase):
    def test_noms(self):
        self.assertTrue(bodacc.concorde("Essai Gestion S.A.S.", ["ESSAI GESTION"]))
        self.assertTrue(bodacc.concorde("Société Générale d'Immeubles", ["SOCIETE GENERALE D'IMMEUBLES (SGI)"]))
        self.assertTrue(bodacc.concorde("ESSAI GESTION", ["CABINET ESSAI GESTION ET ASSOCIES"]))
        self.assertTrue(bodacc.concorde("EG", ["ESSAI GESTION", "EG"]))
        # le cas du 08/09/2011 : registre au SIREN du syndic, commercant d'une autre société
        self.assertFalse(bodacc.concorde("S.C.I. AUSTERLITZ", ["ESSAI GESTION", "EG"]))
        self.assertFalse(bodacc.concorde("ESSAI", ["CABINET ESSAI"]))   # un seul mot : il faut l'égalité
        self.assertFalse(bodacc.concorde("SCI LES PINS", ["CABINET LES PINS"]))   # un seul mot hors articles
        self.assertFalse(bodacc.concorde("SARL", ["ESSAI GESTION"]))
        self.assertFalse(bodacc.concorde(None, ["ESSAI GESTION"]))
        self.assertFalse(bodacc.concorde("ESSAI GESTION", []))

    def test_entrepreneur_individuel_nom_jamais_garde(self):
        annonces = [annonce("B1", "2019-03-04", "Procédures collectives", "FICTIVE Personne"),
                    annonce("B2", "2020-03-04", "Radiations", "FICTIVE Personne")]
        res = {"siren": "327918231", "familles": {"Procédures collectives": {"n": 1}, "Radiations": {"n": 1}}}
        bodacc.details(ClientFactice(annonces), res, lambda s: {"ei": True, "noms": ["PERSONNE FICTIVE"]})
        self.assertEqual([x["commercant_concorde"] for x in res["procedures"] + res["radiations"]], [True, True])
        self.assertNotIn("FICTIVE", json.dumps(res).upper())
        # identité inconnue (non trouvé à l'annuaire) : ni nom gardé, ni concordance
        res = {"siren": "327918231", "familles": {"Procédures collectives": {"n": 1}}}
        bodacc.details(ClientFactice(annonces[:1]), res, lambda s: {"ei": None, "noms": ()})
        self.assertEqual(res["procedures"][0]["commercant_concorde"], None)
        self.assertNotIn("FICTIVE", json.dumps(res).upper())


class Publication(unittest.TestCase):
    ENTREE = {"siren": "327918231", "heure": "2026-10-28T20:00:00+01:00", "format": bodacc.FORMAT,
              "familles": {"Procédures collectives": {"n": 4, "premiere": "2005-01-01", "derniere": "2021-06-01"},
                           "Radiations": {"n": 1, "premiere": "2011-09-08", "derniere": "2011-09-08"},
                           "Ventes et cessions": {"n": 120, "premiere": "2009-01-01", "derniere": "2024-02-02"},
                           "Dépôts des comptes": {"n": 9, "premiere": "2012-01-01", "derniere": "2025-07-01"}},
              "procedures": [{"date": "2005-01-01", "type": "Avis initial", "nature": "x", "commercant_concorde": True},
                             {"date": "2011-09-08", "type": "Avis initial", "nature": "y", "commercant_concorde": False},
                             {"date": "2018-02-02", "type": "Avis initial", "nature": "z", "commercant_concorde": True},
                             {"date": "2021-06-01", "type": "Rectificatif", "nature": "t"}],
              "radiations": [{"date": "2011-09-08", "commercant_concorde": False}],
              "achats": [{"date": "2009-01-01"}] * 100, "ecartees": 0}

    def test_publiables(self):
        gardees, familles, ecartees = bodacc.publiables(self.ENTREE, "2010-05-05")
        self.assertEqual([x["date"] for x in gardees["procedures"]], ["2018-02-02"])
        self.assertEqual(gardees["radiations"], [])
        self.assertEqual(dict(ecartees), {"avant_creation": 1, "nom_discordant": 2, "non_controlee": 1})
        self.assertEqual(familles["Procédures collectives"], {"n": 1, "premiere": "2018-02-02", "derniere": "2018-02-02"})
        self.assertNotIn("Radiations", familles)
        self.assertEqual(familles["Dépôts des comptes"]["n"], 9)

    def test_champ_publie(self):
        b, ecart = build.bodacc_publie(self.ENTREE, "2010-05-05")
        self.assertEqual((b["total"], b["familles"]["Procédures collectives"], b["achats"], b["dernier_achat"]),
                         (130, 1, 120, "2024-02-02"))
        self.assertEqual(b["procedures"], [{"date": "2018-02-02", "type": "Avis initial", "nature": "z"}])
        self.assertEqual((b["premiere"], b["radiations"]), ("2009-01-01", []))
        self.assertNotIn("commercant", json.dumps(b))
        self.assertEqual(build.ecartees_publiees(ecart), {"ecartees_nom_discordant": 2, "ecartees_avant_creation": 1,
                                                          "non_controlees": 1})
        self.assertEqual(build.bodacc_publie(None, None)[0], None)

    def test_a_completer(self):
        self.assertFalse(bodacc.a_completer(self.ENTREE))
        ancien = dict(self.ENTREE, format=None)
        self.assertTrue(bodacc.a_completer(ancien))
        self.assertFalse(bodacc.a_completer({"familles": {"Dépôts des comptes": {"n": 2}}}))


if __name__ == "__main__":
    unittest.main()
