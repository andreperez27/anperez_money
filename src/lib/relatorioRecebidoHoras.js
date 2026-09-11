// ============================================================================
// RELATÓRIO "RECEBIDO & HORAS" — agregação por mês/semana (primeira aba dos Relatórios)
// ============================================================================
// Lib PURA (sem React/Supabase/DOM): recebe os dados JÁ consultados e devolve
// os totais e as séries do período. O que a UI busca nas tabelas (os
// planejamentos realizados Entrada e o fixo semanal da config do Ponto) fica
// no hook useRelatorioRecebidoHoras; aqui somam-se os números.
//
// Contrato:
//   calcularRecebidoHoras({ planejamentosRealizados, fixoSemana, periodo, dataRealPorLancamento })
//     → {
//         totalRecebido, totalValorHorasExtras,
//         porMes:    [{ mes, recebido, valorHorasExtras }],
//         porData:   [{ data, recebido, valorHorasExtras }],
//         porSemana: [{ semana, recebido, valorHorasExtras }],
//         recebimentos: [{ data, semana, valor, valorHorasExtras, referente, descricao }],
//       }
//
//   • dataRealPorLancamento (opcional, correção 11/09/2026): mapa
//     { [lancamento_id]: 'YYYY-MM-DD' } com a data REAL da movimentação que o
//     pagamento gerou. Quando o item tem lancamento_id presente no mapa, a data
//     do recebimento (filtro do período, linha, bucket porData e semana civil)
//     é a data da movimentação real — NÃO a data_prevista (a data em que o
//     pagamento DEVERIA cair pode divergir do dia em que o dinheiro entrou; ex.:
//     Pagamento Semanal previsto 09/09 caiu de fato em 10/09). Sem o mapa
//     (histórico da planilha e lançamentos antigos, sem lancamento_id), vale a
//     data_prevista.
//
//   • porMes    agrupa por MÊS CIVIL do recebimento — a série do gráfico para
//     Trimestre/Semestre/Ano/Personalizado (barras por mês).
//   • porData   agrupa por DATA de recebimento (data_prevista) — a série do
//     gráfico da visão MÊS: UMA BARRA POR DIA, rótulo DD/MM; pagamentos da
//     MESMA data somam na mesma barra (03/07 × dois períodos → uma barra de
//     03/07). Nasce dos MESMOS recebimentos que a lista mostra logo abaixo,
//     então gráfico e lista nunca desalinham (bug 2 de 06/09/2026 — a barra da
//     semana civil que começava antes do dia 1º sumia do gráfico).
//   • porSemana agrupa por SEMANA CIVIL do recebimento (segunda-feira ISO) —
//     série AGREGADA mantida para compatibilidade/inspeção; NÃO alimenta mais
//     o gráfico da visão Mês.
//   • recebimentos é a LISTA DETALHADA: UMA LINHA POR PAGAMENTO REALIZADO
//     (estado='realizado', Entrada, valor>0, dentro do período) — mesmo que
//     dois pagamentos compartilhem a mesma semana_trabalho, cada um tem a
//     própria data de recebimento e o próprio valor (regra 06/09/2026: não se
//     funde linha). Ordenada pela data do recebimento.
//     - `data`    dia em que o dinheiro ENTROU de fato — a data REAL da
//       movimentação (via lancamento_id/dataRealPorLancamento) quando existir,
//       senão a data_prevista (correção 11/09/2026) — rótulo da linha;
//     - `semana`  segunda-feira ISO da semana civil do recebimento (serve para
//       o gráfico; a linha não é repartida na borda do mês — regra de sempre);
//     - `valor`   o valor do recebimento;
//     - `referente` segunda-feira ISO da semana de TRABALHO que o pagamento
//       cobre, lida das COLUNAS GRAVADAS ano_semana_trabalho/semana_trabalho
//       (migration 28 — preenchidas quando a série jornada nasce; NUNCA um
//       cálculo de "menos 7 dias" a partir da data do recebimento). Rótulo
//       informativo "referente ao período de X a Y"; null se as colunas
//       forem inválidas/ausentes (ex.: histórico da planilha);
//     - `descricao` descrição salva no lançamento — fallback de exibição
//       quando não há colunas de trabalho (o texto "referente a ..." da
//       planilha vive na descricao);
//     - `valorHorasExtras` fatia desta linha dos extras da semana de trabalho
//       — ver Regra de extras abaixo.
//
//   • planejamentosRealizados  lista de itens do Planejamento (origens manual,
//     jornada, recorrente, outro, historico_planilha). Só contam como Recebido:
//     tipo_op='Entrada', estado='realizado', valor > 0 e data_prevista DENTRO
//     do período — a lib aplica o filtro sozinha (defensiva). EXCLUSÕES de
//     origem explícitas (decisão 06/09/2026):
//       - 'historico_planilha' só conta antes de 24/08/2026 (a partir da
//         semana 34/2026 a fonte é o próprio app — regra 05/09/2026);
//       - 'historico_acordo' e 'historico_outros' NUNCA contam aqui — o Acordo
//         trabalhista tem aba própria e Outros não é pagamento de trabalho.
//     Cada item também PODE trazer `valor_semanal` (opcional): a coluna B
//     "VALOR SEMANAL" da planilha — o FIXO de referência da época (1.400 em
//     2025, 1.600 no início de 2026, 1.650 de março/2026 em diante). Só as
//     linhas origem 'historico_planilha' carregam (migration 30; backfill do
//     script de reconciliação). PODE trazer também `valor_extra_historico`
//     (migration 31): a coluna C "HorasExtras" da planilha — o excedente REAL
//     da semana, que o relatório usa DIRETO como extra, sem fórmula.
//   • fixoSemana                o valor fixo SEMANAL padrão do Ponto
//     (ponto_config.VALOR_FIXO_SEMANA, config.fixoSemana do usePonto) — a base
//     que a semana de trabalho normal paga. Serve de régua dos extras quando a
//     linha NÃO traz valor_semanal (os lançamentos do próprio app): o que o
//     recebimento passa do fixo é o extra. Default 0 → nenhum extra.
//   • periodo                  { tipo, inicio, fim } — mesmo formato que
//     periodos.js produz (mes/trimestre/semestre/ano/personalizado). Só
//     inicio/fim são usados; limites INCLUSIVOS.
//
// Regras de atribuição (ambas as grades usam a MESMA semântica do app e da
// planilha — e do dashboard "Recebimentos do mês" do app antigo, que agrupa
// por data_recebimento):
//   • porMes   → a chave é o MÊS CIVIL da data de recebimento (data_prevista):
//     o mês em que o dinheiro ENTROU decide o mês do relatório.
//   • porData  → a chave é a DATA CIVIL do recebimento (o dia em que o dinheiro
//     caiu na conta). Não há grade de semanas aqui: QUALQUER pagamento do
//     período vira barra na própria data, e a borda do mês não esconde
//     lançamento.
//   • porSemana→ a chave é a SEGUNDA-FEIRA ISO da semana CIVIL do recebimento
//     (a semana em que o dinheiro caiu na conta, não a em que o trabalho foi
//     feito). "O relatório mostra o que foi recebido na semana; o que foi
//     recebido na semana foi trabalho da semana ANTERIOR" (regra 05/09/2026).
//     As colunas de reconciliação ano_semana_trabalho/semana_trabalho NÃO
//     mudam o bucket: descrevem o trabalho atendido (o referente informativo).
//     A primeira semana do mês que começa ANTES do dia 1º fica de fora dessa
//     série (regra da não-repartição) — por isso porSemana não é mais o gráfico
//     da visão Mês.
//   • Uma semana não é repartida: pertence ao mês/semana do seu inicioISO.
//     Como a semana começa na SEGUNDA, a primeira semana de um mês que começa
//     meio da semana inicia no mês ANTERIOR e não aparece no mês/seleção; a
//     última semana que atravessa o fim vai inteira para o mês em que começa.
//
// REGRA DE EXTRAS (ajustada em 06/09/2026, decisão do André):
//   • O "extra" do relatório NÃO é mais o valorHe+valorDomfer do Ponto: é o
//     quanto o valor RECEBIDO passou do fixo padrão da semana:
//       extras da semana de trabalho W = max(0, Σ(valores dos pagamentos que
//       cobrem W) − fixoSemana)
//     Rote que as semanas normais já batem com o valor antigo: pagamento de
//     1.650 (= fixo) → extra 0; de 2.050 (fixo 1.650 + dom/fer 400) → extra
//     400. Nas semanas com FERIADO existe desconto no fixo (fixo/6 × 5, regra
//     do Ponto — regra 04/09/2026), então o bruto valorHe+valorDomfer
//     SUPERA o excedente real: recebido 1.800 → extra real 150 (1800 − 1650),
//     não 400. Só neste relatório; os cards do Ponto continuam como estão.
//   • Os extras aparecem NAS LINHAS dos pagamentos que cobrem W, enlaçados
//     pelo mesmo dado gravado: as colunas ano_semana_trabalho/semana_trabalho
//     (referente). Pagamento SEM colunas (histórico do seguro, netflix...)
//     não casa com semana → jamais ganha extra pela fórmula. DETALHE: o
//     histórico da planilha TEM o excedente GRAVADO (valor_extra_historico,
//     migration 31) — ele vira o extra DIRETO da linha, sem fórmula nem rateio.
//   • BASE HISTÓRICA (migration 30, decisão 06/09/2026): quando TODAS as
//     parcelas que cobrem W carregam `valor_semanal`, a base da semana é a
//     SOMA delas (junho parcelado: 825 + 825 = 1.650) e vale NO LUGAR do
//     fixoSemana da config. Se qualquer parcela não tiver (lançamentos do
//     próprio app), a base é o fixoSemana atual. Assim a semana de 05/01/2026
//     (paga 14/01) usa a base 1.600 da época → 2.760 − 1.600 = 1.160 (bate com
//     o Ponto), e não 1.110 (2.760 − 1.650 de hoje). A base histórica vale
//     apenas para as linhas SEM valor_extra_historico (a fórmula).
//   • Quando VÁRIOS pagamentos parcelam a mesma semana W (ex.: junho, parcelas
//     de 50%), o total de extras de W (Σ valores − fixo) é RATEADO de forma
//     proporcional ao valor de cada parcela: cada linha mostra a fatia do
//     pedaço que pagou. Soma das fatias == extra da semana; a semana conta UMA
//     única vez no total do mês/card/gráfico (nada duplica). O rateio vale só
//     na fórmula (linhas sem valor_extra_historico); linhas com o valor
//     gravado já trazem a fatia exata da fonte.
//   • Sem pagamento no período cobrindo W → não há onde mostrar (extras só
//     aparecem onde há a linha que os paga).
//
// Regras de apresentação:
//   • porMes/porData/porSemana trazem APENAS as entradas com algum dado
//     (recebido > 0 ou valorHorasExtras > 0), em ordem cronológica. Período
//     sem nenhum dado devolve porMes=[] (a página cai no estado "Em
//     construção" do template).
//   • recebimentos traz TODOS os pagamentos realizados do período (mesmo os da
//     borda cuja semana começa antes do mês — a lista não esconde movimento;
//     a grade do gráfico é que não reparte a semana).
//   • Não há segundos calendários: os limites de mês vêm de periodos.js
//     (definirPeriodo/deslocarPeriodo), a mesma fonte do seletor; a semana
//     compartilha a fonte única semana.js usada pelo módulo Planejamento.
// ============================================================================

