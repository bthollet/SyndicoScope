# -*- coding: utf-8 -*-
"""Assemble les deux variantes de la page à partir de site/ (gabarit, style, script) :

- <sortie>/site/index.html : page complète et autonome, données intégrées (s'ouvre en local,
  ou plus tard sur GitHub Pages) ;
- <sortie>/artifact/index.html : fragment sans doctype, html, head ni body, qui charge
  donnees.json et contours.json par fetch relatif ; les deux fichiers sont copiés à côté.

Le gabarit site/index.html est coupé en deux par la ligne « <!-- CORPS --> » : la tête (titre,
méta, style) et le corps (balisage, scripts). « <!--DONNEES--> » marque l'emplacement des données
intégrées ; « /*CSS*/ » et « /*JS*/ » ceux du style et du script.

Jeux complémentaires d'un département D (jurisprudence, pénal…) : donnees_complementaires/<type>_<D>/
<type>_<D>.json, à la racine du dépôt, jamais commités tant que le verrou de publication n'est pas levé.
Chaque jeu trouvé est embarqué dans la page autonome (<script type="application/json"
id="complement-<type>">) et copié à côté du fragment (complement-<type>.json) ; meta.complements de
donnees.json en donne la liste (build.complements). Aucun jeu : rien ne change.
"""
import json
import os
import re

SEPARATEUR = "<!-- CORPS -->"
DOSSIER_COMPLEMENTS = "donnees_complementaires"
MOTIF_COMPLEMENT = re.compile(r"[a-z][a-z0-9_-]*")   # le type devient un identifiant HTML et un nom de fichier


def _lire(chemin):
    with open(chemin, encoding="utf-8") as f:
        return f.read()


def _ecrire(chemin, texte):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, "w", encoding="utf-8", newline="\n") as f:
        f.write(texte)


def json_pour_script(obj):
    """JSON sûr dans un <script type="application/json"> : tout « < » devient \\u003c (il n'apparaît
    que dans des chaînes, où l'échappement est valide), ce qui interdit </script> et <!--."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def lire_complements(racine, dep):
    """{type : objet} des jeux complémentaires du département `dep`, par type dans l'ordre alphabétique.
    Un jeu absent ne casse rien ; un fichier présent mais illisible arrête tout (ValueError) plutôt que
    d'être tu."""
    base = os.path.join(racine, DOSSIER_COMPLEMENTS)
    out = {}
    if not dep or not os.path.isdir(base):
        return out
    suffixe = "_" + dep
    for nom in sorted(os.listdir(base)):
        typ = nom[:-len(suffixe)] if nom.endswith(suffixe) else ""
        chemin = os.path.join(base, nom, nom + ".json")
        if not MOTIF_COMPLEMENT.fullmatch(typ) or not os.path.isfile(chemin):
            continue
        try:
            with open(chemin, encoding="utf-8") as f:
                out[typ] = json.load(f)
        except (OSError, ValueError) as e:
            raise ValueError("jeu complementaire illisible : %s (%s)" % (chemin, e)) from None
    return out


def assembler(racine):
    site = os.path.join(racine, "site")
    g = _lire(os.path.join(site, "index.html"))
    css = _lire(os.path.join(site, "vendor", "leaflet-1.9.4.css")) + "\n" + _lire(os.path.join(site, "style.css"))
    js = _lire(os.path.join(site, "app.js"))
    if g.count(SEPARATEUR) != 1 or "/*CSS*/" not in g or "/*JS*/" not in g or "<!--DONNEES-->" not in g:
        raise ValueError("gabarit site/index.html incomplet")
    g = g.replace("/*CSS*/", css).replace("/*JS*/", js)
    tete, corps = g.split(SEPARATEUR)
    return tete, corps


def rendre(racine, sortie, donnees, geojson, complements=None):
    if not os.path.exists(os.path.join(racine, "site", "index.html")):
        print("site/index.html absent : pages non produites (données écrites).")
        return
    complements = complements or {}
    tete, corps = assembler(racine)
    # variante Artifact : fragment + deux JSON chargés par fetch relatif, et les jeux complémentaires
    dossier_a = os.path.join(sortie, "artifact")
    _ecrire(os.path.join(dossier_a, "index.html"), tete + corps.replace("<!--DONNEES-->", ""))
    _ecrire(os.path.join(dossier_a, "donnees.json"), json.dumps(donnees, ensure_ascii=False, separators=(",", ":")))
    _ecrire(os.path.join(dossier_a, "contours.json"), json.dumps(geojson, ensure_ascii=False, separators=(",", ":")))
    for nom in os.listdir(dossier_a):   # un jeu retiré ne reste pas à côté de la page
        m = re.fullmatch(r"complement-(.+)\.json", nom)
        if m and m.group(1) not in complements:
            os.remove(os.path.join(dossier_a, nom))
    for typ, obj in complements.items():
        _ecrire(os.path.join(dossier_a, "complement-%s.json" % typ), json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    # variante complète : document HTML autonome, données intégrées
    integre = ('<script type="application/json" id="donnees-json">' + json_pour_script(donnees) + "</script>\n"
               '<script type="application/json" id="contours-json">' + json_pour_script(geojson) + "</script>\n")
    for typ, obj in complements.items():
        integre += '<script type="application/json" id="complement-%s">' % typ + json_pour_script(obj) + "</script>\n"
    page = ('<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            + tete + "</head>\n<body>\n" + corps.replace("<!--DONNEES-->", integre) + "</body>\n</html>\n")
    _ecrire(os.path.join(sortie, "site", "index.html"), page)
    print("pages : %s ; %s" % (os.path.join(dossier_a, "index.html"), os.path.join(sortie, "site", "index.html")))
