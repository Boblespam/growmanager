---
type: architecture
updated: 2026-09-12
sources: [suivi projet Home Assistant du Clapié — mise en place 09/09/2026]
---

# Infrastructure — Serveur de production (PC atelier)

Fiche technique du serveur Ubuntu dédié qui héberge GrowManager en production, ainsi que les services annexes colocalisés sur la même machine. Migration réalisée le **09/09/2026** (dev sur PC Windows/Docker Desktop → prod sur ce serveur).

## 1. Serveur

| Élément | Valeur |
|---|---|
| Machine | PC atelier |
| OS | Ubuntu 24.04.5 LTS (déjà installé au préalable, conservé tel quel, aucune réinstallation) |
| IP locale | `192.168.1.156` |
| Réservation IP | Statique via la box (Bbox), réservation DHCP faite le 09/09/2026 : l'IP ne change plus, même après extinction prolongée |
| Docker | 29.6.1 |
| Docker Compose | v5.3.1 |

## 2. Accès SSH

- Utilisateur sur le serveur : `pik`
- Authentification par clé (`id_ed25519`), sans mot de passe
- Côté PC Windows (client), alias configuré dans `~/.ssh/config` :
  - Host : `clapie`
  - Résout vers : `pik@192.168.1.156`
  - Clé utilisée : `id_ed25519`
- Usage : `ssh clapie` pour se connecter directement, `scp ... clapie:...` pour les transferts de fichiers

> C'est cet alias `clapie` qui est utilisé dans [[overview]] pour le workflow de mise à jour prod.

## 3. Ports et réseau

| Service | Port | Notes |
|---|---|---|
| GrowManager — frontend Nginx (prod) | 80 | |
| GrowManager — backend FastAPI | 8000 | Doc Swagger auto sur `/docs` |
| GrowManager — MySQL | 3306 | Non exposé en prod |
| GrowManager — frontend Vite | 5173 | Dev uniquement, pas utilisé en prod |
| Home Assistant (service colocalisé sur la même machine) | 8123 | Conteneur Docker en `--network=host` |
| Pi-hole (DNS, voir section 5) | 53 (DNS), 8081 (admin web) | Déployé mais usage DNS abandonné |

Pas de conflit de ports entre GrowManager et Home Assistant.

## 4. Déploiement de GrowManager en prod — étapes réalisées

Contexte : GrowManager (FastAPI + MySQL + React + Nginx, sous Docker) tournait en dev sur le PC Windows (Docker Desktop) et a été migré vers ce serveur Ubuntu.

