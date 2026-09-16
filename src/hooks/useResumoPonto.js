import { useMemo } from 'react'
import { usePonto } from './usePonto'
import { definirPeriodo } from '../lib/periodos'
import { hoje } from '../lib/compartilhados'
import { visoesPontoHome } from '../lib/pontoCalc'

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
  const hojeISO = hoje()
  const { carregando, erro, resumo, cargaEsperada, excecoes, feriados, ferias } = usePonto(janela)
  const visoes = useMemo(() => {
    if (carregando || erro) return null
    return visoesPontoHome({
      excecoes: excecoes || [],
      inicioISO: janela.inicioISO,
      fimISO: janela.fimISO,
      hojeISO,
      feriados: feriados || [],
      ferias: ferias || [],
      agora: new Date(),
    })
  }, [carregando, erro, excecoes, feriados, ferias, janela.inicioISO, janela.fimISO, hojeISO])
  return {
    carregando,
    erro,
    saldoHoras: resumo.he + resumo.horasDomfer,
    cargaEsperada,
    he: resumo.he,
    horasDomfer: resumo.horasDomfer,
    visoes,
  }
}
