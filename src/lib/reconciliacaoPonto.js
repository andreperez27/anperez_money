// ============================================================================
// RECONCILIAÇÃO COM O PONTO — núcleo PURA e testável (ETAPA 06/E5-G)
// ============================================================================
// O "Pagamento fixo Semanal" nasce no Planejamento como uma SÉRIE recorrente
// de origem 'jornada' (criada no modo Recorrente→Semanal). É uma ESTIMATIVA
// para as semanas futuras: cada ocorrência, caindo na quarta-feira da SEMANA
// SEGUINTE ao trabalho, prevê o valor fixo + adicional de domingo. Quando a
// semana de trabalho fechar (hoje > fim dela no Ponto), o número real
// (fixo + HE + domingo/feriado, o mesmo do card "Previsto a receber")
// substitui a estimativa naquela ocorrência.
//
// Esta lib reúne 100% da matemática/estado desse processo em funções PURAS:
//   • semanaDeTrabalhoDaData   → de uma data_prevista, a semana ISO da semana
//                                ANTERIOR (o trabalho que ela paga);
//   • valorFechadoDaSemana     → o valor real fechado de uma semana (reusa a
//                                MESMA função fecharPeriodo do Ponto — nenhuma
//                                duplicação de cálculo);
//   • semanaFechada            → hoje > fim da semana (a semana já encerrou?);
//   • decidirAtualizacoes       → para o conjunto de linhas, devolve as que
//                                precisam ter o valor trocado (lazy e testável).
//
// O hook (usePlanejamentos/Planejamento) ORQUESTRA o Supabase usando estas
// funções; nenhuma delas importa banco, React ou hooks. A semana vem SEMPRE da
// fonte única src/lib/semana.js; o cálculo de valor é DELEGADO ao pontoCalc.js.
// ============================================================================

import { semanaIso, inicioDaSemanaIso } from './semana.js'
import { fecharPeriodo, previstoAReceberDaSemana } from './pontoCalc.js'

const MS_DIA = 86_400_000

// Data civil 'YYYY-MM-DD' → timestamp UTC. Interno.
function tsDe(dataISO) {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return Date.UTC(ano, mes - 1, dia)
}

// ----------------------------------------------------------------------------
// 1) SEMANA DE TRABALHO de uma data_prevista
// ----------------------------------------------------------------------------
// A ocorrência de origem 'jornada' cai na quarta-feira da semana SEGUINTE ao
// trabalho. Logo, trabalho = a semana ANTERIOR àquela em que data_prevista cai.
// Caminho robusto e imune à virada de ano ISO:
//   semanaIso(dataPrevista)            → { ano, semana, inicio (seg), fim (dom) }
//   inicio - 7 dias                    → segunda-feira da semana de trabalho
//   semanaIso(dessa segunda)           → { ano, semana } da semana de trabalho
// Nunca calculamos semana "na mão" — sempre via semana.js.
// ----------------------------------------------------------------------------
export function semanaDeTrabalhoDaData(dataPrevista) {
  const sem = semanaIso(dataPrevista)
  const segundaAnterior = new Date(tsDe(sem.inicio) - 7 * MS_DIA).toISOString().slice(0, 10)
  const { ano, semana } = semanaIso(segundaAnterior)
  return { ano, semana }
}

// ----------------------------------------------------------------------------
// 2) VALOR FECHADO da semana de trabalho (mesmo cálculo do card "Previsto a
//    receber" do Ponto): fixoSemana (já com o desconto por feriado na semana,
//    regra 04/09/2026) + HE + domingo/feriado.
// ----------------------------------------------------------------------------
// Reusa fecharPeriodo (src/lib/pontoCalc.js) sobre as EXCEÇÕES da janela
// [inicioISO, fimISO] — o mesmo que o usePonto alimenta com excecoes/ferias.
// config.fixoSemana vem de ponto_config (VALOR_FIXO_SEMANA); os valores HE e
// dom/fer já vêm congelados nas linhas ponto_excecoes (valor_he/valor_domfer).
// feriados (ponto_feriados) entra no desconto proporcional do fixo — dia útil
// com feriado abate 1/6 do fixo; domingo com feriado não desconta.
// ----------------------------------------------------------------------------
export function valorFechadoDaSemana({ excecoes, config, ferias = [], feriados = [], inicioISO, fimISO } = {}) {
  const resumo = fecharPeriodo(excecoes, { inicioISO, fimISO }, ferias)
  return previstoAReceberDaSemana({
    fixoSemana: Number(config?.fixoSemana ?? 0),
    resumo,
    feriados,
    inicioISO,
    fimISO,
  }).valor
}

// ----------------------------------------------------------------------------
// 3) SEMANA FECHADA — basta comparar hoje > fim da semana de trabalho
//    (o domingo). Usada para saber se o valor real já pode substituir o previsto.
// ----------------------------------------------------------------------------
export function semanaFechada(inicioISO, fimISO, dataHoje) {
  return String(dataHoje) > String(fimISO)
}

// ----------------------------------------------------------------------------
// 4) DECIDIR ATUALIZAÇÕES — conjunto lazy de linhas origem 'jornada' previstas.
//    Para cada linha cuja semana de trabalho JÁ FECHOU, compara o valor real
//    do Ponto com o gravado e devolve os updates quando diferentes. Ocorrências
//    'realizado'/'cancelado' ou com semana ainda aberta nunca são tocadas
//    (histórico real / previsão ainda válida).
// ----------------------------------------------------------------------------
// Parâmetros:
//   • linhas            → itens do Planejamento (snake_case, select('*')).
//   • hoje              → data civil 'YYYY-MM-DD'.
//   • buscarValorRealDaSemana(anoTrab, semTrab, inicioISO, fimISO) → Promise de
//     número (ou null se a semana não tiver dados no Ponto). Separado para o
//     hook injetar a chamada ao Supabase (ponto_excecoes + ponto_ferias +
//     ponto_config). A lib decide, quem busca entrega.
// Devolve um array de { id, valor, ano_semana_trabalho, semana_trabalho } para
// a atualização, já arredondando a 2 casas.
// ----------------------------------------------------------------------------
export async function decidirAtualizacoes({ linhas = [], hoje, buscarValorRealDaSemana } = {}) {
  // Só linhas de origem 'jornada', ainda previstas, com referência de semana.
  const candidatas = linhas.filter(
    (l) =>
      l.origem === 'jornada' &&
      l.estado === 'previsto' &&
      Number.isInteger(l.semana_trabalho) &&
      Number.isInteger(l.ano_semana_trabalho),
  )

  const updates = []
  for (const linha of candidatas) {
    const inicio = inicioDaSemanaIso(linha.ano_semana_trabalho, linha.semana_trabalho)
    const fim = semanaIso(inicio).fim
    if (!semanaFechada(inicio, fim, hoje)) continue

    let valorReal
    try {
      valorReal = await buscarValorRealDaSemana({
        ano: linha.ano_semana_trabalho,
        semana: linha.semana_trabalho,
        inicioISO: inicio,
        fimISO: fim,
      })
    } catch {
      // Erro ao buscar o Ponto: não derruba o carregamento do Planejamento —
      // a linha permanece como está e será re-tentada na próxima navegação.
      continue
    }

    if (valorReal === null || valorReal === undefined) continue
    const real2 = Math.round(Number(valorReal) * 100) / 100
    const gravado2 = Math.round(Number(linha.valor) * 100) / 100
    // Arredondamento em centavos: evita "atualizar" desnecessário por float.
    if (real2 !== gravado2) {
      updates.push({ id: linha.id, valor: real2 })
    }
  }

  return updates
}