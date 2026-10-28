#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Contrôle d'une page à publier (HTML autonome, fichier de données) avant de la mettre dans docs/.

Le passage national et le mode « un département » contrôlent ce qu'ils écrivent (publier.py). Une page
assemblée à part, données et jeux complémentaires intégrés, se contrôle ici, en dernier, sur le fichier
même qui sera publié. On y cherche, sans jamais les afficher :
- un numéro masqué (contrat des données, § 11) : SIREN d'un entrepreneur individuel ou d'un syndic que
  l'annuaire ne connaît pas, seul, en tête d'un SIRET ou écrit par groupes de trois chiffres ; SIRET
  d'un non trouvé. Les numéros se lisent dans le cache local de l'annuaire (build.numeros_masques) ;
- une clé interdite à la publication (publier.CLES_INTERDITES), écrite en clé JSON. Ce sont des noms de
  champs, pas des données : on les nomme.

Usage
  python -X utf8 -I scripts/controler_page.py <fichier> [<fichier>...] --annuaire build/national/cache/dinum.json

Sortie : par fichier, le nombre de numéros masqués trouvés et les clés interdites, puis « OK » ou
« REFUSÉ ». Code de sortie : 0 rien trouvé, 1 trouvé, 2 erreur.
"""
import argparse
import json
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, "pipeline"))

NUMERO = re.compile(r"(?<!\d)(\d{9}(?:\d{5})?)(?!\d)")
SIREN_ESPACE = re.compile(r"(?<!\d)(\d{3})[   ](\d{3})[   ](\d{3})(?!\d)")


def examiner(texte, sirens, sirets, interdites):
    """(numéros masqués trouvés, clés interdites trouvées) dans un texte ; les numéros ne sont que comptés."""
    n = 0
    for m in NUMERO.finditer(texte):
        x = m.group(1)
        n += x[:9] in sirens or x in sirets
    n += sum(1 for m in SIREN_ESPACE.finditer(texte) if "".join(m.groups()) in sirens)
    cles = sorted({c for c in interdites if re.search(r'"%s"\s*:' % re.escape(c), texte)})
    return n, cles


def principal():
    import build     # noqa: E402
    import publier   # noqa: E402
    ap = argparse.ArgumentParser(description="Contrôle d'une page à publier : numéros masqués, clés interdites")
    ap.add_argument("fichiers", nargs="+")
    ap.add_argument("--annuaire", required=True, help="cache local de l'annuaire (dinum.json)")
    a = ap.parse_args()
    with open(a.annuaire, encoding="utf-8") as f:
        sirens, sirets = build.numeros_masques(json.load(f))
    refus = 0
    for chemin in a.fichiers:
        with open(chemin, encoding="utf-8", errors="replace") as f:
            n, cles = examiner(f.read(), sirens, sirets, publier.CLES_INTERDITES)
        print("%s : numéros masqués %d, clés interdites %s" % (chemin, n, cles or "aucune"))
        refus += bool(n or cles)
    print("REFUSÉ" if refus else "OK")
    return 1 if refus else 0


if __name__ == "__main__":
    try:
        sys.exit(principal())
    except SystemExit:
        raise
    except BaseException as e:   # jamais de trace : elle pourrait citer une valeur lue
        print("ERREUR : %s (détail expurgé)" % type(e).__name__, file=sys.stderr)
        sys.exit(2)