import { definirPeriodo, deslocarPeriodo, validarFaixaDePeriodo } from './periodos.js'
import { semanaIso, inicioDaSemanaIso } from './semana.js'

function arre2(n) {
  return Math.round(n * 100) / 100
}

// Regra 05/09/2026 (com o André): a planilha preenche as lacunas dos anos
// ANTERIORES e de 2026 ATÉ a semana 34 — o primeiro lançamento digitado no
// app (24/08/2026, início da semana de trabalho 34). Registros com origem
// 'historico_planilha' e data a partir de 24/08/2026 NÃO contam como recebido
// — de lá em diante a fonte é o próprio app (registros digitados/manuais e
// séries do Planejamento).
const CORTE_APOS_PLANILHA = '2026-08-24'

// Grade dos meses civis que INTERSECAM o período [inicio, fim], em ordem
// cronológica (inclusive meses parcialmente cobertos — ex.: faixa personalizada
// que começa no dia 15). Reusa a aritmética civil de periodos.js.
function mesesNoPeriodo(inicio, fim) {
  const meses = []
  let mes = definirPeriodo('mes', inicio)
  while (mes.inicio <= fim) {
    meses.push({ chave: mes.inicio.slice(0, 7), inicio: mes.inicio, fim: mes.fim })
    mes = deslocarPeriodo('mes', mes, 1)
  }
  return meses
}

