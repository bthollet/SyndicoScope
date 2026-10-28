#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Client PISTE minimal de SyndicoScope (Judilibre), qui ne dévoile jamais la clé.

Identifiants, lus seulement quand un jeton doit être émis, dans cet ordre :
  1. les variables d'environnement PISTE_CLIENT_ID et PISTE_CLIENT_SECRET ;
  2. sinon, le fichier désigné par la variable PISTE_SECRETS_FILE, au format « Clé: valeur » ;
     clés reconnues sans tenir compte de la casse : Client_ID, Client_Secret et Clien_Secret.
Aucun chemin par défaut. Le secret n'est jamais affiché ni journalisé ; les exceptions sont expurgées.

Jeton : cache partagé du poste, <dossier temporaire>/piste_token.json, au format
{"token", "expires", "sandbox"} commun aux autres clients du poste. PISTE ne garde qu'un jeton
valide par application : en émettre un révoque le précédent, donc celui d'un autre processus.
On relit toujours le cache d'abord ; sur un refus (401), on ne renouvelle que si le jeton refusé
est encore celui du cache (sinon un autre processus l'a déjà renouvelé : on prend le sien).

Test :
    PISTE_SECRETS_FILE=<chemin> python -X utf8 -I pipeline/piste.py --test
fait un seul appel Judilibre minimal (plus l'appel OAuth si aucun jeton valide n'est en cache)
et n'affiche que « OK » avec le statut HTTP.
"""
import json
import os
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

OAUTH = "https://oauth.piste.gouv.fr/api/oauth/token"
API = "https://api.piste.gouv.fr"
JUDILIBRE = "cassation/judilibre/v1.0"
CACHE = os.path.join(tempfile.gettempdir(), "piste_token.json")
APPELS = {"oauth": 0, "api": 0}


class IdentifiantsAbsents(Exception):
    pass


def _contexte_tls():
    ctx = ssl.create_default_context()
    try:
        import certifi   # dépendance facultative : magasin de certificats à jour
        ctx.load_verify_locations(cafile=certifi.where())
    except Exception:
        pass
    return ctx


def lire_identifiants():
    cid, sec = os.environ.get("PISTE_CLIENT_ID"), os.environ.get("PISTE_CLIENT_SECRET")
    if cid and sec:
        return cid, sec
    chemin = os.environ.get("PISTE_SECRETS_FILE")
    if not chemin:
        raise IdentifiantsAbsents("définir PISTE_CLIENT_ID et PISTE_CLIENT_SECRET, ou PISTE_SECRETS_FILE")
    vals = {}
    with open(chemin, encoding="utf-8-sig") as f:
        for ligne in f:
            if ":" in ligne:
                k, v = ligne.split(":", 1)
                vals[k.strip().lower().replace("_", "")] = v.strip()
    cid = vals.get("clientid")
    sec = vals.get("clientsecret") or vals.get("cliensecret")   # « Clien_Secret » : coquille d'origine
    if not cid or not sec:
        raise IdentifiantsAbsents("le fichier désigné ne porte pas Client_ID et Client_Secret")
    return cid, sec


def _lire_cache():
    try:
        with open(CACHE, encoding="utf-8") as f:
            c = json.load(f)
        if not c.get("sandbox") and float(c.get("expires", 0)) > time.time() + 60:
            return c.get("token")
    except (OSError, ValueError, TypeError):
        pass
    return None


def _emettre():
    cid, sec = lire_identifiants()
    corps = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": cid,
                                    "client_secret": sec, "scope": "openid"}).encode()
    del cid, sec
    APPELS["oauth"] += 1
    with urllib.request.urlopen(urllib.request.Request(OAUTH, data=corps), timeout=60, context=_contexte_tls()) as r:
        d = json.load(r)
    tok = d["access_token"]
    tmp = CACHE + ".%d.tmp" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"token": tok, "expires": time.time() + d.get("expires_in", 3600), "sandbox": False}, f)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, CACHE)
    return tok


def jeton(force=False):
    if not force:
        tok = _lire_cache()
        if tok:
            return tok
    return _emettre()


def appel(route, params=None):
    """GET sur une route PISTE ; rend (statut HTTP, objet JSON ou None)."""
    url = "%s/%s" % (API, route.lstrip("/"))
    if params:
        url += "?" + urllib.parse.urlencode(params)
    tok = jeton()
    for essai in (1, 2):
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok, "Accept": "application/json"})
        APPELS["api"] += 1
        try:
            with urllib.request.urlopen(req, timeout=120, context=_contexte_tls()) as r:
                brut = r.read()
                try:
                    return r.status, json.loads(brut.decode("utf-8"))
                except ValueError:
                    return r.status, None
        except urllib.error.HTTPError as e:
            if e.code == 401 and essai == 1:
                relu = _lire_cache()   # un autre processus a peut-être déjà renouvelé
                tok = relu if (relu and relu != tok) else jeton(force=True)
                continue
            return e.code, None
    return 401, None


def principal():
    if "--test" not in sys.argv[1:]:
        print(__doc__)
        return 0
    statut, _ = appel(JUDILIBRE + "/taxonomy", {"id": "jurisdiction"})
    print(("OK HTTP %d" if statut == 200 else "ÉCHEC HTTP %d") % statut)
    return 0 if statut == 200 else 1


if __name__ == "__main__":
    try:
        sys.exit(principal())
    except SystemExit:
        raise
    except IdentifiantsAbsents as e:
        print("ÉCHEC : identifiants PISTE absents (%s)" % e, file=sys.stderr)
        sys.exit(2)
    except BaseException as e:   # expurgé : ni message ni trace, qui pourraient citer une valeur
        print("ÉCHEC : %s (détail expurgé)" % type(e).__name__, file=sys.stderr)
        sys.exit(2)
