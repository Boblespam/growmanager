import type { CultureEmplacement } from '../api/cultures'

/** Intervalle [date_debut, date_fin). Si aucun historique, utilise fallback (espace actuel). */
export function espaceAtDate(
  emplacements: CultureEmplacement[] | undefined,
  jour: string,
  fallback?: number | null,
): number | undefined {
  if (!emplacements?.length) return fallback ?? undefined
  const covering = emplacements.filter(
    e => e.date_debut <= jour && (e.date_fin == null || jour < e.date_fin),
  )
  if (covering.length) {
    covering.sort((a, b) => b.date_debut.localeCompare(a.date_debut))
    return covering[0].id_espace
  }
  const sorted = [...emplacements].sort((a, b) => {
    const d = a.date_debut.localeCompare(b.date_debut)
    return d !== 0 ? d : a.id_emplacement - b.id_emplacement
  })
  if (jour < sorted[0].date_debut) return sorted[0].id_espace
  return sorted[sorted.length - 1].id_espace
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDateFr(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}
