# Contrat des données de SyndicoScope

Ce que la page charge, dans quel ordre et sous quels noms, quand les données sont produites pour plusieurs départements ou pour la France (`build.py --departements …` ou `--tous`). Les sections 10 à 12 valent aussi pour le `donnees.json` d'un seul département (`build.py --departement …`).

Statut : note technique du 28/10/2026, mise à jour le même jour à 18 h, écrite avec la chaîne nationale. La page (`site/app.js`) lit `meta.maj` ; elle lit encore un seul département, et son adaptation au reste de ce contrat est à faire (dernière section).

## 1. Les fichiers publiés

Tous sont produits dans `<sortie>/site/` par `pipeline/publier.py`. Le flux mensuel (`.github/workflows/mise-a-jour.yml`) les place sous `carte/` sur le site, à côté de la page d'accueil et de la jurisprudence (`docs/`).

| Fichier | Contenu | Nom | Budget |
|---|---|---|---|
| `manifest.json` | sommaire : dates, sources, ancienneté des fiches, départements, index | fixe | < 30 Ko (bloquant ; alerte au-delà de 90 %) |
| `d/<code>.<empreinte>.json` | données d'un département, au format de `donnees.json` | à empreinte | ≤ 6 Mo brut et ≤ 1,5 Mo compressé (bloquant) |
| `g/<code>.<empreinte>.json` | contours de ses communes et arrondissements, au format de `contours.json` | à empreinte | repère 3 Mo brut, 1 Mo compressé (alerte) |
| `c/<type>-<code>.<empreinte>.json` | jeu complémentaire d'un département, s'il en a (§ 12) | à empreinte | — |
| `immat/<préfixe>.<empreinte>.json` | numéro d'immatriculation → département | à empreinte | ≤ 100 Ko (par construction) |
| `immat/autres.<empreinte>.json` | numéros hors du motif `^[A-Z]{2}[0-9]{7}$`, s'il y en a | à empreinte | — |
| `communes.<empreinte>.json` | index national des zones (communes, arrondissements) | à empreinte | repère 600 Ko compressé (alerte) |

L'empreinte est le début (10 caractères hexadécimaux) du SHA-256 du contenu. Un nom ne change que si le contenu change : ces fichiers peuvent être gardés indéfiniment par le navigateur. Seul `manifest.json` a un nom fixe ; la page le relit à chaque visite (`fetch("manifest.json", {cache: "no-cache"})`). Les fichiers qu'aucun manifest ne désigne plus sont retirés de `site/` à chaque exécution.

## 2. L'ordre de chargement

1. `manifest.json`.
2. Selon ce que l'utilisateur donne :
   - **une commune** : `communes.<empreinte>.json` (à la première frappe), qui donne le département ;
   - **un numéro d'immatriculation** : le fragment de `immat/` qui le contient (§ 5), qui donne le département ;
   - **un cercle** : tous les départements dont l'emprise (`bbox`) coupe le cercle, quatre au plus en pratique.
3. Pour chaque département retenu : `d/…` et `g/…`, donnés par `departements.<code>.d` et `.g`. Ce sont les deux objets que `preparer(donnees, contours)` lit aujourd'hui. Puis, si la page en a l'usage, ses jeux complémentaires (`departements.<code>.complements`, § 12).

Un département absent de `departements` n'est pas publié. Si un numéro ou une commune y mène, la page le dit plutôt que de chercher ailleurs.

## 3. `manifest.json`

