// ─── Sauvegarde / restauration de la base locale (mode standalone) ───────────
// Logique pure, indépendante de Capacitor (testable sous Node) : dump de toutes
// les tables en JSON, et restauration atomique (tout ou rien) dans le schéma courant.

export const BACKUP_FORMAT = 'growmanager-mobile-backup'
export const BACKUP_VERSION = 1
export const BACKUP_JSON = 'backup.json'

export interface BackupTable {
  columns: string[]
  rows: unknown[][]
}

export interface BackupPayload {
  format: string
  version: number
  schema_version: number
  created_at: string
  tables: Record<string, BackupTable>
}

export interface SqlStatement {
  statement: string
  values: unknown[]
}

/** Accès minimal à la base, fourni par l'appelant (Capacitor SQLite ou Node). */
export interface BackupDb {
  query(sql: string, values?: unknown[]): Promise<Record<string, unknown>[]>
  /** Instruction hors transaction (PRAGMA). */
  exec(sql: string): Promise<void>
  /** Lot d'instructions exécuté dans UNE transaction (rollback complet si erreur). */
  runInTransaction(set: SqlStatement[]): Promise<void>
}

export interface RestoreStats {
  tables: number
  rows: number
  ignored_tables: string[]
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`

async function listTables(db: BackupDb): Promise<string[]> {
  const rows = await db.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  return rows.map(r => String(r.name))
}

async function listColumns(db: BackupDb, table: string): Promise<string[]> {
  const rows = await db.query(`PRAGMA table_info(${q(table)})`)
  return rows.map(r => String(r.name))
}

/** Contenu complet de la base (toutes les tables, toutes les lignes). */
export async function dumpDatabase(db: BackupDb, schemaVersion: number, now = new Date()): Promise<BackupPayload> {
  const tables: Record<string, BackupTable> = {}
  for (const t of await listTables(db)) {
    const columns = await listColumns(db, t)
    const rows = await db.query(`SELECT * FROM ${q(t)}`)
    tables[t] = { columns, rows: rows.map(r => columns.map(c => r[c] ?? null)) }
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schema_version: schemaVersion,
    created_at: now.toISOString(),
    tables,
  }
}

/** Vérifie qu'un JSON est bien une sauvegarde restaurable par cette version de l'app. */
export function validatePayload(raw: unknown, schemaVersion: number): BackupPayload {
  const p = raw as Partial<BackupPayload> | null
  if (!p || p.format !== BACKUP_FORMAT || typeof p.tables !== 'object' || p.tables === null) {
    throw new Error('Ce fichier n\'est pas une sauvegarde GrowManager du mode autonome')
  }
  if (typeof p.version !== 'number' || p.version > BACKUP_VERSION) {
    throw new Error('Sauvegarde faite avec une version plus récente de l\'app : mettez l\'app à jour avant de restaurer')
  }
  if (typeof p.schema_version !== 'number' || p.schema_version > schemaVersion) {
    throw new Error('Sauvegarde faite avec une version plus récente de l\'app : mettez l\'app à jour avant de restaurer')
  }
  for (const [name, t] of Object.entries(p.tables)) {
    if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) {
      throw new Error(`Sauvegarde corrompue (table ${name})`)
    }
  }
  return p as BackupPayload
}

/** Remplace tout le contenu de la base par celui de la sauvegarde, en une transaction.
 * Les tables et colonnes inconnues du schéma courant sont ignorées (sauvegarde plus
 * ancienne : les colonnes ajoutées depuis restent à leur valeur par défaut). */
export async function restoreDatabase(db: BackupDb, payload: BackupPayload, maxRows = 200): Promise<RestoreStats> {
  const current = await listTables(db)
  const currentSet = new Set(current)
  const set: SqlStatement[] = current.map(t => ({ statement: `DELETE FROM ${q(t)}`, values: [] }))

  let rows = 0
  let tables = 0
  const ignored: string[] = []
  for (const [table, data] of Object.entries(payload.tables)) {
    if (!currentSet.has(table)) { ignored.push(table); continue }
    tables++
    const cols = new Set(await listColumns(db, table))
    const keep = data.columns.map((c, i) => [c, i] as const).filter(([c]) => cols.has(c))
    if (!keep.length) continue
    const colSql = keep.map(([c]) => q(c)).join(', ')
    const one = `(${keep.map(() => '?').join(', ')})`
    // ≤ 900 valeurs par requête : limite de 999 variables des SQLite anciens (Android)
    const chunk = Math.max(1, Math.min(maxRows, Math.floor(900 / keep.length)))
    for (let i = 0; i < data.rows.length; i += chunk) {
      const batch = data.rows.slice(i, i + chunk)
      set.push({
        statement: `INSERT INTO ${q(table)} (${colSql}) VALUES ${batch.map(() => one).join(', ')}`,
        values: batch.flatMap(r => keep.map(([, idx]) => (r[idx] === undefined ? null : r[idx]))),
      })
      rows += batch.length
    }
  }

  // Les clés étrangères sont désactivées le temps de vider puis remplir les tables
  // (ordre quelconque), puis contrôlées avant de valider.
  await db.exec('PRAGMA foreign_keys = OFF;')
  try {
    await db.runInTransaction(set)
  } finally {
    await db.exec('PRAGMA foreign_keys = ON;')
  }
  return { tables, rows, ignored_tables: ignored }
}

/** Noms de fichiers horodatés : growmanager_mobile_20261023_143005.zip */
export function backupFilename(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `growmanager_mobile_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.zip`
}
