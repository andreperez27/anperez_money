// ============================================================================
// PERÍODOS DO PLANEJAMENTO — semana / mês / trimestre / semestre (ETAPA 06/F1)
// ============================================================================
// Lib PURA: sem React, sem Supabase, sem DOM, sem relógio (nenhuma função
// chama new Date() sozinha — quem quiser "hoje" passa a data civil explícita;
// assim os testes são determinísticos e a UI decide o "agora").
//
// Representação única de período (contrato estável):
//   { tipo, inicio, fim, ...metadados }
//   • tipo: 'semana' | 'mes' | 'trimestre' | 'semestre'
//   • inicio/fim: datas civis 'YYYY-MM-DD' INCLUSIVAS, sempre inicio <= fim
//   • metadados mínimos por tipo (só o que identifica o período):
//       semana    → ano, semana        (ISO 8601, via src/lib/semana.js)
//       mes       → ano, mes           (mes 1–12, calendário civil)
//       trimestre → ano, trimestre     (Q1..Q4 → 1..4)
//       semestre  → ano, semestre      (S1..S2 → 1..2)
//
// REGRAS DE OURO:
//   • A lógica ISO de semana NÃO é duplicada: delega 100% para
//     src/lib/semana.js (semanaIso). A navegação semanal anda ±7 dias CIVIS
//     em UTC sobre a segunda-feira e pergunta à fonte única qual dupla
//     (ano/semana) resultou — viradas de ano corretas por construção.
//   • Mês/trimestre/semestre usam aritmética CIVIL própria (índice linear de
//     meses/trimestres/semestres), nunca soma fixa de dias.
//   • Datas civis nunca tocam fuso: os componentes YYYY-MM-DD entram em
//     Date.UTC e saem por getUTC* — "2026-08-31" significa o dia civil
//     inteiro, em qualquer timezone onde o app rode (mesma convenção de
//     semana.js/compartilhados.js).
// ============================================================================

const MS_DIA = 86_400_000

import { semanaIso } from './semana.js'

export const TIPOS_DE_PERIODO = ['semana', 'mes', 'trimestre', 'semestre']