```json
{
  "schema": 1, "version": "0.1", "genere_le": "2026-10-28T18:02:05+01:00",
  "date_reference": "2026-10-28", "date_t3": "2025-10-29",
  "sources": {
    "rnic_quotidienne": {"url": "…", "date_fichier": "2026-10-28", "lignes": 656037, "lignes_gardees": 647804,
                         "doublons_ecartes": 8233, "variantes": 0, "octets": 411051120, "sha256": "d96ecfe1…",
                         "derniere_maj": "2026-10-24"},
    "rnic_t3": {"url": "…", "date_fichier": "2025-10-29", "lignes": 619402, "lignes_gardees": 619402,
                "doublons_ecartes": 0, "variantes": 0, "octets": 452973300, "sha256": "6bcb9d65…"}
  },
  "france": {"copros": 647804, "copros_t3": 619402, "departements_vus": 101, "departements_publies": 101,
             "sans_departement": 501, "syndics": {"sirets": 0, "ei": 0, "nt": 0},
             "collectivites_outre_mer": {"975": 1, "977": 66, "978": 391}},
  "immat": {"regex": "^[A-Z]{2}[0-9]{7}$", "conformes": 647417, "total": 647417,
            "modele": "immat/{prefixe}.{empreinte}.json", "fragments": {"AA0": "1a2b3c4d5e", "…": "…"},
            "autres": null},
  "communes": {"fichier": "communes.<empreinte>.json", "zones": 0, "octets": 0, "octets_gzip": 0},
  "maj": {"base": "mandat_en_cours", "date_ref": "2026-10-28", "plancher": "2025-08-24",
          "dates_de_masse": [{"date": "2025-08-23", "n": 19761, "part": 0.0305, "part_sans_mandat": 0.7964},
                             {"date": "2025-08-24", "n": 171961, "part": 0.2655, "part_sans_mandat": 0.9277}],
          "dates_signalees": [{"date": "2026-03-14", "n": 16449, "part": 0.0254, "part_sans_mandat": 0.4786,
                               "siret_distincts": 1735}, "…"],
          "mesurable": {"12": true, "18": false},
          "mesurable_a_partir_du": {"12": "2026-08-25", "18": "2027-02-25"}},
  "departements": {
    "13": {"nom": "Bouches-du-Rhône", "d": "d/13.<empreinte>.json", "d_octets": 2163864, "d_gzip": 590066,
           "g": "g/13.<empreinte>.json", "g_octets": 266994, "g_gzip": 77804,
           "bbox": [43.1575, 4.2302, 43.9241, 5.8134], "copros": 36252, "syndics": 332,
           "complements": {"jurisprudence": {"fichier": "c/jurisprudence-13.<empreinte>.json", "octets": 0,
                                             "empreinte": "<empreinte>"}}},
    "76": {"…": "…", "doublons_ecartes": [3006, 0]}
  }
}
```

