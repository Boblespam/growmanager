import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, Package, Pencil, Trash2, Loader2, AlertTriangle,
  ChevronUp, ChevronDown, ChevronsUpDown, ArrowDownUp, LogOut,
  FlaskConical, Snowflake, Printer,
} from 'lucide-react'
import { stockAPI, Stock } from '../api/stock'
import { curingAPI, SessionCuring, PlantCuring } from '../api/curing'
import { stockAlertSeuilsAPI, StockAlertResult } from '../api/stockAlertSeuils'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import NouveauStockModal from '../components/NouveauStockModal'
import BulkEntryModal from '../components/BulkEntryModal'
import ImportExportModal from '../components/ImportExportModal'
import StockOriginDrawer from '../components/StockOriginDrawer'

// ── Tri ──────────────────────────────────────────────────────────────────────
type StockSortCol = 'variete' | 'type' | 'soustype' | 'engrais' | 'bocal' | 'quantite' | 'date' | 'age'
type ExtractionSortCol = 'variete' | 'type' | 'quantite' | 'date' | 'age'
type SortDir = 'asc' | 'desc'
type CuringSortCol = 'plante' | 'variete' | 'culture' | 'bocal' | 'debut' | 'jours' | 'jours_recolte' | 'quantite'

function SortIcon({ col, current, dir }: { col: string; current: string | null; dir: SortDir }) {
  if (current !== col) return <ChevronsUpDown size={12} className="ml-1 text-gray-300 inline" />
  return dir === 'asc'
    ? <ChevronUp   size={12} className="ml-1 text-grow-600 inline" />
    : <ChevronDown size={12} className="ml-1 text-grow-600 inline" />
}

// ── Age / duree ───────────────────────────────────────────────────────────────
function ageLabel(dateStr?: string): string {
  if (!dateStr) return '—'
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
  if (diff < 0) return '—'
  if (diff < 30) return `${diff} j`
  if (diff < 365) { const m = Math.floor(diff / 30); return `${m} mois` }
  const y = Math.floor(diff / 365)
  return `${y} an${y > 1 ? 's' : ''}`
}

function durationLabel(start?: string, end?: string): string {
  if (!start || !end) return '—'
  const diff = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000)
  if (diff <= 0) return '< 1 j'
  if (diff < 30) return `${diff} j`
  if (diff < 365) { const m = Math.floor(diff / 30); return `${m} mois` }
  const y = Math.floor(diff / 365)
  return `${y} an${y > 1 ? 's' : ''}`
}

// ── Badges type ──────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  Fleur:     'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  Trim:      'bg-lime-100 dark:bg-lime-900/30 text-lime-700 dark:text-lime-300',
  WPFF:      'bg-cyan-100 text-cyan-700',
  Hash:      'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  Rosin:     'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  Poussière: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  Autre:     'bg-gray-100 text-gray-600 dark:text-gray-300',
}
const EXTRACTION_TYPES = ['Trim', 'WPFF']

