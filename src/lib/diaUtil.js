// ============================================================================
// DIA ÚTIL — ajuste do vencimento de fatura p/ o próximo dia útil.
// ============================================================================
// Regra financeira (Administradora): quando o dia fixo de vencimento do cartão
// cai em sábado, domingo (ou feriado), o pagamento real ocorre no PRÓXIMO dia
// útil. Centraliza esse cálculo para exibição do cartão, projeção da fatura no
// Planejamento e indicador de "Atrasado" — sem lógica duplicada.
//
// REAPROVEITA a fonte de feriados do módulo Ponto (tabela ponto_feriados) via
// ehFeriado (pontoCalc.js) — nunca duplica a lista; a lista chega aqui pronta
// (ex.: useFeriados) na MESMA convenção aceita pelo Ponto ({data} ou string).
// ============================================================================

import { ehFeriado } from './pontoCalc.js'
import { adicionarDiasISO } from './saldoProjetado.js'

// Dia útil = segunda a sexta E não feriado (a lista é a mesma do Ponto).
export function ehDiaUtil(dataISO, feriados = []) {
  const d = new Date(`${dataISO}T00:00:00Z`)
  const dia = d.getUTCDay()
  if (dia === 0 || dia === 6) return false
  return !ehFeriado(dataISO, feriados)
}

// Avança sábado/domingo/feriado até o próximo dia útil (máx. 12 saltos —
// cobre uma sequência longa de feriados sem risco de loop infinito).
export function ajustarParaDiaUtil(dataISO, feriados = []) {
  let d = dataISO
  for (let i = 0; i < 12; i++) {
    if (ehDiaUtil(d, feriados)) return d
    d = adicionarDiasISO(d, 1)
  }
  return d
}

// Vencimento REAL da fatura a partir de 'YYYY-MM' + dia fixo do cartão:
//   • clamp para mês curto (ex.: dia 31 em abril → 30), mesma regra antiga;
//   • ajusta o resultado p/ o próximo dia útil (fim de semana E feriado).
export function vencimentoRealISO(mesStr, diaVenc, feriados = []) {
  const dia = Math.max(1, Number(diaVenc) || 1)
  const [ano, m] = String(mesStr).split('-').map(Number)
  const ultimo = new Date(ano, m, 0).getDate()
  const diaFinal = Math.min(dia, ultimo)
  const base = `${ano}-${String(m).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`
  return ajustarParaDiaUtil(base, feriados)
}