---
type: bug
status: corrigé
discovered: 2026-10-13
fixed: 2026-10-13
sources: [backend/app/routers/parametre.py, backend/app/main.py, backend/Dockerfile.prod]
---

# Bug — Doublons dans les listes paramétrables (seed en parallèle des 2 workers)

**Découvert le 2026-10-13** par Pik après le déploiement de la 3.8.0 (listes Matériel / Vaporisateurs paramétrables).

## Symptôme

Dans Paramétrage, chaque catégorie de matériel (Bocaux, Lampes, Pots…) et chaque état du matériel apparaissaient plusieurs fois. Concerne toutes les listes ajoutées en 3.8.0 (`materiel_categories`, `etats_materiel`, `vapo_*`).

## Cause

Même famille que [[bugs/tapoconfig-migration-race]] : `uvicorn --workers 2` exécute `seed_parametres()` dans chaque worker au démarrage. `seed_defaults()` teste « liste vide ? » puis insère : les deux workers ont vu les nouvelles listes vides au même moment et les ont remplies chacun. Aucune contrainte d'unicité n'existait sur `ParametreListeValeur`.

## Correction (validée par Pik)

- `run_migrations()` : suppression des doublons (on garde le plus petit `id_parametre`, égalité selon la collation MySQL donc insensible casse/accents), puis création de l'index unique `uq_parametre_liste_valeur (liste_nom, valeur)` (try/except : l'autre worker peut le créer en même temps).
- `seed_defaults()` : insertions en `INSERT IGNORE` (`_insert_ignore`), donc le second worker ne crée plus de doublon.
- POST / PATCH `/api/parametres` : `IntegrityError` → 409 « Cette valeur existe déjà dans la liste ».
- Mode local (Android) non concerné : un seul processus.

## À retenir

Tout seed exécuté au démarrage doit être idempotent **et** sûr en concurrence (contrainte unique + insert ignore, ou verrou nommé MySQL). Voir [[architecture/patterns]] section 1.

## Voir aussi

[[log]] entrée du 2026-10-13 · [[bugs/tapoconfig-migration-race]]
