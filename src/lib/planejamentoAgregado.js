// ============================================================================
// AGREGAÇÃO DE PLANEJAMENTOS — agrupamento por mês e por semana ISO (F1)
// ============================================================================
// Lib PURA: separa os itens em grupos cronológicos. NENHUMA lógica financeira
// vive aqui — entradas/saídas/resultado/contagens continuam sendo cálculo
// exclusivo de calcularResumoPlanejamentos() (src/lib/planejamentoCalc.js).
// O fluxo previsto é: itens → agrupar → aplicar calcularResumoPlanejamentos
// em cada grupo.itens. Assim não existe segunda implementação de totais.
//
// Contratos comuns aos dois agrupadores:
//   • [] entra  →  [] sai (nunca null, nunca erro);
//   • grupos em ORDEM CRONOLÓGICA, independente da ordem de entrada;
//   • nenhum item se perde e nenhum se duplica (a soma dos grupos é igual ao
//     total de itens — garantido pela suíte teste_planejamentoAgregado);
//   • itens são as PRÓPRIAS referências (sem cópia), preservando campos;
//   • item sem data_prevista válida lança erro CLARO de domínio — dado ruim
//     nunca é descartado em silêncio.
//
// A semana ISO é SEMPRE da fonte única src/lib/semana.js (semanaIso) — nada
// de segundo calendário. Os limites de mês vêm de periodos.js (definirPeriodo),
// evitando reimplementar "quantos dias tem o mês".
// ============================================================================

import { semanaIso } from './semana.js'
import { definirPeriodo } from './periodos.js'

function dataPrevistaValida(item, indice) {
  const rotulo = `itens[${indice}]${item?.descricao ? ` ("${item.descricao}")` : ''}`
  if (!item || typeof item.data_prevista !== 'string') {
    throw new Error(`${rotulo}: data_prevista ausente ou inválida.`)
  }
  // Reaproveita a validação estrita do domínio: formato YYYY-MM-DD + data que
  // existe no calendário (2026-02-30 é rejeitado). Lança com mensagem clara.
  try {
    definirPeriodo('mes', item.data_prevista)
  } catch (e) {
    throw new Error(`${rotulo}: ${e.message}`)
  }
  return item.data_prevista
}

// ---------------------------------------------------------------------------
// Agrupa pelo MÊS CIVIL de data_prevista (ano+mês, nunca por texto solto).
//
// agruparPorMes(itens) →
// [
//   { chave:'2026-07', inicio:'2026-07-01', fim:'2026-07-31', itens:[...] },
//   { chave:'2026-08', inicio:'2026-08-01', fim:'2026-08-31', itens:[...] },
// ]
// ---------------------------------------------------------------------------
// Garantia explícita de ordem cronológica (entrada fora de ordem é caso real).
function ordenarPorChave(grupos) {
  return [...grupos].sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0))
}

export function agruparPorMes(itens = []) {
  if (!Array.isArray(itens)) {
    throw new Error('agruparPorMes espera uma lista de itens.')
  }

  const grupos = new Map()
  for (let i = 0; i < itens.length; i++) {
    const data = dataPrevistaValida(itens[i], i)
    const chave = data.slice(0, 7) // 'YYYY-MM' — ordena cronológico como texto

    if (!grupos.has(chave)) {
      const limites = definirPeriodo('mes', `${chave}-01`)
      grupos.set(chave, {
        chave,
        inicio: limites.inicio,
        fim: limites.fim,
        itens: [],
      })
    }
    grupos.get(chave).itens.push(itens[i])
  }

  return ordenarPorChave([...grupos.values()])
}

// ---------------------------------------------------------------------------
// Agrupa pela SEMANA ISO de data_prevista, via semana.js (fonte única).
//
// agruparPorSemanaISO(itens) →
// [
//   { chave:'2026-W35', ano:2026, semana:35,
//     inicio:'2026-08-24', fim:'2026-08-30', itens:[...] },
// ]
// Obs.: a chave usa o ANO ISO da semana — um item em 29/12/2025 cai no grupo
// '2026-W01' junto com os primeiros dias de janeiro/2026 (regra ISO correta).
// ---------------------------------------------------------------------------
export function agruparPorSemanaISO(itens = []) {
  if (!Array.isArray(itens)) {
    throw new Error('agruparPorSemanaISO espera uma lista de itens.')
  }

  const grupos = new Map()
  for (let i = 0; i < itens.length; i++) {
    const data = dataPrevistaValida(itens[i], i)
    const { ano, semana, inicio, fim } = semanaIso(data)
    const chave = `${ano}-W${String(semana).padStart(2, '0')}`

    if (!grupos.has(chave)) {
      grupos.set(chave, { chave, ano, semana, inicio, fim, itens: [] })
    }
    grupos.get(chave).itens.push(itens[i])
  }

  return ordenarPorChave([...grupos.values()])
}
