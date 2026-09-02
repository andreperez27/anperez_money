import { useMemo } from 'react'
import { usePlanejamentos } from './usePlanejamentos'
import { calcularResumoPlanejamentos } from '../lib/planejamentoCalc'
import { semanaIso } from '../lib/semana'
import { hoje } from '../lib/compartilhados'

// Saldo PREVISTO da semana corrente para o card de Planejamento na Home.
//
// Reusa usePlanejamentos com a semana atual (a visão padrão da tela de
// Planejamento). O valor é o resultado do fluxo previsto da semana
// (entradas − saídas, cancelados fora).
//
// O resumo EXCLUI os itens com destino Cartão (destino_padrao='cartao'), sejam
// previstos ou realizados em cartão: mesma regra da projeção da fatura
// (faturaProjecao.js) — um item de cartão NUNCA soma como linha própria no
// fluxo da semana, pois nenhum dinheiro sai da conta nessa janela (a saída
// acontece no PAGAMENTO da fatura do cartão, que já carrega esse valor). Sem
// esse filtro, essas despesas somariam indevidamente no card da semana.
export function useResumoPlanejamento() {
  const { ano, semana } = useMemo(() => semanaIso(hoje()), [])
  const { carregando, erro, itens } = usePlanejamentos({ ano, semana })

  const resumo = useMemo(() => {
    const semCartao = (itens || []).filter(
      (i) => i.destino_padrao !== 'cartao',
    )
    return calcularResumoPlanejamentos(semCartao)
  }, [itens])

  return {
    carregando,
    erro,
    resultado: resumo.totais.resultado,
    entradas: resumo.totais.entradas,
    saidas: resumo.totais.saidas,
  }
}
