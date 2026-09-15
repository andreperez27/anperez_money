// ============================================================================
// SUGESTÃO DE CARTÃO PARA USAR HOJE — lib PURA (sem Supabase, testável).
// ============================================================================
// Usado no card de Cartões do Dashboard para distribuir gastos PF/PJ sem
// precisar entrar em cada fatura: recomenda o cartão que dá mais fôlego até o
// próximo vencimento, expondo o raciocínio (próximo fechamento + limite).
//
// Critério (decisão 15/09/2026):
//   • primário: a PRÓXIMA data de fechamento a partir de hoje — o cartão que
//     fecha MAIS TARDE ganha; a data é derivada do mes de fatura em que uma
//     compra feita HOJE cairia (calcularMesFatura, o mesmo espelho do backend,
//     já usado em faturaProjecao/relatorios — nada de comparação de zero);
//   • secundário (empate de MESMA data de fechamento): maior LIMITE DISPONÍVEL
//     primeiro (vem da RPC calcular_limite_disponivel, nunca recalculado aqui);
//   • com 0 ou 1 cartão comparável → null (nada a comparar; o card volta ao
//     comportamento atual).
//
// Contrato: recebe os cartões ativos como vieram do banco (com id, nome,
// dia_fechamento e limite nominal) e o map de limites disponíveis
// { [cartaoId]: numero } do hook — este arquivo é SÓ cálculo.
// ============================================================================

import { calcularMesFatura } from './faturaPlanejamento.js'

// Pad2 para montar datas YYYY-MM-DD a partir dos componentes.
function pad2(n) {
  return String(n).padStart(2, '0')
}

// Próxima data de fechamento (YYYY-MM-DD) de um dia de fechamento a partir de
// hoje. Reaproveita calcularMesFatura: 'hoje' cai no mês M da fatura → o
// fechamento a considerar é o MESMO (o que vem pela frente, já que hoje não
// ultrapassou o fechamento efetivo do mês M). Dia efetivo = clamp no último
// dia do mês (mesma regra do SQL de fechamento).
export function proximaDataFechamento(diaFechamento, hojeIso) {
  const [ano, mes] = calcularMesFatura(hojeIso, diaFechamento).split('-').map(Number)
  const ultimo = new Date(ano, mes, 0).getDate()
  const dia = Math.min(Number(diaFechamento), ultimo)
  return `${ano}-${pad2(mes)}-${pad2(dia)}`
}

// Quantos dias de calendário entre hoje e a data alvo (0 se for hoje).
export function diasEntreDatas(hojeIso, dataAlvoIso) {
  const emUTC = (iso) => {
    const [a, m, d] = iso.split('-').map(Number)
    return Date.UTC(a, m - 1, d)
  }
  return Math.round((emUTC(dataAlvoIso) - emUTC(hojeIso)) / 86400000)
}

// Ordena os cartões comparáveis pela próxima data de fechamento (mais tarde
// primeiro); empate de MESMA data → maior limite disponível primeiro. Devolve
// a lista com os campos auxiliares incorporados: proximaDataFechamento,
// diasAteFechamento e limiteDisponivel.
// Cartões sem dia_fechamento são ignorados na comparação (não têm data).
export function classificarCartoesParaHoje(cartoes, limites = {}, hojeIso) {
  return cartoes
    .filter((c) => c && c.dia_fechamento != null)
    .map((c) => {
      const prox = proximaDataFechamento(c.dia_fechamento, hojeIso)
      return {
        ...c,
        proximaDataFechamento: prox,
        diasAteFechamento: diasEntreDatas(hojeIso, prox),
        limiteDisponivel: Number(limites[c.id] ?? c.limite) || 0,
      }
    })
    .sort((a, b) => {
      if (a.proximaDataFechamento !== b.proximaDataFechamento) {
        return a.proximaDataFechamento > b.proximaDataFechamento ? -1 : 1
      }
      return b.limiteDisponivel - a.limiteDisponivel
    })
}

// Sugestão de cartão para comprar HOJE: o primeiro da classificação, ou null
// se não houver pelo menos 2 cartões comparáveis (nada a comparar).
export function sugerirCartaoParaHoje({ cartoes, limites = {}, hojeIso }) {
  const ordenados = classificarCartoesParaHoje(cartoes, limites, hojeIso)
  return ordenados.length >= 2 ? ordenados[0] : null
}