- `bbox` : `[lat min, lon min, lat max, lon max]` du territoire, tiré des contours ; à défaut, des copropriétés.
- `copros` : fiches de la quotidienne, après retrait des doublons (§ 7). Le nombre de copropriétés du T3 et celui des lignes publiées (copropriétés présentes au T3 et absentes aujourd'hui comprises) sont dans `meta.chiffres` du fichier du département, pas dans le manifest.
- `doublons_ecartes` et `variantes` d'un département : `[quotidienne, T3]`, présents seulement s'ils ne sont pas nuls.
- `france.sans_departement` : lignes de la quotidienne sans code de département, non publiées. `france.collectivites_outre_mer` en donne la part qui relève de Saint-Pierre-et-Miquelon (975), de Saint-Barthélemy (977) et de Saint-Martin (978) : 458 copropriétés le 28/10/2026, hors publication dans cette version (§ 13) ; les 43 autres n'ont aucun code.
- `france.syndics` : syndics professionnels publiés, France entière, sans double compte d'un département à l'autre : `sirets`, SIRET distincts ; `ei` et `nt`, SIREN distincts des entrepreneurs individuels et des syndics non trouvés à l'annuaire, masqués (§ 11). Le détail d'un département est dans `meta.chiffres.masques` de son fichier.
- `france.bodacc` : annonces d'alerte du BODACC écartées, France entière, sur les syndics publiés, un SIREN compté une fois : `ecartees_nom_discordant`, `ecartees_avant_creation`, `non_controlees` (§ 9). Le détail d'un département est dans `meta.sources.bodacc` de son fichier.
- `maj` : l'ancienneté des fiches pour la France (§ 10), `n` et `part` étant ceux de la France.
- `complements` : présent seulement pour un département qui a des jeux complémentaires (§ 12).
- Les valeurs de l'exemple sont celles du 28/10/2026, sauf les zones, la taille de l'index des communes et celle des jeux complémentaires, à relever sur une exécution complète. Taille projetée pour 101 départements : 27,7 Ko, dont 2,4 Ko pour `maj` (22 dates signalées, environ 110 octets chacune).

## 4. `d/` et `g/` : les formats actuels, inchangés

`d/<code>.<empreinte>.json` a exactement le format de `donnees.json` : `meta`, `syndics` et `copros` (`champs` puis `lignes`). `meta` y porte `nom_departement`, `maj` (§ 10) et `complements` (§ 12). `g/<code>.<empreinte>.json` a le format de `contours.json`, une FeatureCollection de propriétés `code`, `nom`, `type` et, pour un arrondissement, `parent`.

Les indices sont propres à chaque fichier : zone, syndic et période renvoient aux tables `meta.zones`, `syndics` et `meta.periodes` du même fichier. Pour réunir deux départements, la page doit renuméroter les syndics. Pour un même SIREN, elle les fond en une entité, comme elle le fait déjà pour les établissements d'une société ; les clés `ei-N` et `nt-N` des syndics masqués n'ont de sens que dans leur fichier, et se préfixent du code du département (§ 11). Un numéro d'immatriculation n'appartient qu'à un fichier, à une exception près : une copropriété qui a changé de département entre le T3 2025 et aujourd'hui apparaît dans les deux fichiers. Ce sont 50 copropriétés en France le 28/10/2026. L'index des numéros renvoie au département d'aujourd'hui.

## 5. L'index des numéros

Un fragment est un objet `{"p": préfixe, "d": {département: [suffixes]}}`. Le suffixe est le numéro privé de son préfixe, écrit comme un entier ; tous les numéros conformes ont 9 caractères, et les zéros de tête ne sont donc pas perdus. Les listes sont triées.

Le préfixe compte d'abord 3 caractères. Il est allongé d'un caractère, jusqu'à 6, tant que son fragment dépasse 100 Ko. Aucun préfixe publié n'est le début d'un autre. Recherche dans la page :

```js
function fragmentDe(manifest, numero) {
  const im = manifest.immat;
  if (!new RegExp(im.regex).test(numero)) return im.autres ? {chemin: im.autres, cle: numero} : null;
  for (let k = 6; k >= 3; k--) {
    const h = im.fragments[numero.slice(0, k)];
    if (h) return {chemin: im.modele.replace("{prefixe}", numero.slice(0, k)).replace("{empreinte}", h),
                   cle: Number(numero.slice(k))};
  }
  return null;   // numéro inconnu du registre
}
// puis : département = celui dont la liste frag.d[dep] contient cle
```

Le fragment `autres` garde les numéros entiers, en chaînes. Le 28/10/2026 : 100 fragments, le plus gros de 58 776 octets, 647 417 numéros, tous conformes.

## 6. L'index des communes

`communes.<empreinte>.json` est rangé en colonnes de même longueur : `code`, `nom`, `type` (`c` commune, `a` arrondissement), `parent` (commune d'un arrondissement, sinon `null`), `dep`, `lat`, `lon` (centre, au 1e-4 degré) et `decoupee` (1 pour Paris, Lyon et Marseille, découpées en arrondissements). Il ne couvre que les départements publiés.

## 7. Doublons et variantes du registre

Règle du 28/10/2026 :
- une ligne **identique sur toutes les colonnes du fichier brut** à une ligne déjà lue est écartée ; l'identité est vérifiée par une empreinte BLAKE2b de 128 bits de la ligne entière ;
- une ligne de même numéro au contenu différent est une **variante** : elle est gardée et comptée, sans rien trancher.

Mesuré sur les fichiers du 28/10/2026 :

| Fichier | Lignes lues | Doublons écartés | Variantes | Lignes gardées |
|---|---|---|---|---|
| quotidienne du 28/10/2026 | 656 037 | 8 233 | 0 | 647 804 |
| T3 2025 | 619 402 | 0 | 0 | 619 402 |

Les doublons écartés de la quotidienne, par département : 76 : 3 006 · 38 : 1 277 · 47 : 770 · 88 : 727 · 53 : 688 · 77 : 634 · 62 : 368 · 27 : 210 · 69 : 205 · 18 : 110 · 39 : 85 · 43 : 75 · 56 : 58 · 23 : 20. Aucun dans les autres départements, dont le 13.

Conséquence : les comptes nationaux par syndic (`syndics[].national`) portent sur les lignes gardées. L'API tabulaire, qui compte les lignes, donne 322 414 copropriétés tenues par des professionnels ; il en reste 318 545 une fois les doublons écartés. Les mêmes chiffres sont écrits à chaque exécution dans le journal, dans les statistiques de chaque extrait et dans le manifest.

## 8. Contrôles

Un contrôle bloquant en échec arrête l'exécution **avant** l'écriture du manifest : rien n'est publié, et le flux mensuel ouvre un ticket. Le détail est dans `<sortie>/controles.json`.

| Contrôle | Règle | Bloquant |
|---|---|---|
| fraîcheur de la quotidienne | fichier daté de 3 jours au plus | oui |
| lignes lues = lignes annoncées | quand l'API tabulaire a moissonné le même fichier | oui |
| états de mandat connus | les quatre valeurs du registre, dont « Mandat expiré avec successeur déclaré » | oui |
| lignes malformées | au plus 0,1 % | oui au-delà, alerte en deçà |
| lignes sans département | au plus 1 % (le 28/10/2026 : 501, dont 458 de Saint-Martin, Saint-Barthélemy et Saint-Pierre-et-Miquelon, et 43 vides) | oui au-delà |
| empreinte du T3 2025 | SHA-256 `6bcb9d65…aab11` (452 973 300 octets) | oui |
| comptes nationaux par SIRET | somme des comptes = fiches professionnelles | oui |
| réponses de l'annuaire complètes | chaque SIRET a une réponse en cache ; sans elle, un syndic serait publié comme « non identifié » | oui (relancer : le cache reprend) |
| réponses du BODACC complètes | chaque SIREN a une réponse en cache ; sans elle, le champ `bodacc` reste vide | alerte |
| annonces d'alerte du BODACC contrôlées | chaque SIREN qui a une procédure collective ou une radiation a ses annonces détaillées au format courant ; sinon elles ne sont pas publiées (`non_controlees`, § 9) | alerte |
| publication d'un département | clés interdites, champs, types, coordonnées au 1e-4, syndics masqués (§ 11) et aucun de leurs vrais numéros dans le fichier ni dans ses jeux complémentaires, aucun nom publié égal au nom d'un représentant non professionnel du département | oui |
| tailles | `d/`, manifest | oui (manifest : alerte au-delà de 90 % du budget) |
| écarts au mois précédent | France à ±3 %, département à ±10 % s'il bouge d'au moins 50 copropriétés | oui |
| dates de masse | dates, plancher, mesurabilité et dates signalées (§ 10) ; alerte si une date de masse manque dans un département, ou si la règle appliquée à ses seuls comptes en donne d'autres | information, alerte |
| motif des numéros, doublons, variantes, tailles des contours | mesurés et publiés | alerte |

La « dernière mise à jour » la plus récente dans la quotidienne du 28/10/2026 est du 24/10/2026 : le registre a quatre jours de retard sur son propre fichier. La fraîcheur se contrôle donc sur la date du fichier ; cette date est publiée dans `sources.rnic_quotidienne.derniere_maj`.

## 9. Ce qui n'est jamais publié

- Aucune adresse, aucun nom d'usage de copropriété, aucune référence cadastrale, aucune identification du représentant légal : ces colonnes ne sont pas lues.
- Aucun nom de représentant non professionnel : il est retiré à la lecture du fichier, avant toute écriture sur disque.
- Rien qui mène à un entrepreneur individuel, ni à un syndic que l'annuaire ne connaît pas : ni nom, ni SIREN, ni SIRET, ni lieu, ni date de création, ni annonce (§ 11).
- Aucune date de fin de mandat par copropriété, aucun état de mandat : seulement des drapeaux dérivés.
- Des annonces du BODACC, seulement la date, le type et, pour une procédure collective, la nature du jugement. Règles du 28/10/2026 :
  - une annonce n'est rattachée à un syndic que si son champ `registre` porte son SIREN, chiffres normalisés ;
  - le registre du BODACC peut lui-même se tromper : une procédure collective du 08/09/2011 porte au registre le SIREN d'un syndic des Bouches-du-Rhône qui publie encore, et au champ commercant une autre société. Une annonce d'alerte (procédure collective, radiation) n'est donc publiée que si, en plus, son `commercant` concorde avec la dénomination, le nom complet, le sigle ou une enseigne du syndic à l'annuaire, et si elle ne précède pas la date de création de la société ;
  - concordance : casse, accents, ponctuation et formes juridiques (SAS, SARL, SA, EURL, SCI… et leurs libellés développés) retirés, mêmes mots dans un ordre quelconque, ou tous les mots du nom le plus court dans l'autre quand il en a au moins deux hors articles et prépositions ;
  - une annonce écartée ne s'affiche jamais, pas même dans les comptes par famille : `total`, `familles`, `premiere` et `derniere` sont recomptés sans elle. Elle est comptée, sur les syndics publiés et un SIREN une fois, dans `meta.sources.bodacc` du département et dans `france.bodacc` du manifest : `ecartees_nom_discordant`, `ecartees_avant_creation`, `non_controlees` (réponse en cache d'un format antérieur, ou identité inconnue : pas publiée non plus). Son `id` reste dans le cache local, pour relecture ;
  - le cache local garde de chaque annonce détaillée son `id`, son `registre`, le booléen `commercant_concorde` et, pour une société seulement, son `commercant`. Pour un entrepreneur individuel, ce nom est celui d'une personne : celui de l'annuaire est lu au moissonnage pour la comparaison, puis oublié ; ni l'un ni l'autre n'est stocké ni publié ;
  - les achats de fonds (`achats`, `dernier_achat`) sont lus dans les comptes par famille : une information, pas une alerte, sans contrôle du commercant.
- Les fichiers des jeux complémentaires restent hors du dépôt (§ 12). Ceux du 13 (décisions de justice et leur revue) sont publiés depuis le 28/10/2026, décision de Brice : intégrés à la page du 13, à la racine du site.
- Le journal détaillé (`journal.txt`, qui cite des SIRET) reste dans l'exécuteur. Les messages de contrôle n'en citent aucun, parce que le journal d'Actions d'un dépôt public est public.
- Aucune donnée brute d'API (BODACC, annuaire des entreprises, registre des copropriétés) dans le cache d'Actions ni dans un artefact d'Actions (décision du 28/10/2026) : le flux mensuel moissonne à neuf à chaque passage, et une relance refait tout le moissonnage ; son seul artefact est le site publié. Le manifest du mois précédent, pour le contrôle des écarts, est relu sur le site publié. Il n'y a pas de flux de pull request ; s'il en vient un, il tourne sur des jeux fictifs, sans réseau vers ces API (les essais unitaires n'en appellent aucune). Le cache local du poste, hors dépôt, reste permis.