// ---------------------------------------------------------------------------
// Internos — validação e aritmética de data civil (mesmas regras de semana.js:
// formato estrito + existência real no calendário; reimplementado aqui porque
// tsDe é interno lá e alterá-la só para exportar não se justifica).
// ---------------------------------------------------------------------------
function validarDataCivil(dataISO) {
  if (typeof dataISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
    throw new Error(`Data inválida ("${dataISO}"): use o formato YYYY-MM-DD.`)
  }
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  const ts = Date.UTC(ano, mes - 1, dia)
  const volta = new Date(ts)
  if (
    volta.getUTCFullYear() !== ano ||
    volta.getUTCMonth() !== mes - 1 ||
    volta.getUTCDate() !== dia
  ) {
    throw new Error(`Data inexistente no calendário ("${dataISO}").`)
  }
  return { ano, mes, dia }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function isoDe(ano, mes, dia) {
  return `${ano}-${pad(mes)}-${pad(dia)}`
}

function tsDe(dataISO) {
  const { ano, mes, dia } = validarDataCivil(dataISO)
  return Date.UTC(ano, mes - 1, dia)
}

// Último dia civil do mês (aceita mes 13+ via Date.UTC normalizar — usado
// pelos limites de trimestre/semestre).
function diasNoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

function inteiro(valor, rotulo) {
  if (!Number.isInteger(valor)) {
    throw new Error(`${rotulo} inválido (${valor}): use um inteiro.`)
  }
  return valor
}

// Montador único: garante que TODO período devolvido tem a mesma forma,
// com inicio/fim coerentes com os metadados.
function montarPeriodo(tipo, metadados, inicio, fim) {
  if (inicio > fim) {
    throw new Error(`Período inválido (${tipo}): início ${inicio} depois do fim ${fim}.`)
  }
  return { tipo, ...metadados, inicio, fim }
}

// ---------------------------------------------------------------------------
// API PÚBLICA
// ---------------------------------------------------------------------------

// define o período QUE CONTÉM a data civil de referência.
//
// definirPeriodo('semana', '2026-08-26')
//   → { tipo:'semana', ano:2026, semana:35, inicio:'2026-08-24', fim:'2026-08-30' }
// definirPeriodo('mes', '2026-08-26')
//   → { tipo:'mes', ano:2026, mes:8, inicio:'2026-08-01', fim:'2026-08-31' }
// definirPeriodo('trimestre', '2026-08-26')
//   → { tipo:'trimestre', ano:2026, trimestre:3, inicio:'2026-07-01', fim:'2026-09-30' }
// definirPeriodo('semestre', '2026-08-26')
//   → { tipo:'semestre', ano:2026, semestre:2, inicio:'2026-07-01', fim:'2026-12-31' }
export function definirPeriodo(tipo, referencia) {
  const { ano, mes } = validarDataCivil(referencia)

  if (tipo === 'semana') {
    // Fonte única do calendário ISO: semanaIso devolve ano/semana/inicio/fim.
    const s = semanaIso(referencia)
    return montarPeriodo(tipo, { ano: s.ano, semana: s.semana }, s.inicio, s.fim)
  }

  if (tipo === 'mes') {
    return montarPeriodo(
      tipo,
      { ano, mes },
      isoDe(ano, mes, 1),
      isoDe(ano, mes, diasNoMes(ano, mes)),
    )
  }

  if (tipo === 'trimestre') {
    const trimestre = Math.floor((mes - 1) / 3) + 1 // Q1..Q4 → 1..4
    const primeiroMes = (trimestre - 1) * 3 + 1
    const ultimoMes = primeiroMes + 2
    return montarPeriodo(
      tipo,
      { ano, trimestre },
      isoDe(ano, primeiroMes, 1),
      isoDe(ano, ultimoMes, diasNoMes(ano, ultimoMes)),
    )
  }

  if (tipo === 'semestre') {
    const semestre = mes <= 6 ? 1 : 2
    const primeiroMes = (semestre - 1) * 6 + 1
    const ultimoMes = primeiroMes + 5
    return montarPeriodo(
      tipo,
      { ano, semestre },
      isoDe(ano, primeiroMes, 1),
      isoDe(ano, ultimoMes, diasNoMes(ano, ultimoMes)),
    )
  }

  throw new Error(
    `Tipo de período desconhecido ("${tipo}"): use ${TIPOS_DE_PERIODO.join(', ')}.`,
  )
}

// Desloca o período em EXATAMENTE uma unidade do seu tipo (delta inteiro,
// pode ser 0 para reconstruir; negativo volta no tempo).
//
//   deslocarPeriodo('semana', p,  1)  → próxima semana ISO
//   deslocarPeriodo('mes',    p, -1)  → mês anterior
//   deslocarPeriodo('trimestre', p, 1)
//   deslocarPeriodo('semestre',  p, 1)
//
// Semana NÃO usa (ano, semana±delta) direto — na borda de ano a semana 53
// pode nem existir no ano seguinte. Em vez disso anda ±7 dias civis sobre a
// segunda-feira e pergunta à fonte única qual dupla resultou (mesmo caminho
// já validado pela navegação da tela e pelo teste_semana).
export function deslocarPeriodo(tipo, periodo, delta) {
  if (!periodo || periodo.tipo !== tipo) {
    throw new Error(`Período incompatível: esperava tipo "${tipo}".`)
  }
  const n = inteiro(delta, 'Delta')

  if (tipo === 'semana') {
    const deslocadoTs = tsDe(periodo.inicio) + n * 7 * MS_DIA
    const novaData = new Date(deslocadoTs).toISOString().slice(0, 10)
    return definirPeriodo('semana', novaData)
  }

  // Mês/trimestre/semestre: índice linear + reconstrução civil (jamais soma
  // fixa de dias — fevereiro teria 30 "dias" fantasmos).
  if (tipo === 'mes') {
    inteiro(periodo.ano, 'Ano')
    inteiro(periodo.mes, 'Mês')
    const indice = periodo.ano * 12 + (periodo.mes - 1) + n
    const novoAno = Math.floor(indice / 12)
    const novoMes = (indice % 12) + 1
    return montarPeriodo(
      tipo,
      { ano: novoAno, mes: novoMes },
      isoDe(novoAno, novoMes, 1),
      isoDe(novoAno, novoMes, diasNoMes(novoAno, novoMes)),
    )
  }

  if (tipo === 'trimestre') {
    inteiro(periodo.ano, 'Ano')
    inteiro(periodo.trimestre, 'Trimestre')
    const indice = periodo.ano * 4 + (periodo.trimestre - 1) + n
    const novoAno = Math.floor(indice / 4)
    const novoTrimestre = (indice % 4) + 1
    const primeiroMes = (novoTrimestre - 1) * 3 + 1
    const ultimoMes = primeiroMes + 2
    return montarPeriodo(
      tipo,
      { ano: novoAno, trimestre: novoTrimestre },
      isoDe(novoAno, primeiroMes, 1),
      isoDe(novoAno, ultimoMes, diasNoMes(novoAno, ultimoMes)),
    )
  }

  if (tipo === 'semestre') {
    inteiro(periodo.ano, 'Ano')
    inteiro(periodo.semestre, 'Semestre')
    const indice = periodo.ano * 2 + (periodo.semestre - 1) + n
    const novoAno = Math.floor(indice / 2)
    const novoSemestre = (indice % 2) + 1
    const primeiroMes = (novoSemestre - 1) * 6 + 1
    const ultimoMes = primeiroMes + 5
    return montarPeriodo(
      tipo,
      { ano: novoAno, semestre: novoSemestre },
      isoDe(novoAno, primeiroMes, 1),
      isoDe(novoAno, ultimoMes, diasNoMes(novoAno, ultimoMes)),
    )
  }

  throw new Error(
    `Tipo de período desconhecido ("${tipo}"): use ${TIPOS_DE_PERIODO.join(', ')}.`,
  )
}

// A data civil de referência pertence ao período? Limites INCLUSIVOS
// (inicio e fim contam como "dentro"). Comparação lexicográfica é segura
// porque ambas as strings estão validadas no formato estrito YYYY-MM-DD.
//
// ehPeriodoAtual('mes', periodo, '2026-08-26') → true/false determinístico.
export function ehPeriodoAtual(tipo, periodo, referencia) {
  if (!periodo || periodo.tipo !== tipo) {
    throw new Error(`Período incompatível: esperava tipo "${tipo}".`)
  }
  const data = String(referencia ?? '')
  validarDataCivil(data)
  return data >= periodo.inicio && data <= periodo.fim
}

// Valida uma FAIXA civil [inicio, fim] para consultas por período
// (ex.: listarPorPeriodo do hook). Ambas as datas precisam ser civis reais
// (YYYY-MM-DD estrito) e inicio <= fim — faixa invertida é REJEITADA com
// erro claro, nunca invertida silenciosamente. Devolve {inicio, fim}.
export function validarFaixaDePeriodo(inicioISO, fimISO) {
  const inicio = String(inicioISO ?? '')
  const fim = String(fimISO ?? '')
  validarDataCivil(inicio)
  validarDataCivil(fim)
  if (inicio > fim) {
    throw new Error(
      `Faixa de datas inválida: início (${inicio}) depois do fim (${fim}).`,
    )
  }
  return { inicio, fim }
}
