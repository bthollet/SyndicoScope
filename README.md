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

Pas encore choisie.