## 10. `meta.maj` : l'ancienneté des fiches

Contrat du 28/10/2026, dans `meta` de chaque fichier de département ; le manifest porte le même bloc pour la France. Valeurs du 13, le 28/10/2026 :

```json
{"base": "mandat_en_cours", "date_ref": "2026-10-28", "plancher": "2025-08-24",
 "dates_de_masse": [{"date": "2025-08-23", "n": 1714, "part": 0.0473, "part_sans_mandat": 0.7946},
                    {"date": "2025-08-24", "n": 12151, "part": 0.3352, "part_sans_mandat": 0.944}],
 "dates_signalees": [{"date": "2026-10-03", "n": 2184, "part": 0.0602, "part_sans_mandat": 0.1401,
                      "siret_distincts": 154}, "…"],
 "mesurable": {"12": true, "18": false},
 "mesurable_a_partir_du": {"12": "2026-08-25", "18": "2027-02-25"}}
```

- **Base** : les fiches « Mandat en cours » dont la date de dernière mise à jour est connue. Elles seules portent les drapeaux 256 (date connue), 64 (plus de 12 mois sans mise à jour) et 128 (plus de 18 mois). Une copropriété sans mandat en cours n'a personne pour mettre sa fiche à jour : elle sort de la base. Le 13, le 28/10/2026 : 17 118 fiches dans la base, dont 1 205 (7,0 %) sans mise à jour depuis plus de 12 mois.
- **Champs d'une date** : `n`, fiches du département datées de ce jour, tous états confondus ; `part`, `n` rapporté à toutes les fiches datées du département ; `part_sans_mandat`, part de ces `n` hors « Mandat en cours » (pas de mandat, mandat expiré avec ou sans successeur) ; `siret_distincts`, SIRET de syndics professionnels distincts parmi ces `n`. Parts de 0 à 1, à 4 décimales. Une date sans fiche dans le département n'est pas listée.
- **Date de masse** : un jour qui porte au moins 1 % des fiches datées de la France **et** plus de fiches que tous les jours antérieurs réunis. Il efface le passé : avant lui il ne reste presque rien, et l'ancienneté réelle des fiches qui portent cette date est inconnue. Le seuil de 1 % ne sert qu'à écarter les premiers jours de la série, où une fiche isolée « précède » tout ce qui suit. Les dates de masse sont celles de la France, pour tous les départements.
- **Plancher** : la plus récente des dates de masse. L'indicateur à N mois n'est mesurable que si `date_ref` − N mois > plancher, au sens strict : une fiche datée du plancher a pu ne pas être mise à jour depuis bien avant. Sinon, le drapeau n'est jamais posé et la page retire la colonne. `mesurable_a_partir_du` donne la première date de référence à laquelle l'indicateur se mesure, même si elle est passée ; `null` s'il n'y a pas de plancher.
- **Date signalée** : un jour qui porte lui aussi au moins 1 % des fiches datées de la France, sans effacer le passé. Ses fiches restent comptées comme mises à jour ; mais si un traitement du registre ou un envoi groupé les avait datées sans vraie mise à jour, l'indicateur à 12 mois serait sous-estimé, et la page le dit.

