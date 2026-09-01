// ============================================================================
// RECORRÊNCIA MENSAL — funções PURAS de extensão e datas (ETAPA 06 / P4-E)
// ============================================================================
// Decisão 2 (andaime 01/09/2026, com André): a recorrência mensal passou de
// previsão avulsa de UM mês para uma SÉRIE (serie_id) com valor repetido. Aqui
// vivem os cálculos de:
//   1. quantos meses a série cobre (com data de término; ou o horizonte
//      inicial FIXO de 24 meses quando indefinida);
//   2. a data civil da 1ª ocorrência a partir do dia de vencimento (1-31) e
//      do mês de início — com clamp de fim de mês no mês inicial (D2). Nos
//      meses seguintes o clamp é da lib dataDaParcela (parcelas.js).
//
// O que esta lib NÃO conhece: React, Supabase, hooks. É função pura.
// ============================================================================

// Horizonte inicial (em MESES) de uma recorrência SEM data de término
// (indefinida). Decisão com André (01/09/2026): gera 24 meses previstos de
// uma vez; estender depois é caminho de regenerarSerie (já testado). Constante
// nomeada e comentada para ser o único ponto de ajuste.
export const HORIZONTE_RECORRENCIA_SEM_TERMINO_MESES = 24

// Quantos meses (inclusive) entre um mês inicial 'YYYY-MM' e uma data de
// término 'YYYY-MM-DD'. Devolve >= 1. Ex.: '2026-09' + '2027-02-15' → 6
// (set/out/nov/dez/jan/fev). Lança Error se a data de término for anterior ao
// mês inicial (não faz sentido gerar uma série negativa).
export function mesesAteTermino(mesInicial, dataTermino) {
  if (typeof mesInicial !== 'string' || !/^\d{4}-\d{2}$/.test(mesInicial)) {
    throw new Error(`Mês inicial inválido ("${mesInicial}"): use o formato YYYY-MM.`)
  }
  if (typeof dataTermino !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataTermino)) {
    throw new Error(`Data de término inválida ("${dataTermino}"): use o formato YYYY-MM-DD.`)
  }
  const [a0, m0] = mesInicial.split('-').map(Number)
  const [aT, mT] = dataTermino.split('-').map(Number)
  const total = (aT - a0) * 12 + (mT - m0) + 1
  if (total < 1) {
    throw new Error('A data de término deve ser no mês inicial ou depois dele.')
  }
  return total
}

// Total de parcelas de uma recorrência: com término = meses até ele (inclusive);
// sem término = horizonte inicial fixo. Toda linha nasce 'previsto', então o
// total de parcelas == a quantidade de meses previstos gerados.
export function totalParcelasRecorrencia(mesInicial, dataTermino) {
  if (!dataTermino) return HORIZONTE_RECORRENCIA_SEM_TERMINO_MESES
  return mesesAteTermino(mesInicial, dataTermino)
}

// Monta 'YYYY-MM-DD' do dia do vencimento no mês de início, com clamp de fim
// de mês (ex.: dia 31 em fevereiro → 28/29). A lib dataDaParcela já faz o
// clamp nos meses seguintes preservando a âncora (D2) — aqui só normalizamos
// o 1º. Ex.: ('2027-01', 31) → '2027-01-31'; ('2027-02', 31) → '2027-02-28'.
export function primeiroVencimento(mesInicio, dia) {
  const diaNum = Number(dia)
  if (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 31) {
    throw new Error(`Dia do vencimento inválido (${dia}): informe 1 a 31.`)
  }
  const [a, m] = mesInicio.split('-').map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(m) || m < 1 || m > 12) {
    throw new Error(`Mês de início inválido ("${mesInicio}"): use o formato YYYY-MM.`)
  }
  const ultimo = new Date(a, m, 0).getDate()
  const diaEfetivo = Math.min(diaNum, ultimo)
  return `${a}-${String(m).padStart(2, '0')}-${String(diaEfetivo).padStart(2, '0')}`
}