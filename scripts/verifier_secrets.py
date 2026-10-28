#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vérificateur de secrets de SyndicoScope (bibliothèque standard seule).

Usages
  --indexe              fichiers indexés, contenu de l'index (crochet pre-commit)
  --suivis              tous les fichiers suivis (intégration continue)
  --message <fichier>   message de commit (crochet commit-msg)
  --contre <fichier>    les VALEURS d'un fichier de secrets au format « Clé: valeur »
                        apparaissent-elles dans l'arbre de travail (fichiers suivis et non
                        ignorés), dans un objet quelconque de l'historique ou dans la
                        configuration locale du dépôt ? Sortie : « absent » ou « PRÉSENT »,
                        rien d'autre. Aucune valeur n'est jamais affichée.
  --motifs <fichier>    chaînes interdites propres à un poste (une par ligne, « # » pour un
                        commentaire), jamais affichées. S'ajoutent aux trois premiers modes.
                        Le crochet lit ce chemin dans `git config syndicoscope.motifsLocaux`.

Un .json sous donnees_complementaires/ est une trouvaille en soi (jeux complémentaires, hors du
dépôt tant que le verrou de publication n'est pas levé).

Une trouvaille s'affiche « chemin:ligne: règle », jamais avec le texte trouvé.
Code de sortie : 0 rien trouvé, 1 trouvé, 2 erreur.

Une ligne qui porte « verif-secrets: ignorer » échappe aux deux règles heuristiques
(affectation, bearer), jamais aux autres. À n'employer que pour un faux positif avéré.
"""
import argparse
import math
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

REGLES_STRICTES = [
    ("cle_privee", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("jeton_github", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b")),
    ("cle_aws", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("cle_google", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("jeton_slack", re.compile(r"\bxox[abprs]-[0-9A-Za-z-]{10,}\b")),
    ("jeton_jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
]
MOTS_CLES = (r"client[_ -]?id|clien[_ -]?secret|client[_ -]?secret|secret|token|jeton|api[_ -]?key|"
             r"cle[_ -]?api|password|passwd|mot[_ -]?de[_ -]?passe")
AFFECTATION = re.compile(r"(?i)\b(?:%s)\b[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9_\-.~+/=]{12,})" % MOTS_CLES)
BEARER = re.compile(r"(?i)\bbearer\s+([A-Za-z0-9_\-.~+/=]{20,})")
NOMS_INTERDITS = re.compile(
    r"(?i)^(?:\.env(?:\..+)?|.+\.(?:pem|key|p12|pfx|jks|keystore)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|"
    r"piste.*\.txt|.*secrets?\.(?:txt|json|ya?ml|ini|cfg|toml|env))$")
EXEMPTION = "verif-secrets: ignorer"
# Jeux complémentaires (jurisprudence, pénal…) : aucun .json de ce dossier n'entre dans le dépôt (28/10/2026).
JEUX_COMPLEMENTAIRES = re.compile(r"(?i)^donnees_complementaires/.*\.json$")


def entropie(s):
    n = len(s)
    return -sum(c / n * math.log2(c / n) for c in Counter(s).values()) if n else 0.0


def ressemble_a_un_secret(v):
    """Écarte les noms de variables, d'environnement et les expressions de code."""
    v = v.strip("\"'")
    if len(v) < 12:
        return False
    if re.fullmatch(r"[A-Z0-9_]+", v):           # nom de variable d'environnement
        return False
    if not (re.search(r"[0-9]", v) and re.search(r"[A-Za-z]", v)):
        return False
    if re.fullmatch(r"[a-z_][a-z0-9_.]*", v):     # identifiant ou chemin d'attribut Python
        return False
    if re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", v):
        return True                              # forme des identifiants PISTE
    return entropie(v) >= 3.2


def git(*args, entree=None, racine=None):
    r = subprocess.run(["git", "-c", "core.quotepath=false"] + list(args), cwd=racine, input=entree,
                       capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("git %s a échoué (code %d)" % (args[0], r.returncode))
    return r.stdout


def racine_depot():
    ici = Path(__file__).resolve().parent
    return Path(git("rev-parse", "--show-toplevel", racine=str(ici)).decode("utf-8").strip())


def lire_motifs(chemin):
    if not chemin:
        return []
    motifs = []
    with open(chemin, encoding="utf-8-sig") as f:
        for ligne in f:
            s = ligne.strip()
            if s and not s.startswith("#"):
                motifs.append(s.lower().encode("utf-8"))
    return motifs


def examiner(nom, contenu, motifs):
    """Rend la liste des trouvailles (chemin, ligne, règle), sans jamais le texte trouvé."""
    trouve = []
    base = nom.replace("\\", "/").rsplit("/", 1)[-1]
    if NOMS_INTERDITS.match(base):
        trouve.append((nom, 0, "nom de fichier réservé aux secrets"))
    if JEUX_COMPLEMENTAIRES.match(nom.replace("\\", "/")):
        trouve.append((nom, 0, "jeu complémentaire : hors du dépôt tant que le verrou de publication n'est pas levé"))
    if b"\x00" in contenu[:8000]:
        texte = ""
    else:
        texte = contenu.decode("utf-8", "replace")
    for i, ligne in enumerate(texte.splitlines(), 1):
        for regle, rx in REGLES_STRICTES:
            if rx.search(ligne):
                trouve.append((nom, i, regle))
        if EXEMPTION not in ligne:
            if any(ressemble_a_un_secret(m.group(1)) for m in AFFECTATION.finditer(ligne)):
                trouve.append((nom, i, "affectation d'un identifiant"))
            if any(ressemble_a_un_secret(m.group(1)) for m in BEARER.finditer(ligne)):
                trouve.append((nom, i, "jeton porteur"))
    if motifs:
        bas = contenu.lower()
        for k, m in enumerate(motifs, 1):
            if m in bas:
                n = bas[:bas.index(m)].count(b"\n") + 1
                trouve.append((nom, n, "motif local n° %d" % k))
    return trouve


def objets_par_lot(shas, racine):
    """Lit des objets git par `cat-file --batch` ; rend {sha: contenu}."""
    if not shas:
        return {}
    sortie = git("cat-file", "--batch", entree=("\n".join(shas) + "\n").encode(), racine=racine)
    res, i = {}, 0
    while i < len(sortie):
        fin = sortie.index(b"\n", i)
        entete = sortie[i:fin].decode("utf-8", "replace").split()
        if len(entete) < 3 or entete[1] == "missing":
            i = fin + 1
            continue
        taille = int(entete[2])
        res[entete[0]] = sortie[fin + 1:fin + 1 + taille]
        i = fin + 1 + taille + 1
    return res


def mode_indexe(racine, motifs):
    noms = [n for n in git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT", racine=racine)
            .decode("utf-8").split("\0") if n]
    if not noms:
        return []
    etapes = git("ls-files", "--stage", "-z", "--", *noms, racine=racine).decode("utf-8").split("\0")
    sha_de = {}
    for e in etapes:
        if "\t" in e:
            meta, chemin = e.split("\t", 1)
            sha_de[chemin] = meta.split()[1]
    contenus = objets_par_lot(sorted(set(sha_de.values())), racine)
    trouve = []
    for chemin, sha in sorted(sha_de.items()):
        trouve += examiner(chemin, contenus.get(sha, b""), motifs)
    return trouve


def mode_suivis(racine, motifs):
    trouve = []
    for n in git("ls-files", "-z", racine=racine).decode("utf-8").split("\0"):
        p = Path(racine) / n
        if n and p.is_file():
            trouve += examiner(n, p.read_bytes(), motifs)
    return trouve


def mode_message(chemin, motifs):
    lignes = [l for l in Path(chemin).read_text(encoding="utf-8", errors="replace").splitlines()
              if not l.startswith("#")]
    return examiner("(message de commit)", "\n".join(lignes).encode("utf-8"), motifs)


def valeurs_secretes(chemin):
    vals = []
    with open(chemin, encoding="utf-8-sig") as f:
        for ligne in f:
            if ":" in ligne:
                v = ligne.split(":", 1)[1].strip().strip("\"'")
                if len(v) >= 6:
                    vals.append(v.lower().encode("utf-8"))
    if not vals:
        raise ValueError("aucune valeur lisible")
    return vals


def mode_contre(racine, chemin_secrets):
    vals = valeurs_secretes(chemin_secrets)

    def contient(data):
        bas = data.lower()
        return any(v in bas for v in vals)

    # 1. arbre de travail : fichiers suivis et fichiers nouveaux non ignorés
    for n in git("ls-files", "-z", "--cached", "--others", "--exclude-standard", racine=racine).decode("utf-8").split("\0"):
        p = Path(racine) / n
        if n and p.is_file() and contient(p.read_bytes()):
            return True
    # 2. tous les objets du dépôt : blobs, arbres, commits (messages), étiquettes, objets orphelins
    proc = subprocess.Popen(["git", "cat-file", "--batch-all-objects", "--batch"], cwd=racine,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    flux, present = proc.stdout, False
    while True:
        entete = flux.readline()
        if not entete:
            break
        parts = entete.split()
        if len(parts) < 3 or parts[1] == b"missing":
            continue
        corps = flux.read(int(parts[2]))
        flux.read(1)
        if not present and contient(corps):
            present = True
    proc.wait()
    if present:
        return True
    # 3. configuration et messages locaux du dépôt
    for nom in ("config", "COMMIT_EDITMSG", "FETCH_HEAD", "description"):
        p = Path(racine) / ".git" / nom
        if p.is_file() and contient(p.read_bytes()):
            return True
    return False


def principal():
    ap = argparse.ArgumentParser(description="Vérificateur de secrets de SyndicoScope")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--indexe", action="store_true")
    g.add_argument("--suivis", action="store_true")
    g.add_argument("--message")
    g.add_argument("--contre")
    ap.add_argument("--motifs")
    a = ap.parse_args()
    racine = str(racine_depot())
    if a.contre:
        present = mode_contre(racine, a.contre)
        print("PRÉSENT" if present else "absent")
        return 1 if present else 0
    motifs = lire_motifs(a.motifs)
    if a.indexe:
        trouve = mode_indexe(racine, motifs)
    elif a.suivis:
        trouve = mode_suivis(racine, motifs)
    else:
        trouve = mode_message(a.message, motifs)
    for chemin, ligne, regle in trouve:
        print("%s:%s: %s" % (chemin, ligne, regle))
    if trouve:
        print("Refusé : %d trouvaille(s). Retirer le secret, puis réindexer." % len(trouve), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(principal())
    except SystemExit:
        raise
    except BaseException as e:   # jamais de trace : elle pourrait citer une valeur lue
        print("ERREUR : %s (détail expurgé)" % type(e).__name__, file=sys.stderr)
        sys.exit(2)
