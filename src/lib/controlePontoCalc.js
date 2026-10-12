// ============================================================================
// ESPELHO DE CONTROLE DE PONTO — motor puro da aba "Controle de ponto"
// ============================================================================
// Reconstrói dia a dia a partir da carga padrão (config, nunca hardcoded) +
// exceções. SOMENTE LEITURA: nenhuma regra de negócio nova — só compõe o que
// pontoCalc.js já calcula.
//
// Dinheiro em semana que cruza mês (decisão): AGRUPADO POR SEMANA inteira e
// rotulada ("Semana 28/09–04/10"), sem ratear o fixo por dia — o fixo é
// semanal e o Planejamento não tem esse valor quebrado. Semana parcial na
// borda aparece CHEIA com indicação discreta. Nas linhas diárias, R$ só
// onde é diário por natureza (HE paga, diária dom/fer, desconto da falta —
// todos congelados por linha); fixo e desconto de feriado só no bloco semanal.
// Dias futuros: situação previsto, fora dos totais, sem projeção.
// Banco: all-time; saldo em data X via soma até X (linhas futuras de fora).
// Campos de hora e de R$ viajam separados (futuro modo "somente horas" é só
// esconder colunas).
// ============================================================================

import {
  baseDoDia,
  cargaCumpridaParcial,
  cargaEsperadaHoras,
  classificarDia,
  descontoFeriadosDoFixo,
  diaSemanaIso,
  diasDoPeriodo,
  minutosCargaDia,
  minutosEmHora,
  statusFaltasFIFO,
  creditosBancoMinutos,
  debitosBancoMinutos,
  TEMPOS_CARGA_PADRAO,
} from './pontoCalc.js'
import { semanaIso } from './semana.js'

export const DIA_SEMANA_ROTULO = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

const ehPag = (ex) => (ex?.destino ?? 'pagamento') === 'pagamento'

// Saldo do banco (minutos) até uma data (inclusive). Linhas futuras de fora —
// com data = hoje bate exatamente com o saldo atual.
export function saldoBancoAte(excecoes, dataISO) {
  const ref = String(dataISO)
  const ate = (excecoes ?? []).filter((ex) => ex && String(ex.data) <= ref)
  return creditosBancoMinutos(ate) - debitosBancoMinutos(ate)
}

// Segunda-feira ISO de uma data (início da semana de trabalho).
function segundaDe(dataISO) {
  return semanaIso(dataISO).inicio
}

// Domingo da semana que começa na segunda dada.
function domingoDe(segundaISO) {
  return semanaIso(segundaISO).fim
}

