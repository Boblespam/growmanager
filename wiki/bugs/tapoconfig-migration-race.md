---
type: bug
status: corrigé
discovered: 2026-09-13
fixed: 2026-10-23
sources: [backend/app/main.py, backend/app/db_init.py, backend/Dockerfile.prod, log 2026-09-13, log 2026-10-23]
---

# Bug — Race condition sur la création de nouvelles tables (2 workers Uvicorn)

**Découvert le 2026-09-13**, lors du déploiement prod de la PR #5 (intégration Tapo H100).

## Symptôme observé

Dans les logs `growmanager-backend` juste après `./update.sh latest` :

```
sqlalchemy.exc.OperationalError: (pymysql.err.OperationalError) (1050, "Table 'TapoConfig' already exists")
[SQL:
CREATE TABLE `TapoConfig` (
    id_config INTEGER NOT NULL AUTO_INCREMENT,
    ...
)
]
```

Le service a fini par démarrer correctement (`Application startup complete`) juste après. Pas d'interruption de service durable, pas de perte de données.

## Cause

`backend/Dockerfile.prod` lance `uvicorn app.main:app --workers 2`. Chaque worker importe `app.main` indépendamment et exécute au chargement du module :

```python
Base.metadata.create_all(bind=engine)
```

(une fois directement dans `main.py`, une seconde fois à l'intérieur de `run_migrations()`). Cette fonction vérifie les tables déjà présentes puis émet `CREATE TABLE` pour celles qui manquent — mais entre la vérification et l'exécution, rien n'empêche un second processus de faire la même vérification avant que le premier n'ait committé sa création.

Au tout premier démarrage après l'ajout d'une nouvelle table (ici `TapoConfig`), les deux workers ont fait la course : le premier l'a créée, le second est arrivé une fraction de seconde après et a planté sur "already exists". Le worker en échec a été relancé automatiquement (comportement natif d'Uvicorn en mode multi-workers), et au second essai la table existait déjà donc tout est rentré dans l'ordre.

## Impact

Aucune perte ni corruption de données. Juste un plantage/redémarrage bref d'un worker au moment précis du déploiement. **Se reproduira à l'identique à chaque future migration qui ajoute une nouvelle table** (pas les ajouts de colonnes : ceux-ci passent par le check `INFORMATION_SCHEMA` dans `run_migrations()`, qui réduit la fenêtre de course même s'il n'est pas non plus parfaitement atomique — seule la création de table via `create_all()` a été prise en défaut jusqu'ici).

## Correction (2026-10-23)

Piste 1 retenue : la préparation de la base est faite **une seule fois, avant le lancement des workers**.

- Nouveau module `backend/app/db_init.py` : `run_migrations()` (inclut `create_all()`), `seed_parametres()`, `seed_culture_emplacements()` et `init_database()` qui les enchaîne. Code déplacé tel quel depuis `main.py`, sans changement de logique. Lançable seul : `python -m app.db_init` (ne démarre ni l'API ni le poller capteurs).
- `backend/Dockerfile.prod` : `CMD ["sh", "-c", "python -m app.db_init && export GM_SKIP_DB_INIT=1 && exec uvicorn ... --workers 2"]`.
- `backend/app/main.py` : appelle `init_database()` sauf si `GM_SKIP_DB_INIT=1`. En dev (`Dockerfile`, un seul process `--reload`), la variable n'est pas définie : `main.py` fait l'init lui-même, comportement inchangé.
- Si l'init échoue, `uvicorn` ne démarre pas et le conteneur redémarre (politique `restart`) au lieu de servir avec un schéma incomplet.

**Tests (MySQL réel, 2 workers)** : avant correctif, base vide → `(1050, "Table ... already exists")` à chacun des 3 essais. Après : 0 erreur sur 3 démarrages base vide, sur un redémarrage base existante, sur l'ajout d'une nouvelle table (suppression puis recréation de `TapoConfig`), et en mode dev. 80 tables, aucun doublon dans `ParametreListeValeur`.

Couvre aussi la cause racine de [[bugs/parametres-doublons-seed-workers]] (seeds exécutés en parallèle par les 2 workers), dont les protections (index unique, `INSERT IGNORE`) restent en place.

## Fichiers concernés

`backend/app/db_init.py` (`run_migrations()`, `create_all()`, seeds), `backend/app/main.py` (garde `GM_SKIP_DB_INIT`), `backend/Dockerfile.prod` (init puis `--workers 2`).

## Voir aussi

[[architecture/patterns]] section 1 (migrations) · [[log]] entrées du 2026-09-13 et du 2026-10-23 · [[roadmap]] section Tapo H100
