# -*- coding: utf-8 -*-
"""Indicateurs par syndic professionnel (SIRET) et taux de base.

Chaque taux est rendu en paire (numérateur, dénominateur) : la page affiche le dénominateur et
trace l'entonnoir avec. Définitions détaillées : docs/methode.md.

Rétention T3 2025 -> aujourd'hui, pour chaque copropriété rattachée au SIRET dans le T3 :
- « gardee »      : même SIRET aujourd'hui ;
- « interne »     : autre SIRET de la même société (même SIREN) - transfert interne, compté comme gardée ;
- « groupe »      : société du même groupe présumé (dirigeant société commun ou marque d'un groupe intégré) ;
- « concurrent »  : autre syndic professionnel ;
- « non_pro »     : représentant déclaré sans SIRET (bénévole, non connu) ;
- « exp_sans »    : « Mandat expiré sans successeur déclaré » - le registre vide alors le représentant,
                    seule la comparaison avec le T3 permet d'imputer la fiche à son dernier syndic ;
- « pas_mandat »  : « Pas de mandat en cours » ;
- « absente »     : absente de l'extrait du département aujourd'hui.

Mises à jour de la fiche (maj_12, maj_18) : la base est la fiche « Mandat en cours » datée, et un
indicateur à N mois n'existe que si les dates du registre permettent de le mesurer (dates de masse,
ci-dessous ; contrat : docs/contrat-des-donnees.md, meta.maj).
"""
import collections
import datetime as dt

from commun import moins_mois

TAILLES = [("moins_20", None, 19), ("20_49", 20, 49), ("50_99", 50, 99), ("100_300", 100, 300), ("plus_300", 301, None)]
CAT_RETENTION = ["gardee", "interne", "groupe", "concurrent", "non_pro", "exp_sans", "pas_mandat", "absente"]
CAT_GAIN = ["nouvelle", "interne", "groupe", "concurrent", "sans_syndic", "non_pro"]
MOIS_MAJ = (12, 18)
# Date de masse : le registre a donné d'un coup la même date de mise à jour à une grande part des fiches,
# au point d'effacer ce qui précède. Règle (fixée le 28/10/2026 sur la quotidienne du jour, 647 771 fiches
# datées) : un jour porte au moins SEUIL_MASSE des fiches datées ET plus de fiches que tous les jours
# antérieurs réunis. Seuls les 23 et 24/08/2025 la remplissent (19 761 fiches contre 272 avant ; 171 961
# contre 20 033) ; aucun jour antérieur n'a porté plus de 46 fiches. Le seuil de 1 % ne sert qu'à écarter
# les premiers jours de la série, où une fiche isolée « précède » tout ce qui suit.
# Date signalée : un jour qui porte lui aussi au moins SEUIL_MASSE des fiches datées, sans effacer le passé
# (22 jours le 28/10/2026, jusqu'à 53 112 fiches le 03/10/2026). Ses fiches restent comptées comme mises à
# jour ; mais si un traitement du registre ou un envoi groupé les a datées sans vraie mise à jour,
# l'indicateur à 12 mois est sous-estimé : la page le dit (décision du 28/10/2026).
SEUIL_MASSE = 0.01


def jours_maj(rows):
    """{date iso : [fiches datées ce jour-là, dont hors « Mandat en cours »]}."""
    out = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        if r.maj is not None:
            v = out[r.maj.isoformat()]
            v[0] += 1
            v[1] += 0 if r.etat == 0 else 1
    return dict(out)


def sirets_par_jour(rows):
    """{date iso : nombre de SIRET de syndics professionnels distincts parmi les fiches datées ce jour-là}."""
    out = collections.defaultdict(set)
    for r in rows:
        if r.maj is not None and isinstance(r.repr, str):
            out[r.maj.isoformat()].add(r.repr)
    return {d: len(s) for d, s in out.items()}