Mesures du 28/10/2026, quotidienne entière (647 771 fiches datées) :
- deux dates de masse : le 23/08/2025 (19 761 fiches, contre 272 avant lui) et le 24/08/2025 (171 961, contre 20 033) ; aucun jour antérieur n'a porté plus de 46 fiches. Le T3 2025 portait déjà ce plancher : 553 477 de ses 619 371 fiches datées le sont du 23 ou du 24/08/2025 ;
- les deux dates sont présentes dans les 101 départements ; la part du 24/08 va de 4,9 % (Paris) à 51,2 % (Haute-Corse), médiane 30,1 %. Dans sept départements (03, 15, 16, 23, 39, 46, 48), la règle appliquée à leurs seuls comptes ne retiendrait que le 24/08 : c'est la règle nationale qui vaut ;
- 22 dates signalées, du 14/03/2026 au 24/10/2026 : vingt samedis et deux dimanches. Le registre semble traiter ses mises à jour par lots, le samedi ; un dimanche ordinaire ne porte que quelques fiches.

Les dix jours les plus chargés de la France :

| Jour | Fiches | Part | Hors mandat en cours | SIRET distincts | Nature |
|---|---|---|---|---|---|
| 24/08/2025 (dim.) | 171 961 | 26,5 % | 92,8 % | 1 726 | masse |
| 03/10/2026 (sam.) | 53 112 | 8,2 % | 14,3 % | 2 952 | signalée |
| 04/10/2026 (dim.) | 50 547 | 7,8 % | 17,5 % | 3 168 | signalée |
| 05/09/2026 (sam.) | 27 769 | 4,3 % | 71,5 % | 1 726 | signalée |
| 11/07/2026 (sam.) | 24 729 | 3,8 % | 1,6 % | 2 916 | signalée |
| 23/08/2025 (sam.) | 19 761 | 3,1 % | 79,6 % | 1 003 | masse |
| 14/03/2026 (sam.) | 16 449 | 2,5 % | 47,9 % | 1 735 | signalée |
| 05/07/2026 (dim.) | 13 548 | 2,1 % | 2,8 % | 2 204 | signalée |
| 04/07/2026 (sam.) | 12 290 | 1,9 % | 1,3 % | 2 026 | signalée |
| 06/06/2026 (sam.) | 11 335 | 1,8 % | 41,2 % | 1 620 | signalée |

