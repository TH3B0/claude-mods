import { expect, mock, test } from 'claude-code/testing'

import { avanza, daVoci, ripartire, segna } from '../hooks/piano'

const T0 = Date.parse('2026-10-20T10:00:00Z')
const MIN = 60_000

const VOCI = [
  { content: 'Leggere', status: 'in_progress' },
  { content: 'Scrivere', status: 'pending' },
  { content: 'Provare', status: 'pending' },
  { content: 'Rilasciare', status: 'pending' },
]

const BANDA = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
}

test('le liste di update_plan e TodoWrite diventano passi', async () => {
  const p = daVoci(VOCI, 'piano') ?? []
  expect(p.map(x => x.stato)).toEqual(['in_progress', 'pending', 'pending', 'pending'])
  expect(p[1]).toMatchObject({ id: 'piano-2', titolo: 'Scrivere' })
  expect(daVoci('niente', 'piano')).toBeUndefined()
})

test('avanza, done e start', async () => {
  const p = daVoci(VOCI, 'piano') ?? []
  expect(avanza(p).map(x => x.stato)).toEqual(['completed', 'in_progress', 'pending', 'pending'])
  expect(segna(p, [1, 2], 4).map(x => x.stato)).toEqual(['completed', 'completed', 'pending', 'in_progress'])
})

test('un piano senza passi in comune riparte da zero, il seguito no', async () => {
  const p = daVoci(VOCI, 'piano') ?? []
  expect(ripartire([], p)).toBe(true)
  expect(ripartire(p, p)).toBe(false)
  expect(ripartire(p, daVoci([{ content: 'Altro', status: 'pending' }], 'piano') ?? [])).toBe(true)
})

test('la barra segue la lista dei passi dell\'app e tiene le altre barre', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  on('tool.call', () => ({ result: 'ok' }))
  // un'altra mod sotto, che disegna la sua riga
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>altra barra</Text>
  })

  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: VOCI, scope: 'first_task' })
  await clock.advance(2 * MIN)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'barra-avanzamento', surface, ...BANDA })
    expect(await ui.find({ type: 'Text', text: /altra barra/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /25%.*Passo 2 di 4: Scrivere/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /resta ~6:00/ })).toBeDefined()
    await ui.unmount()
  }
})

test('wrap_up chiude il piano: la barra si ferma, poi sparisce al messaggio dopo', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [{ content: 'Disattivare file-tree', status: 'in_progress' }],
    scope: 'continuation',
  })
  await clock.advance(35_000)
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Fatto.' })

  const ui = await $.ui.mount({ plugin: 'barra-avanzamento', surface: 'desktop', ...BANDA })
  expect(await ui.find({ type: 'Text', text: /100%.*Completato ✓/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /in 0:35/ })).toBeDefined()
  // il tempo non va più avanti
  await clock.advance(5 * MIN)
  expect(await ui.find({ type: 'Text', text: /in 0:35/ })).toBeDefined()
  await ui.unmount()

  await $.prompt.submit({ text: 'grazie' } as Parameters<typeof $.prompt.submit>[0])
  const dopo = await $.ui.mount({ plugin: 'barra-avanzamento', surface: 'desktop', ...BANDA })
  expect(await dopo.find({ type: 'Text', text: /Completato|Passo/ })).toBeUndefined()
  await dopo.unmount()
})