def dates_de_masse(jours, seuil=SEUIL_MASSE):
    """Dates de masse d'un compte par jour ({date iso : [fiches, dont hors mandat en cours]}), dans l'ordre."""
    total = sum(v[0] for v in jours.values())
    out, avant = [], 0
    for d in sorted(jours):
        n = jours[d][0]
        if total and n >= seuil * total and n > avant:
            out.append(d)
        avant += n
    return out


def dates_signalees(jours, masse, seuil=SEUIL_MASSE):
    """Jours qui portent au moins `seuil` des fiches datées sans être des dates de masse, dans l'ordre."""
    total = sum(v[0] for v in jours.values())
    return [d for d in sorted(jours) if total and jours[d][0] >= seuil * total and d not in masse]


def mesurabilite(date_ref, plancher, mois=MOIS_MAJ):
    """{N : vrai si « plus de N mois sans mise à jour » se mesure}. Il faut date_ref - N mois > plancher :
    une fiche datée du plancher a pu n'être pas mise à jour depuis bien avant, on ne sait pas depuis quand."""
    return {n: plancher is None or moins_mois(date_ref, n) > plancher for n in mois}


def premier_jour_mesurable(plancher, mois):
    """Première date de référence à laquelle l'indicateur à `mois` mois se mesure."""
    d = plancher + dt.timedelta(days=28 * mois)   # minorant : un mois compte au moins 28 jours
    while moins_mois(d, mois) <= plancher:
        d += dt.timedelta(days=1)
    return d


def meta_maj(date_ref, dates, jours, signalees=(), sirets=None):
    """meta.maj du contrat des données. `dates`, `signalees` : dates de masse et dates signalées (celles de la
    France) ; `jours` : comptes par jour de la population décrite (un département, ou la France) : n, part
    de ses fiches datées, part hors « Mandat en cours » parmi les fiches du jour ; `sirets` : SIRET distincts
    par jour, pour les dates signalées. Une date sans fiche dans la population n'est pas listée."""
    plancher = dt.date.fromisoformat(max(dates)) if dates else None
    total = sum(v[0] for v in jours.values())
    m = mesurabilite(date_ref, plancher)

    def jour(d):
        n, hors = jours[d]
        return {"date": d, "n": n, "part": round(n / total, 4), "part_sans_mandat": round(hors / n, 4)}
    return {"base": "mandat_en_cours", "date_ref": date_ref.isoformat(),
            "plancher": plancher.isoformat() if plancher else None,
            "dates_de_masse": [jour(d) for d in sorted(dates) if (jours.get(d) or [0])[0]],
            "dates_signalees": [dict(jour(d), siret_distincts=(sirets or {}).get(d, 0))
                                for d in sorted(signalees) if (jours.get(d) or [0])[0]],
            "mesurable": {str(n): m[n] for n in MOIS_MAJ},
            "mesurable_a_partir_du": {str(n): premier_jour_mesurable(plancher, n).isoformat() if plancher else None
                                      for n in MOIS_MAJ}}


def profil(rows):
    lc = [r for r in rows if r.lots is not None]
    out = {"n": len(rows), "lots": sum(r.lots for r in lc), "lots_connus": len(lc)}
    for nom, lo, hi in TAILLES:
        out["taille_" + nom] = [sum(1 for r in lc if (lo is None or r.lots >= lo) and (hi is None or r.lots <= hi)), len(lc)]
    per = [r for r in rows if r.iv is not None]
    out["avant_1975"] = [sum(1 for r in per if r.iv[1] <= 1974), len(per)]
    out["qp_2024"] = [sum(1 for r in rows if r.qp), len(rows)]
    for nom, att in (("aidee", "aidee"), ("residence_service", "residence")):
        c = [r for r in rows if getattr(r, att) is not None]
        out[nom] = [sum(1 for r in c if getattr(r, att)), len(c)]
    return out


