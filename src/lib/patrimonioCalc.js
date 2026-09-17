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

// Soma dos saldos das caixinhas ativas — assumida constante apenas quando
// não há histórico disponível. Quando há `caixinhaMovs` (histórico por data),
// o saldo é reconstruído por replay, igual às contas.
function somarCaixinhasConstante(caixinhas = []) {
  return (caixinhas || [])
    .filter((c) => c && c.ativa !== false)
    .reduce((s, c) => s + Number(c.saldo || 0), 0)
}

function saldoCaixinhaEmData(caixinha, movimentos = [], dataAlvo) {
  // Se não há histórico, assume constante (limitação antiga)
  if (!movimentos || movimentos.length === 0) {
    if (caixinha.criado_em && String(caixinha.criado_em).slice(0, 10) > String(dataAlvo)) return 0
    return Number(caixinha.saldo || 0)
  }
  // Com histórico, verifica se a caixinha já existia na dataAlvo:
  // existe se há algum movimento com data <= dataAlvo, ou se dataAlvo >= criado_em
  const temMovAteData = movimentos.some((m) => String(m.data) <= String(dataAlvo))
  const existePorCriacao = !caixinha.criado_em || String(caixinha.criado_em).slice(0, 10) <= String(dataAlvo)
  if (!temMovAteData && !existePorCriacao) {
    // Nenhum movimento até a data e ainda não criada → não existia
    // Para o caso de migração (criado_em 2026-08-20 mas movimentos desde fev),
    // temMovAteData será true para 2024? Não, 2024 < fev/2026, então false, e
    // existePorCriacao false para 2024, então retorna 0 — correto para 2024.
    return 0
  }
  // Replay a partir do saldo atual, revertendo movimentos com data > dataAlvo
  let saldo = Number(caixinha.saldo || 0)
  for (const m of movimentos) {
    if (String(m.data) > String(dataAlvo)) {
      const delta = Number(m.valor)
      if (m.tipo === 'guardar' || m.tipo === 'rendimento') saldo -= delta
      else if (m.tipo === 'resgatar' || m.tipo === 'taxa') saldo += delta
    }
  }
  return Math.round(Math.max(0, saldo) * 100) / 100
}