function TypeBadge({ type }: { type?: string }) {
  const label = type || 'Autre'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[label] ?? TYPE_COLORS['Autre']}`}>
      {label}
    </span>
  )
}

// ── Ligne stock avec confirmation ─────────────────────────────────────────────
function StockRow({ item, onEdit, onDeleted, onSortie, onOrigine, onLabel }: {
  item: Stock
  onEdit: (s: Stock) => void
  onDeleted: () => void
  onSortie: () => void
  onOrigine: (id: number) => void
  onLabel: (id: number) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSortie, setConfirmSortie] = useState(false)
  const isCloture = !!item.date_fin_stock

  const remove = useMutation({
    mutationFn: () => stockAPI.delete(item.id_stock),
    onSuccess: onDeleted,
    onError: () => setConfirmDelete(false),
  })
  const sortie = useMutation({
    mutationFn: () => stockAPI.sortie(item.id_stock),
    onSuccess: () => { setConfirmSortie(false); onSortie() },
    onError: () => setConfirmSortie(false),
  })

  if (confirmDelete) return (
    <tr className="bg-red-50 dark:bg-red-900/20">
      <td colSpan={9} className="px-5 py-3 text-sm text-red-700 dark:text-red-300">
        <span className="flex items-center gap-2">
          <AlertTriangle size={14} />
          Supprimer <strong>{item.variete_nom ?? 'ce stock'}</strong> ({item.quantite_stock}g) ?
        </span>
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex justify-end gap-2">
          <button onClick={() => remove.mutate()} disabled={remove.isPending}
            className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50">
            {remove.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Confirmer'}
          </button>
          <button onClick={() => setConfirmDelete(false)}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs rounded hover:bg-gray-50">
            Annuler
          </button>
        </div>
      </td>
    </tr>
  )

  if (confirmSortie) return (
    <tr className="bg-amber-50 dark:bg-amber-900/20">
      <td colSpan={9} className="px-5 py-3 text-sm text-amber-800 dark:text-amber-300">
        <span className="flex items-center gap-2">
          <LogOut size={14} />
          Déclarer <strong>{item.variete_nom ?? 'ce stock'}</strong> comme terminé (0 g restant) ?
        </span>
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex justify-end gap-2">
          <button onClick={() => sortie.mutate()} disabled={sortie.isPending}
            className="px-3 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 disabled:opacity-50">
            {sortie.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Confirmer'}
          </button>
          <button onClick={() => setConfirmSortie(false)}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs rounded hover:bg-gray-50">
            Annuler
          </button>
        </div>
      </td>
    </tr>
  )

  const specs = (() => {
    const t = item.type_stock
    if (t === 'Hash') {
      const parts = [item.maillage, item.type_hash].filter(Boolean)
      return parts.length ? parts.join(' · ') : '—'
    }
    if (t === 'Rosin') {
      if (!item.type_rosin) return '—'
      return item.maillage ? `${item.type_rosin} - ${item.maillage}` : item.type_rosin
    }
    if (t === 'WPFF') return '—'
    return item.sous_type_stock || '—'
  })()

  const bocalLabel = (() => {
    if (!item.bocal_nom && !item.id_materiel_bocal) return '—'
    const nom = item.bocal_nom ?? `Bocal #${item.id_materiel_bocal}`
    const vol = item.bocal_volume_ml
    if (vol) { const volStr = vol >= 1000 ? `${vol / 1000} L` : `${vol} mL`; return `${nom} · ${volStr}` }
    return nom
  })()

  const ageCol = isCloture
    ? <span className="text-xs text-gray-400 dark:text-gray-500 italic">{durationLabel(item.date_stock ?? undefined, item.date_fin_stock ?? undefined)}</span>
    : <span className="text-sm text-gray-400 dark:text-gray-500">{ageLabel(item.date_stock ?? undefined)}</span>

  const rowClass = isCloture
    ? 'opacity-50 bg-gray-50 dark:bg-gray-700/30'
    : 'hover:bg-violet-50/40 dark:hover:bg-violet-900/10 group cursor-pointer'

  return (
    <tr className={rowClass} onClick={e => { if (!(e.target as HTMLElement).closest('button')) onOrigine(item.id_stock) }} title="Cliquer pour voir l'origine">
      <td className="px-5 py-3">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {item.plant_nom ?? item.variete_nom ?? '—'}
          {isCloture && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-normal">clôturé {item.date_fin_stock ? new Date(item.date_fin_stock).toLocaleDateString('fr-FR') : ''}</span>}
        </div>
        {item.plant_nom && item.plant_culture_nom && (
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.plant_culture_nom}</div>
        )}
        {item.plant_nom && !item.plant_culture_nom && item.variete_nom && (
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.variete_nom}</div>
        )}
      </td>
      <td className="px-5 py-3"><TypeBadge type={item.type_stock ?? undefined} /></td>
      <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400">{specs}</td>
      <td className="px-5 py-3">
        {!item.substrat_type && !item.engrais_type && <span className="text-sm text-gray-400">—</span>}
        {item.substrat_type && (
          <div className="text-sm text-gray-500 dark:text-gray-400">{item.substrat_type}</div>
        )}
        {item.engrais_type && (
          <div className={item.substrat_type ? 'text-xs text-gray-400 dark:text-gray-500 mt-0.5' : 'text-sm text-gray-500 dark:text-gray-400'}>
            {item.engrais_type}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-sm text-gray-400 dark:text-gray-500 max-w-[160px] truncate" title={bocalLabel !== '—' ? bocalLabel : undefined}>{bocalLabel}</td>
      <td className="px-5 py-3 text-sm font-semibold text-grow-700">
        {isCloture ? <span className="line-through text-gray-400 dark:text-gray-500">0 g</span> : `${item.quantite_stock.toFixed(1)} g`}
      </td>
      <td className="px-5 py-3 text-sm text-gray-400 dark:text-gray-500">{item.date_stock ? new Date(item.date_stock).toLocaleDateString('fr-FR') : '—'}</td>
      <td className="px-5 py-3">{ageCol}</td>
      <td className="px-5 py-3 text-right">
        <div className={`flex justify-end gap-1 ${isCloture ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
          <button onClick={e => { e.stopPropagation(); onLabel(item.id_stock) }}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded" title="Imprimer étiquette">
            <Printer size={14} />
          </button>
          <button onClick={e => { e.stopPropagation(); onOrigine(item.id_stock) }}
            className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded" title="Voir l'origine">
            <FlaskConical size={14} />
          </button>
          {!isCloture && (
            <button onClick={e => { e.stopPropagation(); setConfirmSortie(true) }}
              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded" title="Sortie stock">
              <LogOut size={14} />
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); onEdit(item) }} className="p-1.5 text-gray-400 hover:text-grow-600 hover:bg-grow-50 rounded" title="Modifier">
            <Pencil size={14} />
          </button>
          <button onClick={e => { e.stopPropagation(); setConfirmDelete(true) }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Supprimer">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Ligne extraction ──────────────────────────────────────────────────────────
function ExtractionRow({ item, onEdit, onDeleted, onSortie }: {
  item: Stock
  onEdit: (s: Stock) => void
  onDeleted: () => void
  onSortie: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSortie, setConfirmSortie] = useState(false)
  const isCloture = !!item.date_fin_stock

  const remove = useMutation({
    mutationFn: () => stockAPI.delete(item.id_stock),
    onSuccess: onDeleted,
    onError: () => setConfirmDelete(false),
  })
  const sortie = useMutation({
    mutationFn: () => stockAPI.sortie(item.id_stock),
    onSuccess: () => { setConfirmSortie(false); onSortie() },
    onError: () => setConfirmSortie(false),
  })

  if (confirmDelete) return (
    <tr className="bg-red-50 dark:bg-red-900/20">
      <td colSpan={5} className="px-5 py-3 text-sm text-red-700 dark:text-red-300">
        <span className="flex items-center gap-2">
          <AlertTriangle size={14} />
          Supprimer <strong>{item.variete_nom ?? 'cette extraction'}</strong> ({item.quantite_stock}g) ?
        </span>
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex justify-end gap-2">
          <button onClick={() => remove.mutate()} disabled={remove.isPending}
            className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50">
            {remove.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Confirmer'}
          </button>
          <button onClick={() => setConfirmDelete(false)}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs rounded hover:bg-gray-50">
            Annuler
          </button>
        </div>
      </td>
    </tr>
  )

  if (confirmSortie) return (
    <tr className="bg-amber-50 dark:bg-amber-900/20">
      <td colSpan={5} className="px-5 py-3 text-sm text-amber-800 dark:text-amber-300">
        <span className="flex items-center gap-2">
          <LogOut size={14} />
          Déclarer <strong>{item.variete_nom ?? 'cette extraction'}</strong> comme terminé (0 g restant) ?
        </span>
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex justify-end gap-2">
          <button onClick={() => sortie.mutate()} disabled={sortie.isPending}
            className="px-3 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 disabled:opacity-50">
            {sortie.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Confirmer'}
          </button>
          <button onClick={() => setConfirmSortie(false)}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs rounded hover:bg-gray-50">
            Annuler
          </button>
        </div>
      </td>
    </tr>
  )

  const rowClass = isCloture
    ? 'opacity-50 bg-gray-50 dark:bg-gray-700/30'
    : 'hover:bg-cyan-50/40 dark:hover:bg-cyan-900/10 group'

  return (
    <tr className={rowClass}>
      <td className="px-5 py-3">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {item.variete_nom ?? '—'}
          {isCloture && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-normal">clôturé</span>}
        </div>
      </td>
      <td className="px-5 py-3"><TypeBadge type={item.type_stock ?? undefined} /></td>
      <td className="px-5 py-3 text-sm font-semibold text-cyan-700 dark:text-cyan-400">
        {isCloture ? <span className="line-through text-gray-400 dark:text-gray-500">0 g</span> : `${item.quantite_stock.toFixed(1)} g`}
      </td>
      <td className="px-5 py-3 text-sm text-gray-400 dark:text-gray-500">{item.date_stock ? new Date(item.date_stock).toLocaleDateString('fr-FR') : '—'}</td>
      <td className="px-5 py-3 text-sm text-gray-400 dark:text-gray-500">{ageLabel(item.date_stock ?? undefined)}</td>
      <td className="px-5 py-3 text-right">
        <div className={`flex justify-end gap-1 ${isCloture ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
          {!isCloture && (
            <button onClick={() => setConfirmSortie(true)}
              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded" title="Sortie extraction">
              <LogOut size={14} />
            </button>
          )}
          <button onClick={() => onEdit(item)} className="p-1.5 text-gray-400 hover:text-grow-600 hover:bg-grow-50 rounded" title="Modifier">
            <Pencil size={14} />
          </button>
          <button onClick={() => setConfirmDelete(true)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Supprimer">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Ligne curing ──────────────────────────────────────────────────────────────
function CuringRow({ session, plants, sortCol, sortDir }: {
  session: SessionCuring
  plants: PlantCuring[]
  sortCol: CuringSortCol | null
  sortDir: SortDir
}) {
  const [open, setOpen] = useState(false)
  const sorted = useMemo(() => {
    if (!sortCol) return plants
    return [...plants].sort((a, b) => {
      let va: string | number = '', vb: string | number = ''
      if (sortCol === 'plante')        { va = a.nom_affichage ?? ''; vb = b.nom_affichage ?? '' }
      else if (sortCol === 'variete')  { va = a.variete_nom   ?? ''; vb = b.variete_nom   ?? '' }
      else if (sortCol === 'culture')  { va = a.nom_culture   ?? ''; vb = b.nom_culture   ?? '' }
      else if (sortCol === 'bocal')    { va = a.bocal_nom     ?? ''; vb = b.bocal_nom     ?? '' }
      else if (sortCol === 'debut')    { va = a.date_mise_bocal ?? ''; vb = b.date_mise_bocal ?? '' }
      else if (sortCol === 'jours')    { va = a.jours_curing ?? 0; vb = b.jours_curing ?? 0 }
      else if (sortCol === 'jours_recolte') { va = a.jours_depuis_recolte ?? 0; vb = b.jours_depuis_recolte ?? 0 }
      else if (sortCol === 'quantite') { va = a.poids_recolte ?? 0; vb = b.poids_recolte ?? 0 }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [plants, sortCol, sortDir])

  return (
    <>
      <tr className="hover:bg-purple-50/40 dark:hover:bg-purple-900/10 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
          <span className="flex items-center gap-2">
            {open ? <ChevronUp size={14} className="text-purple-500" /> : <ChevronDown size={14} className="text-gray-400" />}
            {session.nom_culture ?? `Culture #${session.id_culture}`}
          </span>
        </td>
        <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <Snowflake size={12} className="text-purple-400" />
            {session.bocal_count} bocal{session.bocal_count !== 1 ? 'x' : ''}
          </div>
        </td>
        <td className="px-5 py-3 text-sm font-semibold text-purple-700 dark:text-purple-400">
          {session.total_poids_recolte != null ? `${session.total_poids_recolte.toFixed(1)} g` : '—'}
        </td>
        <td className="px-5 py-3" />
        <td className="px-5 py-3" />
        <td className="px-5 py-3" />
        <td className="px-5 py-3" />
        <td className="px-5 py-3" />
      </tr>
      {open && sorted.map(p => (
        <tr key={p.id_plant} className="bg-purple-50/30 dark:bg-purple-900/10">
          <td className="px-5 py-2 pl-12 text-sm text-gray-700 dark:text-gray-300">
            <div>{p.nom_affichage ?? '—'}</div>
            {p.variete_nom && <div className="text-xs text-gray-400 dark:text-gray-500">{p.variete_nom}</div>}
          </td>
          <td className="px-5 py-2 text-sm text-gray-500 dark:text-gray-400">{p.nom_culture ?? '—'}</td>
          <td className="px-5 py-2 text-sm font-medium text-purple-700 dark:text-purple-400">
            {p.poids_recolte != null ? `${p.poids_recolte.toFixed(1)} g` : '—'}
          </td>
          <td className="px-5 py-2 text-sm text-gray-400 dark:text-gray-500">{p.bocal_nom ?? '—'}</td>
          <td className="px-5 py-2 text-sm text-gray-400 dark:text-gray-500">
            {p.date_mise_bocal ? new Date(p.date_mise_bocal).toLocaleDateString('fr-FR') : '—'}
          </td>
          <td className="px-5 py-2 text-sm text-gray-400 dark:text-gray-500">
            {p.jours_curing != null ? `${p.jours_curing} j` : '—'}
          </td>
          <td className="px-5 py-2 text-sm text-gray-400 dark:text-gray-500">
            {p.jours_depuis_recolte != null ? `${p.jours_depuis_recolte} j` : '—'}
          </td>
          <td className="px-5 py-2" />
        </tr>
      ))}
    </>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function StockPage() {
  const queryClient = useQueryClient()

  const { data: stockData = [], isLoading: loadingStock } = useQuery<Stock[]>({
    queryKey: ['stock'],
    queryFn: async () => (await stockAPI.getAll()).data,
  })

  const { data: curingData, isLoading: loadingCuring } = useQuery<{
    sessions: SessionCuring[]
    plants: PlantCuring[]
  }>({
    queryKey: ['curing-dashboard'],
    queryFn: async () => (await curingAPI.getDashboard()).data,
  })

  const { data: alertsData } = useQuery<StockAlertResult>({
    queryKey: ['stock-alert-seuils'],
    queryFn: async () => (await stockAlertSeuilsAPI.checkAll()).data,
  })

  const [activeTab,    setActiveTab]    = useState<'stock' | 'curing' | 'extractions'>('stock')
  const [searchTerm,   setSearchTerm]   = useState('')
  const [typeFilter,   setTypeFilter]   = useState('')
  const [showClotures, setShowClotures] = useState(false)
  const [sortCol,      setSortCol]      = useState<StockSortCol | null>(null)
  const [sortDir,      setSortDir]      = useState<SortDir>('asc')
  const [extSortCol,   setExtSortCol]   = useState<ExtractionSortCol | null>(null)
  const [extSortDir,   setExtSortDir]   = useState<SortDir>('asc')
  const [extTypeFilter, setExtTypeFilter] = useState('')
  const [showModal,        setShowModal]        = useState(false)
  const [editStock,        setEditStock]        = useState<Stock | null>(null)
  const [showImportExport, setShowImportExport] = useState(false)
  const [showBulkEntry,    setShowBulkEntry]    = useState(false)
  const [origineStockId,   setOrigineStockId]   = useState<number | null>(null)
  const [labelStockId,     setLabelStockId]     = useState<number | null>(null)

  const curingSortState = useState<CuringSortCol | null>(null)
  const [curingSortCol, setCuringSortCol] = curingSortState
  const [curingSortDir, setCuringSortDir] = useState<SortDir>('asc')

  const handleSort = (col: StockSortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const handleExtSort = (col: ExtractionSortCol) => {
    if (extSortCol === col) setExtSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setExtSortCol(col); setExtSortDir('asc') }
  }
  const handleCuringSort = (col: CuringSortCol) => {
    if (curingSortCol === col) setCuringSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setCuringSortCol(col); setCuringSortDir('asc') }
  }

  // ── Filtrage / tri stock ────────────────────────────────────────────────────
  const stockFiltered = useMemo(() => {
    let data = stockData.filter(s => {
      const matchSearch = !searchTerm ||
        (s.variete_nom ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.plant_nom   ?? '').toLowerCase().includes(searchTerm.toLowerCase())
      const matchType   = !typeFilter || s.type_stock === typeFilter
      const matchCloture = showClotures || !s.date_fin_stock
      const notExtraction = !EXTRACTION_TYPES.includes(s.type_stock || '')
      return matchSearch && matchType && matchCloture && notExtraction
    })
    if (sortCol) {
      data = [...data].sort((a, b) => {
        let va: string | number = '', vb: string | number = ''
        if (sortCol === 'variete')   { va = a.variete_nom      ?? ''; vb = b.variete_nom      ?? '' }
        if (sortCol === 'type')      { va = a.type_stock        ?? ''; vb = b.type_stock        ?? '' }
        if (sortCol === 'soustype')  { va = a.sous_type_stock   ?? ''; vb = b.sous_type_stock   ?? '' }
        if (sortCol === 'engrais')   { va = a.engrais_type      ?? ''; vb = b.engrais_type      ?? '' }
        if (sortCol === 'bocal')     { va = a.bocal_nom         ?? ''; vb = b.bocal_nom         ?? '' }
        if (sortCol === 'quantite')  { va = a.quantite_stock;          vb = b.quantite_stock }
        if (sortCol === 'date')      { va = a.date_stock        ?? ''; vb = b.date_stock        ?? '' }
        if (sortCol === 'age')       { va = a.date_stock        ?? ''; vb = b.date_stock        ?? '' }
        const cmp = va < vb ? -1 : va > vb ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return data
  }, [stockData, searchTerm, typeFilter, showClotures, sortCol, sortDir])

  const extractionFiltered = useMemo(() => {
    let data = stockData.filter(s => {
      const matchSearch = !searchTerm || (s.variete_nom ?? '').toLowerCase().includes(searchTerm.toLowerCase())
      const matchType   = !extTypeFilter || s.type_stock === extTypeFilter
      const matchCloture = showClotures || !s.date_fin_stock
      const isExtraction = EXTRACTION_TYPES.includes(s.type_stock || '')
      return matchSearch && matchType && matchCloture && isExtraction
    })
    if (extSortCol) {
      data = [...data].sort((a, b) => {
        let va: string | number = '', vb: string | number = ''
        if (extSortCol === 'variete')  { va = a.variete_nom   ?? ''; vb = b.variete_nom   ?? '' }
        if (extSortCol === 'type')     { va = a.type_stock     ?? ''; vb = b.type_stock     ?? '' }
        if (extSortCol === 'quantite') { va = a.quantite_stock;       vb = b.quantite_stock }
        if (extSortCol === 'date')     { va = a.date_stock     ?? ''; vb = b.date_stock     ?? '' }
        if (extSortCol === 'age')      { va = a.date_stock     ?? ''; vb = b.date_stock     ?? '' }
        const cmp = va < vb ? -1 : va > vb ? 1 : 0
        return extSortDir === 'asc' ? cmp : -cmp
      })
    }
    return data
  }, [stockData, searchTerm, extTypeFilter, showClotures, extSortCol, extSortDir])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = stockData.filter(s => !s.date_fin_stock && !EXTRACTION_TYPES.includes(s.type_stock || ''))
    const activeExt = stockData.filter(s => !s.date_fin_stock && EXTRACTION_TYPES.includes(s.type_stock || ''))
    const totalG   = active.reduce((s, x) => s + x.quantite_stock, 0)
    const totalExt = activeExt.reduce((s, x) => s + x.quantite_stock, 0)
    const byType: Record<string, number> = {}
    const byTypeExt: Record<string, number> = {}
    active.forEach(s => { byType[s.type_stock ?? 'Autre'] = (byType[s.type_stock ?? 'Autre'] ?? 0) + s.quantite_stock })
    activeExt.forEach(s => { byTypeExt[s.type_stock ?? 'Autre'] = (byTypeExt[s.type_stock ?? 'Autre'] ?? 0) + s.quantite_stock })
    return { totalG, totalExt, byType, byTypeExt }
  }, [stockData])

  const allTypes = useMemo(() =>
    [...new Set(stockData.filter(s => !EXTRACTION_TYPES.includes(s.type_stock || '')).map(s => s.type_stock).filter(Boolean))].sort() as string[],
    [stockData]
  )
  const allExtractionTypes = Object.keys(stats.byTypeExt).sort()

  const curingStats = useMemo(() => {
    const plants = curingData?.plants ?? []
    return {
      totalBocaux: plants.length,
      totalPoids: plants.reduce((s, p) => s + (p.poids_recolte ?? 0), 0),
    }
  }, [curingData])

  const curingSessionsFiltered = useMemo(() => {
    const sessions = curingData?.sessions ?? []
    const plants   = curingData?.plants   ?? []
    return sessions.map(session => ({
      session,
      plants: plants.filter(p => p.id_culture === session.id_culture),
    }))
  }, [curingData])

  if (loadingStock) return <LoadingSpinner />

  const th = 'px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200'
  const thFixed = 'px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap'

  return (
    <div className="space-y-6">

      {/* Modals */}
      {(showModal || editStock) && (
        <NouveauStockModal editStock={editStock} onClose={() => { setShowModal(false); setEditStock(null) }} />
      )}
      {showImportExport && <ImportExportModal onClose={() => setShowImportExport(false)} />}
      {showBulkEntry && <BulkEntryModal onClose={() => setShowBulkEntry(false)} />}

      {/* Drawer traçabilité origine */}
      {origineStockId && (
        <StockOriginDrawer
          stockId={origineStockId}
          onClose={() => setOrigineStockId(null)}
        />
      )}

      {/* Alertes seuils */}
      {alertsData && (alertsData.alerts.length > 0 || alertsData.ruptures.length > 0) && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-5 py-4">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-semibold text-sm">
            <AlertTriangle size={16} />
            Alertes stock
          </div>
          {alertsData.ruptures.length > 0 && (
            <div className="mt-2 space-y-1">
              {alertsData.ruptures.map(r => (
                <div key={r.variete_nom}
                     className="flex items-center justify-between text-sm py-1 border-b border-red-100 dark:border-red-800 last:border-0">
                  <span className="text-red-700 dark:text-red-300 font-medium">{r.variete_nom}</span>
                  <span className="text-red-600 dark:text-red-400 text-xs">Rupture · {r.quantite_actuelle.toFixed(0)} g</span>
                </div>
              ))}
            </div>
          )}
          {alertsData.alerts.length > 0 && (
            <div className="mt-2 space-y-1">
              {alertsData.alerts.map(a => (
                <div key={a.variete_nom}
                     className="flex items-center justify-between text-sm py-1">
                  <span className="text-red-600 dark:text-red-300">{a.variete_nom}</span>
                  <span className="text-red-500 text-xs">{a.quantite_actuelle.toFixed(0)} g / seuil {a.seuil_alerte} g</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Package size={24} className="text-grow-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Stock</h1>
          </div>
          {activeTab === 'stock' && stats.totalG > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 px-3 py-1.5 bg-grow-50 border border-grow-100 rounded-lg">
                <span className="text-xs text-grow-600 font-medium">{stats.totalG.toFixed(0)} g</span>
                <span className="text-xs text-grow-500">total</span>
              </div>
              {Object.entries(stats.byType).map(([type, qty]) => (
                <div key={type} className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 border border-purple-100 rounded-lg">
                  <span className="text-xs text-purple-700 dark:text-purple-300 font-medium">{qty.toFixed(0)} g</span>
                  <span className="text-xs text-purple-500">{type}</span>
                </div>
              ))}
            </div>
          )}
          {activeTab === 'curing' && curingStats.totalBocaux > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 border border-purple-100 rounded-lg">
                <span className="text-xs text-purple-700 dark:text-purple-300 font-medium">{curingStats.totalBocaux}</span>
                <span className="text-xs text-purple-500">bocaux</span>
              </div>
              <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-50 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg">
                <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">{curingStats.totalPoids.toFixed(0)} g</span>
                <span className="text-xs text-gray-400">récolte</span>
              </div>
            </div>
          )}
          {activeTab === 'extractions' && stats.totalExt > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-cyan-500">Total extractions</span>
              {Object.entries(stats.byTypeExt).map(([type, qty]) => (
                <div key={type} className="flex items-center gap-1 px-3 py-1.5 bg-cyan-50 border border-cyan-100 rounded-lg">
                  <span className="text-xs text-cyan-700 font-medium">{qty.toFixed(0)} g</span>
                  <span className="text-xs text-cyan-500">{type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {activeTab === 'stock' && (
            <>
              <button onClick={() => setShowImportExport(true)}
                className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 text-sm">
                <ArrowDownUp size={15} />Import / Export
              </button>
              <button onClick={() => setShowBulkEntry(true)}
                className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 text-sm">
                <Plus size={15} />Saisie en masse
              </button>
              <button onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-grow-600 text-white rounded-lg hover:bg-grow-700 text-sm font-medium">
                <Plus size={18} />Nouveau stock
              </button>
            </>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-xl p-1">
        <button
          onClick={() => setActiveTab('stock')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'stock'
              ? 'bg-white dark:bg-gray-800 text-grow-700 dark:text-grow-400 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          <Package size={15} />Stock
          {stockFiltered.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'stock' ? 'bg-grow-100 text-grow-700' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
              {stockFiltered.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('curing')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'curing'
              ? 'bg-white dark:bg-gray-800 text-purple-700 dark:text-purple-400 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          <Snowflake size={15} />Curing
          {curingStats.totalBocaux > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'curing' ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
              {curingStats.totalBocaux}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('extractions')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'extractions'
              ? 'bg-white dark:bg-gray-800 text-cyan-700 dark:text-cyan-400 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          <FlaskConical size={15} />Extractions
          {extractionFiltered.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === 'extractions' ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
            }`}>
              {extractionFiltered.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Onglet Stock ─────────────────────────────────────────────────────── */}
      {activeTab === 'stock' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">

          {/* Filtres */}
          <div className="flex flex-col lg:flex-row gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher variété ou plante…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grow-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
            </div>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grow-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="">Tous les types</option>
              {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 cursor-pointer">
              <input type="checkbox" checked={showClotures} onChange={e => setShowClotures(e.target.checked)} className="rounded" />
              Afficher clôturés
            </label>
          </div>

          {/* Table */}
          {stockFiltered.length === 0 ? (
            <EmptyState
              icon={<Package size={40} />}
              title="Aucun stock"
              description={searchTerm || typeFilter ? 'Aucun résultat pour ces filtres.' : 'Ajoutez votre premier stock.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className={th} onClick={() => handleSort('variete')}>Variété / Plante <SortIcon col="variete" current={sortCol} dir={sortDir} /></th>
                    <th className={th} onClick={() => handleSort('type')}>Type <SortIcon col="type" current={sortCol} dir={sortDir} /></th>
                    <th className={th} onClick={() => handleSort('soustype')}>Specs <SortIcon col="soustype" current={sortCol} dir={sortDir} /></th>
                    <th className={th} onClick={() => handleSort('engrais')}>Substrat / Engrais <SortIcon col="engrais" current={sortCol} dir={sortDir} /></th>
                    <th className={th} onClick={() => handleSort('bocal')}>Bocal <SortIcon col="bocal" current={sortCol} dir={sortDir} /></th>
                    <th className={th} onClick={() => handleSort('quantite')}>Quantité <SortIcon col="quantite" current={sortCol} dir={sortDir} /></th>
                    <th className={th} onClick={() => handleSort('date')}>Date <SortIcon col="date" current={sortCol} dir={sortDir} /></th>
                    <th className={th} onClick={() => handleSort('age')}>Âge <SortIcon col="age" current={sortCol} dir={sortDir} /></th>
                    <th className={thFixed} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {stockFiltered.map(s => (
                    <StockRow
                      key={s.id_stock}
                      item={s}
                      onEdit={s => setEditStock(s)}
                      onDeleted={() => queryClient.invalidateQueries({ queryKey: ['stock'] })}
                      onSortie={() => queryClient.invalidateQueries({ queryKey: ['stock'] })}
                      onOrigine={id => setOrigineStockId(id)}
                      onLabel={id => setLabelStockId(id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Onglet Curing ────────────────────────────────────────────────────── */}
      {activeTab === 'curing' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {loadingCuring ? (
            <div className="flex items-center justify-center py-16 text-sm text-gray-400 gap-2">
              <Loader2 size={16} className="animate-spin" /> Chargement…
            </div>
          ) : curingSessionsFiltered.length === 0 ? (
            <EmptyState
              icon={<Snowflake size={40} />}
              title="Aucun curing en cours"
              description="Les plantes en bocal apparaîtront ici."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className={th} onClick={() => handleCuringSort('culture')}>Culture <SortIcon col="culture" current={curingSortCol} dir={curingSortDir} /></th>
                    <th className={th} onClick={() => handleCuringSort('bocal')}>Bocal <SortIcon col="bocal" current={curingSortCol} dir={curingSortDir} /></th>
                    <th className={th} onClick={() => handleCuringSort('quantite')}>Poids récolte <SortIcon col="quantite" current={curingSortCol} dir={curingSortDir} /></th>
                    <th className={th} onClick={() => handleCuringSort('debut')}>Mise en bocal <SortIcon col="debut" current={curingSortCol} dir={curingSortDir} /></th>
                    <th className={th} onClick={() => handleCuringSort('jours')}>Jours curing <SortIcon col="jours" current={curingSortCol} dir={curingSortDir} /></th>
                    <th className={th} onClick={() => handleCuringSort('jours_recolte')}>Jours récolte <SortIcon col="jours_recolte" current={curingSortCol} dir={curingSortDir} /></th>
                    <th className={thFixed} />
                    <th className={thFixed} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {curingSessionsFiltered.map(({ session, plants }) => (
                    <CuringRow
                      key={session.id_culture}
                      session={session}
                      plants={plants}
                      sortCol={curingSortCol}
                      sortDir={curingSortDir}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Onglet Extractions ───────────────────────────────────────────────── */}
      {activeTab === 'extractions' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">

          {/* Filtres extractions */}
          {allExtractionTypes.length > 0 && (
            <div className="flex gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <select
                value={extTypeFilter}
                onChange={e => setExtTypeFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-grow-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="">Tous les types</option>
                {allExtractionTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}

          {extractionFiltered.length === 0 ? (
            <EmptyState
              icon={<FlaskConical size={40} />}
              title="Aucune extraction"
              description="Les extractions (Trim, WPFF) apparaîtront ici."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className={th} onClick={() => handleExtSort('variete')}>Variété <SortIcon col="variete" current={extSortCol} dir={extSortDir} /></th>
                    <th className={th} onClick={() => handleExtSort('type')}>Type <SortIcon col="type" current={extSortCol} dir={extSortDir} /></th>
                    <th className={th} onClick={() => handleExtSort('quantite')}>Quantité <SortIcon col="quantite" current={extSortCol} dir={extSortDir} /></th>
                    <th className={th} onClick={() => handleExtSort('date')}>Date <SortIcon col="date" current={extSortCol} dir={extSortDir} /></th>
                    <th className={th} onClick={() => handleExtSort('age')}>Âge <SortIcon col="age" current={extSortCol} dir={extSortDir} /></th>
                    <th className={thFixed} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {extractionFiltered.map(s => (
                    <ExtractionRow
                      key={s.id_stock}
                      item={s}
                      onEdit={s => setEditStock(s)}
                      onDeleted={() => queryClient.invalidateQueries({ queryKey: ['stock'] })}
                      onSortie={() => queryClient.invalidateQueries({ queryKey: ['stock'] })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
