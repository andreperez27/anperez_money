// ============================================================================
// PENDÊNCIA DE ATRASO — data da nova ocorrência (lib PURA, sem Supabase)
// ============================================================================
// Regra aprovada: a pendência migra para a PRÓXIMA ocorrência da mesma série
// (sem deslocamento fixo de dias); avulso (sem serie_id) cai na próxima
// segunda-feira. Aritmética civil em UTC, mesma disciplina de semana.js.
// A tag "Pendente (atraso da semana de dd/mm)" é gerada no banco (date_trunc);
// aqui vive só o cálculo da DATA (front passa p_data_pendente / p_data_nova).
// ============================================================================

import { semanaIso } from './semana.js'

const MS_DIA = 86_400_000

function isoDe(ts) {
  return new Date(ts).toISOString().slice(0, 10)
}

function tsDe(dataISO) {
  const [ano, mes, dia] = String(dataISO).split('-').map(Number)
  return Date.UTC(ano, mes - 1, dia)
}

// Último dia civil do mês (para o clamp do dia âncora mensal).
function ultimoDiaDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

// Próxima segunda-feira após `hojeISO` (se hoje é segunda, +7).
export function proximaSegunda(hojeISO) {
  const dowIso = (new Date(tsDe(hojeISO)).getUTCDay() + 6) % 7 // 0 = seg
  return isoDe(tsDe(hojeISO) + (7 - dowIso) * MS_DIA)
}

// Data da pendência herdada de `item`:
//   • série semanal (periodicidade 'semanal') → data_prevista + 7 dias;
//   • série mensal/parcelada (serie_id, demais casos) → mesmo dia no mês
//     seguinte, com clamp no último dia do mês (mesma regra D2 de parcelas.js);
//   • avulso (sem serie_id) → próxima segunda-feira após `hojeISO`.
export function proximaDataPendente(item, hojeISO) {
  const base = String(item?.data_prevista || hojeISO)
  if (item?.serie_id) {
    if (item.periodicidade === 'semanal') {
      return isoDe(tsDe(base) + 7 * MS_DIA)
    }
    const [ano, mes, dia] = base.split('-').map(Number)
    const proxMes = mes === 12 ? 1 : mes + 1
    const proxAno = mes === 12 ? ano + 1 : ano
    const diaFinal = Math.min(dia, ultimoDiaDoMes(proxAno, proxMes))
    return `${proxAno}-${String(proxMes).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`
  }
  return proximaSegunda(hojeISO)
}

// Rótulo da semana de origem para exibição (espelho do date_trunc do banco).
export function rotuloSemanaAtraso(dataPrevsta) {
  const segunda = semanaIso(dataPrevsta).inicio
  const [, mes, dia] = segunda.split('-')
  return `Pendente (atraso da semana de ${dia}/${mes})`
}
