import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Calendar, Loader2 } from 'lucide-react'
import { cultureAPI, Culture, CultureEmplacement } from '../../api/cultures'

interface Props {
  culture: Culture
  emplacement: CultureEmplacement
  onClose: () => void
}

export default function ModifierDateEmplacementModal({ culture, emplacement, onClose }: Props) {
  const qc = useQueryClient()
  const [dateDebut, setDateDebut] = useState(emplacement.date_debut.slice(0, 10))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      cultureAPI.corrigerDateEmplacement(culture.id_culture, emplacement.id_emplacement, dateDebut),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cultures'] })
      qc.invalidateQueries({ queryKey: ['culture', culture.id_culture] })
      qc.invalidateQueries({ queryKey: ['sensor-day'] })
      onClose()
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Impossible de modifier cette date')
    },
  })

  const canSubmit = Boolean(dateDebut) && !save.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-grow-50 rounded-lg">
              <Calendar size={16} className="text-grow-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              Modifier le changement d'espace
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Espace</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {emplacement.nom_espace || `Espace #${emplacement.id_espace}`}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date de début</label>
            <input
              type="date"
              value={dateDebut}
              onChange={e => { setDateDebut(e.target.value); setError(null) }}
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
            onClick={() => save.mutate()}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm text-white bg-grow-600 rounded-lg hover:bg-grow-700 disabled:opacity-50 flex items-center gap-2"
          >
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}
