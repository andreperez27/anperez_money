// ============================================================================
// RELATÓRIO "ACORDO TRABALHISTA" — agregação (aba nova dos Relatórios)
// ============================================================================
// Lib PURA (sem React/Supabase/DOM): recebe os planejamentos já consultados e
// devolve os totais e as séries do período, filtrando SOMENTE a origem
// 'historico_acordo' (parcelas do acordo trabalhista da planilha — migration
// 31). Não há horas extras nem lógica de Ponto aqui: é o histórico de
// depósitos do acordo (data + valor).
//
// Contrato:
//   calcularRecebidoAcordo({ planejamentos, periodo })
//     → {
//         totalRecebido,
//         depositos: [{ data, valor, descricao }],
//         porMes:    [{ mes, recebido }],
//         porData:   [{ data, recebido }],
//         porAno:    [{ ano, recebido, depositos }],
//       }
//
//   • planejamentos  lista de itens do Planejamento (origem manual, jornada,
//     recorrente, outro, historico_*). Só contam: tipo_op='Entrada',
//     estado='realizado', valor > 0, data_prevista DENTRO do período E origem
//     'historico_acordo'. A lib filtra sozinha (defensiva).
//   • periodo        { tipo, inicio, fim } — limites INCLUSIVOS.
//
// Séries:
//   • porMes  → chave = MÊS CIVIL do recebimento (data_prevista), ordem
//     cronológica — alimenta o gráfico nas visões Trimestre/Semestre/Ano/
//     Personalizado (barras por mês).
//   • porData → chave = DATA CIVIL do recebimento — a série da visão Mês
//     (uma barra por dia) e a mesma granularidade da lista detalhada.
//   • porAno  → chave = ANO CIVIL do recebimento, no mesmo formato dos
//     depósitos (um registro por ano: total do ano + a lista de depósitos
//     daquele ano em ordem cronológica). Agregação aditiva usada pela aba
//     "Acordo trabalhista" (gráfico por ano + lista resumida por ano).
//   • depositos → UMA LINHA POR DEPÓSITO (data + valor + descricao), ordenado
//     pela data do recebimento. É a lista detalhada da aba (e do PDF).
//
// Não há regra de corte 24/08/2026 aqui: o Acordo trabalhista foi pago
// até julho/2025; se por acaso existirem registros futuros com esta origem,
// eles entram normalmente no período (a origem é exclusiva do histórico).
// ============================================================================

import { definirPeriodo, deslocarPeriodo, validarFaixaDePeriodo } from './periodos.js'

function arre2(n) {
  return Math.round(n * 100) / 100
}

// Grade dos meses civis que INTERSECAM o período [inicio, fim], em ordem
// cronológica (mesmos limites de periodos.js).
function mesesNoPeriodo(inicio, fim) {
  const meses = []
  let mes = definirPeriodo('mes', inicio)
  while (mes.inicio <= fim) {
    meses.push({ chave: mes.inicio.slice(0, 7), inicio: mes.inicio, fim: mes.fim })
    mes = deslocarPeriodo('mes', mes, 1)
  }
  return meses
}

export function calcularRecebidoAcordo({ planejamentos = [], periodo } = {}) {
  if (!periodo) {
    throw new Error('calcularRecebidoAcordo espera um periodo ({ inicio, fim }).')
  }
  const { inicio, fim } = validarFaixaDePeriodo(periodo.inicio, periodo.fim)

  // Só os recebimentos do ACORDO (origem 'historico_acordo') dentro da faixa.
  const depositos = (Array.isArray(planejamentos) ? planejamentos : [])
    .filter(
      (p) =>
        p &&
        p.origem === 'historico_acordo' &&
        p.tipo_op === 'Entrada' &&
        p.estado === 'realizado' &&
        String(p.data_prevista) >= inicio &&
        String(p.data_prevista) <= fim &&
        Number(p.valor) > 0,
    )
    .map((p) => ({
      data: String(p.data_prevista),
      valor: arre2(Number(p.valor)),
      descricao: String(p.descricao ?? '').trim(),
    }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))

  let totalRecebido = 0

  const totalPorMes = new Map()
  for (const m of mesesNoPeriodo(inicio, fim)) {
    totalPorMes.set(m.chave, 0)
  }
  const totalPorData = new Map()
  for (const d of depositos) {
    totalRecebido += d.valor
    const chaveMes = d.data.slice(0, 7)
    if (totalPorMes.has(chaveMes)) totalPorMes.set(chaveMes, totalPorMes.get(chaveMes) + d.valor)
    totalPorData.set(d.data, (totalPorData.get(d.data) ?? 0) + d.valor)
  }

  const porMes = [...totalPorMes.entries()]
    .filter(([, v]) => v > 0)
    .map(([mes, recebido]) => ({ mes, recebido: arre2(recebido) }))
    .sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0))

  const porData = [...totalPorData.entries()]
    .map(([data, recebido]) => ({ data, recebido: arre2(recebido) }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))

  // porAno: agrupa os depósitos por ANO CIVIL (aditivo aos totais acima) —
  // cada ano com o total recebido e a lista cronológica dos depósitos.
  const porAno = []
  for (const d of depositos) {
    const ano = d.data.slice(0, 4)
    let bloco = porAno[porAno.length - 1]
    if (!bloco || bloco.ano !== ano) {
      bloco = { ano, recebido: 0, depositos: [] }
      porAno.push(bloco)
    }
    bloco.recebido = arre2(bloco.recebido + d.valor)
    bloco.depositos.push(d)
  }

  return {
    totalRecebido: arre2(totalRecebido),
    depositos,
    porMes,
    porData,
    porAno,
  }
}