1. Docker et Docker Compose déjà en place sur la machine Ubuntu (vérifié avant migration).
2. Dépôt cloné (public, sans authentification) dans `~/growmanager` sur le serveur. Fichier `.env.production` rempli avec des secrets générés via `openssl rand`.
3. Dump SQL exporté via `docker exec <conteneur-db> mysqldump ...` (voir piège d'encodage en section 6 — ne pas rediriger via PowerShell).
4. Dump SQL (9 Mo) et dossier `backend/uploads` (photos, référencées en base, indispensables) transférés par `scp` via l'alias SSH `clapie`.
5. Conteneurs démarrés avec `docker-compose.server.yml`, dump SQL importé.
6. Intégrité vérifiée par comptage : 3 cultures, 29 plants, 73 lignes de stock. Application accessible et fonctionnelle sur `http://192.168.1.156`.
7. Instance de dev sur le PC Windows arrêtée (`docker compose down`), code conservé pour du développement futur.

### Fichiers Docker Compose disponibles dans le repo

- `docker-compose.yml` — dev, sur le PC Windows.
- `docker-compose.server.yml` — build local sur le serveur cible (celui utilisé pour ce déploiement initial).
- `docker-compose.prod.yml` — déploiement à partir d'images GHCR pré-buildées (voir ADR-008 dans [[architecture/decisions]]) — alternative disponible pour un futur déploiement sans build local, c'est celui utilisé par `update.sh` (voir [[overview]]).

## 5. Pi-hole (DNS local) — service annexe

Objectif initial : résoudre les services par nom (`growmanager`, `leclapie`) plutôt que par IP. Déployé en conteneur Docker :

```bash
docker run -d --name pihole \
  --restart=unless-stopped \
  -p 53:53/tcp -p 53:53/udp \
  -p 8081:80 \
  -e TZ=Europe/Paris \
  -e FTLCONF_webserver_api_password="<secret>" \
  -e FTLCONF_dns_listeningMode=all \
  -v ~/pihole/etc-pihole:/etc/pihole \
  -v ~/pihole/etc-dnsmasq.d:/etc/dnsmasq.d \
  --cap-add=NET_ADMIN \
  pihole/pihole:latest
```

- Admin web : `http://192.168.1.156:8081/admin`
- **Piège rencontré :** `systemd-resolved` bloque le bind Docker sur `0.0.0.0:53`, même s'il n'écoute lui-même que sur `127.0.0.53`/`127.0.0.54`. Correction :

  ```bash
  sudo sed -i 's/^#\?DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf
  sudo systemctl restart systemd-resolved
  # puis repointer /etc/resolv.conf vers /run/systemd/resolve/resolv.conf
  ```

  Attention : il faut bien retirer le `#`, un simple ajout de `no` sans enlever le `#` laisse la ligne ignorée.

**Décision finale : usage DNS abandonné.** Configurer chaque appareil à la main pour utiliser Pi-hole n'était pas praticable (et un téléphone hors Wi-Fi maison perd de toute façon la résolution). Le passage par le DHCP du routeur aurait réglé le problème mais n'a pas été fait. Accès à GrowManager conservé par IP (`http://192.168.1.156`) comme méthode définitive. Le conteneur reste installé et actif, disponible si le sujet est repris (ex. blocage de pub réseau).

## 6. Pièges rencontrés et solutions (à garder pour référence)

### Redirection `mysqldump` sous PowerShell

Ne jamais utiliser `>` pour rediriger la sortie d'un `docker exec ... mysqldump` depuis PowerShell : ça encode en UTF-16 et insère des octets nuls, ce qui fait planter l'import (`ERROR: ASCII '\0' appeared...`). Utiliser `| Out-File -FilePath fichier.sql -Encoding utf8`, ou mieux, tout faire depuis une session bash (voir prévention plus bas).

### Mot de passe root MySQL figé au premier démarrage du volume

Si le conteneur `db` a déjà initialisé son volume de données une fois, changer `MYSQL_ROOT_PASSWORD` dans `.env.production` n'a plus d'effet. Il faut supprimer le volume (`docker volume rm growmanager_mysql_data`) pour qu'il soit réappliqué.

### Réutilisation d'image Docker entre dev et prod

`docker-compose.yml` (dev) et `docker-compose.server.yml` (prod) taguent la même image `growmanager-frontend` (même nom de dossier de projet `growmanager`). Si le fichier dev a été lancé une fois avant le fichier prod, `docker compose up` sans `--build` réutilise l'ancienne image en cache : le conteneur prod fait tourner le serveur de dev Vite (port 5173) au lieu du build Nginx (port 80), **silencieusement** (`docker compose ps` affiche quand même "Up").

**Toujours ajouter `--build --remove-orphans` au premier `up` d'un déploiement prod** sur une machine où le dev a pu tourner avant.

### Corruption d'encodage CP850 lors de l'export/import (le plus sérieux)

**Cause :** même en évitant le piège UTF-16 ci-dessus, PowerShell décode encore le flux de sortie de `docker exec ... mysqldump` avec le codepage OEM de la console (850 sur un Windows en français) avant de le ré-encoder en UTF-8, ce qui corrompt tout caractère non-ASCII.

**Symptômes :** `µ`/`°`/`²`/`®` affichés comme `┬Á`/`┬▓`/`┬«`, accents français (`é`/`è`/`à`/`ç`) affichés comme `├®`/`├¿`, guillemets typographiques affichés comme `ÔÇÿ`/`ÔÇ£`/`ÔÇØ`. A touché 31 colonnes sur 16 tables (~950 lignes). La vérification de comptage de lignes ne l'avait pas détecté, car elle ne contrôlait que le nombre de lignes, pas le contenu.

**Détection fiable** (indépendante des soucis de charset/collation du client `mysql`), comparaison sur l'hexadécimal brut :
- `HEX(colonne) LIKE '%E294AC%'` (marqueur `┬`, plage U+0080-U+00BF : µ, °, ², ®...)
- `HEX(colonne) LIKE '%E2949C%'` (marqueur `├`, plage U+00C0-U+00FF : accents français)
- `HEX(colonne) LIKE '%C394C387%'` (marqueur `ÔÇ`, guillemets/tirets typographiques)

**Correction :**

```sql
UPDATE table SET col = CONVERT(CAST(CONVERT(col USING cp850) AS BINARY) USING utf8mb4)
WHERE HEX(col) LIKE '...';
```

Ne jamais appliquer cette transformation sans le `WHERE` ciblé sur un marqueur de corruption : elle abîmerait du texte déjà correct.

**Prévention pour un futur export :** ne jamais faire passer `docker exec ... mysqldump` par une redirection PowerShell locale, même via `Out-File`. Utiliser `docker exec <conteneur> sh -c "mysqldump ... > /tmp/dump.sql"` (écriture entièrement côté Linux dans le conteneur) puis `docker cp <conteneur>:/tmp/dump.sql .` (copie d'octets bruts, zéro interprétation texte par PowerShell), ou faire tout l'export/import depuis une session bash (SSH ou WSL) plutôt que PowerShell.

### Piège bash annexe rencontré pendant le diagnostic

Dans une boucle `while read ... done < fichier`, ne jamais appeler `docker exec -i` à l'intérieur : le `-i` garde le stdin interactif ouvert et vole les lignes du fichier destinées au `read`, la boucle s'arrête après la première itération sans erreur visible.

### `update.sh` ignore silencieusement `.env.production` → panne d'authentification MySQL en prod (2026-09-12)

**Symptôme :** après un `./update.sh latest` qui s'est déroulé sans erreur (pull + recreate backend/frontend OK), le dashboard ne charge plus — `Access denied for user 'grow'@'172.18.0.2' (using password: YES)` dans les logs backend. L'app tournait pourtant normalement quelques minutes avant, et le conteneur `db` n'avait pas été touché (`update.sh` ne redémarre jamais `db`).

**Cause :** `update.sh` lance `docker compose -f docker-compose.prod.yml pull|up` **sans `--env-file .env.production`**. Docker Compose ne charge que `.env` par défaut, jamais `.env.production`. Le backend recréé hérite donc des valeurs par défaut codées en dur dans `docker-compose.prod.yml` (`MYSQL_PASSWORD: ${MYSQL_PASSWORD:-grow2024}`) au lieu du vrai mot de passe — alors que le déploiement initial avait été fait avec `docker-compose.server.yml --env-file .env.production` (voir section 4), qui lui lisait bien le bon fichier.

**Piège aggravant pendant le diagnostic :** le mot de passe root réellement figé dans le volume MySQL ne correspondait déjà plus à celui inscrit dans `.env.production` au moment du diagnostic (fichier probablement régénéré après l'init du volume — cf. piège "mot de passe root figé au premier démarrage" ci-dessus). Le vrai mot de passe root a dû être retrouvé via `docker inspect growmanager-db-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep MYSQL` (les variables d'environnement de création d'un conteneur restent lisibles indépendamment des fichiers `.env` modifiés depuis).

**Correction appliquée :**
1. Root MySQL retrouvé via `docker inspect` (ci-dessus), connexion `docker exec -it growmanager-db-1 mysql -u root -p`.
2. Alignement du compte applicatif sur `.env.production` : `ALTER USER 'grow'@'%' IDENTIFIED BY '<valeur de MYSQL_PASSWORD dans .env.production>'; FLUSH PRIVILEGES;`
3. Fix définitif pour que `docker compose` (via `update.sh`) charge les bonnes variables sans toucher au script : `ln -sf .env.production .env` à la racine du repo sur le serveur.
4. **`docker compose restart backend` ne suffit pas** — les variables d'env sont figées à la création du conteneur, un `restart` les réutilise telles quelles. Il faut recréer : `docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate backend`.

**Prévention :** après chaque `update.sh`, vérifier que `growmanager-backend` reste `Up` plus de quelques secondes (`docker ps`, pas de boucle de crash) et que le dashboard charge réellement, avant de considérer le déploiement terminé.

## 7. Ressources

- Doc Swagger de l'API GrowManager : `http://localhost:8000/docs` (depuis le serveur ou via SSH avec un tunnel de port)

## See Also

- [[overview]] — commandes de lancement et workflow de mise à jour prod
- [[architecture/decisions]] — ADR-008, images Docker versionnées via GHCR
