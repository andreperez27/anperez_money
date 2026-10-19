// ============================================================================
// SEMANAS DO PONTO NO PLANEJAMENTO — núcleo PURO e testável
// ============================================================================
// Modelo AUTOMÁTICO (decisão do André, 19/10/2026): a entrada semanal do
// Ponto deixou de ser uma SÉRIE materializada no Planejamento. Agora cada
// semana de trabalho é UMA linha INDEPENDENTE (sem serie_id/parcela_numero),
// criada/reajustada sozinha a partir do valor fechado do Ponto — o mesmo
// comportamento de cartão/condomínio. A linha guarda a semana ISO de TRABALHO
// que ela paga (ano_semana_trabalho/semana_trabalho), o que permite:
//   • deduplicar (uma linha por semana, sempre);
//   • reconciliar o valor pelo Ponto (fixo − feriados + HE + dom/fer) nas
//     semanas FECHADAS (pode dar zero); nas ABERTAS, previsão só do fixo;
//   • exibir a legenda discreta "Pagamento da semana X" na linha.
//
// Esta lib reúne 100% da matemática pura; o hook (usePlanejamentos) ORQUESTRA
// o Supabase usando estas funções. A semana vem SEMPRE da fonte única
// src/lib/semana.js; o vínculo com o Ponto é da reconciliacaoPonto.js.
// ============================================================================

import { semanaIso, inicioDaSemanaIso } from './semana.js'
import { semanaDeTrabalhoDaData } from './reconciliacaoPonto.js'

const MS_DIA = 86_400_000

// Data civil 'YYYY-MM-DD' → timestamp UTC. Interno.
function tsDe(dataISO) {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return Date.UTC(ano, mes - 1, dia)
}

function isoDe(ts) {
  return new Date(ts).toISOString().slice(0, 10)
}

// Soma (ou subtrai) dias corridos a uma data civil. Exportado porque o hook
// usa para achar a segunda-feira da semana que abre a janela de sincronização.
export function adicionarDiasISO(dataISO, dias) {
  return isoDe(tsDe(dataISO) + dias * MS_DIA)
}

// ----------------------------------------------------------------------------
// 1) DATA DE PAGAMENTO da semana de trabalho (ano, semana)
// ----------------------------------------------------------------------------
// O pagamento cai na QUARTA-FEIRA da semana ISO SEGUINTE ao trabalho — ou
// seja, a segunda-feira da semana de trabalho + 9 dias. É o caminho inverso de
// reconciliacaoPonto.semanaDeTrabalhoDaData (que sai da data paga para a
// semana trabalhada). Nunca montamos número de semana "na mão".
// ----------------------------------------------------------------------------
export function dataPagamentoDaSemana(ano, semana) {
  return adicionarDiasISO(inicioDaSemanaIso(ano, semana), 9)
}

// ----------------------------------------------------------------------------
// 2) HORIZONTE DE SEMANAS — semanas consecutivas em torno da semana de trabalho
//    CORRENTE (a que paga a próxima quarta em relação a hojeISO).
// ----------------------------------------------------------------------------
// Cada item traz a dupla de trabalho (ano/semana), a janela seg–dom do
// trabalho e a data_prevista (quarta seguinte). A sincronização insere linha
// para toda semana AUSENTE e ajusta o valor das PREVISTAS — nada em série.
// `semanasAnteriores` recua o início algumas semanas (reconciliação de linhas
// recentes já vencidas); `semanas` conta a partir da corrente (inclusive).
// ----------------------------------------------------------------------------
export function semanasJornadaNoHorizonte({ hojeISO, semanas = 52, semanasAnteriores = 0 } = {}) {
  const { ano, semana } = semanaDeTrabalhoDaData(hojeISO)
  const saida = []
  let inicio = adicionarDiasISO(inicioDaSemanaIso(ano, semana), -7 * semanasAnteriores)
  const total = semanas + semanasAnteriores
  for (let i = 0; i < total; i++) {
    const { ano: a, semana: s, fim } = semanaIso(inicio)
    saida.push({
      ano: a,
      semana: s,
      inicio,
      fim,
      dataPrevista: adicionarDiasISO(inicio, 9),
    })
    inicio = adicionarDiasISO(inicio, 7)
  }
  return saida
}

// ----------------------------------------------------------------------------
// 3) CHAVE e DESCRIÇÃO da linha
// ----------------------------------------------------------------------------
// Chave de deduplicação por semana de TRABALHO (a mesma linha nunca nasce 2×).
export function chaveSemanaTrabalho(ano, semana) {
  return `${ano}-${semana}`
}

// Descrição da linha semanal: "Pagamento da semana 41" (substitui o antigo
// rótulo fixo "Pagamento Semanal"). A semana é a de TRABALHO que ela paga.
export function descricaoDaSemana(semana) {
  return `Pagamento da semana ${semana}`
}

// Descrição herdada das séries antigas (antes de virar linha automática).
export const DESCRICAO_JORNADA_LEGADA = 'Pagamento Semanal'

// A descrição é a AUTOMÁTICA do Ponto (legada "Pagamento Semanal" ou já no
// formato "Pagamento da semana N")? Só essas podem ser reescritas pela
// sincronização — descrição renomeada à mão pelo usuário é preservada.
const RE_DESCRICAO_AUTO = /^Pagamento da semana \d{1,2}$/

export function ehDescricaoAutomaticaJornada(descricao) {
  if (typeof descricao !== 'string') return false
  const d = descricao.trim()
  return d === DESCRICAO_JORNADA_LEGADA || RE_DESCRICAO_AUTO.test(d)
}

// ----------------------------------------------------------------------------
// 4) COMPARAÇÃO em centavos — evita reescrever valor por ruído de float
// ----------------------------------------------------------------------------
export function valorDiferente(a, b) {
  return Math.round(Number(a) * 100) !== Math.round(Number(b) * 100)
}

// Normaliza um valor em reais para 2 casas (o mesmo arredondamento gravado).
export function arredondarValor(valor) {
  return Math.round(Number(valor) * 100) / 100
}

// ----------------------------------------------------------------------------
// 5) VALOR PREVISTO da linha semanal — regra de exibição (decisão 19/10/2026)
// ----------------------------------------------------------------------------
// Semana FECHADA → valor REAL do Ponto (fixo − feriados + HE + dom/fer), que
// PODE ser zero (a linha continua existindo com 0). Semana ABERTA (corrente ou
// futura) → previsão SÓ do fixo semanal, sem descontos de feriado nem HE.
// ----------------------------------------------------------------------------
export function valorPrevistoJornada({ fechada, fixoSemana, valorReal }) {
  return arredondarValor(fechada ? valorReal : fixoSemana)
}
