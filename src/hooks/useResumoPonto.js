import { useMemo } from 'react'
import { usePonto } from './usePonto'
import { definirPeriodo } from '../lib/periodos'
import { hoje } from '../lib/compartilhados'

// Saldo de horas da SEMANA CORRENTE para o card do Ponto na Home.
//
// Usa o mesMOS cálculo de usePonto (mesma página Ponto), só que sem
// dependência de navegação: fixa a semana atual via definirPeriodo. O valor
// mostrado é a soma das horas extras + domingo/feriado — o mesmo saldo do
// card "Saldo do período" (que inclui o dom/fer na carga cumprida).
export function useResumoPonto() {
  const janela = useMemo(() => {
    const p = definirPeriodo('semana', hoje())
    return { inicioISO: p.inicio, fimISO: p.fim }
  }, [])
  const { carregando, erro, resumo, cargaEsperada } = usePonto(janela)
  return {
    carregando,
    erro,
    saldoHoras: resumo.he + resumo.horasDomfer,
    cargaEsperada,
    he: resumo.he,
    horasDomfer: resumo.horasDomfer,
  }
}