// Monta UM dia do espelho. Retorna o objeto do dia (ver espelhoControlePonto).
// Dia futuro COM lançamento carrega os dados (exibido como "agendada" nas
// listas, fora dos totais).
function montarDia({
  data, excecao, emFerias, feriado, futuro, tempos, temposCarga,
}) {
  const dia = {
    data,
    diaSemana: DIA_SEMANA_ROTULO[diaSemanaIso(data)],
    situacao: null,
    entrada: null,
    saida: null,
    horarioPadrao: false,
    horas: null,
    hePagaHoras: 0,
    hePagaValor: 0,
    bancoHoras: 0,
    domferDias: 0,
    domferValor: 0,
    descontoFalta: 0,
    faltaMinutos: 0,
    faltaDestino: null,
    obs: null,
    futuro,
  }
  if (futuro) {
    dia.situacao = 'previsto'
    if (classificarDia(data, feriado ? [data] : []) === 'he' && !emFerias) {
      dia.entrada = tempos.entrada
      dia.saida = tempos.saida
      dia.horarioPadrao = true
    }
    // Lançamento em data futura: carrega os dados para a marca "agendada"
    // (fora dos totais — só entra nas listas de faltas/extras).
    if (excecao) {
      dia.agendada = true
      dia.entrada = excecao.entrada ?? dia.entrada
      dia.saida = excecao.saida ?? dia.saida
      dia.horarioPadrao = false
      dia.obs = excecao.obs ?? null
      const dest = excecao.destino ?? 'pagamento'
      if (excecao.tipo === 'falta') {
        const min = Number(excecao.minutos_falta) || 0
        dia.situacao = `falta-${dest}`
        dia.faltaMinutos = min
        dia.faltaDestino = dest
        dia.faltaIntegral = min >= minutosCargaDia(data, temposCarga)
        if (dest === 'pagamento') dia.descontoFalta = Number(excecao.valor_desconto) || 0
      } else if (excecao.tipo === 'he') {
        dia.situacao = dest === 'banco' ? 'he-banco' : 'he-pagamento'
        dia.horas = Number(excecao.horas || 0)
        if (dest === 'banco') {
          dia.bancoHoras = Number(excecao.he || 0)
        } else {
          dia.hePagaHoras = Number(excecao.he || 0)
          dia.hePagaValor = Number(excecao.valor_he || 0)
        }
      } else if (excecao.tipo === 'domfer') {
        dia.situacao = dest === 'banco' ? 'domfer-banco' : 'domfer-pagamento'
        dia.horas = Number(excecao.horas || 0)
        if (dest === 'banco') {
          dia.bancoHoras = Number(excecao.horas || 0)
        } else {
          dia.domferDias = Number(excecao.domfer_qtd || 0)
          dia.domferValor = Number(excecao.valor_domfer || 0)
        }
      }
    }
    return dia
  }
  if (emFerias) {
    dia.situacao = 'ferias'
    return dia
  }
  if (feriado) {
    if (!excecao) {
      dia.situacao = 'feriado'
      return dia
    }
    // Feriado trabalhado = domfer (cai no ramo abaixo).
  } else if (diaSemanaIso(data) === 6) {
    if (!excecao) {
      dia.situacao = 'domingo'
      return dia
    }
    // Domingo trabalhado = domfer (cai no ramo abaixo).
  }
  if (!excecao) {
    // Dia de carga sem lançamento = turno padrão cumprido (horários da
    // config, estilo discreto na UI).
    dia.situacao = 'padrao'
    dia.entrada = tempos.entrada
    dia.saida = tempos.saida
    dia.horarioPadrao = true
    dia.horas = baseDoDia(data)
    return dia
  }
  dia.entrada = excecao.entrada ?? null
  dia.saida = excecao.saida ?? null
  dia.obs = excecao.obs ?? null
  if (excecao.tipo === 'he') {
    const h = Number(excecao.he || 0)
    dia.horas = Number(excecao.horas || 0)
    if (ehPag(excecao)) {
      dia.situacao = 'he-pagamento'
      dia.hePagaHoras = h
      dia.hePagaValor = Number(excecao.valor_he || 0)
    } else {
      dia.situacao = 'he-banco'
      dia.bancoHoras = h
    }
    return dia
  }
  if (excecao.tipo === 'domfer') {
    const h = Number(excecao.horas || 0)
    dia.horas = h
    if (ehPag(excecao)) {
      dia.situacao = 'domfer-pagamento'
      dia.domferDias = Number(excecao.domfer_qtd || 0)
      dia.domferValor = Number(excecao.valor_domfer || 0)
    } else {
      dia.situacao = 'domfer-banco'
      dia.bancoHoras = h
    }
    return dia
  }
  if (excecao.tipo === 'falta') {
    dia.situacao = `falta-${excecao.destino ?? 'pagamento'}`
    dia.horas = 0
    dia.faltaMinutos = Number(excecao.minutos_falta) || 0
    dia.faltaDestino = excecao.destino ?? 'pagamento'
    dia.faltaIntegral = dia.faltaMinutos >= minutosCargaDia(data, temposCarga)
    if (dia.faltaDestino === 'pagamento') {
      dia.descontoFalta = Number(excecao.valor_desconto) || 0
    } else if (dia.faltaDestino === 'banco') {
      dia.bancoHoras = 0 // débito entra via minutos (lista do banco), não horas
      dia.faltaBancoMinutos = dia.faltaMinutos
    }
    return dia
  }
  // Tipo legado 'ferias' em linha avulsa: trata como férias.
  dia.situacao = 'ferias'
  return dia
}

function temposDoDia(dataISO, temposCarga = TEMPOS_CARGA_PADRAO) {
  const d = diaSemanaIso(dataISO)
  if (d === 6) return null
  const sab = d === 5
  const t = temposCarga ?? TEMPOS_CARGA_PADRAO
  return {
    entrada: minutosEmHora(sab ? t.sabadoEntrada : t.utilEntrada),
    saida: minutosEmHora(sab ? t.sabadoSaida : t.utilSaida),
  }
}

