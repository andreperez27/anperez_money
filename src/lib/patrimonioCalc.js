// ============================================================================
// PATRIMÔNIO — cálculo unificado e evolução no período
// ============================================================================
// Patrimônio total = saldo das contas ativas (Nubank PF + PJ) + saldo das
// caixinhas ativas. Este é o ÚNICO ponto de cálculo do app — tanto o card da
// página Contas Correntes quanto o relatório Patrimônio consomem daqui, para
// não haver duas versões divergindo.
//
// Evolução no tempo: replay cronológico dos lançamentos REALIZADOS em conta
// (entradas/saídas via movimentacoes, mesma fonte do extrato) somado ao valor
// das caixinhas em cada ponto. Não há tabela de snapshot de patrimônio —
// o histórico é reconstruído a partir do saldo_atual + efeito reverso das
// movimentações, igual ao que `calcularSaldoReal` já faz para o Planejamento.
//
// LIMITAÇÃO CONHECIDA (caixinhas): `caixinha_movimentacoes` existe (guardar /
// resgatar / rendimento / taxa) mas o app ainda não tem busca consolidada de
// histórico por período para todas as caixinhas de forma confiável, e o valor
// isolado de cada caixinha antes do primeiro movimento não é rastreável sem
// snapshot. Para não travar a entrega, o valor atual de cada caixinha ativa
// é assumido como CONSTANTE retroativamente em toda a janela. Ou seja, a
// variação do patrimônio no gráfico reflete 100% a movimentação das CONTAS;
// os aportes/resgates de caixinha aparecem apenas como movimentações na conta
// (Saída "Guardado na caixinha X" / Entrada "Resgate da caixinha X"), mas o
// saldo da caixinha em si não varia no retrovisor. Quando houver histórico
// confiável de caixinha por data, basta trocar `somarCaixinhasConstante` por
// replay de `caixinha_movimentacoes` por ponto.
// ============================================================================

import { calcularSaldoReal } from './saldoProjetado.js'
import { somarEfeito } from './extratoCalc.js'
import { semanaIso } from './semana.js'

// Soma dos saldos das caixinhas ativas — assumida constante (limitação acima).
function somarCaixinhasConstante(caixinhas = []) {
  return (caixinhas || [])
    .filter((c) => c && c.ativa !== false) // ativa ausente = considerar ativa (compat. legada)
    .reduce((s, c) => s + Number(c.saldo || 0), 0)
}

// Patrimônio ATUAL (ponto único) — usado pelo card de Contas Correntes e pelo
// resumo do relatório (data final do período).
export function calcularPatrimonioAtual(contas = [], caixinhas = []) {
  const saldoContas = (contas || [])
    .filter((c) => c && c.ativa)
    .reduce((s, c) => s + Number(c.saldo_atual || 0), 0)
  return saldoContas + somarCaixinhasConstante(caixinhas)
}

// Patrimônio em uma data específica (reconstrução). Reaproveita
// `calcularSaldoReal` por conta (mesma regra do Planejamento) e soma caixinhas
// constantes. Se a data for anterior à cobertura, devolve null (mesma semântica
// do Planejamento: UI mostra "—").
// Para datas antes de 2026-01-01, o replay usa o histórico migrado
// (planejamentos com origem historico_*), pois movimentacoes só existe a partir
// de jan/2026. O corte evita contar em dobro o que já está em movimentacoes.
const CORTE_HISTORICO = '2026-01-01'

function somarHistoricoAteData(historico = [], dataAlvo) {
  let total = 0
  for (const h of historico || []) {
    if (!h || !h.data_prevista || !h.valor) continue
    if (String(h.data_prevista) > String(dataAlvo)) continue
    if (h.estado !== 'realizado') continue
    const v = Number(h.valor)
    if (h.tipo_op === 'Entrada') total += v
    else if (h.tipo_op === 'Saida') total -= v
  }
  return total
}