Les dates signalées à forte part hors mandat (05/09/2026, 14/03/2026, 06/06/2026) ont l'allure de passages du registre sur les mandats échus. Neuf sur dix de leurs fiches « Pas de mandat en cours » ont une date de fin de mandat dans le même mois, environ trois mois plus tôt : 06/2026, 12/2025 et 03/2026. Ces fiches quittent la base ; elles ne pèsent pas sur l'indicateur.

Vraies mises à jour ou traitement ? Quotidienne du 28/10/2026 contre T3 du 29/10/2025, fiches « Mandat en cours » présentes dans les deux :

| Date de dernière mise à jour | Fiches | Date de fin ou lots changés depuis le T3 | dont date de fin avancée | SIRET changé |
|---|---|---|---|---|
| 03-04/10/2026 | 86 530 | 74,3 % | 72,6 % | 28,4 % |
| autres dates signalées | 170 900 | 76,0 % | 73,2 % | 30,4 % |
| autres jours après le T3 | 76 671 | 72,5 % | 67,2 % | 26,3 % |
| dates de masse | 16 403 | 0,0 % | 0,0 % | 0,0 % |

Les fiches des 3 et 4/10/2026 ont changé autant que celles des jours ordinaires (74,3 % contre 72,5 %), et les fiches des dates de masse pas du tout : ce sont, pour l'essentiel, de vraies mises à jour. Un champ changé depuis le T3 veut dire une déclaration postérieure au 29/10/2025, donc de moins de 12 mois au 28/10/2026 : ces fiches sont à bon droit comptées à jour. La sous-estimation possible ne porte que sur les fiches sans changement visible (25,7 % aux 3-4/10, 27,5 % les jours ordinaires) : une mise à jour annuelle ne change souvent ni la date de fin ni les lots. La mesure se refait avec `scripts/q_contre_t3.py` (méthode et limites dans son en-tête ; `--jours` pour examiner d'autres dates), sur les extraits d'un passage national : une quinzaine de secondes, des comptes seulement.

