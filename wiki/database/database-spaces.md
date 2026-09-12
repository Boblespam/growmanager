---
type: database
updated: 2026-04-09
sources: [models/all_models.py, routers/espaces.py]
---

# Database — Growing Spaces Domain

## EspaceCulture

A physical growing space (tent, room, cupboard).

| Column | Type | Notes |
|---|---|---|
| `id_espace` | PK | |
| `nom` | String | Space name (e.g. "Tente 120×120") |
| `type_espace` | String | Space type (indoor, outdoor, etc.) |
| `id_materiel_principal` | FK → Materiel (nullable) | Main equipment item (e.g. the tent itself) |
| `dimensions` | String (nullable) | e.g. "120×120×200" |
| `surface_m2` | Float (nullable) | Floor area — used in pot count formula |
| `hauteur_cm` | Float (nullable) | Height |
| `statut` | String | `Actif` \| `Inactif` \| `Maintenance` |
| `notes` | Text (nullable) | |

**Relationships:** → many `EspaceMateriel` (equipment list), → many `Culture`, → many `CultureEmplacement`, → many `GoveeDevice`, → many `PlanCulture`, → many `HistoriqueCulture`

`surface_m2` feeds the pot count formula: → [[architecture/patterns]] (pot count formula)

Deleting a space is blocked (`409`) if a `Culture` currently points at it, or if it appears anywhere in `CultureEmplacement` history — spaces used at least once are kept forever for traceability.

---

## CultureEmplacement

*Ajouté 2026-09-12 (PR #6, contributeur externe Devilouned).*

Historique des emplacements d'une culture : quel espace elle occupait, sur quelle période. Modélise des intervalles `[date_debut, date_fin)` — `date_fin = NULL` signifie l'affectation en cours.

| Column | Type | Notes |
|---|---|---|
| `id_emplacement` | PK | |
| `id_culture` | FK → Culture (`ON DELETE CASCADE`) | |
| `id_espace` | FK → EspaceCulture | |
| `date_debut` | Date | Début de l'affectation |
| `date_fin` | Date (nullable) | `NULL` = affectation courante |

**Relationships:** `Culture.emplacements` (une culture a plusieurs `CultureEmplacement`, triés par `date_debut`)

**Invariants maintenus par `backend/app/routers/culture_helpers.py`** :
- Une seule ligne par culture avec `date_fin IS NULL` à la fois (l'affectation courante).
- Pas de chevauchement ni de trou entre deux affectations successives d'une même culture.
- `Culture.id_espace` est toujours synchronisé avec l'affectation courante (mis à jour à chaque déplacement ou correction de date).
- Un espace déjà occupé par une autre culture `active`/`sechage_curing` ne peut pas recevoir un déplacement (`409`).

**Backfill :** à chaque changement de modèle, `ensure_initial_emplacement()` crée rétroactivement la première affectation d'une culture existante (espace courant, date de début = `date_debut` de la culture) si elle n'a encore aucun historique. Un seed équivalent tourne aussi au démarrage du backend (`seed_culture_emplacements()` dans `main.py`) et côté app mobile standalone (migration SQLite `SCHEMA_VERSION` 1→3 dans `frontend/src/local/db.ts`).

**Endpoints** (`backend/app/routers/cultures.py`) :
- `GET /api/cultures/{id}/emplacements` — historique complet
- `GET /api/cultures/{id}/espace-at?date=YYYY-MM-DD` — résout l'espace occupé à une date donnée
- `POST /api/cultures/{id}/deplacer` — clôture l'affectation courante et en ouvre une nouvelle (`id_espace`, `date_deplacement`)
- `PUT /api/cultures/{id}/emplacements/{emplacement_id}` — corrige la date de début d'une affectation existante (recale la voisine précédente)

**Usage principal :** le calendrier de culture et l'export PDF (`SensorDayChart`, `calendarPdfExport.ts`) résolvent désormais les logs capteurs par période d'occupation réelle de la culture (via `espaceAtDate` côté frontend) plutôt que sur l'espace actuel uniquement — utile quand une culture change de box entre croissance et floraison, chaque box ayant ses propres capteurs.

---

## EspaceMateriel

Assignment of a piece of equipment (`Materiel`) to a space.

| Column | Type | Notes |
|---|---|---|
| `id_espace_materiel` | PK | |
| `id_espace` | FK → EspaceCulture | |
| `id_materiel` | FK → Materiel | |
| `date_assignation` | Date (nullable) | When it was put in the space |
| `notes` | Text (nullable) | |

This is the mechanism for tracking which lamps, fans, irrigation systems are currently in which space.

---

## Import / Export

`EspaceCulture` supports CSV export/import via:
- `GET /api/espaces/export/csv` → download CSV
- `POST /api/espaces/import` → upload CSV file

Used in `ImportExportModal` component on the Espaces page.

---

## See Also

- [[api/api-infrastructure]] — espaces endpoints
- [[database/database-sensors]] — GoveeDevice linked to spaces
- [[database/database-equipment]] — Materiel (what gets assigned to spaces)
- [[database/database-planning]] — PlanCulture references EspaceCulture
- [[database/database-culture]] — Culture.id_espace, synchronisé avec CultureEmplacement
- [[features/culture-lifecycle]] — utilisation de l'historique d'emplacement dans le calendrier
