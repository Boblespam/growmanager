// ─── ZIP minimal sans compression (mode standalone : sauvegarde) ─────────────
// Écriture et lecture de fichiers .zip en méthode « stored » (aucune compression) :
// les photos sont déjà compressées (JPEG) et cela évite toute dépendance externe.
// Le fichier produit s'ouvre avec n'importe quel outil zip (Windows, Android, unzip).
// La lecture ne gère que la méthode « stored » (celle qu'on écrit).

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Construit un zip « stored ». Retourne les morceaux (à passer à new Blob([...])). */
export function buildZip(entries: ZipEntry[], when: Date = new Date()): Uint8Array[] {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(when)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const e of entries) {
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const size = e.data.length
    if (size > 0xfffffffe || offset > 0xfffffffe) throw new Error('Sauvegarde trop volumineuse (> 4 Go)')

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)          // version needed
    lv.setUint16(6, 0x0800, true)      // flag : noms en UTF-8
    lv.setUint16(8, 0, true)           // méthode : stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)

    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)          // version made by
    cv.setUint16(6, 20, true)          // version needed
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)     // offset de l'en-tête local
    cd.set(name, 46)

    parts.push(local, e.data)
    central.push(cd)
    offset += local.length + size
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  return [...parts, ...central, end]
}

/** Lit un zip « stored » via son répertoire central. Vérifie le CRC de chaque fichier. */
export function readZip(buf: ArrayBuffer): ZipEntry[] {
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  const dec = new TextDecoder()

  // Fin de répertoire central : cherchée depuis la fin (commentaire éventuel ≤ 64 Ko)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Fichier zip invalide')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)

  const out: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Fichier zip corrompu')
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const csize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOff = view.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue // dossier
    if (method !== 0) {
      throw new Error('Ce fichier zip a été recompressé : utilisez le fichier de sauvegarde d\'origine')
    }
    if (view.getUint32(localOff, true) !== 0x04034b50) throw new Error('Fichier zip corrompu')
    const lName = view.getUint16(localOff + 26, true)
    const lExtra = view.getUint16(localOff + 28, true)
    const start = localOff + 30 + lName + lExtra
    const data = bytes.subarray(start, start + csize)
    if (crc32(data) !== crc) throw new Error(`Fichier zip corrompu (${name})`)
    out.push({ name, data })
  }
  return out
}

// ─── Conversions base64 (Capacitor Filesystem lit et écrit en base64) ────────

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}
