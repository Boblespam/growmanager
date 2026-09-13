---
type: architecture
updated: 2026-05-13
sources: [main.py, Documentation/claude.md, Documentation/PHASE1_SUMMARY.txt]
---

# GrowManager — Project Overview

Cannabis cultivation management application. Tracks grow cycles, plants, seeds, equipment, extractions, recipes, sensors, and living soil systems.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + React Query (TanStack v5) |
| Backend | FastAPI 0.111 + SQLAlchemy 2.0 + PyMySQL |
| Database | MySQL (Docker container) |
| Containerization | Docker Compose |

## Running Containers

| Container | Port | Purpose |
|---|---|---|
| `growmanager-backend-1` | 8000 | FastAPI API |
| `growmanager-frontend-1` | 5173 | Vite dev server |
| `growmanager-db-1` | 3306 | MySQL database |

## Launch Commands

### Développement (Windows)

```bash
# Start everything
docker-compose up -d

# Restart after backend changes
docker-compose restart backend

# Restart after frontend changes (usually not needed — Vite HMR handles it)
docker-compose restart frontend

# View backend logs
docker-compose logs -f backend

# Connect to MySQL
docker exec -it growmanager-db-1 mysql -u root -p growmanager
```

### Production (Linux)

Serveur dédié (PC atelier, Ubuntu 24.04.5 LTS) à `192.168.1.156` (IP réservée en DHCP sur la box), accès `ssh clapie` (alias SSH configuré sur le poste Windows). Dépôt cloné dans `~/growmanager`. Détails serveur complets (specs, ports, services colocalisés, pièges rencontrés) : [[architecture/infrastructure-prod]].

Déploiement **pull-based** depuis les images pré-buildées sur GHCR (`docker-compose.prod.yml`) — pas de build sur le serveur :

```bash
./update.sh latest   # ou ./update.sh vX.Y.Z pour figer une version précise
```

> `update.sh` fait : `docker compose -f docker-compose.prod.yml pull` (images `backend`+`frontend`) puis `up -d --no-deps backend frontend`. La base de données n'est jamais redémarrée.

> ⚠️ `update.sh` ne passe pas `--env-file .env.production` — Compose ne charge que `.env`. Un lien symbolique `.env → .env.production` doit exister à la racine du repo sur le serveur, sinon le backend recréé retombe sur des identifiants MySQL par défaut et casse l'authentification (voir [[architecture/infrastructure-prod]] section 6, incident du 2026-09-12).

**Workflow complet de mise à jour prod :**
1. Sur le PC Windows : double-clic sur `push.bat` (commit + bump de version auto + push vers `main`)
2. Attendre la fin du workflow GitHub Actions "Build & Publish Docker images" — publie `ghcr.io/mdf73/growmanager-{backend,frontend}` avec les tags `latest`, `main`, `sha-xxxxx` (et les tags semver sur un tag Git `vX.Y.Z`)
3. `ssh clapie` puis `cd growmanager && ./update.sh latest`

> `docker-compose.server.yml` (build depuis les sources, utilisé pour un tout premier déploiement sans registre) reste dispo mais n'est plus le flux courant depuis le passage sur ce serveur dédié.

## Key File Paths

```
growmanager/
├── backend/app/
│   ├── models/all_models.py     ← ALL SQLAlchemy models
│   ├── models/__init__.py       ← model exports
│   ├── routers/                 ← 29 router files (one per domain)
│   ├── schemas/                 ← Pydantic schemas
│   ├── main.py                  ← startup, migrations, router registration
│   ├── database.py              ← DB engine, session
│   └── config.py                ← env config
├── frontend/src/
│   ├── api/                     ← 28 Axios client files
│   ├── pages/                   ← 25 page components
│   ├── components/              ← shared components + culture/ subdirectory
│   └── App.tsx                  ← route table
└── Documentation/
    ├── claude.md                ← dev rules (authoritative)
    └── PHASE1_SUMMARY.txt       ← phase achievements
```

## API Base URL

All endpoints: `/api/...`

Health check: `GET /health` → `{"status": "ok"}`

CORS: open (all origins/methods/headers — dev setup).

## Database

Name: `growmanager`
Engine: MySQL with SQLAlchemy ORM.
Migrations: no Alembic — startup `run_migrations()` in `main.py` runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` via `INFORMATION_SCHEMA`.

## Versions

**Application : v3.1.0** (frontend `package.json` + backend `main.py` synchronisés)

| Composant | Version |
|---|---|
| Python | 3.11 |
| FastAPI | 0.111 |
| SQLAlchemy | 2.0.30 |
| React | 18.3.1 |
| Vite | 5.3.1 |
| React Router | 6.23.1 |
| TanStack Query | 5.40.0 |
| Axios | 1.7.2 |
| Tailwind | 3.4.4 |

> Règle : à chaque `bump-version.bat`, mettre à jour aussi `backend/app/main.py` (2 occurrences : `FastAPI(version=...)` et la route `GET /`).

## See Also

- [[architecture/stack]] — detailed architecture breakdown
- [[architecture/patterns]] — key development patterns
- [[architecture/infrastructure-prod]] — serveur de production : specs, ports, services colocalisés, pièges rencontrés
- [[database/database-overview]] — all DB tables
- [[frontend/frontend-overview]] — page routing and component structure
- [[roadmap]] — pending features and TODOs
