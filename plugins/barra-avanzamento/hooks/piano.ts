import type { Passo } from '../types'

type Stato = Passo['stato']

/** Lo stato come lo scrivono update_plan e TodoWrite; qualsiasi altro valore è "da fare". */
export function stato(s: unknown): Stato {
  return s === 'completed' || s === 'in_progress' ? s : 'pending'
}

/**
 * Una lista intera (update_plan `items`, TodoWrite `todos`) come passi della barra.
 * Le voci senza testo si saltano; l'id è la posizione, come la contano `done` e `start`.
 */
export function daVoci(voci: unknown, prefisso: string): Passo[] | undefined {
  if (!Array.isArray(voci)) return undefined
  return voci.flatMap((v: Record<string, unknown> | null, i): Passo[] => {
    const titolo = v?.content
    if (typeof titolo !== 'string') return []
    const inCorso = typeof v?.activeForm === 'string' ? v.activeForm : undefined
    return [{ id: `${prefisso}-${i + 1}`, titolo, inCorso, stato: stato(v?.status) }]
  })
}

/** È un piano nuovo, da cronometrare da capo, e non il seguito di quello di prima? */
export function ripartire(prima: readonly Passo[], dopo: readonly Passo[]): boolean {
  if (prima.length === 0 || prima.every(p => p.stato === 'completed')) return true
  const visti = new Set(prima.map(p => p.titolo))
  return !dopo.some(p => visti.has(p.titolo))
}

/** update_plan `advance`: chiude il passo in corso e apre il primo da fare. */
export function avanza(lista: readonly Passo[]): Passo[] {
  const prossimo = lista.findIndex(p => p.stato === 'pending')
  return lista.map((p, i) =>
    p.stato === 'in_progress' ? { ...p, stato: 'completed' } : i === prossimo ? { ...p, stato: 'in_progress' } : p,
  )
}

/** wrap_up a fine turno: l'app spunta da sé i passi rimasti, la barra fa lo stesso. */
export function chiudi(lista: readonly Passo[]): Passo[] {
  return lista.map(p => (p.stato === 'completed' ? p : { ...p, stato: 'completed' }))
}

/** update_plan `done` / `start`, con i passi contati da 1; un solo passo resta in corso. */
export function segna(lista: readonly Passo[], fatti: readonly number[], inizia?: number): Passo[] {
  const f = new Set(fatti.map(n => n - 1))
  const a = inizia === undefined ? -1 : inizia - 1
  return lista.map((p, i): Passo => {
    if (f.has(i)) return { ...p, stato: 'completed' }
    if (i === a) return { ...p, stato: 'in_progress' }
    if (a >= 0 && p.stato === 'in_progress') return { ...p, stato: 'pending' }
    return p
  })
}
