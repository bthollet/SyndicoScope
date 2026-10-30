# SyndicoScope

Aide au choix d'un syndic de copropriété, à partir de données ouvertes : registre national d'immatriculation des copropriétés (Anah), annuaire des entreprises (DINUM), BODACC (DILA) et contours administratifs (IGN, servis par geo.api.gouv.fr).

État : prototype en cours de construction, sur la branche `prototype-carte`.

## Protections du dépôt

- Les données téléchargées ou générées (`build/`, `data/`) ne sont jamais commitées.
- Un vérificateur de secrets refuse tout commit qui indexerait un identifiant ou une clé. Il s'active une fois par clone, car ce réglage n'est pas versionné :

  ```
  git config core.hooksPath scripts/hooks
  ```

- Le même vérificateur tourne en intégration continue sur tous les fichiers suivis.

## Licence

- **Code du dépôt et textes de la page** : licence MIT, texte dans [`LICENSE`](LICENSE). Une exception : `site/vendor/leaflet-1.9.4.css`, copie de la feuille de style de Leaflet, garde sa licence BSD à deux clauses, dont l'avis figure en tête du fichier.
- **Données publiées** (les fichiers `.json` de `docs/`) : [Licence Ouverte 2.0](https://github.com/etalab/licence-ouverte/blob/master/LO.md) d'Etalab. Pour les réutiliser, citer la source, « SyndicoScope, https://bthollet.github.io/SyndicoScope/ », et la date de mise à jour des données indiquée sur la page, sans laisser croire à une caution officielle.

### Les sources et leurs conditions

La page cite chaque source avec sa date. Licences relevées le 30/10/2026 sur les fiches data.gouv.fr des sources :

- Registre national d'immatriculation des copropriétés, Agence nationale de l'habitat : Licence Ouverte 2.0.
- Décisions de justice, Judilibre, Cour de cassation : Licence Ouverte 2.0, et [conditions générales d'utilisation de l'open data de la Cour de cassation](https://piste.gouv.fr/images/cgu/CGU_open_data_V8.pdf) (version du 6 janvier 2022). Elles demandent notamment au réutilisateur :
  - de ne pas réutiliser les données d'identité des magistrats et des membres du greffe pour évaluer, analyser, comparer ou prédire leurs pratiques professionnelles ;
  - de ne pas altérer les données ni en dénaturer le sens ;
  - de mentionner, pour chaque décision reprise, la juridiction et la formation qui l'a rendue, son siège et la date de son prononcé.
- Contours administratifs, IGN (ADMIN EXPRESS) : Licence Ouverte 2.0.
- BODACC, DILA : Licence Ouverte (version 1).
- Annuaire des entreprises (API Recherche d'entreprises) et API Découpage administratif, DINUM : aucune licence affichée sur data.gouv.fr ; à préciser.

### Données personnelles

La page ne nomme ni dirigeant, ni syndic bénévole ou copropriétaire, ni syndic en entreprise individuelle, et n'écrit aucune adresse. Qui réutilise ces données reste tenu par le RGPD.
