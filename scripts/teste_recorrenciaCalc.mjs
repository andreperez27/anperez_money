import assert from 'node:assert/strict'
import { montarLinhasRecorrentes } from '../src/lib/planejamentoSerie.js'
import {
  HORIZONTE_RECORRENCIA_SEM_TERMINO_MESES,
  mesesAteTermino,
  totalParcelasRecorrencia,
  primeiroVencimento,
} from '../src/lib/recorrenciaCalc.js'

// ============================================================================
// Testes das funções PURAS de recorrência mensal (ETAPA 06 / P4-E).
// Rodar: node scripts/teste_recorrenciaCalc.mjs
//
// Cobrem a DECISÃO 2 do andaime 01/09/2026: recorrência agora é SÉRIE com o
// mesmo valor repetido, dia de vencimento (1-31) com clamp de fim de mês (D2)
// e data de término opcional (indefinida = horizonte inicial fixo de 24 meses).
// ============================================================================

let ok = 0
let falhou = 0

function teste(nome, fn) {
  try {
    fn()
    ok += 1
    console.log(`ok      — ${nome}`)
  } catch (e) {
    falhou += 1
    console.log(`FALHOU  — ${nome}`)
    console.log(`        ${e.message}`)
  }
}

function lancaErro(fn, trecho) {
  assert.throws(fn, (e) => e instanceof Error && e.message.includes(trecho))
}

const SERIE = '22222222-2222-2222-2222-222222222222'

// <<< PROBLEMA 1 — recorrência SEM término atravessando fevereiro (clamp) >>>
// 31/01/2027 + 24 meses: cada mês clampado no fim (fev → 28), âncora 31 nas
// retomadas; a 24ª parcela = 31/12/2028 (janeiro/2027 + 23 meses).
teste('R1 — indefinida: 24 meses do dia 31 (clamp em fevereiro, âncora preservada)', () => {
  const linhas = montarLinhasRecorrentes({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Netflix',
    valorCentavos: 4490,
    totalParcelas: HORIZONTE_RECORRENCIA_SEM_TERMINO_MESES,
    dataPrimeiraParcela: '2027-01-31',
    origem: 'recorrente',
  })
  assert.equal(linhas.length, 24)
  // 31/01 → 28/02 → 31/03 (clamp + âncora retomada → D2)
  assert.equal(linhas[0].data_prevista, '2027-01-31')
  assert.equal(linhas[1].data_prevista, '2027-02-28')
  assert.equal(linhas[2].data_prevista, '2027-03-31')
  // última parcela = 31/12/2028
  assert.equal(linhas[23].data_prevista, '2028-12-31')
  // todas com o MESMO valor (44,90) e origem recorrente
  assert.ok(linhas.every((l) => l.valor === 44.9))
  assert.ok(linhas.every((l) => l.origem === 'recorrente'))
  // nenhum dia civil inválido ao longo do horizonte
  for (const l of linhas) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(l.data_prevista))
})

// <<< PROBLEMA 1 — recorrência SEM término, dia 30 e dia 29 (bissexto) >>>
teste('R2 — indefinida: dia 30 (abril→maio) e dia 29 em ano bissexto', () => {
  const l30 = montarLinhasRecorrentes({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Assinatura',
    valorCentavos: 1000,
    totalParcelas: 12,
    dataPrimeiraParcela: '2027-04-30',
    origem: 'recorrente',
  })
  // 30/04 → 30/05 → 30/06 (sem clamp até dez, âncora sempre existe até 30)
  assert.equal(l30[1].data_prevista, '2027-05-30')
  assert.equal(l30[2].data_prevista, '2027-06-30')

  // dia 29 bissexto: 29/01/2028 → 29/02/2028 → 29/03/2028
  const l29 = montarLinhasRecorrentes({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Aluguel',
    valorCentavos: 150000,
    totalParcelas: 12,
    dataPrimeiraParcela: '2028-01-29',
    origem: 'recorrente',
  })
  assert.equal(l29[0].data_prevista, '2028-01-29')
  assert.equal(l29[1].data_prevista, '2028-02-29')
  assert.equal(l29[2].data_prevista, '2028-03-29')
})

// <<< PROBLEMA 1 — recorrência COM término parando no mês exato >>>
// mesInicial '2027-01' + término '2027-12-31' → 12 parcelas; a última cai no
// MÊS do término (dia 31/12) — série "para" exatamente onde o usuário pediu.
teste('R3 — com término: 12 meses e última parcela no mês da data de término', () => {
  const mesInicial = '2027-01'
  const dataTermino = '2027-12-31'
  assert.equal(mesesAteTermino(mesInicial, dataTermino), 12)
  assert.equal(totalParcelasRecorrencia(mesInicial, dataTermino), 12)

  const linhas = montarLinhasRecorrentes({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Plano anual',
    valorCentavos: 50000,
    totalParcelas: 12,
    dataPrimeiraParcela: primeiroVencimento(mesInicial, 31),
    origem: 'recorrente',
  })
  assert.equal(linhas.length, 12)
  assert.equal(linhas[0].data_prevista, '2027-01-31')
  assert.equal(linhas[11].data_prevista, '2027-12-31')
})

