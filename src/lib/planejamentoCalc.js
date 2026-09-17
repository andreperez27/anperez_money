// Regras financeiras de agregação dos Planejamentos (ETAPA 06/E3).
// Função PURA: sem React, sem Supabase, sem semana — fácil de testar
// (padrão extratoCalc: lógica de números vive em lib, não em hooks).
//
// Semântica aprovada:
// - CANCELADO NÃO participa dos totais financeiros (preserva histórico,
//   mas deixa de ser previsão);
// - Contagens contam TODOS os registros por estado, independente dos
//   totais;
// - Resultado é FLUXO previsto (entradas - saídas) e nunca "saldo".
export function calcularResumoPlanejamentos(itens = []) {
  const totais = { entradas: 0, saidas: 0, resultado: 0 }
  const contagens = { previsto: 0, realizado: 0, cancelado: 0 }

  for (const item of itens) {
    // Contagem: todos os estados entram aqui.
    if (item.estado === 'previsto') contagens.previsto += 1
    else if (item.estado === 'realizado') contagens.realizado += 1
    else if (item.estado === 'cancelado') contagens.cancelado += 1

    // Totais: cancelado fica de fora das somas.
    if (item.estado === 'cancelado') continue

    const valor = Number(item.valor || 0)
    if (item.tipo_op === 'Entrada') totais.entradas += valor
    else if (item.tipo_op === 'Saida') totais.saidas += valor
  }

  totais.resultado = totais.entradas - totais.saidas
  return { totais, contagens }
}

// ----------------------------------------------------------------------------
// PERCENTUAL DE RENDA COMPROMETIDA (card da Visão Geral do Planejamento).
// Função PURA / testável. Recebe os itens do período — o MESMO array que passa
// em calcularResumoPlanejamentos (a página usa itensParaSomatorio) — e decide
// o cenário comparando inicio/fim do período com hoje (datas civis
// 'YYYY-MM-DD', comparação lexicográfica segura, mesma convenção do app):
//   • fechado (fim < hoje): TUDO que foi realizado no período — entradas
//     realizadas / despesas realizadas de qualquer origem (fixas, parceladas
//     E avulsas variáveis já lançadas).
//   • futuro (inicio > hoje): período nem começou — renda base = ENTRADAS
//     PREVISTAS do período inteiro (mesma base do card "Entradas previstas").
//   • atual (inicio <= hoje <= fim): o saldo real de HOJE já está na conta e
//     conta como recurso disponível (mesma fonte do card de saldo projetado)
//     MAIS as entradas ainda NÃO realizadas com data prevista entre hoje e o
//     fim do período. Entradas JÁ realizadas do período NÃO somam de novo —
//     elas já estão dentro do saldo real de hoje (duplicaria o valor).
//
// Comprometido (atual/futuro) = o valor PLANEJADO (previsto) das despesas
// comprometidas que caem no período — entram também os itens ainda 'previsto',
// não só os realizados. São comprometidas apenas:
//   - origem 'recorrente'  (despesa fixa mensal; a TABELA dos fixos é
//     despesa_recorrente_item, mas no planejamentos a origem é 'recorrente');
//   - origem 'fatura'      (fatura de cartão — direcionamento existente no
//     formulário de Planejamento; projeção de compras/parcelas entra pelo
//     valor previsto, sem esperar virar valor_real);
//   - serie_id preenchido  (parcela de série parcelada OU ocorrência de
//     série recorrente — compromisso contratual).
//   Avulsas variáveis ficam de fora (piso, não total).
// A fatura sintética nasce 'previsto' (específica de projeção), por isso NÃO
// entra no modo fechado — lá vale o que foi REALIZADO nas linhas (a fatura só
// conta no fechado se houver valor_real com estado 'realizado').
//
// Devolve { percentual, rendaBase, comprometidoBase, modo }, com modo =
// 'fechado' | 'atual' | 'futuro'. percentual é null quando não há base de
// renda (saldo real + entradas não-formam-base ou nenhuma entrada no futuro) —
// o card vira "sem dados suficientes neste período", sem divisão por zero.
// `saldoRealHoje` entra pronto (vem do MESMO hook do saldo projetado — a
// página não refaz a consulta). Cancelados nunca participam.
// ----------------------------------------------------------------------------
export function calcularRendaComprometida({
  itens = [],
  inicioISO,
  fimISO,
  hojeISO,
  saldoRealHoje = 0,
} = {}) {
  const inicio = String(inicioISO ?? '')
  const fim = String(fimISO ?? '')
  const hoje = String(hojeISO ?? '')
  const modo =
    fim && hoje && fim < hoje ? 'fechado' : inicio && inicio > hoje ? 'futuro' : 'atual'

  let rendaBase = 0
  let comprometidoBase = 0

  for (const item of itens) {
    if (!item || item.estado === 'cancelado') continue
    const valor = Number(item.valor || 0)

    if (item.tipo_op === 'Entrada') {
      if (modo === 'fechado') {
        if (item.estado === 'realizado') rendaBase += valor
      } else if (modo === 'futuro') {
        // Período inteiro previsto: todas as entradas não-canceladas formam a base.
        rendaBase += valor
      } else if (item.estado === 'previsto' && item.data_prevista >= inicio && item.data_prevista <= fim) {
        // atual: todas as entradas ainda NÃO realizadas no período — as
        // realizadas já estão dentro do saldo real de hoje; somá-las de novo
        // duplicaria. Inclui também as atrasadas (com data < hoje) que ainda
        // estão pendentes, pois ainda são renda esperada para o período.
        rendaBase += valor
      }
      continue
    }
    if (item.tipo_op !== 'Saida') continue

    if (modo === 'fechado') {
      if (item.estado === 'realizado') comprometidoBase += valor
    } else if (item.origem === 'recorrente' || item.origem === 'fatura' || !!item.serie_id) {
      comprometidoBase += valor
    }
  }

  // Período ATUAL: o saldo real de hoje entra como recurso disponível (contas
  // ativas, sem caixinha — mesma regra do card de saldo projetado).
  if (modo === 'atual') rendaBase += Number(saldoRealHoje || 0)

  if (!(rendaBase > 0)) {
    return { percentual: null, rendaBase, comprometidoBase, modo }
  }
  const percentual = Math.round((comprometidoBase / rendaBase) * 100)
  return { percentual, rendaBase, comprometidoBase, modo }
}
