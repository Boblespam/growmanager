---
type: bug
status: ouvert
discovered: 2026-09-13
sources: [backend/app/main.py, backend/Dockerfile.prod, log 2026-09-13]
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

## Pas encore corrigé — pistes de fix

1. Exécuter `Base.metadata.create_all()` + `run_migrations()` **une seule fois**, avant de lancer les workers (ex : dans un entrypoint/script de démarrage du conteneur, ou protégé par un verrou nommé MySQL comme celui déjà utilisé dans `tapo_service.py` pour éviter le double-polling).
2. Ou, plus simple : encadrer l'appel à `create_all()` d'un `try/except` qui ignore spécifiquement l'erreur MySQL 1050 ("table already exists").

À valider avec le développeur externe (Devilouned) ou en interne avant la prochaine migration qui ajoute une table.

## Fichiers concernés

`backend/app/main.py` (`run_migrations()`, appels `create_all()`), `backend/Dockerfile.prod` (`--workers 2`).

## Voir aussi

[[architecture/patterns]] section 1 (migrations) · [[log]] entrée du 2026-09-13 · [[roadmap]] section Tapo H100
