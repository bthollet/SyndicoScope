# -*- coding: utf-8 -*-
"""Outils communs du pipeline : journal, mémoire libre, client HTTP poli, dates.

Bibliothèque standard seule. `certifi` est employé s'il est importable (dépendance facultative :
sur un poste dont le magasin de certificats est périmé, Python échoue sinon en « certificate has
expired ») ; à défaut, repli sur `curl`. La vérification TLS n'est jamais désactivée.
"""
import calendar
import datetime as dt
import gzip
import json
import os
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = "0.1"
UA = "SyndicoScope/%s (aide au choix d'un syndic ; donnees ouvertes)" % VERSION

# Espacement minimal entre deux appels à un même hôte (secondes) et pauses avant reprise.
# DINUM : 5 requêtes/s au plus -> 0,25 s ; BODACC : 2/s au plus -> 0,55 s ; API tabulaire : espacée.
ECARTS = {
    "tabular-api.data.gouv.fr": 1.0,
    "recherche-entreprises.api.gouv.fr": 0.25,
    "www.bodacc.fr": 0.55,
    "geo.api.gouv.fr": 0.5,
}
PAUSES = {"tabular-api.data.gouv.fr": (0, 10, 60)}   # deux reprises au plus
PAUSES_DEFAUT = (0, 5, 30)
SEUIL_MEMOIRE_MO = 1024


class ErreurFatale(Exception):
    pass


class ErreurAPI(Exception):
    pass


def maintenant():
    return dt.datetime.now().astimezone()


def horodatage():
    return maintenant().isoformat(timespec="seconds")


def moins_mois(d, n):
    m = d.month - 1 - n
    a = d.year + m // 12
    m = m % 12 + 1
    return dt.date(a, m, min(d.day, calendar.monthrange(a, m)[1]))


def mois_entre(d_ancienne, d_recente):
    """Nombre de mois révolus entre deux dates (0 si la première est postérieure)."""
    if d_ancienne is None or d_recente is None or d_ancienne > d_recente:
        return 0 if d_ancienne and d_recente else None
    n = (d_recente.year - d_ancienne.year) * 12 + d_recente.month - d_ancienne.month
    if d_recente.day < d_ancienne.day:
        n -= 1
    return max(n, 0)


def ddate(v):
    if not v:
        return None
    try:
        return dt.date.fromisoformat(str(v).strip()[:10])
    except ValueError:
        return None


def dint(v):
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


def dfloat(v):
    try:
        x = float(str(v).strip())
    except (ValueError, TypeError):
        return None
    return x if x == x else None   # écarte NaN


