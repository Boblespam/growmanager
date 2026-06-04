import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Trash2, Loader2, Save } from 'lucide-react'
import { stockAPI } from '../api/stock'
import { varieteAPI, Variete } from '../api/varietes'
import { useParametreListe } from '../api/parametres'

interface BulkEntryModalProps {
  onClose: () => void
}

const TYPES_STOCK_FB = ['Fleur', 'Trim', 'WPFF', 'Hash', 'Rosin', 'Autre']
const SOUS_TYPES_FB  = ['Indoor', 'Outdoor']
const NO_CULTURE_INFO = ['Hash', 'Rosin', 'WPFF']

const today = () => new Date().toISOString().split('T')[0]

interface StockLine {
  id: number
  id_variete:      number | undefined
  type_stock:      string
  sous_type_stock: string
  quantite_stock:  string
  date_stock:      string
}

let _nextId = 1
function newLine(): StockLine {
  return {
    id:              _nextId++,
    id_variete:      undefined,
    type_stock:      'Fleur',
    sous_type_stock: 'Indoor',
    quantite_stock:  '',
    date_stock:      today(),
  }
}

export default function BulkEntryModal({ onClose }: BulkEntryModalProps) {
  const queryClient = useQueryClient()

  const { values: typesStockParam } = useParametreListe('types_stock')
  const { values: sousTypesParam }  = useParametreListe('sous_types_stock')

  const TYPES_STOCK = typesStockParam.length > 0 ? typesStockParam : TYPES_STOCK_FB
  const SOUS_TYPES  = sousTypesParam.length  > 0 ? sousTypesParam  : SOUS_TYPES_FB

  const { data: varietes = [] } = useQuery<Variete[]>({
    queryKey: ['varietes'],
    queryFn: async () => (await varieteAPI.getAll()).data,
  })

  const [lines, setLines] = useState<StockLine[]>([newLine()])
  const [errors, setErrors] = useState<Record<number, string>>({})

  // ── Helpers ──────────────────────────────────────────────────────────────

  const updateLine = (id: number, patch: Partial<StockLine>) =>
    setLines(ls => ls.map(l => l.id === id ? { ...l, ...patch } : l))

  const removeLine = (id: number) =>
    setLines(ls => ls.length > 1 ? ls.filter(l => l.id !== id) : ls)

  const addLine = () => setLines(ls => [...ls, newLine()])

  // ── Validation ───────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const errs: Record<number, string> = {}
    for (const l of lines) {
      const qty = parseFloat(l.quantite_stock)
      if (!l.quantite_stock || isNaN(qty) || qty <= 0) {
        errs[l.id] = 'Quantité invalide'
      }
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Sauvegarde bulk ───────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: async () => {
      const results = []
      for (const l of lines) {
        const showCultureInfo = !NO_CULTURE_INFO.includes(l.type_stock)
        const payload = {
          id_variete:      l.id_variete ?? null,
          id_plant:        null,
          id_bocal:        null,
          id_materiel_bocal: null,
          type_stock:      l.type_stock,
          sous_type_stock: showCultureInfo ? (l.sous_type_stock || null) : null,
          lampe_type:      null,
          substrat_type:   null,
          engrais_type:    null,
          maillage:        null,
          type_hash:       null,
          type_rosin:      null,
          date_stock:      l.date_stock || null,
          quantite_stock:  parseFloat(l.quantite_stock) || 0,
          variete_nom:     undefined,
          bocal_taille:    undefined,
        }
        results.push(await stockAPI.create(payload))
      }
      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      onClose()
    },
  })

  const handleSave = () => {
    if (validate()) save.mutate()
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  const sel =
    'w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm ' +
    'focus:outline-none focus:ring-2 focus:ring-grow-600 bg-white dark:bg-gray-700 ' +
    'text-gray-900 dark:text-gray-100'

  const inp = sel

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Saisie en masse
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={22} />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1 px-6 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 pr-3">Variété</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3">Sous-type</th>
                <th className="pb-2 pr-3">Quantité (g)</th>
                <th className="pb-2 pr-3">Date</th>
                <th className="pb-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {lines.map(l => {
                const showSousType = !NO_CULTURE_INFO.includes(l.type_stock)
                return (
                  <tr key={l.id} className="group">
                    {/* Variété */}
                    <td className="py-2 pr-3 min-w-[160px]">
                      <select
                        value={l.id_variete ?? ''}
                        onChange={e => updateLine(l.id, {
                          id_variete: e.target.value ? Number(e.target.value) : undefined,
                        })}
                        className={sel}
                      >
                        <option value="">— Non renseignée —</option>
                        {varietes.map(v => (
                          <option key={v.id_variete} value={v.id_variete}>{v.nom_variete}</option>
                        ))}
                      </select>
                    </td>

                    {/* Type */}
                    <td className="py-2 pr-3 min-w-[120px]">
                      <select
                        value={l.type_stock}
                        onChange={e => updateLine(l.id, {
                          type_stock: e.target.value,
                          sous_type_stock: NO_CULTURE_INFO.includes(e.target.value) ? '' : l.sous_type_stock,
                        })}
                        className={sel}
                      >
                        {TYPES_STOCK.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </td>

                    {/* Sous-type */}
                    <td className="py-2 pr-3 min-w-[120px]">
                      {showSousType ? (
                        <select
                          value={l.sous_type_stock}
                          onChange={e => updateLine(l.id, { sous_type_stock: e.target.value })}
                          className={sel}
                        >
                          <option value="">—</option>
                          {SOUS_TYPES.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs px-2">—</span>
                      )}
                    </td>

                    {/* Quantité */}
                    <td className="py-2 pr-3 min-w-[100px]">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={l.quantite_stock}
                        onChange={e => updateLine(l.id, { quantite_stock: e.target.value })}
                        placeholder="0"
                        className={`${inp} ${errors[l.id] ? 'border-red-400 focus:ring-red-400' : ''}`}
                      />
                      {errors[l.id] && (
                        <p className="text-xs text-red-500 mt-0.5">{errors[l.id]}</p>
                      )}
                    </td>

                    {/* Date */}
                    <td className="py-2 pr-3 min-w-[140px]">
                      <input
                        type="date"
                        value={l.date_stock}
                        onChange={e => updateLine(l.id, { date_stock: e.target.value })}
                        className={inp}
                      />
                    </td>

                    {/* Supprimer — icône seule */}
                    <td className="py-2 w-8">
                      <button
                        onClick={() => removeLine(l.id)}
                        disabled={lines.length === 1}
                        title="Supprimer cette ligne"
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded
                                   disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Ajouter une ligne */}
          <button
            onClick={addLine}
            className="mt-3 flex items-center gap-1.5 text-sm text-grow-600 hover:text-grow-700 font-medium px-2 py-1 rounded hover:bg-grow-50 dark:hover:bg-grow-900/20 transition-colors"
          >
            <Plus size={15} />
            Ajouter une ligne
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {lines.length} ligne{lines.length > 1 ? 's' : ''} à enregistrer
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                         text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={save.isPending}
              className="px-4 py-2 text-sm bg-grow-600 text-white rounded-lg hover:bg-grow-700
                         disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {save.isPending
                ? <><Loader2 size={15} className="animate-spin" /> Enregistrement…</>
                : <><Save size={15} /> Enregistrer tout</>
              }
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