export function patrimonioEmData({ contas = [], caixinhas = [], movimentacoes = [], historico = [], dataAlvo, coberturaMinima }) {
  const contasAtivas = (contas || []).filter((c) => c && c.ativa)
  const caixa = somarCaixinhasConstante(caixinhas)

  // Para qualquer data, o patrimônio é o saldo atual (que já embute todo o
  // histórico, pois o saldo bancário de hoje reflete tudo) menos o efeito das
  // movimentações com data > dataAlvo. Para datas antes do corte, o histórico
  // entra no mesmo conjunto, mas como o saldo atual não contém o histórico
  // anterior a 2026 de forma isolada, usamos o histórico como aproximação:
  // se a data é antes do primeiro movimento vivo, o replay do histórico a
  // partir de zero é a melhor estimativa (limitação: sem saldo inicial real).
  // Para datas >= corte, o histórico já está embutido no saldoAtual via
  // movimentacoes? Não — o saldo atual de 2026 não contém o histórico de 2021-
  // 2025, então somar histórico daria dupla contagem. Por isso, para datas
  // >= corte, usamos só movimentacoes; para datas < corte, usamos só histórico.
  const ehHistoricoPuro = String(dataAlvo) < CORTE_HISTORICO

  if (ehHistoricoPuro) {
    // Período puro histórico: soma cumulativa do histórico até a data + caixinhas.
    // É uma aproximação (sem saldo inicial real), mas garante variação correta
    // no gráfico para esses períodos antigos. O valor absoluto não é o saldo
    // bancário real da época, e sim o fluxo acumulado — sinalizado no código.
    const histAteData = somarHistoricoAteData(historico, dataAlvo)
    return Math.round((histAteData + caixa) * 100) / 100
  }

  if (contasAtivas.length === 0) {
    // Sem contas ativas, só histórico + caixinhas (caso raro)
    const histAteData = somarHistoricoAteData(historico, dataAlvo)
    return Math.round((histAteData + caixa) * 100) / 100
  }

  let total = 0
  let algumNull = false

  const porConta = new Map()
  for (const c of contasAtivas) porConta.set(c.id, [])
  for (const m of movimentacoes || []) {
    if (!m || !m.conta_id) continue
    if (!porConta.has(m.conta_id)) continue
    porConta.get(m.conta_id).push(m)
  }

  for (const conta of contasAtivas) {
    const saldoAtual = Number(conta.saldo_atual || 0)
    const movs = porConta.get(conta.id) || []
    const saldoNaData = calcularSaldoReal({
      saldoAtual,
      movimentacoes: movs,
      dataAlvo,
      coberturaMinima,
    })
    if (saldoNaData === null) {
      algumNull = true
      break
    }
    total += saldoNaData
  }

  if (algumNull) return null
  total += caixa
  return Math.round(total * 100) / 100
}

// Granularidade do gráfico conforme o tipo de período (mesma decisão visual
// dos outros relatórios: detalhe diário para janelas curtas, agregação para
// janelas longas).
export function granularidadePatrimonio(tipoPeriodo) {
  if (tipoPeriodo === 'semana') return 'dia'
  if (tipoPeriodo === 'mes') return 'dia'
  if (tipoPeriodo === 'trimestre') return 'semana'
  if (tipoPeriodo === 'semestre') return 'mes'
  if (tipoPeriodo === 'ano') return 'mes'
  // personalizado: escolhe pela duração
  return 'dia'
}