def diligence(rows, date_ref, plancher=None):
    """maj_12, maj_18 : parmi les fiches « Mandat en cours » datées ; None quand le plancher empêche la mesure."""
    s12, s18 = moins_mois(date_ref, 12), moins_mois(date_ref, 18)
    m = mesurabilite(date_ref, plancher)
    am = [r for r in rows if r.etat == 0 and r.maj is not None]
    ec = [r for r in rows if r.etat == 0 and r.fin is not None]
    return {"maj_12": [sum(1 for r in am if r.maj < s12), len(am)] if m[12] else None,
            "maj_18": [sum(1 for r in am if r.maj < s18), len(am)] if m[18] else None,
            "fin_passee": [sum(1 for r in ec if r.fin < date_ref), len(ec)]}


def etats(rows):
    c = collections.Counter(r.etat for r in rows)
    return {"en_cours": c.get(0, 0), "exp_avec": c.get(1, 0), "exp_sans": c.get(2, 0), "pas_mandat": c.get(3, 0),
            "inconnu": c.get(-1, 0), "n": len(rows)}


def meme_groupe(siren_a, siren_b, groupes):
    ga, gb = groupes.get(siren_a), groupes.get(siren_b)
    return ga is not None and gb is not None and ga[0] == gb[0]


def categorie_retention(siret, t, IQ, groupes):
    a = IQ.get(t.immat)
    if a is None:
        return "absente"
    if a.etat == 2:
        return "exp_sans"
    if a.etat == 3:
        return "pas_mandat"
    if isinstance(a.repr, str):
        if a.repr == siret:
            return "gardee"
        if a.repr[:9] == siret[:9]:
            return "interne"
        if meme_groupe(a.repr[:9], siret[:9], groupes):
            return "groupe"
        return "concurrent"
    return "non_pro"


def origine_gain(siret, q, IT, groupes):
    t = IT.get(q.immat)
    if t is None:
        return "nouvelle"
    if isinstance(t.repr, str):
        if t.repr[:9] == siret[:9]:
            return "interne"
        if meme_groupe(t.repr[:9], siret[:9], groupes):
            return "groupe"
        return "concurrent"
    if t.etat in (2, 3):
        return "sans_syndic"
    return "non_pro"


def retention(siret, pt, pq, IQ, IT, groupes):
    cats = collections.Counter(categorie_retention(siret, t, IQ, groupes) for t in pt)
    ids_t = {t.immat for t in pt}
    gains = collections.Counter(origine_gain(siret, q, IT, groupes) for q in pq if q.immat not in ids_t)
    perdues = sum(cats[c] for c in ("groupe", "concurrent", "non_pro", "exp_sans", "pas_mandat", "absente"))
    gains_ext = sum(v for k, v in gains.items() if k != "interne")
    return {"n_t3": len(pt), "n_auj": len(pq),
            "cats": {c: cats.get(c, 0) for c in CAT_RETENTION},
            "gains": {c: gains.get(c, 0) for c in CAT_GAIN},
            "perdues": perdues, "gains_externes": gains_ext,
            "solde": len(pq) - len(pt), "solde_hors_interne": gains_ext - perdues}


def base_retention(T, IQ, groupes):
    """Taux de base départemental : toutes les fiches T3 rattachées à un SIRET professionnel."""
    cats = collections.Counter(categorie_retention(t.repr, t, IQ, groupes) for t in T if isinstance(t.repr, str))
    n = sum(cats.values())
    return {c: [cats.get(c, 0), n] for c in CAT_RETENTION}


def base_niveau(rows, date_ref, plancher=None):
    """Taux de base d'une population de fiches : toutes les fiches, et celles d'un syndic professionnel."""
    pro = [r for r in rows if isinstance(r.repr, str)]
    return {"toutes": {"profil": profil(rows), "diligence": diligence(rows, date_ref, plancher), "etats": etats(rows)},
            "pro": {"profil": profil(pro), "diligence": diligence(pro, date_ref, plancher), "etats": etats(pro)}}