def memoire_libre_mo():
    """Mémoire physique disponible en Mo : GlobalMemoryStatusEx sous Windows, /proc/meminfo sinon."""
    if os.name == "nt":
        try:
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
            ms = MS()
            ms.dwLength = ctypes.sizeof(MS)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms)):
                return int(ms.ullAvailPhys // (1024 * 1024))
        except Exception:
            pass
    try:
        with open("/proc/meminfo", encoding="ascii") as f:
            d = {}
            for ligne in f:
                k, _, v = ligne.partition(":")
                if v.split():
                    d[k] = int(v.split()[0])
        val = d.get("MemAvailable") or d.get("MemFree")
        return val // 1024 if val else None
    except OSError:
        return None


class Journal:
    """Journal horodaté, une ligne par événement. N'y écrire ni secret ni personne physique."""

    def __init__(self, chemin):
        os.makedirs(os.path.dirname(chemin), exist_ok=True)
        self.f = open(chemin, "a", encoding="utf-8")
        self.verrou = threading.Lock()

    def ecrire(self, *parts):
        ligne = horodatage() + " | " + " | ".join(str(p) for p in parts)
        with self.verrou:
            self.f.write(ligne + "\n")
            self.f.flush()

    def fermer(self):
        self.f.close()


def dire(msg):
    print(maintenant().strftime("%H:%M:%S"), msg, flush=True)


def verifier_memoire(journal, etape, seuil=SEUIL_MEMOIRE_MO):
    m = memoire_libre_mo()
    journal.ecrire("MEMOIRE", etape, "%s Mo disponibles (seuil d'arret : %d Mo)" % (m, seuil))
    if m is not None and m < seuil:
        raise ErreurFatale("Memoire disponible %d Mo < %d Mo a l'etape '%s' : arret." % (m, seuil, etape))
    return m


class Client:
    """GET avec espacement par hôte, deux reprises au plus, TLS vérifié (certifi, sinon curl)."""

    def __init__(self, journal):
        self.j = journal
        self.ctx = ssl.create_default_context()
        self.certifi = False
        try:
            import certifi   # dépendance facultative
            self.ctx.load_verify_locations(cafile=certifi.where())
            self.certifi = True
        except Exception:
            pass
        self.curl = False
        self.dernier = {}
        self.verrou = threading.Lock()
        self.appels = {}
        journal.ecrire("CLIENT", "certifi=%s" % self.certifi)

    def _attendre(self, hote):
        with self.verrou:
            t = time.monotonic()
            prevu = max(t, self.dernier.get(hote, 0.0) + ECARTS.get(hote, 1.0))
            self.dernier[hote] = prevu
        if prevu > t:
            time.sleep(prevu - t)

    def _par_curl(self, url, delai):
        exe = shutil.which("curl")
        if not exe:
            raise ErreurFatale("TLS : ni certifi ni curl ; la verification TLS ne sera pas coupee.")
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            nom = tmp.name
        try:
            r = subprocess.run([exe, "-sS", "-L", "--compressed", "-m", str(int(delai)), "-A", UA, "-o", nom,
                                "-w", "%{http_code}", url], capture_output=True, text=True)
            if r.returncode != 0:
                raise OSError("curl code %s" % r.returncode)
            with open(nom, "rb") as f:
                return int(r.stdout.strip() or 0), f.read()
        finally:
            try:
                os.unlink(nom)
            except OSError:
                pass

    def _une_requete(self, url, delai):
        if self.curl:
            return self._par_curl(url, delai)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"})
        try:
            with urllib.request.urlopen(req, timeout=delai, context=self.ctx) as r:
                corps = r.read()
                if r.headers.get("Content-Encoding", "").lower() == "gzip":
                    corps = gzip.decompress(corps)
                return r.status, corps
        except urllib.error.HTTPError as e:
            corps = e.read()
            if e.headers.get("Content-Encoding", "").lower() == "gzip":
                try:
                    corps = gzip.decompress(corps)
                except OSError:
                    pass
            return e.code, corps
        except urllib.error.URLError as e:
            if isinstance(e.reason, ssl.SSLError) and shutil.which("curl"):
                self.j.ecrire("CLIENT", "echec TLS en Python : repli sur curl, verification conservee")
                self.curl = True
                return self._par_curl(url, delai)
            raise

    def get(self, url, delai=120):
        hote = urllib.parse.urlsplit(url).netloc
        pauses = PAUSES.get(hote, PAUSES_DEFAUT)
        derniere = "?"
        for i, pause in enumerate(pauses):
            if pause:
                time.sleep(pause)
            self._attendre(hote)
            t0 = time.monotonic()
            try:
                st, corps = self._une_requete(url, delai)
            except ErreurFatale:
                raise
            except Exception as e:   # erreur réseau : reprise
                derniere = type(e).__name__
                self.j.ecrire("GET", url, "ERREUR RESEAU", derniere, "essai %d/%d" % (i + 1, len(pauses)))
                continue
            duree = time.monotonic() - t0
            with self.verrou:
                self.appels[hote] = self.appels.get(hote, 0) + 1
            if st in (429, 502, 503, 504) and i < len(pauses) - 1:
                derniere = "HTTP %d" % st
                self.j.ecrire("GET", url, "HTTP %d" % st, "%.1fs" % duree, "transitoire : reprise")
                continue
            self.j.ecrire("GET", url, "HTTP %d" % st, "%d octets" % len(corps), "%.1fs" % duree)
            return st, corps
        raise ErreurAPI("Echec apres %d essais sur %s : %s" % (len(pauses), url[:160], derniere))

    def get_json(self, url, delai=180):
        st, corps = self.get(url, delai=delai)
        if st != 200:
            raise ErreurAPI("HTTP %d sur %s" % (st, url[:160]))
        try:
            return json.loads(corps.decode("utf-8"))
        except ValueError:
            raise ErreurAPI("Reponse non JSON sur %s" % url[:160])


def ecrire_json(chemin, obj, compact=False):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, chemin)


def lire_json(chemin, defaut=None):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defaut
