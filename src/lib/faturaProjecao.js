// ============================================================================
// PROJEÇÃO DA FATURA NO PLANEJAMENTO — lib PURA (sem Supabase, testável).
// ============================================================================
// Orquestra a mesclagem entre os itens REAIS do Planejamento (tabela
// planejamentos) e as FATURAS projetadas (sintéticas). O objetivo principal é
// evitar a DUPLA CONTAGEM:
//
//   • Um planejamento 'previsto' com destino Cartão já soma como linha própria
//     na data dele (isso é o comportamento de calcularResumoPlanejamentos).
//   • Quando esse previsto é "absorvido" por uma fatura projetada do seu
//     (cartão, mes), ele NÃO pode continuar contando como linha solta — senão
//     o mesmo real é somado duas vezes no período.
//
// Solução:
//   • itensVisiveis     → TODOS os itens reais + faturas (para a timeline e a
//                         lista "Próximos lançamentos"). O previsto de cartão
//                         continua aparecendo como linha própria (a projeção
//                         é informativa, não substitui a linha).
//   • itensParaSomatorio → os itens que realmente participam do somatório:
//                         itensBase MENOS os previstos de cartão absorvidos
//                         MAIS as faturas projetadas (que já carregam o valor
//                         real + previsto). calcularResumoPlanejamentos fica
//                         INTOCADO e recebe só este array.
//
// REGRA-CHAVE do previsto de cartão:
//   Um planejamento 'previsto' com destino_padrao='cartao' NUNCA soma como
//   linha própria em itensParaSomatorio, seja qual for o período visualizado.
//   Ele só contribui pro total através da fatura (real ou projetada) do seu
//   (cartão, mês). Se essa fatura não aparece no período visível (vencimento
//   fora da faixa), o valor dele simplesmente NÃO conta nos totais desse
//   período — correto, pois nenhum dinheiro sai da conta nessa janela. Ele
//   continua aparecendo em itensVisiveis (timeline / "Próximos lançamentos")
//   com o badge "Cartão: [nome]", só não soma fora da fatura.
// ============================================================================

import { calcularMesFatura, montarItensFatura } from './faturaPlanejamento.js'
import { formatarData } from './compartilhados.js'

// Marcações de FÉRIAS viram itens marcadores sintéticos (R$ 0) na timeline.
// São avisos de DATA futura — não alteram valor semanal nem o somatório. Um
// marcador por INTERVALO (data_inicio), com o intervalo na descrição.
export function montarItensFerias(ferias = [], { inicioISO, fimISO } = {}) {
  const inicio = inicioISO || ''
  const fim = fimISO || ''
  const marcadores = []
  for (const f of ferias) {
    const data = f.data_inicio
    if ((inicio && data < inicio) || (fim && data > fim)) continue
    const intervalo =
      f.data_inicio === f.data_fim
        ? formatarData(f.data_inicio)
        : `${formatarData(f.data_inicio)} – ${formatarData(f.data_fim)}`
    marcadores.push({
      id: `ferias:${f.id}`,
      ferias: true,
      origem: 'ferias',
      tipo: 'ferias',
      tipo_op: 'Entrada',
      descricao: `Férias ${intervalo}`,
      valor: 0,
      data_prevista: data,
      estado: 'previsto',
      destina_padrao: null,
      serie_id: null,
      conta_id: null,
      categoria: null,
    })
  }
  return marcadores
}

