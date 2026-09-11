// ============================================================================
// SALDO ACUMULADO PROJETADO — lib PURA (sem Supabase/React, testável).
// ============================================================================
// Estende o resultado ISOLADO de cada período do Planejamento: em vez de
// mostrar só "entradas − saídas daquela janela", revela a posição de caixa
// esperada (saldo acumulado) partindo do saldo REAL das contas hoje.
//
// Semântica (igual a planejamentoCalc.js):
//   • CANCELADO não participa do fluxo;
//   • Entrada soma, Saida subtrai; itens com valor 0 (ex.: marcador de férias)
//     não movem o saldo;
//   • os itens já devem vir sem o que duplica via fatura de cartão — ou seja,
//     o array `itens` deve ser o `itensParaSomatorio` de montarProjecao
//     (que exclui previstos/realizados de cartão que entram só via fatura).
//
// Devolve:
//   • serie   → [{ data, saldo }], o saldo ao final de cada DIA com movimento
//               (a sequência real, não a soma isolada de um período);
//   • saldoAoFim  → saldo acumulado no fim da faixa analisada.
//   • saldoAteData(serie, dataISO) → saldo acumulado até uma data específica
//               (o ponto do card "Saldo projetado" do período selecionado).
// ============================================================================

// Soma `dias` a uma data civil ISO (UTC), devolvendo 'YYYY-MM-DD'.
export function adicionarDiasISO(dataISO, dias) {
  const [ano, mes, dia] = String(dataISO).split('-').map(Number)
  const ts = Date.UTC(ano, mes - 1, dia) + dias * 86_400_000
  return ISODeUTC(ts)
}

export function ISODeUTC(ts) {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function compararISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

// Percorre os itens em ordem cronológica acumulando o saldo a partir de
// `saldoInicial`. Filtra pela faixa [inicioISO, fimISO] e ignora cancelados.
// `itens` pode vir fora de ordem — a função sempre ordena (determinístico).
export function calcularSaldoProjetado(saldoInicial, itens = [], { inicioISO, fimISO } = {}) {
  const inicio = inicioISO || ''
  const fim = fimISO || ''

  const ativos = (itens || [])
    .filter((i) => i.estado !== 'cancelado')
    .map((i) => ({ ...i, valor: Number(i.valor || 0) }))
    .filter((i) => (!inicio || i.data_prevista >= inicio) && (!fim || i.data_prevista <= fim))
    .sort((a, b) => compararISO(a.data_prevista, b.data_prevista))

  let saldo = Number(saldoInicial) || 0
  const serie = []
  for (const item of ativos) {
    if (item.tipo_op === 'Entrada') saldo += item.valor
    else if (item.tipo_op === 'Saida') saldo -= item.valor
    // evita duplicar datas na série: mantém o saldo da última vez do dia
    if (serie.length > 0 && serie[serie.length - 1].data === item.data_prevista) {
      serie[serie.length - 1].saldo = saldo
    } else {
      serie.push({ data: item.data_prevista, saldo: Math.round(saldo * 100) / 100 })
    }
  }

  return {
    serie,
    saldoAoFim: Math.round(saldo * 100) / 100,
    saldoAteData,
  }
}

// ---------------------------------------------------------------------------
// PROJEÇÃO A PARTIR DO SALDO REAL DE HOJE (série para o card "Saldo projetado")
// ---------------------------------------------------------------------------
// Corrige o bug 11/09/2026 (saldo projetado maior que o saldo real): antes a
// série reanimava a semana CORRENTE a partir da véspera (real da véspera +
// resultado previsto da semana). No MEIO da semana isso inflava o número:
// a base da véspera revertia as movimentações reais do início da semana (ex.:
// Padaria, Enel, pagamento de fatura), mas a série só devolvia à projeção o
// que existia no planejamento — as avulsas reais (sem item) ficavam "apagadas".
//
// Nova regra: a projeção para HOJE/FUTURO parte do saldo REAL de hoje e soma
// apenas os itens com data_prevista ESTRITAMENTE depois de hoje (o que já
// aconteceu já está embutido no saldo real atual; reanimar a véspera duplicava).
// Períodos passados continuam reconstruídos por calcularSaldoReal (um
// lançamento de hoje não retroage no número de ontem).
export function projetarSerie({ saldoAtual, itens = [], inicioISO, fimISO } = {}) {
  // Só o que ainda VAI acontecer (data_prevista > inicioISO). O restante do
  // filtro (cancelado, intervalo fim) e o acumulado ficam na lib base.
  const futuros = (itens || []).filter((i) => compararISO(i.data_prevista, inicioISO || '') > 0)
  return calcularSaldoProjetado(saldoAtual, futuros, { inicioISO: '', fimISO })
}

// Saldo acumulado até `dataISO` (inclusive). Se não houver marca na lista,
// devolve o saldoInicial (se data antes de tudo) ou o último saldo (se depois).
export function saldoAteData(serie = [], dataISO, saldoInicial = 0) {
  let resultado = Number(saldoInicial) || 0
  for (const m of serie) {
    if (compararISO(m.data, dataISO) <= 0) {
      resultado = m.saldo
    } else {
      break
    }
  }
  return resultado
}

// ---------------------------------------------------------------------------
// SALDO REAL DE UM DIA PASSADO (reconstrução para o card "Saldo projetado")
// ---------------------------------------------------------------------------
// Para um período JÁ encerrado (fim < hoje) não existe o que projetar
// partindo de hoje: o card deve mostrar o saldo de caixa REAL que existia ao
// fim do último dia do período. Reconstrução:
//
//   saldoReal(fim do dia D) = saldo atual das contas
//                           − efeito das movimentações com data > D
//
// `movimentacoes` deve vir com a MESMA regra de efeito de extratoCalc.somarEfeito
// (Entrada soma, Saída subtrai; transferência interna anula porque são duas
// linhas próprias) e já filtradas pelas contas que participam do cálculo.
// Se `dataAlvo` for anterior à cobertura da busca (`coberturaMinima`), não dá
// para reconstruir com segurança → devolve null (a UI mostra "—" em vez de
// inventar número).
// ============================================================================
export function calcularSaldoReal({ saldoAtual, movimentacoes = [], dataAlvo, coberturaMinima }) {
  if (coberturaMinima && compararISO(dataAlvo, coberturaMinima) < 0) return null
  let saldo = Number(saldoAtual) || 0
  for (const m of movimentacoes || []) {
    if (String(m.data) > dataAlvo) {
      saldo -= (m.tipo_op === 'Entrada' ? 1 : -1) * Number(m.valor)
    }
  }
  return Math.round(saldo * 100) / 100
}