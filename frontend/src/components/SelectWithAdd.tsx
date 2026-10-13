import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'

// ── Select avec bouton "Ajouter" inline ───────────────────────────────────────
// Partagé par les modales Matériel / Vaporisateur. Les valeurs viennent d'une
// liste paramétrable (useParametreListeWithAdd) ; l'ajout inline l'enrichit.
const defaultCls = 'w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-grow-400 focus:border-transparent bg-white dark:bg-gray-800'

export default function SelectWithAdd({
  values, isAdding, onAddValue, value, onChange, placeholder = '—', className = defaultCls,
}: {
  values: string[]
  isAdding: boolean
  onAddValue: (v: string) => Promise<unknown>
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [adding, setAdding] = useState(false)
  const [newVal, setNewVal] = useState('')
  const [error, setError]   = useState('')

  const handleAdd = async () => {
    const v = newVal.trim()
    if (!v) return
    try {
      if (!values.includes(v)) await onAddValue(v)
      onChange(v)
      setNewVal('')
      setError('')
      setAdding(false)
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Erreur lors de l\'ajout')
    }
  }

  // Valeur enregistrée absente de la liste (supprimée depuis Paramétrage) : on la garde affichable
  const options = value && !values.includes(value) ? [...values, value] : values

  if (adding) {
    return (
      <div>
        <div className="flex gap-1">
          <input autoFocus type="text" className={`${className} flex-1`}
            value={newVal} onChange={e => setNewVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
              if (e.key === 'Escape') setAdding(false)
            }}
            placeholder="Nouvelle valeur…" />
          <button type="button" onClick={handleAdd} disabled={isAdding || !newVal.trim()}
            className="px-2 py-1 bg-grow-600 text-white text-xs rounded-lg hover:bg-grow-700 disabled:opacity-40">
            {isAdding ? <Loader2 size={11} className="animate-spin" /> : '✓'}
          </button>
          <button type="button" onClick={() => { setAdding(false); setError('') }}
            className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-xs rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40">
            ✕
          </button>
        </div>
        {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex gap-1">
      <select className={`${className} flex-1`} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      <button type="button" onClick={() => setAdding(true)}
        className="px-2 border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-grow-600 hover:border-grow-300 rounded-lg text-xs"
        title="Ajouter une valeur">
        <Plus size={13} />
      </button>
    </div>
  )
}
