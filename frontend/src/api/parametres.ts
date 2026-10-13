import axios from 'axios'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CATEGORIES } from './materiel'

// ── Valeurs verrouillées ──────────────────────────────────────────────────────
// Valeurs sur lesquelles le code s'appuie (champs spécifiques, liens stock/curing…) :
// ni renommables ni supprimables depuis Paramétrage. Miroir : backend/app/routers/parametre.py (LISTES_VERROUILLEES).
export const LISTES_VERROUILLEES: Record<string, readonly string[]> = {
  materiel_categories: CATEGORIES,
}

export function isValeurVerrouillee(listeNom: string, valeur: string): boolean {
  return LISTES_VERROUILLEES[listeNom]?.includes(valeur) ?? false
}

export interface ParametreValeur {
  id_parametre: number
  liste_nom:    string
  valeur:       string
  ordre:        number
}

// Tri alphabétique français : insensible à la casse et aux accents, nombres dans l'ordre
// naturel (« 15µ » avant « 110µ »). Appliqué à toutes les listes paramétrables.
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })
export const compareValeurs = (a: string, b: string) => collator.compare(a, b)
export const trierValeurs = (valeurs: string[]) => [...valeurs].sort(compareValeurs)

export const parametresAPI = {
  getList: async (listeNom: string) => {
    const res = await axios.get<ParametreValeur[]>(`/api/parametres/${listeNom}`)
    res.data = [...res.data].sort((a, b) => compareValeurs(a.valeur, b.valeur))
    return res
  },

  add: (listeNom: string, valeur: string) =>
    axios.post<ParametreValeur>(`/api/parametres/${listeNom}`, { valeur }),

  update: (id: number, valeur: string) =>
    axios.patch<ParametreValeur>(`/api/parametres/${id}`, { valeur }),

  delete: (id: number) =>
    axios.delete(`/api/parametres/${id}`),
}

// ── Hook pratique ─────────────────────────────────────────────────────────────
export function useParametreListe(listeNom: string) {
  const { data = [], isLoading } = useQuery<ParametreValeur[]>({
    queryKey: ['parametres', listeNom],
    queryFn: async () => (await parametresAPI.getList(listeNom)).data,
    staleTime: 60_000,
  })
  return { values: data.map(p => p.valeur), items: data, isLoading }
}

// ── Hook avec mutation inline (pour "Ajouter depuis le formulaire") ────────────
export function useParametreListeWithAdd(listeNom: string) {
  const qc = useQueryClient()
  const { values, items, isLoading } = useParametreListe(listeNom)

  const addMut = useMutation({
    mutationFn: (valeur: string) => parametresAPI.add(listeNom, valeur),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parametres', listeNom] }),
  })

  return { values, items, isLoading, addValue: addMut.mutateAsync, isAdding: addMut.isPending }
}