export function montarProjecao({ itensBase, cartoes, faturasReais, inicioISO, fimISO, previstosCartaoExternos, ferias }) {
  const base = itensBase || []
  const cartoesLista = cartoes || []
  const cartaoPorId = new Map(cartoesLista.map((c) => [c.id, c]))
  // Também aceita cartões vindos de faturasReais (se cartoes não vier completo).
  for (const fr of faturasReais || []) {
    if (fr?.cartao?.id && !cartaoPorId.has(fr.cartao.id)) {
      cartaoPorId.set(fr.cartao.id, fr.cartao)
    }
  }

  // Separa os itens de destino CARTÃO (para agregar nas faturas, NUNCA somar
  // como linha própria) dos demais itens que realmente somam como saída direta.
  //
  // Regra do fluxo: QUALQUER planejamento direcionado ao cartão
  // (destino_padrao='cartao' — previsto OU realizado; o realizado em cartão
  // mantém esse campo via realizar_planejamento_cartao) NÃO conta como saída
  // de caixa aqui: a saída só acontece no PAGAMENTO da fatura do cartão. O
  // previsto de cartão entra via fatura projetada; o realizado de cartão já
  // está representado na fatura REAL (v_faturas, via faturasReais).
  const restantes = []
  const cartaoDoPeriodo = []
  const previstosCartaoDoPeriodo = []
  for (const item of base) {
    const ehCartao =
      item.destino_padrao === 'cartao' &&
      !!item.cartao_padrao_id &&
      cartaoPorId.has(item.cartao_padrao_id)
    if (ehCartao) {
      cartaoDoPeriodo.push(item)
      if (item.estado === 'previsto') previstosCartaoDoPeriodo.push(item)
    } else {
      restantes.push(item)
    }
  }

  // Fonte da PROJEÇÃO: os PREVISTOS de destino cartão do período (do itensBase)
  // SOMA os que vierem explicitamente por `previstosCartaoExternos` (todos os
  // previstos de cartão do usuário, fora da janela). Assim a fatura projetada,
  // que respeita o dia_fechamento e cai no mês do VENCIMENTO, aparece no período
  // em que o vencimento cai — mesmo que a compra prevista tenha data_prevista
  // noutra faixa (ex.: compra em agosto vencendo em setembro). Evita o furo de
  // a Projeção nunca aparecer quando compra e vencimento caem em períodos distintos.
  // Realizados de cartão NÃO entram aqui: já estão na fatura real.
  const previstosCartao = previstosCartaoDoPeriodo.slice()
  const idsJaIncluidos = new Set(previstosCartao.map((i) => i.id))
  for (const item of previstosCartaoExternos || []) {
    const ehPrevistoCartao =
      item.estado === 'previsto' &&
      item.destino_padrao === 'cartao' &&
      !!item.cartao_padrao_id &&
      cartaoPorId.has(item.cartao_padrao_id)
    // Evita duplicar um previsto que já chegou pelo itensBase do período.
    if (ehPrevistoCartao && !idsJaIncluidos.has(item.id)) {
      idsJaIncluidos.add(item.id)
      previstosCartao.push(item)
    }
  }

  // Agrega a soma dos previstos por (cartao_id, mes_fatura calculado).
  // A "data da compra" do previsto é a sua data_prevista (quando a parcela/compra
  // deverá ocorrer) — mesma referência que o modal "Lançar → Cartão" vai usar.
  // O mês de fatura respeita o dia_fechamento do cartão (calcularMesFatura).
  const previstosPorCartaoMes = {}
  for (const item of previstosCartao) {
    const cartao = cartaoPorId.get(item.cartao_padrao_id)
    const mes = calcularMesFatura(item.data_prevista, cartao.dia_fechamento)
    if (!previstosPorCartaoMes[item.cartao_padrao_id]) {
      previstosPorCartaoMes[item.cartao_padrao_id] = {}
    }
    previstosPorCartaoMes[item.cartao_padrao_id][mes] =
      (previstosPorCartaoMes[item.cartao_padrao_id][mes] || 0) + Number(item.valor || 0)
  }

  // Gera as faturas (uma por (cartao, mes)) do dado real + previstos, na faixa.
  const faturas = montarItensFatura({
    faturasReais,
    previstosPorCartaoMes,
    inicioISO,
    fimISO,
    cartoes: cartoesLista,
  })

  // Item de cartão NUNCA volta pro somatório como linha própria (seja previsto
  // ou realizado): se o seu (cartão, mes) gerou fatura na faixa, o valor entra
  // via fatura; se não gerou (vencimento fora da faixa), simplesmente não conta
  // neste período — dinheiro nenhum sai da conta nessa janela além do pagamento
  // da fatura. Para os realizados de cartão o valor já está na fatura REAL
  // (faturasReais/v_faturas), por isso também não voltam como linha.
  // Marcadores de FÉRIAS (R$ 0, somente indicativos) entram só no VISÍVEL —
  // não entram no somatório nem movem o saldo (valor 0 / não afetam o resumo).
  const marcadoresFerias = montarItensFerias(ferias || [], { inicioISO, fimISO })

  const itensVisiveis = [...base, ...marcadoresFerias, ...faturas].sort((a, b) =>
    a.data_prevista < b.data_prevista ? -1 : a.data_prevista > b.data_prevista ? 1 : 0,
  )
  const itensParaSomatorio = [...restantes, ...faturas].sort((a, b) =>
    a.data_prevista < b.data_prevista ? -1 : a.data_prevista > b.data_prevista ? 1 : 0,
  )

  return { itensVisiveis, itensParaSomatorio }
}
