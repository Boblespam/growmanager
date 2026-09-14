import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, MapPin, Loader2 } from 'lucide-react'
import { cultureAPI, Culture } from '../../api/cultures'
import { espacesAPI } from '../../api/espaces'

interface Props {
  culture: Culture
  onClose: () => void
}

export default function DeplacerCultureModal({ culture, onClose }: Props) {
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [idEspace, setIdEspace] = useState<number | ''>('')
  const [dateDeplacement, setDateDeplacement] = useState(today)
  const [error, setError] = useState<string | null>(null)

  const { data: espaces = [] } = useQuery({
    queryKey: ['espaces'],
    queryFn: async () => (await espacesAPI.getAll()).data,
  })

  const { data: occupants = [] } = useQuery({
    queryKey: ['cultures'],
    queryFn: async () => (await cultureAPI.getAll()).data,
  })

  const occupiedIds = useMemo(() => {
    const ids = new Set<number>()
    for (const c of occupants) {
      if (c.id_culture === culture.id_culture) continue
      if (c.id_espace && (c.statut === 'active' || c.statut === 'sechage_curing')) {
        ids.add(c.id_espace)
      }
    }
    return ids
  }, [occupants, culture.id_culture])

  const deplacer = useMutation({
    mutationFn: () =>
      cultureAPI.deplacer(culture.id_culture, {
        id_espace: idEspace as number,
        date_deplacement: dateDeplacement,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cultures'] })
      qc.invalidateQueries({ queryKey: ['culture', culture.id_culture] })
      qc.invalidateQueries({ queryKey: ['sensor-day'] })
      onClose()
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Impossible de déplacer la culture')
    },
  })

  const canSubmit =
    typeof idEspace === 'number' &&
    idEspace !== culture.id_espace &&
    Boolean(dateDeplacement) &&
    !deplacer.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-grow-50 rounded-lg">
              <MapPin size={16} className="text-grow-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              Déplacer {culture.nom || `Culture #${culture.id_culture}`}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Espace actuel</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {culture.nom_espace || (culture.id_espace ? `Espace #${culture.id_espace}` : 'Aucun')}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Nouvel espace</label>
            <select
              value={idEspace}
              onChange={e => { setIdEspace(e.target.value ? Number(e.target.value) : ''); setError(null) }}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-grow-400 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="">Choisir un espace…</option>
              {espaces.map(esp => {
                const current = esp.id_espace === culture.id_espace
                const occupied = occupiedIds.has(esp.id_espace)
                return (
                  <option key={esp.id_espace} value={esp.id_espace} disabled={current || occupied}>
                    {esp.nom}{current ? ' (actuel)' : occupied ? ' (occupé)' : ''}
                  </option>
                )
              })}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date du déplacement</label>
            <input
              type="date"
              value={dateDeplacement}
              onChange={e => { setDateDeplacement(e.target.value); setError(null) }}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-grow-400 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40"
          >
            Annuler
          </button>
          <button
            onClick={() => deplacer.mutate()}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm text-white bg-grow-600 rounded-lg hover:bg-grow-700 disabled:opacity-50 flex items-center gap-2"
          >
            {deplacer.isPending ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
            Déplacer
          </button>
        </div>
      </div>
    </div>
  )
}