## 11. Syndics masqués : entrepreneurs individuels et syndics non trouvés à l'annuaire

Le SIREN d'un entrepreneur individuel mène à la personne. Un SIRET que l'annuaire des entreprises ne connaît ni par lui-même ni par son SIREN peut être celui d'une personne non diffusible, ou un numéro mal saisi : on ne sait pas lequel. Décisions du 28/10/2026 : ni l'un ni l'autre ne sort de la chaîne. Ils ne sont ni dans `d/`, ni dans un jeu complémentaire, ni dans le manifest, ni dans un fichier suivi par git ; ils ne vivent que dans le cache local de l'annuaire, hors dépôt. Même règle pour la raison sociale déclarée au registre, qui peut être le nom de la personne.

| | Entrepreneur individuel | Non trouvé à l'annuaire |
|---|---|---|
| repéré par | `ei` vrai (nature juridique 1xxx, mention d'entrepreneur individuel, ou diffusion partielle) | `trouve` faux |
| `siren` | `ei-1`, `ei-2`… | `nt-1`, `nt-2`… |
| `nom` | « Entrepreneur individuel » | « Syndic professionnel non identifié au répertoire des entreprises » |

- La clé de pseudonyme est stable dans le département, dans l'ordre des SIREN ; elle n'a de sens que dans son fichier. En réunissant deux départements, la page la préfixe du code du département ; un même syndic présent dans deux départements y a deux clés. La numérotation se décale quand un syndic masqué arrive ou part : décalage accepté le 28/10/2026, une clé ne se garde pas d'un mois à l'autre.
- `siret`, `sigle`, `enseignes`, `bureau`, `siege`, `creation`, `bodacc`, `finances`, `groupe`, `dirigee_par` et `judilibre` valent `null`. Une date d'annonce au BODACC et un département suffisent à retrouver l'annonce, donc le nom.
- Restent : `ei`, `trouve`, `forme`, `tranche`, `effectif` (vides pour un non trouvé) et `national` (comptes de copropriétés et de lots, France entière).
- Comptes : `meta.chiffres.masques` du département, `{"ei": n, "nt": n}` en SIREN ; `france.syndics` du manifest pour la France (§ 3).
- Un SIRET sans réponse de l'annuaire (erreurs d'appel répétées) n'est pas un « non trouvé » : le contrôle des réponses complètes arrête l'exécution avant (§ 8), et la relance reprend le cache.
- Contrôle bloquant de publication, dans les trois modes (passage national, un département, `--rendu-seul`) : clé `ei-N` ou `nt-N`, libellé fixe, champs ci-dessus à `null`, aucune clé de pseudonyme sur un syndic non masqué ; et aucun vrai numéro masqué dans le fichier ni dans ses jeux complémentaires, SIREN seul ou en tête d'un SIRET, SIRET entier. Le SIREN d'un non trouvé reste permis si une société publiée le porte aussi ; son SIRET, jamais. En `--rendu-seul`, les numéros se lisent dans `<sortie>/cache/dinum.json` ; sans ce cache, seule la structure est contrôlée, et le journal le dit. Un `donnees.json` antérieur au masquage échoue donc au `--rendu-seul` : il faut le reconstruire.
- Un essai (`tests/test_ei.py`) examine aussi les sorties du poste, pages comprises : aucun numéro masqué, aucun nom déclaré au registre pour ces SIREN.
- Le registre publie lui-même, fiche par fiche, la raison sociale et le SIRET du représentant professionnel : le numéro d'immatriculation d'une copropriété y mène. SyndicoScope n'ajoute ni ce nom ni ce numéro.
- Le 28/10/2026 : 5 entrepreneurs individuels dans les Bouches-du-Rhône, 3 en Corse-du-Sud, aucun en Guyane ; aucun syndic non trouvé dans ces trois départements.

## 12. Jeux complémentaires

Données d'un département produites à part (jurisprudence, pénal…) : `donnees_complementaires/<type>_<code>/<type>_<code>.json`, à la racine du dépôt. `<type>` suit `^[a-z][a-z0-9_-]*$` : il devient un identifiant HTML et un nom de fichier.

