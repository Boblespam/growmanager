// ─── Handlers locaux : Sauvegarde & restauration (mode standalone) ────────────
// Équivalent mobile de /backup/dump et /backup/restore (mysqldump côté serveur).
// Format : un .zip contenant backup.json (toutes les tables) + photos/… (fichiers).
// Restaurable uniquement en mode autonome (pas de passerelle vers le serveur).
import { Filesystem, Directory } from '@capacitor/filesystem'
import { route, LocalHttpError } from '../router'
import { getDb } from '../db'
import { SCHEMA_VERSION } from '../schema'
import { seedDefaults } from '../seeds'
import { initPhotosDir } from '../photos-fs'
import { buildZip, readZip, base64ToBytes, bytesToBase64, type ZipEntry } from '../zip'
import {
  dumpDatabase, validatePayload, restoreDatabase, backupFilename,
  BACKUP_JSON, type BackupDb,
} from '../backup-core'

async function backupDb(): Promise<BackupDb> {
  const conn = await getDb()
  return {
    query: async (sql, values = []) => (await conn.query(sql, values as never[])).values ?? [],
    exec: async (sql) => { await conn.execute(sql, false) },
    runInTransaction: async (set) => {
      if (set.length) await conn.executeSet(set as never[], true)
    },
  }
}

/** Chemins relatifs ('photos/…') de tous les fichiers photo référencés en base. */
async function photoPaths(db: BackupDb): Promise<string[]> {
  const rows = await db.query('SELECT filepath, thumbnail_path FROM "Photo"')
  const paths = new Set<string>()
  for (const r of rows) {
    for (const p of [r.filepath, r.thumbnail_path]) {
      if (typeof p === 'string' && p.trim()) paths.add(p.trim().replace(/^\/+/, ''))
    }
  }
  return [...paths]
}

function isSafePhotoPath(p: string): boolean {
  return p.startsWith('photos/') && !p.split('/').includes('..') && !p.endsWith('/')
}

async function readPhoto(path: string): Promise<Uint8Array | null> {
  try {
    const r = await Filesystem.readFile({ path, directory: Directory.Data })
    if (typeof r.data === 'string') return base64ToBytes(r.data)
    return new Uint8Array(await (r.data as Blob).arrayBuffer())
  } catch {
    return null // fichier absent : la ligne en base est conservée, sans image
  }
}

// Infos affichées avant la sauvegarde (nombre et poids des photos)
route('GET', '/backup/info', async () => {
  const db = await backupDb()
  const paths = await photoPaths(db)
  const rows = await db.query('SELECT COALESCE(SUM(taille_ko), 0) AS ko FROM "Photo"')
  return { data: { nb_photos: paths.length, taille_photos_ko: Number(rows[0]?.ko ?? 0) } }
})

route('GET', '/backup/dump', async ({ query: q }) => {
  const withPhotos = q.get('photos') !== '0'
  const db = await backupDb()
  const payload = await dumpDatabase(db, SCHEMA_VERSION)
  const entries: ZipEntry[] = [
    { name: BACKUP_JSON, data: new TextEncoder().encode(JSON.stringify(payload)) },
  ]
  if (withPhotos) {
    for (const p of await photoPaths(db)) {
      if (!isSafePhotoPath(p)) continue
      const data = await readPhoto(p)
      if (data) entries.push({ name: p, data })
    }
  }
  const filename = backupFilename()
  return {
    data: new Blob(buildZip(entries) as BlobPart[], { type: 'application/zip' }),
    headers: { 'content-disposition': `attachment; filename=${filename}` },
  }
})

route('POST', '/backup/restore', async ({ body }) => {
  if (!(body instanceof FormData)) throw new LocalHttpError(400, 'Fichier attendu')
  const file = body.get('file')
  if (!(file instanceof File) || file.size === 0) throw new LocalHttpError(400, 'Fichier vide')

  // 1. Lecture et contrôle du fichier AVANT de toucher aux données
  let entries: ZipEntry[]
  let payload
  try {
    entries = readZip(await file.arrayBuffer())
    const json = entries.find(e => e.name === BACKUP_JSON)
    if (!json) throw new Error('Ce fichier n\'est pas une sauvegarde GrowManager du mode autonome')
    payload = validatePayload(JSON.parse(new TextDecoder().decode(json.data)), SCHEMA_VERSION)
  } catch (e) {
    throw new LocalHttpError(400, e instanceof Error ? e.message : 'Fichier de sauvegarde invalide')
  }

  // 2. Base : remplacement complet en une transaction (rien n'est modifié si erreur)
  const db = await backupDb()
  let stats
  try {
    stats = await restoreDatabase(db, payload)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new LocalHttpError(500, `Restauration annulée, vos données n'ont pas été modifiées (${msg})`)
  }
  await seedDefaults(await getDb())

  // 3. Photos : écrites dans un dossier temporaire, puis substituées à l'ancien dossier
  //    (les anciennes photos ne sont supprimées qu'une fois les nouvelles écrites)
  const photos = entries.filter(e => isSafePhotoPath(e.name))
  const rmdir = (path: string) =>
    Filesystem.rmdir({ path, directory: Directory.Data, recursive: true }).catch(() => undefined)
  await rmdir('photos_restore')
  await Filesystem.mkdir({ path: 'photos_restore', directory: Directory.Data, recursive: true })
    .catch(() => undefined)
  let photosKo = 0
  for (const p of photos) {
    await Filesystem.writeFile({
      path: p.name.replace(/^photos\//, 'photos_restore/'),
      directory: Directory.Data,
      data: bytesToBase64(p.data),
      recursive: true,
    })
    photosKo += p.data.length / 1024
  }
  await rmdir('photos')
  await Filesystem.rename({
    from: 'photos_restore', to: 'photos', directory: Directory.Data, toDirectory: Directory.Data,
  })
  await initPhotosDir()

  return {
    data: {
      ok: true,
      tables: stats.tables,
      lignes: stats.rows,
      photos: photos.length,
      photos_mo: Math.round(photosKo / 102.4) / 10,
      tables_ignorees: stats.ignored_tables,
      sauvegarde_du: payload.created_at,
    },
  }
})