// término no meio do mês: 2027-02-15 → 2 parcelas (jan + fev), última dia 15.
teste('R4 — com término no meio do mês: conta o mês inteiro do término', () => {
  assert.equal(mesesAteTermino('2027-01', '2027-02-15'), 2)
  assert.equal(totalParcelasRecorrencia('2027-01', '2027-02-15'), 2)
  const linhas = montarLinhasRecorrentes({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Curto',
    valorCentavos: 10000,
    totalParcelas: 2,
    dataPrimeiraParcela: primeiroVencimento('2027-01', 15),
    origem: 'recorrente',
  })
  assert.deepEqual(
    linhas.map((l) => l.data_prevista),
    ['2027-01-15', '2027-02-15'],
  )
})

// <<< PROBLEMA 1 — cálculo de extensão e primeiro vencimento (puritas) >>>
teste('C1 — mesesAteTermino: mesmo mês = 1; virada de ano = contagem correta', () => {
  assert.equal(mesesAteTermino('2026-09', '2026-09-30'), 1)
  assert.equal(mesesAteTermino('2026-09', '2027-02-28'), 6)
  assert.equal(mesesAteTermino('2026-01', '2026-12-31'), 12)
  assert.equal(mesesAteTermino('2026-12', '2028-12-31'), 25)
})

teste('C2 — mesesAteTermino rejeita data anterior ao mês inicial', () => {
  lancaErro(() => mesesAteTermino('2027-02', '2027-01-31'), 'término deve ser no mês inicial')
  lancaErro(() => mesesAteTermino('2026-09', '2026-08-15'), 'término deve ser no mês inicial')
})

teste('C3 — totalParcelasRecorrencia: sem término = horizonte fixo de 24', () => {
  assert.equal(totalParcelasRecorrencia('2026-09', null), 24)
  assert.equal(totalParcelasRecorrencia('2026-09', ''), 24)
  assert.equal(totalParcelasRecorrencia('2026-09', undefined), 24)
})

teste('C4 — primeiroVencimento: clamp de fim de mês e mês inválido', () => {
  assert.equal(primeiroVencimento('2027-02', 31), '2027-02-28')
  assert.equal(primeiroVencimento('2028-02', 31), '2028-02-29')
  assert.equal(primeiroVencimento('2027-04', 31), '2027-04-30')
  assert.equal(primeiroVencimento('2027-04', 15), '2027-04-15')
  lancaErro(() => primeiroVencimento('2027-02', 0), '1 a 31')
  lancaErro(() => primeiroVencimento('2027-02', 32), '1 a 31')
  lancaErro(() => primeiroVencimento('2027-13', 5), 'YYYY-MM')
})

// <<< PROBLEMA 1 — serie_data_termino propagado como metadado informativo >>>
teste('S1 — montarLinhasRecorrentes propaga serie_data_termino em cada linha', () => {
  const linhas = montarLinhasRecorrentes({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Plano anual',
    valorCentavos: 50000,
    totalParcelas: 4,
    dataPrimeiraParcela: '2027-01-15',
    origem: 'recorrente',
    serieDataTermino: '2027-04-15',
  })
  assert.equal(linhas.length, 4)
  assert.ok(linhas.every((l) => l.serie_data_termino === '2027-04-15'))
})

teste('S2 — sem série_data_termino as linhas não carregam o campo', () => {
  const linhas = montarLinhasRecorrentes({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Netflix',
    valorCentavos: 4490,
    totalParcelas: 3,
    dataPrimeiraParcela: '2027-01-10',
    origem: 'recorrente',
  })
  assert.ok(linhas.every((l) => !('serie_data_termino' in l)))
})

// <<< PROBLEMA 1 — mesmo valor repetido via gerarOcorrenciasDaSerie? NÃO: a
// lib de série parcelada divide; a de recorrência repete. Confirma que a série
// recorrente mantém todas as datas válidas e contagem 1..N. >>>
teste('V1 — recorrência gera ocorrências numeradas 1..N sem lacunas', () => {
  const linhas = montarLinhasRecorrentes({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Condomínio (valor do 1º mês, limitação assumida)',
    valorCentavos: 90000,
    totalParcelas: 6,
    dataPrimeiraParcela: '2027-01-10',
    origem: 'recorrente',
  })
  assert.deepEqual(
    linhas.map((l) => l.parcela_numero),
    [1, 2, 3, 4, 5, 6],
  )
  assert.ok(linhas.every((l) => l.total_parcelas === 6))
  assert.ok(linhas.every((l) => l.valor === 900))
  assert.ok(linhas.every((l) => l.estado === 'previsto'))
  assert.ok(linhas.every((l) => l.origem === 'recorrente'))
})

// ---------------------------------------------------------------------------

console.log(`\n${ok} ok, ${falhou} falharam`)
if (falhou > 0) process.exitCode = 1