import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Passo, Tempi } from '../types'
import { avanza, chiudi, daVoci, ripartire, segna } from './piano'

/** La lista dei passi che l'app desktop mostra sotto i messaggi. */
const UPDATE_PLAN = 'mcp__ccd_turn__update_plan'
/** Il riepilogo di fine turno dell'app: spunta i passi rimasti senza passare da update_plan. */
const WRAP_UP = 'mcp__ccd_turn__wrap_up'

const passi = atom({ plugin: 'barra-avanzamento', key: 'passi' } as const, [] as Passo[])
const tempi = atom({ plugin: 'barra-avanzamento', key: 'tempi' } as const, null as Tempi | null)
const ora = atom({ plugin: 'barra-avanzamento', key: 'ora' } as const, 0)

const LARGHEZZA = 20

const durata = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

const tuttiFatti = (lista: Passo[]) => lista.length > 0 && lista.every(p => p.stato === 'completed')

let tick: { cancel: () => void } | null = null

async function avviaTick($: EngineInterface) {
  if (tick) return
  tick = $.clock.every(1000, async () => {
    const adesso = await $.clock.now()
    await update($, ora, () => adesso)
  })
}

function fermaTick() {
  tick?.cancel()
  tick = null
}

async function dopoModifica($: EngineInterface) {
  const lista = await read($, passi)
  const adesso = await $.clock.now()
  await update($, ora, () => adesso)
  if (tuttiFatti(lista)) {
    await update($, tempi, t => (t && t.fine === null ? { ...t, fine: adesso } : t))
    fermaTick()
  } else if (lista.length > 0) {
    await avviaTick($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const lista = await read($, passi)
    if (lista.length > 0 && !tuttiFatti(lista)) await avviaTick($)
    return next(e)
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && ran.result) {
      const t = ran.result.task
      const adesso = await $.clock.now()
      const prima = await read($, passi)
      const nuovo = prima.length === 0 || tuttiFatti(prima)
      if (nuovo) await update($, tempi, () => ({ inizio: adesso, fine: null }))
      await update($, passi, lista => [
        ...(nuovo ? [] : lista),
        { id: t.id, titolo: e.subject, inCorso: e.activeForm, stato: 'pending' as const },
      ])
      await dopoModifica($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await update($, passi, lista => {
        if (e.status === 'deleted') return lista.filter(p => p.id !== e.taskId)
        const stato = e.status
        return lista.map((p): Passo =>
          p.id !== e.taskId
            ? p
            : {
                ...p,
                titolo: e.subject ?? p.titolo,
                inCorso: e.activeForm ?? p.inCorso,
                stato: stato ?? p.stato,
              },
        )
      })
      await dopoModifica($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Un piano finito resta in vista fino al messaggio dopo, poi sparisce.
  on('prompt.submit', async ($, e, next) => {
    if (tuttiFatti(await read($, passi))) {
      await update($, passi, () => [])
      await update($, tempi, () => null)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // update_plan (app desktop) e TodoWrite: una lista intera, oppure avanza / done / start.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined || ran.isError === true) return ran
    if (e.tool === WRAP_UP) {
      const prima = await read($, passi)
      if (prima.length > 0 && prima.some(p => p.stato !== 'completed')) {
        await update($, passi, () => chiudi(prima))
        await dopoModifica($)
      }
      return ran
    }
    if (e.tool !== UPDATE_PLAN && e.tool !== 'TodoWrite') return ran

    const prima = await read($, passi)
    const intera = daVoci(e.tool === 'TodoWrite' ? e.todos : e.items, e.tool === 'TodoWrite' ? 'todo' : 'piano')
    let dopo: Passo[] | undefined
    if (intera) {
      dopo = intera
    } else if (e.tool === UPDATE_PLAN && e.advance === true) {
      dopo = avanza(prima)
    } else if (e.tool === UPDATE_PLAN && (Array.isArray(e.done) || typeof e.start === 'number')) {
      const fatti = Array.isArray(e.done) ? e.done.filter((n): n is number => typeof n === 'number') : []
      dopo = segna(prima, fatti, typeof e.start === 'number' ? e.start : undefined)
    }
    if (dopo === undefined) return ran

    if (intera && ripartire(prima, intera)) {
      const adesso = await $.clock.now()
      await update($, tempi, () => ({ inizio: adesso, fine: null }))
    }
    const finale = dopo
    await update($, passi, () => finale)
    await dopoModifica($)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Quello che disegnano le altre mod (barra-sessione, savvy-progress, …) resta, sopra la barra.
    const sotto = await next(e)
    const lista = await read($, passi)
    if (e.props.hasSurvey || lista.length === 0) return sotto

    const t = await read($, tempi)
    const adesso = await read($, ora)

    const totale = lista.length
    const fatti = lista.filter(p => p.stato === 'completed').length
    const mancano = totale - fatti
    const attuale = lista.find(p => p.stato === 'in_progress') ?? lista.find(p => p.stato === 'pending')
    const pieni = Math.round((fatti / totale) * LARGHEZZA)
    const barra = '█'.repeat(pieni) + '░'.repeat(LARGHEZZA - pieni)
    const percento = Math.round((fatti / totale) * 100)

    const trascorso = t ? (t.fine ?? Math.max(adesso, t.inizio)) - t.inizio : 0
    let tempo: string
    if (mancano === 0) {
      tempo = `in ${durata(trascorso)}`
    } else if (fatti === 0) {
      tempo = `trascorso ${durata(trascorso)} · resta: calcolo…`
    } else {
      const resta = (trascorso / fatti) * mancano
      tempo = `trascorso ${durata(trascorso)} · resta ~${durata(resta)}`
    }

    const nome = attuale
      ? attuale.stato === 'in_progress' && attuale.inCorso
        ? attuale.inCorso
        : attuale.titolo
      : ''

    const dettaglio =
      mancano === 0
        ? 'Completato ✓'
        : `Passo ${fatti + 1} di ${totale}: ${nome} · ${mancano === 1 ? 'manca 1 passo' : `mancano ${mancano} passi`}`

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {sotto}
        <Text>
          {barra} {percento}%  {dettaglio}
        </Text>
        <Text dimColor>⏱ {tempo}</Text>
      </Box>
    )
  })
}