// Grade das semanas ISO (segunda→domingo) cuja SEGUNDA cai dentro do período
// [inicio, fim]. A primeira semana que começa ANTES de inicio fica de fora (a
// semana é atribuída ao mês anterior — regra da não-repartição), e cada semana
// seguinte avança até a última que ainda começa na faixa. Chave = segunda ISO.
function semanasNoPeriodo(inicio, fim) {
  const semanas = []
  let semana = definirPeriodo('semana', inicio)
  while (semana.inicio < inicio) {
    semana = deslocarPeriodo('semana', semana, 1)
  }
  while (semana.inicio <= fim) {
    semanas.push(semana.inicio)
    semana = deslocarPeriodo('semana', semana, 1)
  }
  return semanas
}

// Agrupamento do período: 'mes' → porData (Trimestre, Semestre, Ano,
// Personalizado abrem barras por MÊS; a visão Mês abre as barras por DATA de
// recebimento — uma barra por dia, alinhada à lista detalhada abaixo).
export function agrupamentoPorTipoDePeriodo(tipo) {
  return tipo === 'mes' ? 'data' : 'mes'
}

// Devolve a série que alimenta o GRÁFICO dadas as dados prontos e o período
// ativo — Centraliza a decisão (testável) que o hook chama.
export function selecionarSerieDoRelatorio(dados, periodo) {
  if (!dados || !periodo) return []
  return agrupamentoPorTipoDePeriodo(periodo.tipo) === 'data'
    ? dados.porData
    : dados.porMes
}