function somarCaixinhasEmData(caixinhas = [], porCaixinha = new Map(), dataAlvo) {
  let total = 0
  for (const c of caixinhas || []) {
    if (!c || c.ativa === false) continue
    const movs = porCaixinha.get(c.id) || []
    total += saldoCaixinhaEmData(c, movs, dataAlvo)
  }
  return Math.round(total * 100) / 100
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
// Corte real de confiabilidade: Saída só existe a partir de 2026-06-02
// (primeira Saida em planejamentos). Antes disso, só Entrada (histórico de
// renda), sem despesa, então não há como calcular patrimônio líquido real.
// Não confundir com 2026-01-01 (início de movimentacoes) — o corte para
// patrimônio é 2026-06-02.
const CORTE_HISTORICO = '2026-06-02'

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

export function patrimonioEmData({ contas = [], caixinhas = [], movimentacoes = [], historico = [], caixinhaMovs = [], dataAlvo, coberturaMinima }) {
  const contasAtivas = (contas || []).filter((c) => c && c.ativa)
  // Para caixinhas, tenta replay histórico se houver movimentos, senão constante
  const porCaixinha = new Map()
  for (const c of caixinhas || []) porCaixinha.set(c.id, [])
  for (const m of caixinhaMovs || []) {
    if (!m || !m.caixinha_id) continue
    if (!porCaixinha.has(m.caixinha_id)) continue
    porCaixinha.get(m.caixinha_id).push(m)
  }
  const caixa = caixinhas && caixinhaMovs && caixinhaMovs.length > 0
    ? somarCaixinhasEmData(caixinhas, porCaixinha, dataAlvo)
    : somarCaixinhasConstante(caixinhas)

  // Histórico puro (antes do corte): a melhor estimativa sem snapshot é o
  // fluxo acumulado do histórico DENTRO do período, ancorado no caixa, não o
  // fluxo desde 2021 (que daria 491k). Para um mês como dez/2025 com 4
  // lançamentos (9720), o patrimônio vai de caixa (3253) até caixa+9720
  // (12973), variação correta e magnitude em milhares, coerente com ago/2026.
  // Isso evita o salto de meio milhão que vinha da soma desde 2021.
  const ehHistoricoPuro = String(dataAlvo) < CORTE_HISTORICO
  if (ehHistoricoPuro) {
    // Soma só do histórico DENTRO do período que contém dataAlvo, a partir do
    // início do período histórico que está sendo consultado. Como não temos o
    // saldo inicial real de 2021, usamos caixa como base e somamos só o que
    // aconteceu dentro da janela do período em questão. Para simplificar, aqui
    // usamos o histórico até dataAlvo mas subtraímos o histórico antes do
    // início do histórico total (aproximação: variação dentro do período).
    // Na prática, para um ponto isolado sem contexto de período, usamos só o
    // histórico até ele, mas o gráfico de um mês usará pontos relativos ao
    // início do mês, então a variação mensal fica correta.
    const histAteData = somarHistoricoAteData(historico, dataAlvo)
    // Para não explodir, normalizamos pelo histórico até o corte, mas como
    // não temos o saldo inicial, mantemos a soma a partir de zero mas com
    // magnitude reduzida: subtraímos o histórico até 2021-01-01 (zero) é o mesmo,
    // então mantemos mas documentamos como aproximação.
    // A correção real para magnitude é usar o período: o ponto inicial do
    // período histórico deve ser caixa, não 491k. Vamos tratar no
    // calcularEvolucaoPatrimonio para períodos históricos puros, onde o
    // patrimônioInicial será o primeiro ponto (caixa + primeiro hist), e a
    // variação será só dentro do período.
    return Math.round((histAteData + caixa) * 100) / 100
  }

  // Para o replay unificado, juntamos histórico (antes do corte) e vivo
  // (a partir do corte) num único conjunto e fazemos saldoAtual - efeito(depois).
  // O histórico já está embutido no saldoAtual? Não — o saldo atual de 2026
  // reflete só o vivo (movimentacoes), não o histórico de 2021-2025. Por isso,
  // para datas antes do corte, o histórico precisa ser tratado como parte do
  // efeito "depois" também, mas como o saldoAtual não o contém, precisamos de
  // uma base histórica. A forma mais simples e que mantém a magnitude em 3k é:
  // para datas < corte, o patrimônio é caixa + efeito do histórico até a data
  // (aproximação), mas normalizado para não explodir. Como o histórico é só
  // Entrada (390) e representa fluxo acumulado, normalizamos subtraindo o
  // histórico total até o corte, para que o valor em 2025-12-31 fique próximo
  // do valor em 2026-01-01 (continuidade).
  if (String(dataAlvo) < CORTE_HISTORICO) {
    // Histórico puro: variação dentro do período histórico, mas ancorado no
    // patrimônio do corte (2026-01-01) para não ficar em 500k. Calcula o
    // patrimônio no corte via vivo e depois ajusta pela variação histórica
    // dentro do período histórico.
    const patrimonioNoCorte = (() => {
      // Saldo no corte (2026-01-01) via vivo
      let tot = 0
      let algumNullCorte = false
      const porContaCorte = new Map()
      for (const c of contasAtivas) porContaCorte.set(c.id, [])
      for (const m of movimentacoes || []) {
        if (!m || !m.conta_id) continue
        if (!porContaCorte.has(m.conta_id)) continue
        porContaCorte.get(m.conta_id).push(m)
      }
      for (const conta of contasAtivas) {
        const saldoAtual = Number(conta.saldo_atual || 0)
        const movs = porContaCorte.get(conta.id) || []
        const s = calcularSaldoReal({ saldoAtual, movimentacoes: movs, dataAlvo: CORTE_HISTORICO, coberturaMinima })
        if (s === null) { algumNullCorte = true; break }
        tot += s
      }
      if (algumNullCorte) return null
      return tot + caixa
    })()
    if (patrimonioNoCorte === null) return null
    // Variação histórica desde o início do histórico até dataAlvo, menos a
    // variação até o corte, para ancorar no corte
    const histAteData = somarHistoricoAteData(historico, dataAlvo)
    const histAteCorte = somarHistoricoAteData(historico, '2025-12-31')
    // Para datas em 2024, por exemplo, histAteData é menor que histAteCorte,
    // então (histAteData - histAteCorte) é negativo, e patrimonio será
    // patrimonioNoCorte + (negativo) = menor que o corte, o que faz sentido
    // (patrimônio em 2024 menor que em 2026).
    return Math.round((patrimonioNoCorte + (histAteData - histAteCorte)) * 100) / 100
  }

  if (contasAtivas.length === 0) {
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

// Granularidade do gráfico conforme o tipo de período.
// Simplificado 2026-09: Semana/Mês/Personalizado não têm gráfico (só
// início/fim/variação). Trimestre/Ano têm gráfico mês a mês.
export function granularidadePatrimonio(tipoPeriodo) {
  if (tipoPeriodo === 'semana') return null // sem gráfico, só resumo
  if (tipoPeriodo === 'mes') return null
  if (tipoPeriodo === 'trimestre') return 'mes'
  if (tipoPeriodo === 'semestre') return 'mes'
  if (tipoPeriodo === 'ano') return 'mes'
  // personalizado: por ora, sem gráfico (mesmo que Mês)
  return null
}

// Gera os pontos do gráfico + lista detalhada para o período.
// Cada ponto é o patrimônio no FIM do bucket (ex.: fim do dia, fim da semana,
// fim do mês). Usa o replay por data, sem snapshot.
export function calcularEvolucaoPatrimonio({
  contas = [],
  caixinhas = [],
  movimentacoes = [],
  historico = [],
  caixinhaMovs = [],
  periodo, // { tipo, inicio, fim }
  coberturaMinima,
}) {
  if (!periodo?.inicio || !periodo?.fim) {
    return { pontos: [], patrimonioAtual: null, patrimonioInicial: null, variacao: null, variacaoPercentual: null, inicioAjustado: null }
  }

  // Corte de confiabilidade: antes de 2026-06-02 só há Entrada no histórico,
  // sem Saída, então não há patrimônio líquido real.
  // Corte de confiabilidade: antes de 2026-06-02 só há Entrada no histórico,
  // sem Saida, então não há patrimônio líquido real.
  if (periodo.fim < CORTE_HISTORICO) {
    return {
      pontos: [],
      patrimonioAtual: null,
      patrimonioInicial: null,
      variacao: null,
      variacaoPercentual: null,
      granularidade: null,
      semDados: true,
      motivoSemDados: 'Sem dado suficiente para calcular patrimônio antes de junho/2026',
    }
  }
  let periodoEfetivo = periodo
  let inicioAjustado = null
  if (periodo.inicio < CORTE_HISTORICO && periodo.fim >= CORTE_HISTORICO) {
    // Período cruza o corte: considera só a parte a partir do corte
    periodoEfetivo = { ...periodo, inicio: CORTE_HISTORICO }
    inicioAjustado = CORTE_HISTORICO
  }

  const granularidade = granularidadePatrimonio(periodoEfetivo.tipo)

  // Para personalizado, por ora sem gráfico (mesmo que Mês)
  let gran = granularidade
  // (mantido para compatibilidade, mas personalizado agora retorna null)

  const pontos = []
  const inicio = periodoEfetivo.inicio
  const fim = periodoEfetivo.fim

  // Para períodos totalmente no histórico puro (antes do corte), o patrimônio
  // absoluto desde 2021 explode (500k). Para manter a magnitude em milhares e
  // mostrar só a variação DENTRO do período, usamos base = caixa NA DATA de
  // início do período (via saldoCaixinhaEmData) e somamos só o histórico dentro
  // da janela. Isso mantém Dec 2025 com variação 9720 mas base correta (0 se a
  // caixinha ainda não existia, como em dez/2025 onde APê foi criada só em
  // fev/2026, então 0→9720 em vez de 3253→12973).
  const ehPeriodoHistoricoPuro = fim < CORTE_HISTORICO
  // Para histórico puro, a base de caixinhas deve ser a do início do período,
  // não a atual, para não mostrar R$3.253 em anos onde a caixinha nem existia.
  const baseHistoricoPuro = ehPeriodoHistoricoPuro
    ? (() => {
        const porCaixinha = new Map()
        for (const c of caixinhas || []) porCaixinha.set(c.id, [])
        for (const m of caixinhaMovs || []) {
          if (!m || !m.caixinha_id) continue
          if (!porCaixinha.has(m.caixinha_id)) continue
          porCaixinha.get(m.caixinha_id).push(m)
        }
        // Usa a data de início do período para a base
        let total = 0
        for (const c of caixinhas || []) {
          if (!c || c.ativa === false) continue
          const movs = porCaixinha.get(c.id) || []
          total += saldoCaixinhaEmData(c, movs, inicio)
        }
        return Math.round(total * 100) / 100
      })()
    : null
  const histNoPeriodo = ehPeriodoHistoricoPuro
    ? (historico || []).filter((h) => h && h.data_prevista >= inicio && h.data_prevista <= fim)
    : null

  if (gran === null) {
    // Semana/Mês/Personalizado: sem gráfico, só início e fim (ou hoje se período não terminou)
    const hojeLimite = new Date().toISOString().slice(0, 10)
    const inicioEfetivo = inicio
    const fimEfetivo = fim > hojeLimite ? hojeLimite : fim
    if (inicioEfetivo > hojeLimite) {
      // Período futuro inteiro: sem pontos
    } else {
      const patrimonioInicio = ehPeriodoHistoricoPuro
        ? (() => {
            // Para histórico puro, início não tem histórico ainda, só caixa
            let acc = 0
            const histInicio = (histNoPeriodo || []).filter((h) => String(h.data_prevista) === inicioEfetivo)
            for (const h of histInicio) acc += Number(h.valor) * (h.tipo_op === 'Saida' ? -1 : 1)
            return Math.round((baseHistoricoPuro + acc) * 100) / 100
          })()
        : patrimonioEmData({ contas, caixinhas, movimentacoes, historico, caixinhaMovs, dataAlvo: inicioEfetivo, coberturaMinima })
      const patrimonioFim = ehPeriodoHistoricoPuro
        ? (() => {
            let acc = 0
            for (const h of histNoPeriodo || []) {
              if (String(h.data_prevista) >= inicioEfetivo && String(h.data_prevista) <= fimEfetivo) {
                acc += Number(h.valor) * (h.tipo_op === 'Saida' ? -1 : 1)
              }
            }
            return Math.round((baseHistoricoPuro + acc) * 100) / 100
          })()
        : patrimonioEmData({ contas, caixinhas, movimentacoes, historico, caixinhaMovs, dataAlvo: fimEfetivo, coberturaMinima })
      pontos.push({ data: inicioEfetivo, patrimonio: patrimonioInicio })
      if (fimEfetivo !== inicioEfetivo) {
        pontos.push({ data: fimEfetivo, patrimonio: patrimonioFim })
      }
    }
  } else if (gran === 'dia') {
    // Diário: um ponto por data civil no período (usado agora só se granularidade for dia, mas com novo spec, dia só para casos legados)
    let cur = inicio
    // Para histórico puro, acumula só dentro do período
    let acumuladoHist = 0
    const histPorData = new Map()
    if (ehPeriodoHistoricoPuro) {
      for (const h of histNoPeriodo || []) {
        const d = String(h.data_prevista)
        const v = Number(h.valor) * (h.tipo_op === 'Saida' ? -1 : 1)
        histPorData.set(d, (histPorData.get(d) || 0) + v)
      }
    }
    while (cur <= fim) {
      let patrimonio
      if (ehPeriodoHistoricoPuro) {
        if (histPorData.has(cur)) acumuladoHist += histPorData.get(cur)
        patrimonio = Math.round((baseHistoricoPuro + acumuladoHist) * 100) / 100
      } else {
        patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, caixinhaMovs, dataAlvo: cur, coberturaMinima })
      }
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
    // Para histórico puro, acumula só dentro do período
    let acumuladoHistSemana = 0
    const histSemanaPorData = new Map()
    if (ehPeriodoHistoricoPuro) {
      for (const h of histNoPeriodo || []) {
        const d = String(h.data_prevista)
        const v = Number(h.valor) * (h.tipo_op === 'Saida' ? -1 : 1)
        histSemanaPorData.set(d, (histSemanaPorData.get(d) || 0) + v)
      }
    }
    while (semanaInicio <= fim) {
      const sem = semanaIso(semanaInicio)
      const pontoData = sem.fim <= fim ? sem.fim : fim
      // Evita duplicatas quando o período termina no meio da semana
      if (pontos.length === 0 || pontos[pontos.length - 1].data !== pontoData) {
        let patrimonio
        if (ehPeriodoHistoricoPuro) {
          // Soma histórico dentro do período até pontoData
          for (let d = semanaInicio; d <= pontoData; ) {
            if (histSemanaPorData.has(d)) acumuladoHistSemana += histSemanaPorData.get(d)
            if (d === pontoData) break
            const [a,m,dd]=d.split('-').map(Number)
            d = new Date(Date.UTC(a,m-1,dd)+86_400_000).toISOString().slice(0,10)
          }
          patrimonio = Math.round((baseHistoricoPuro + acumuladoHistSemana) * 100) / 100
        } else {
          patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, caixinhaMovs, dataAlvo: pontoData, coberturaMinima })
        }
        pontos.push({ data: pontoData, patrimonio })
      }
      // próxima segunda
      const [a, m, d] = sem.fim.split('-').map(Number)
      const ts = Date.UTC(a, m - 1, d) + 86_400_000
      semanaInicio = new Date(ts).toISOString().slice(0, 10)
    }
    // Garante que o último ponto é exatamente o fim do período se não for domingo
    if (pontos.length > 0 && pontos[pontos.length - 1].data !== fim) {
      let patrimonio
      if (ehPeriodoHistoricoPuro) {
        // Já acumulado até o último ponto, só precisa incluir histórico entre último e fim se houver
        patrimonio = Math.round((baseHistoricoPuro + acumuladoHistSemana) * 100) / 100
      } else {
        patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, caixinhaMovs, dataAlvo: fim, coberturaMinima })
      }
      pontos.push({ data: fim, patrimonio })
    }
    if (pontos.length === 0) {
      const patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, caixinhaMovs, dataAlvo: fim, coberturaMinima })
      pontos.push({ data: fim, patrimonio })
    }
  } else {
    // Mensal: um ponto por fim de mês dentro do período
    const [anoInicio, mesInicio] = inicio.split('-').map(Number)
    const [anoFim, mesFim] = fim.split('-').map(Number)
    let ano = anoInicio
    let mes = mesInicio
    // Para histórico puro, acumula mensalmente
    let acumuladoHistMensal = 0
    const histMensalPorMes = new Map()
    if (ehPeriodoHistoricoPuro) {
      for (const h of histNoPeriodo || []) {
        const mesKey = String(h.data_prevista).slice(0,7)
        const v = Number(h.valor) * (h.tipo_op === 'Saida' ? -1 : 1)
        histMensalPorMes.set(mesKey, (histMensalPorMes.get(mesKey) || 0) + v)
      }
    }
    while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
      const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
      const pontoData = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
      // Só inclui se estiver dentro do período
      const dataEfetiva = pontoData > fim ? fim : pontoData
      const dataInicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`
      if (dataEfetiva >= inicio && dataEfetiva <= fim) {
        if (pontos.length === 0 || pontos[pontos.length - 1].data !== dataEfetiva) {
          let patrimonio
          if (ehPeriodoHistoricoPuro) {
            const mesKey = `${ano}-${String(mes).padStart(2,'0')}`
            if (histMensalPorMes.has(mesKey)) acumuladoHistMensal += histMensalPorMes.get(mesKey)
            patrimonio = Math.round((baseHistoricoPuro + acumuladoHistMensal) * 100) / 100
          } else {
            patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, caixinhaMovs, dataAlvo: dataEfetiva, coberturaMinima })
          }
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
      let patrimonio
      if (ehPeriodoHistoricoPuro) {
        patrimonio = Math.round((baseHistoricoPuro + acumuladoHistMensal) * 100) / 100
      } else {
        patrimonio = patrimonioEmData({ contas, caixinhas, movimentacoes, historico, caixinhaMovs, dataAlvo: fim, coberturaMinima })
      }
      // Se já existe ponto com mesmo fim, substitui
      if (pontos.length > 0 && pontos[pontos.length - 1].data === fim) {
        pontos[pontos.length - 1].patrimonio = patrimonio
      } else {
        pontos.push({ data: fim, patrimonio })
      }
    }
  }

  // Corta exibição no futuro: se o período vai além de hoje, mostra só até hoje
  // (pontos futuros seriam repetição do valor atual, sem informação real).
  const hojeLimite = new Date().toISOString().slice(0, 10)
  const fimEfetivo = fim > hojeLimite ? hojeLimite : fim
  // Se o período inteiro está no futuro, não há dado real
  if (inicio > hojeLimite) {
    return { pontos: [], patrimonioAtual: null, patrimonioInicial: null, variacao: null, variacaoPercentual: null, granularidade: gran }
  }
  // Filtra pontos além de hoje (quando o período se estende no futuro)
  const pontosAteHoje = pontos.filter((p) => p.data <= hojeLimite)
  const pontosValidos = pontosAteHoje.filter((p) => p.patrimonio !== null)

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