// Gera os pontos do gráfico + lista detalhada para o período.
// Cada ponto é o patrimônio no FIM do bucket (ex.: fim do dia, fim da semana,
// fim do mês). Usa o replay por data, sem snapshot.
export function calcularEvolucaoPatrimonio({
  contas = [],
  caixinhas = [],
  movimentacoes = [],
  historico = [],
  periodo, // { tipo, inicio, fim }
  coberturaMinima,
}) {
  if (!periodo?.inicio || !periodo?.fim) {
    return { pontos: [], patrimonioAtual: null, patrimonioInicial: null, variacao: null, variacaoPercentual: null }
  }

  const granularidade = granularidadePatrimonio(periodo.tipo)

  // Para personalizado, decide pela duração em dias
  let gran = granularidade
  if (periodo.tipo === 'personalizado') {
    const dias = Math.round((Date.UTC(...periodo.fim.split('-').map(Number)) - Date.UTC(...periodo.inicio.split('-').map(Number))) / 86_400_000) + 1
    if (dias <= 31) gran = 'dia'
    else if (dias <= 92) gran = 'semana'
    else gran = 'mes'
  }

  const pontos = []
  const inicio = periodo.inicio
  const fim = periodo.fim

  if (gran === 'dia') {
    // Diário: um ponto por data civil no período
    let cur = inicio
    while (cur <= fim) {
      const patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, dataAlvo: cur, coberturaMinima })
      pontos.push({ data: cur, patrimonio })
      // próximo dia
      const [a, m, d] = cur.split('-').map(Number)
      const ts = Date.UTC(a, m - 1, d) + 86_400_000
      cur = new Date(ts).toISOString().slice(0, 10)
    }
  } else if (gran === 'semana') {
    // Semanal: bucket por semana ISO (segunda a domingo), patrimônio no domingo
    const primeiraSemana = semanaIso(inicio)
    let semanaInicio = primeiraSemana.inicio
    while (semanaInicio <= fim) {
      const sem = semanaIso(semanaInicio)
      const pontoData = sem.fim <= fim ? sem.fim : fim
      // Evita duplicatas quando o período termina no meio da semana
      if (pontos.length === 0 || pontos[pontos.length - 1].data !== pontoData) {
        const patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, dataAlvo: pontoData, coberturaMinima })
        pontos.push({ data: pontoData, patrimonio })
      }
      // próxima segunda
      const [a, m, d] = sem.fim.split('-').map(Number)
      const ts = Date.UTC(a, m - 1, d) + 86_400_000
      semanaInicio = new Date(ts).toISOString().slice(0, 10)
    }
    // Garante que o último ponto é exatamente o fim do período se não for domingo
    if (pontos.length > 0 && pontos[pontos.length - 1].data !== fim) {
      const patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, dataAlvo: fim, coberturaMinima })
      pontos.push({ data: fim, patrimonio })
    }
    if (pontos.length === 0) {
      const patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, dataAlvo: fim, coberturaMinima })
      pontos.push({ data: fim, patrimonio })
    }
  } else {
    // Mensal: um ponto por fim de mês dentro do período
    const [anoInicio, mesInicio] = inicio.split('-').map(Number)
    const [anoFim, mesFim] = fim.split('-').map(Number)
    let ano = anoInicio
    let mes = mesInicio
    while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
      const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
      const pontoData = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
      // Só inclui se estiver dentro do período
      const dataEfetiva = pontoData > fim ? fim : pontoData
      const dataInicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`
      if (dataEfetiva >= inicio && dataEfetiva <= fim) {
        if (pontos.length === 0 || pontos[pontos.length - 1].data !== dataEfetiva) {
          const patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, dataAlvo: dataEfetiva, coberturaMinima })
          pontos.push({ data: dataEfetiva, patrimonio })
        }
      }
      mes++
      if (mes > 12) {
        mes = 1
        ano++
      }
      // Evita loop infinito quando o último mês já foi processado e pontoData > fim
      if (pontos.length > 0 && pontos[pontos.length - 1].data === fim) break
      if (ano > anoFim + 1) break
    }
    // Garante ponto final
    if (pontos.length === 0 || pontos[pontos.length - 1].data !== fim) {
      const patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, dataAlvo: fim, coberturaMinima })
      // Se já existe ponto com mesmo fim, substitui
      if (pontos.length > 0 && pontos[pontos.length - 1].data === fim) {
        pontos[pontos.length - 1].patrimonio = patrimonio
      } else {
        pontos.push({ data: fim, patrimonio })
      }
    }
  }

  // Remove pontos com patrimônio null (sem cobertura) — mantém só os válidos
  const pontosValidos = pontos.filter((p) => p.patrimonio !== null)

  if (pontosValidos.length === 0) {
    return { pontos: [], patrimonioAtual: null, patrimonioInicial: null, variacao: null, variacaoPercentual: null, granularidade: gran }
  }

  const patrimonioAtual = pontosValidos[pontosValidos.length - 1].patrimonio
  const patrimonioInicial = pontosValidos[0].patrimonio
  const variacao = Math.round((patrimonioAtual - patrimonioInicial) * 100) / 100
  const variacaoPercentual =
    patrimonioInicial !== 0 && patrimonioInicial !== null
      ? Math.round((variacao / Math.abs(patrimonioInicial)) * 10000) / 100
      : null

  return {
    pontos: pontosValidos,
    patrimonioAtual,
    patrimonioInicial,
    variacao,
    variacaoPercentual,
    granularidade: gran,
  }
}