// RATEIO PROPORCIONAL: divide `total` (centavos de extras) entre os valores
// das parcelas na mesma proporção do valor de cada uma. Cada parte é
// arredondada a 2 casas e a diferença residual da soma cai na última (a soma
// devolvida é EXATAMENTE arre2(total)).
function ratearProporcional(valores, total) {
  const soma = valores.reduce((a, b) => a + b, 0)
  if (!(soma > 0)) return valores.map(() => 0)
  const partes = valores.map((v) => (total * v) / soma).map(arre2)
  const resto = arre2(total) - arre2(partes.reduce((a, b) => a + b, 0))
  partes[partes.length - 1] = arre2(partes[partes.length - 1] + resto)
  return partes
}

export function calcularRecebidoHoras({ planejamentosRealizados = [], fixoSemana = 0, periodo, dataRealPorLancamento = {} } = {}) {
  if (!periodo) {
    throw new Error('calcularRecebidoHoras espera um periodo ({ inicio, fim }).')
  }

  const { inicio, fim } = validarFaixaDePeriodo(periodo.inicio, periodo.fim)

  // Data DO RECEBIMENTO: quando o lançamento do Planejamento tem lancamento_id
  // (o pagamento foi realizado pelo app e gerou uma movimentação), a data real
  // em que o dinheiro ENTROU é a da movimentação real — e não a data_prevista
  // (a data em que o pagamento DEVERIA cair). Correção 11/09/2026: usar
  // data_prevista quando a movimentação caiu noutro dia (ex.: Pagamento Semanal
  // previsto 09/09, mov real em 10/09) desalinhava a linha, o bucket porData e a
  // semana civil em relação ao extrato real. Histórico da planilha e lançamentos
  // antigos não têm lancamento_id → data_prevista é a única fonte (e é a correta).
  const dataDoRecebimento = (p) =>
    p?.lancamento_id && dataRealPorLancamento[p.lancamento_id]
      ? String(dataRealPorLancamento[p.lancamento_id])
      : String(p.data_prevista)

  // Mapas das grades para acumulação (chave 'YYYY-MM' e segunda-feira ISO).
  const totalPorMes = new Map()
  for (const m of mesesNoPeriodo(inicio, fim)) {
    totalPorMes.set(m.chave, { recebido: 0, valorHorasExtras: 0 })
  }
  const totalPorSemana = new Map()
  for (const s of semanasNoPeriodo(inicio, fim)) {
    totalPorSemana.set(s, { recebido: 0, valorHorasExtras: 0 })
  }

  let totalRecebido = 0
  let totalValorHorasExtras = 0

  // --- Recebido: Entrada + realizado dentro do período -------------------
  // Defensivo: filtra aqui também (não confia em quem chamou), mas a grade
  // continua a fonte única da semana (semana.js).
  const realizadosEntrada = (Array.isArray(planejamentosRealizados) ? planejamentosRealizados : [])
    .filter(
      (p) => {
        const dataRecebimento = dataDoRecebimento(p)
        return (
        p &&
        p.tipo_op === 'Entrada' &&
        p.estado === 'realizado' &&
        dataRecebimento >= inicio &&
        dataRecebimento <= fim &&
        Number(p.valor) > 0 &&
        // Planilha vale só até a semana 34/2026 (o app é a fonte a partir
        // daí — primeiro lançamento digitado em 24/08/2026).
        !(p.origem === 'historico_planilha' && dataRecebimento >= CORTE_APOS_PLANILHA) &&
        // Acordo trabalhista e recebimentos avulsos saem do "Recebido & horas"
        // (decisão 06/09/2026): o Acordo tem aba própria (origine
        // historico_acordo) e Outros (historico_outros) não é salário — ambos
        // NÃO fazem parte da conta "o que entrou como pagamento de trabalho".
        !['historico_acordo', 'historico_outros'].includes(p.origem)
        )
      },
    )

  // UMA LINHA POR PAGAMENTO REALIZADO (regra 06/09/2026): mesmo que dois ou
  // mais pagamentos apontem para a MESMA semana de trabalho, cada um vira um
  // recebimento próprio com a sua data (nada de fundir/concatenar datas).
  const itens = realizadosEntrada.map((p) => {
    const data = dataDoRecebimento(p)
    const semana = semanaIso(data).inicio
    let referente = null
    // Período de referência: a semana de TRABALHO que o pagamento cobre vem
    // do DADO GRAVADO na ocorrência (colunas ano_semana_trabalho/semana_trabalho,
    // migration 28). Nenhum "menos 7 dias" calculado na hora de exibir.
    if (Number.isInteger(p.ano_semana_trabalho) && Number.isInteger(p.semana_trabalho)) {
      try {
        referente = inicioDaSemanaIso(p.ano_semana_trabalho, p.semana_trabalho)
      } catch {
        // Semana de trabalho inválida/inexistente no ano: não derruba; fica
        // sem referente (só o bucket do recebimento é usado).
      }
    }
    return {
      data,
      semana,
      valor: Number(p.valor),
      valorSemanal: p.valor_semanal === null || p.valor_semanal === undefined ? null : Number(p.valor_semanal),
      valorExtraHistorico:
        p.valor_extra_historico === null || p.valor_extra_historico === undefined
          ? null
          : Number(p.valor_extra_historico),
      valorHorasExtras: 0,
      referente,
      descricao: String(p.descricao ?? '').trim(),
    }
  })

  // Recebido por mês e por semana civil (buckets da série do gráfico).
  for (const it of itens) {
    totalRecebido += it.valor
    const caixaMes = totalPorMes.get(it.data.slice(0, 7))
    if (caixaMes) caixaMes.recebido += it.valor
    const caixaSemana = totalPorSemana.get(it.semana)
    if (caixaSemana) caixaSemana.recebido += it.valor
  }

  // --- Valor dos extras: SEMANA DE TRABALHO RECEBIDA ACIMA DO FIXO ----------
  // Regra ajustada em 06/09/2026 (decisão do André): o "extra" do relatório
  // NÃO é mais o valorHe+valorDomfer do fechamento do Ponto — é quanto o valor
  // RECEBIDO passou do fixo padrão da semana:
  //   extras da semana de trabalho W = max(0, Σ(valores dos pagamentos que
  //   cobrem W) − fixoSemana)
  // Semana normal (1.650 = fixo) → extra 0; semana com dom/fer não descontados
  //   (2.050) → 400; semana com feriado (recebido 1.800, fixo já descontado
  //   pelo Ponto) → extra REAL 150 (1800 − 1650) — apenas neste relatório.
  // Vários pagamentos pela MESMA W → o extra da semana é RATEADO
  // proporcionalmente ao valor de cada parcela (cada linha mostra a fatia que
  // pagou; a semana conta UMA vez nos totais).
  //
  // EXCEÇÃO HISTÓRICO DA PLANILHA (decisão 06/09/2026): as linhas origem
  // 'historico_planilha' carregam `valor_extra_historico` (migration 31 — a
  // coluna C "HorasExtras" da planilha, o excedente REAL da semana). Nestas
  // linhas o extra é ESSE valor gravado DIRETO — nada de fórmula de subtração
  // nem rateio (o número já é o da fonte). A fórmula continua valendo apenas
  // para linhas reconciliadas pelo Ponto ou que não tenham o dado histórico.
  const valorFixo = Number(fixoSemana) || 0
  const itensComExtraDireto = []
  const itensSemExtraDireto = []
  for (const it of itens) {
    if (it.valorExtraHistorico !== null && it.valorExtraHistorico !== undefined && it.valorExtraHistorico > 0) {
      it.valorHorasExtras = arre2(it.valorExtraHistorico)
      totalValorHorasExtras = arre2(totalValorHorasExtras + it.valorHorasExtras)
      itensComExtraDireto.push(it)
    } else {
      itensSemExtraDireto.push(it)
    }
  }

  // Continua agrupado por semana de trabalho SOMENTE para as linhas sem o
  // extra gravado (origens do app/Ponto — reconciliação do Ponto).
  const pagamentosPorReferente = new Map()
  for (const it of itensSemExtraDireto) {
    if (!it.referente) continue // sem semana de trabalho gravada (seguro, netflix...) → não ganha extra
    if (!pagamentosPorReferente.has(it.referente)) {
      pagamentosPorReferente.set(it.referente, [])
    }
    pagamentosPorReferente.get(it.referente).push(it)
  }

  for (const grupo of pagamentosPorReferente.values()) {
    const soma = grupo.reduce((a, g) => a + g.valor, 0)

    // Base (fixo) da SEMANA: se TODAS as parcelas carregam valor_semanal (a
    // coluna "VALOR SEMANAL" da planilha, o fixo da época — 1.400 em 2025,
    // 1.600 no início de 2026, 1.650 de março em diante), a base é a SOMA
    // delas (junho parcelado: 825 + 825 = 1650). Senão (parcelas do próprio
    // app, que nunca guardam o valor semanal) vale o fixoSemana da config
    // atual do Ponto (ponto_config.VALOR_FIXO_SEMANA).
    const bases = grupo.map((g) => g.valorSemanal)
    const baseSemana = bases.every((b) => b !== null)
      ? arre2(bases.reduce((a, b) => a + b, 0))
      : valorFixo

    const extras = arre2(Math.max(0, soma - baseSemana))
    if (!(extras > 0)) continue

    const partes = ratearProporcional(grupo.map((g) => g.valor), extras)
    grupo.forEach((g, i) => {
      g.valorHorasExtras = arre2(g.valorHorasExtras + partes[i])
    })
    totalValorHorasExtras = arre2(totalValorHorasExtras + extras)
  }

  // Buckets dos extras: cada linha contribui com a SUA fatia (a soma das
  // fatias de uma semana == os extras dela; nada duplica grátis).
  for (const it of itens) {
    if (!(it.valorHorasExtras > 0)) continue
    const caixaMes = totalPorMes.get(it.data.slice(0, 7))
    if (caixaMes) caixaMes.valorHorasExtras += it.valorHorasExtras
    const caixaSemana = totalPorSemana.get(it.semana)
    if (caixaSemana) caixaSemana.valorHorasExtras += it.valorHorasExtras
  }

  const porMes = [...totalPorMes.entries()]
    .filter(([, v]) => v.recebido > 0 || v.valorHorasExtras > 0)
    .map(([mes, v]) => ({
      mes,
      recebido: arre2(v.recebido),
      valorHorasExtras: arre2(v.valorHorasExtras),
    }))
    .sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0))

  const porSemana = [...totalPorSemana.entries()]
    .filter(([, v]) => v.recebido > 0 || v.valorHorasExtras > 0)
    .map(([semana, v]) => ({
      semana,
      recebido: arre2(v.recebido),
      valorHorasExtras: arre2(v.valorHorasExtras),
    }))
    .sort((a, b) => (a.semana < b.semana ? -1 : a.semana > b.semana ? 1 : 0))

  // Série da visão Mês (bug 2 de 06/09/2026): UMA BARRA POR DATA DE
  // RECEBIMENTO — a mesma granularidade (e as mesmas entradas) da lista
  // detalhada. Pagamentos da mesma data somam na mesma barra. Não usa grade de
  // semana, então a borda do mês não faz lançamento sumir do gráfico.
  const porDataCaixa = new Map()
  for (const it of itens) {
    const caixa = porDataCaixa.get(it.data) ?? { recebido: 0, valorHorasExtras: 0 }
    caixa.recebido += it.valor
    caixa.valorHorasExtras += it.valorHorasExtras
    porDataCaixa.set(it.data, caixa)
  }
  const porData = [...porDataCaixa.entries()]
    .filter(([, v]) => v.recebido > 0 || v.valorHorasExtras > 0)
    .map(([data, v]) => ({
      data,
      recebido: arre2(v.recebido),
      valorHorasExtras: arre2(v.valorHorasExtras),
    }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))

  const recebimentos = itens
    .map((it) => ({
      data: it.data,
      semana: it.semana,
      valor: arre2(it.valor),
      valorHorasExtras: arre2(it.valorHorasExtras),
      referente: it.referente,
      descricao: it.descricao,
    }))
    .sort((a, b) => {
      if (a.data !== b.data) return a.data < b.data ? -1 : 1
      return 0 // estável: mantém a ordem em que foram lidos no mesmo dia
    })

  return {
    totalRecebido: arre2(totalRecebido),
    totalValorHorasExtras: arre2(totalValorHorasExtras),
    porMes,
    porData,
    porSemana,
    recebimentos,
  }
}