- `meta.complements` : les types trouvés pour le département, dans l'ordre alphabétique ; `[]` s'il n'y en a pas. Un jeu absent ne casse rien. Un fichier présent mais illisible arrête la construction plutôt que d'être tu.
- Page autonome : chaque jeu est embarqué dans `<script type="application/json" id="complement-<type>">`, avec le même échappement que les données (« < » devient `<`).
- Fragment (`artifact/`) : chaque jeu est copié à côté de la page sous `complement-<type>.json` ; un jeu retiré disparaît.
- Exécution nationale : `c/<type>-<code>.<empreinte>.json`, et dans l'entrée du département au manifest `"complements": {"<type>": {"fichier": "c/…", "octets": …, "empreinte": "…"}}`. En mode « un département », il n'y a pas de manifest : taille et SHA-256 vont au journal.
- Les fichiers restent hors du dépôt. Les jeux du 13 sont publiés depuis le 28/10/2026 (décision de Brice, 20 h 16), intégrés à la page autonome du 13 que GitHub Pages sert à la racine (`docs/index.html`), assemblée sur le poste : la page entre dans le dépôt, pas les fichiers. Leur entrée dans le dépôt, pour que le flux mensuel refasse cette page, est à trancher avant le 3/11/2026 (§ 13). `.gitignore` ignore `donnees_complementaires/**/*.json`. Le crochet pre-commit (`scripts/verifier_secrets.py`) refuse tout `.json` de ce dossier, même ajouté de force. Le mode `--suivis` du vérificateur applique la même règle, mais aucun flux d'intégration continue ne l'appelle aujourd'hui. Les scripts et les notes du dossier pourront entrer dans le dépôt après relecture. Le flux mensuel n'a donc aucun jeu complémentaire : il publie `meta.complements = []`.

## 13. Écarts à la spécification § 9.2, et la suite

- Les contours sont dans `g/`, à part, et non dans le fichier du département : ils changent rarement, leur empreinte reste la même d'un mois à l'autre et le navigateur les garde. Le schéma en colonnes de la spécification, avec contours TopoJSON, reste une option de taille. À trancher quand les tailles nationales seront mesurées.
- Le fichier du département garde le format actuel de `donnees.json`, que la page lit déjà.
- Publication du 28/10/2026 (GitHub Pages, source : branche `main`, dossier `docs/`) : à la racine, la page autonome du 13 ; `jurisprudence/`, un avis de retrait : la page du contentieux, retirée pour correction le 28/10/2026, reviendra corrigée ; `contrat-des-donnees.md`, ce contrat, servi tel quel. Les autres départements ne sont pas publiés ce soir-là : en pages autonomes, 130 Mo pour les 101 (37 Mo compressés), qu'un dépôt git ne doit pas porter ; ils passeront par l'artefact du flux mensuel, quand la source de Pages sera « GitHub Actions ».
- Publication du 29/10/2026, sous `national/` (même source ; décision de Brice, 22 h 33 et 22 h 36) : la page nationale, première étape. Une seule page charge à la demande le fichier du département choisi ; les contours de ses communes viennent en direct du service WFS de l'IGN, à l'ouverture de la carte. Elle ne réunit pas encore deux départements. Assemblée sur le poste, hors du flux : 205 fichiers, 39 Mo, dont des fichiers de plus de 1 Mo, en exception connue (`tests/test_depot.py`) jusqu'au déploiement par le flux. Les Bouches-du-Rhône y portent leurs décisions de justice, comme à la racine ; les autres départements n'en ont aucune. La page de la racine ne change pas.
- Saint-Martin (978), Saint-Barthélemy (977) et Saint-Pierre-et-Miquelon (975) ne sont pas des départements : leurs 458 copropriétés restent hors publication dans cette version (décision du 28/10/2026), comptées au manifest dans `france.collectivites_outre_mer`.
- La page d'accueil et la jurisprudence (`docs/`) ne sont plus servies par la branche dès que la source de Pages passe à « GitHub Actions » ; le flux les recopie donc dans l'artefact. La page de jurisprudence (1,6 Mo) et ses deux CSV ont été suivis par git, en exception connue à la règle des 1 Mo et des fichiers de données (`tests/test_depot.py`), jusqu'à leur retrait du 28/10/2026 : l'exception reste pour la page corrigée.
- **Reste à faire dans la page** :
  - lire le manifest ;
  - charger un ou plusieurs départements et en réunir les syndics, en préfixant les clés `ei-N` et `nt-N` du code du département ;
  - pour un syndic non trouvé (`trouve` faux) : ni lien vers le BODACC, ni SIREN affiché, comme pour un entrepreneur individuel ;
  - chercher un numéro par l'index ;
  - chercher une commune dans toute la France ;
  - dire quand un département n'est pas publié ;
  - lire `meta.complements` et ses jeux.
