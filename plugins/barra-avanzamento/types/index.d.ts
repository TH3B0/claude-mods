export type Passo = {
  id: string
  titolo: string
  inCorso?: string
  stato: 'pending' | 'in_progress' | 'completed'
}

export type Tempi = { inizio: number; fine: number | null }

declare module 'claude-code' {
  interface PluginState {
    'barra-avanzamento': { passi: Passo[]; tempi: Tempi | null; ora: number }
  }
}
