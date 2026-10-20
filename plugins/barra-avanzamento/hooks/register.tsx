import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Passo, Tempi } from '../types'

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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lista = await read($, passi)
    if (e.props.hasSurvey || lista.length === 0) return next(e)

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
        <Text>
          {barra} {percento}%  {dettaglio}
        </Text>
        <Text dimColor>⏱ {tempo}</Text>
      </Box>
    )
  })
}