// Motor principal (puro). Entradas:
//   inicio/fim (faixa do espelho), hojeISO (corte futuro/passado),
//   excecoes (linhas ponto_excecoes da faixa estendida), feriados ([data]),
//   ferias (intervalos), config { fixoSemana, temposCarga },
//   todasExcecoes (all-time para o bloco do banco).
export function espelhoControlePonto({
  inicio, fim, hojeISO, excecoes = [], feriados = [], ferias = [],
  config = {}, todasExcecoes = [], agora = new Date(),
} = {}) {
  const hoje = String(hojeISO)
  const fixoSemana = Number(config.fixoSemana) || 0
  const temposCarga = config.temposCarga ?? TEMPOS_CARGA_PADRAO
  const porData = new Map((excecoes ?? []).map((ex) => [String(ex.data), ex]))
  const feriadosSet = new Set((feriados ?? []).map((f) => (typeof f === 'string' ? f : f.data)))
  const emFerias = (data) => (ferias ?? []).some((f) => f.data_inicio <= data && data <= f.data_fim)

  // --- dias ---
  const dias = diasDoPeriodo(inicio, fim).map((data) => {
    const futuro = data > hoje
    const tempos = temposDoDia(data, temposCarga) ?? { entrada: null, saida: null }
    return montarDia({
      data,
      excecao: porData.get(data) ?? null,
      emFerias: emFerias(data),
      feriado: feriadosSet.has(data),
      futuro,
      tempos,
      temposCarga,
    })
  })

  // --- semanas (interseção com a faixa; bloco sempre CHEIO e rotulado) ---
  const chaves = []
  for (const d of diasDoPeriodo(inicio, fim)) {
    const seg = segundaDe(d)
    if (!chaves.includes(seg)) chaves.push(seg)
  }
  const semanas = chaves.map((segunda) => {
    const domingo = domingoDe(segunda)
    const noPeriodo = dias.filter((d) => d.data >= segunda && d.data <= domingo && !d.futuro)
    // Semana 100% futura: sem dinheiro (não projeta nada).
    if (noPeriodo.length === 0) {
      return {
        segunda,
        domingo,
        rotulo: `${segunda.slice(8, 10)}/${segunda.slice(5, 7)}–${domingo.slice(8, 10)}/${domingo.slice(5, 7)}`,
        parcial: segunda < inicio || domingo > fim,
        futura: true,
        fixo: null,
        descFeriado: null,
        descFaltas: null,
        hePagaHoras: null,
        hePagaValor: null,
        domferDias: null,
        domferValor: null,
        total: null,
      }
    }
    const descFeriado = descontoFeriadosDoFixo(fixoSemana, [...feriadosSet], segunda, domingo)
    let descFaltas = 0
    let hePagaHoras = 0
    let hePagaValor = 0
    let domferDias = 0
    let domferValor = 0
    for (const d of noPeriodo) {
      descFaltas += d.descontoFalta
      hePagaHoras += d.hePagaHoras
      hePagaValor += d.hePagaValor
      domferDias += d.domferDias
      domferValor += d.domferValor
    }
    descFaltas = Math.round(descFaltas * 100) / 100
    return {
      segunda,
      domingo,
      rotulo: `${segunda.slice(8, 10)}/${segunda.slice(5, 7)}–${domingo.slice(8, 10)}/${domingo.slice(5, 7)}`,
      parcial: segunda < inicio || domingo > fim,
      futura: false,
      fixo: fixoSemana,
      descFeriado,
      descFaltas,
      hePagaHoras: Math.round(hePagaHoras * 100) / 100,
      hePagaValor: Math.round(hePagaValor * 100) / 100,
      domferDias,
      domferValor: Math.round(domferValor * 100) / 100,
      total: Math.round((Math.max(0, fixoSemana - descFeriado - descFaltas) + hePagaValor + domferValor) * 100) / 100,
    }
  })

  // --- resumo (só dias não-futuros) ---
  // Dias trabalhados (resposta 2): dia de carga com presença — inclui falta
  // PARCIAL (houve trabalho), exclui falta integral (qualquer destino),
  // férias, feriado sem trabalho e domingo. Dom/fer trabalhado sai em linha
  // separada (domferDias), sem somar aqui.
  const uteis = dias.filter((d) => !d.futuro)
  const diasTrabalhados = uteis.filter((d) => {
    if (d.situacao === 'padrao' || d.situacao === 'he-pagamento' || d.situacao === 'he-banco') return true
    if (String(d.situacao).startsWith('falta-')) {
      return (d.faltaMinutos ?? 0) < Math.round(baseDoDia(d.data) * 60)
    }
    return false
  })
  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100
  // Carga cumprida/prevista ATÉ HOJE (mesma definição do Resumo da Semana e
  // do card da Home; HE e dom/fer NÃO entram na cumprida aqui).
  const limite = fim < hoje ? fim : hoje
  const faltasRows = (excecoes ?? []).filter((ex) => ex && ex.tipo === 'falta')
  const cargaPrevista = limite >= inicio
    ? r2(cargaEsperadaHoras(inicio, limite, [...feriadosSet], ferias ?? [], faltasRows))
    : 0
  const cargaCumprida = limite >= inicio
    ? r2(cargaCumpridaParcial({ inicioISO: inicio, hojeISO: limite, feriados: [...feriadosSet], ferias: ferias ?? [], faltas: faltasRows, agora }))
    : 0
  const soma = (f) => r2(uteis.reduce((a, d) => a + f(d), 0))
  const faltasPorDestino = (dest) => {
    const rows = uteis.filter((d) => d.situacao === `falta-${dest}`)
    return { qtd: rows.length, minutos: rows.reduce((a, d) => a + (d.faltaMinutos || 0), 0) }
  }
  const resumo = {
    carga: {
      cumprida: cargaCumprida,
      prevista: cargaPrevista,
      pct: cargaPrevista > 0 ? Math.round((cargaCumprida / cargaPrevista) * 1000) / 10 : null,
    },
    diasTrabalhados: diasTrabalhados.length,
    domferDias: uteis.filter((d) => d.situacao === 'domfer-pagamento' || d.situacao === 'domfer-banco').length,
    faltas: {
      pagamento: faltasPorDestino('pagamento'),
      banco: faltasPorDestino('banco'),
      abonada: faltasPorDestino('abonada'),
    },
    hePagasHoras: soma((d) => d.hePagaHoras),
    hePagasValor: soma((d) => d.hePagaValor),
    domferPagosDias: uteis.filter((d) => d.situacao === 'domfer-pagamento').reduce((a, d) => a + (d.domferDias || 0), 0),
    domferPagosValor: soma((d) => d.domferValor),
    bancoHorasHe: soma((d) => (d.situacao === 'he-banco' ? d.bancoHoras : 0)),
    bancoHorasDomfer: soma((d) => (d.situacao === 'domfer-banco' ? d.bancoHoras : 0)),
    descFeriado: r2(semanas.reduce((a, s) => a + (s.descFeriado ?? 0), 0)),
    descFaltas: r2(semanas.reduce((a, s) => a + (s.descFaltas ?? 0), 0)),
    valores: r2(semanas.reduce((a, s) => a + (s.total ?? 0), 0)),
  }

  // --- banco (all-time + recorte do período) ---
  const diaAnterior = (() => {
    const [a, m, d] = inicio.split('-').map(Number)
    return new Date(Date.UTC(a, m - 1, d) - 86400000).toISOString().slice(0, 10)
  })()
  const saldoInicio = saldoBancoAte(todasExcecoes, diaAnterior)
  const saldoFim = saldoBancoAte(todasExcecoes, fim < hoje ? fim : hoje)
  const creditosPeriodo = (todasExcecoes ?? [])
    .filter((ex) => ex && ex.data >= inicio && ex.data <= fim && ex.data <= hoje)
    .reduce((a, ex) => a + (ex.destino === 'banco' && (ex.tipo === 'he' || ex.tipo === 'domfer')
      ? (ex.tipo === 'he' ? Math.round(Number(ex.he || 0) * 60) : Math.round(Number(ex.horas || 0) * 60))
      : 0), 0)
  const debitosPeriodo = (todasExcecoes ?? [])
    .filter((ex) => ex && ex.data >= inicio && ex.data <= fim && ex.data <= hoje)
    .reduce((a, ex) => a + (ex.tipo === 'falta' && ex.destino === 'banco' ? Number(ex.minutos_falta) || 0 : 0), 0)
  const faltasBco = (todasExcecoes ?? []).filter((ex) => ex && ex.tipo === 'falta' && ex.destino === 'banco')
  const creditosAll = (todasExcecoes ?? [])
    .filter((ex) => ex && ex.destino === 'banco' && (ex.tipo === 'he' || ex.tipo === 'domfer'))
    .reduce((a, ex) => a + (ex.tipo === 'he' ? Math.round(Number(ex.he || 0) * 60) : Math.round(Number(ex.horas || 0) * 60)), 0)
  const fifoAll = statusFaltasFIFO(faltasBco, creditosAll)
  const fifoPorData = new Map(fifoAll.map((f) => [f.data, f.status]))
  const banco = {
    saldoInicio,
    creditosPeriodo,
    debitosPeriodo,
    saldoFim,
    variacao: saldoFim - saldoInicio,
    // FIFO inclui datas futuras do período (com marca) — só débitos e
    // totais as excluem.
    faltas: fifoAll
      .filter((f) => f.data >= inicio && f.data <= fim)
      .map((f) => ({ ...f, futura: f.data > hoje })),
    fifoPorData,
  }

  return { dias, semanas, resumo, banco }
}
