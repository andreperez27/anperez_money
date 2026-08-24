import assert from 'node:assert/strict'
import {
  dividirValorEmParcelas,
  dataDaParcela,
  gerarOcorrenciasDaSerie,
} from '../src/lib/parcelas.js'

// ============================================================================
// Testes das funções puras de parcelamento (ETAPA 06/E5-C).
// Rodar: node scripts/teste_parcelas.mjs
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

const somaCentavos = (parcelas) =>
  parcelas.reduce((soma, p) => soma + Math.round(p * 100), 0)

// ---------------------------------------------------------------------------
// TESTES DE DIVISÃO
// ---------------------------------------------------------------------------

teste('TESTE D1 — 150000 / 10 → dez parcelas de 15000', () => {
  assert.deepEqual(dividirValorEmParcelas(150000, 10), new Array(10).fill(15000))
})

teste('TESTE D2 — 100000 / 3 → resto nas primeiras (33334, 33333, 33333)', () => {
  assert.deepEqual(dividirValorEmParcelas(100000, 3), [33334, 33333, 33333])
})

teste('TESTE D3 — 100 / 3 → 34, 33, 33', () => {
  assert.deepEqual(dividirValorEmParcelas(100, 3), [34, 33, 33])
})

teste('TESTE D4 — 1 / 1 → [1]', () => {
  assert.deepEqual(dividirValorEmParcelas(1, 1), [1])
})

teste('TESTE D5 — soma das parcelas === total (varredura determinística)', () => {
  const totais = [1, 2, 7, 99, 100, 101, 999, 1500, 150000, 123456789]
  for (const total of totais) {
    for (let qtd = 1; qtd <= Math.min(total, 13); qtd += 1) {
      const parcelas = dividirValorEmParcelas(total, qtd)
      assert.equal(parcelas.length, qtd)
      assert.equal(parcelas.reduce((s, p) => s + p, 0), total)
      // Resto vai às primeiras: diferença entre consecutivas é no máximo 1
      for (let i = 1; i < parcelas.length; i += 1) {
        assert.ok(parcelas[i - 1] - parcelas[i] >= 0)
        assert.ok(parcelas[i - 1] - parcelas[i] <= 1)
      }
    }
  }
})

teste('TESTE D6 — nenhuma parcela contém fração de centavo', () => {
  for (const p of dividirValorEmParcelas(123456, 7)) {
    assert.ok(Number.isInteger(p))
  }
})

teste('TESTE D7 — inválidos: zero, negativo, não inteiro, NaN', () => {
  lancaErro(() => dividirValorEmParcelas(0, 3), 'inteiro positivo')
  lancaErro(() => dividirValorEmParcelas(-100, 3), 'inteiro positivo')
  lancaErro(() => dividirValorEmParcelas(100.5, 3), 'inteiro positivo')
  lancaErro(() => dividirValorEmParcelas(Number.NaN, 3), 'inteiro positivo')
})

teste('TESTE D8 — quantidade inválida: 0, negativo, fracionário, NaN', () => {
  lancaErro(() => dividirValorEmParcelas(1000, 0), 'Quantidade')
  lancaErro(() => dividirValorEmParcelas(1000, -2), 'Quantidade')
  lancaErro(() => dividirValorEmParcelas(1000, 2.5), 'Quantidade')
  lancaErro(() => dividirValorEmParcelas(1000, Number.NaN), 'Quantidade')
})

teste('TESTE D9 — total menor que a quantidade é REJEITADO (parcela R$ 0,00)', () => {
  lancaErro(() => dividirValorEmParcelas(2, 3), 'R$ 0,00')
})

// ---------------------------------------------------------------------------
// TESTES DE DATAS
// ---------------------------------------------------------------------------

teste('TESTE T1 — 25/06/2026 + 1 mês = 25/07/2026', () => {
  assert.equal(dataDaParcela('2026-06-25', 2), '2026-07-25')
})

teste('TESTE T2 — 25/06/2026 + 9 meses = 25/03/2027 (virada de ano)', () => {
  assert.equal(dataDaParcela('2026-06-25', 10), '2027-03-25')
})

teste('TESTE T3 — âncora 31: 31/01 → 28/02 → 31/03 → 30/04 → 31/05', () => {
  assert.deepEqual(
    [
      dataDaParcela('2027-01-31', 1),
      dataDaParcela('2027-01-31', 2),
      dataDaParcela('2027-01-31', 3),
      dataDaParcela('2027-01-31', 4),
      dataDaParcela('2027-01-31', 5),
    ],
    ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31'],
  )
})

teste('TESTE T4 — ano bissexto: 29/01/2024 → 29/02/2024 → 29/03/2024', () => {
  assert.equal(dataDaParcela('2024-01-29', 2), '2024-02-29')
  assert.equal(dataDaParcela('2024-01-29', 3), '2024-03-29')
})

teste('TESTE T5 — não bissexto: 29/01/2027 → 28/02/2027, âncora preservada em 29/03', () => {
  assert.equal(dataDaParcela('2027-01-29', 2), '2027-02-28')
  assert.equal(dataDaParcela('2027-01-29', 3), '2027-03-29')
})

teste('TESTE T6 — dia 28 e dia 30 atravessam meses simples', () => {
  assert.equal(dataDaParcela('2026-02-28', 2), '2026-03-28')
  assert.equal(dataDaParcela('2026-04-30', 2), '2026-05-30')
})

teste('TESTE T7 — 31/12 + 1 mês = 31/01 do ano seguinte', () => {
  assert.equal(dataDaParcela('2026-12-31', 2), '2027-01-31')
})

teste('TESTE T8 — datas civis inválidas são rejeitadas', () => {
  lancaErro(() => dataDaParcela('2026-02-30', 1), 'inexistente')
  lancaErro(() => dataDaParcela('25/06/2026', 1), 'YYYY-MM-DD')
  lancaErro(() => dataDaParcela('abc', 1), 'YYYY-MM-DD')
})

teste('TESTE T9 — número da parcela inválido é rejeitado', () => {
  lancaErro(() => dataDaParcela('2026-06-25', 0), 'inválido')
  lancaErro(() => dataDaParcela('2026-06-25', -1), 'inválido')
  lancaErro(() => dataDaParcela('2026-06-25', 1.5), 'inválido')
})

// ---------------------------------------------------------------------------
// TESTES DA SÉRIE
// ---------------------------------------------------------------------------

const seguro = () =>
  gerarOcorrenciasDaSerie({
    serieId: '11111111-1111-1111-1111-111111111111',
    tipoOp: 'Saida',
    descricao: 'Seguro do carro',
    totalCentavos: 150000,
    totalParcelas: 10,
    dataPrimeiraParcela: '2026-06-25',
  })

teste('TESTE S1 — gera exatamente 10 ocorrências', () => {
  assert.equal(seguro().length, 10)
})

teste('TESTE S2 — parcelas numeradas 1..10 com total_parcelas = 10', () => {
  const ocorrencias = seguro()
  ocorrencias.forEach((o, i) => {
    assert.equal(o.parcela_numero, i + 1)
    assert.equal(o.total_parcelas, 10)
  })
})

teste('TESTE S3 — todas compartilham o mesmo serie_id', () => {
  const ids = new Set(seguro().map((o) => o.serie_id))
  assert.equal(ids.size, 1)
  assert.equal(ids.has('11111111-1111-1111-1111-111111111111'), true)
})

teste('TESTE S4 — soma dos valores = total original (150000 centavos)', () => {
  assert.equal(somaCentavos(seguro().map((o) => o.valor)), 150000)
})

teste('TESTE S5 — primeira e última datas corretas (25/06/2026 → 25/03/2027)', () => {
  const ocorrencias = seguro()
  assert.equal(ocorrencias[0].data_prevista, '2026-06-25')
  assert.equal(ocorrencias[9].data_prevista, '2027-03-25')
})

teste('TESTE S6 — tipo/descrição replicados; opcionais só quando informados', () => {
  const ocorrencias = seguro()
  ocorrencias.forEach((o) => {
    assert.equal(o.tipo_op, 'Saida')
    assert.equal(o.descricao, 'Seguro do carro')
    assert.equal('origem' in o, false)
    assert.equal('conta_destino_id' in o, false)
    assert.equal('observacao' in o, false)
    assert.equal('ano_semana' in o, false) // semana NUNCA nasce aqui
    assert.equal('semana' in o, false)
    assert.equal('lancamento_id' in o, false)
  })

  const completa = gerarOcorrenciasDaSerie({
    serieId: 's-1',
    tipoOp: 'Entrada',
    descricao: 'Aluguel recebido',
    totalCentavos: 250000,
    totalParcelas: 3,
    dataPrimeiraParcela: '2026-09-05',
    origem: 'manual',
    contaDestinoId: 'conta-uuid',
    observacao: 'contrato 2026',
  })[0]
  assert.equal(completa.origem, 'manual')
  assert.equal(completa.conta_destino_id, 'conta-uuid')
  assert.equal(completa.observacao, 'contrato 2026')
})

teste('TESTE S7 — série de 1 parcela = avulsa datada (1/1)', () => {
  const [unica] = gerarOcorrenciasDaSerie({
    serieId: 's-unica',
    tipoOp: 'Entrada',
    descricao: 'Bônus',
    totalCentavos: 50000,
    totalParcelas: 1,
    dataPrimeiraParcela: '2026-08-20',
  })
  assert.equal(unica.parcela_numero, 1)
  assert.equal(unica.total_parcelas, 1)
  assert.equal(unica.valor, 500)
  assert.equal(unica.data_prevista, '2026-08-20')
})

teste('TESTE S8 — séries de 2 e 3 parcelas: datas mensais e valores com resto', () => {
  const duas = gerarOcorrenciasDaSerie({
    serieId: 's2',
    tipoOp: 'Saida',
    descricao: 'Curso',
    totalCentavos: 30000,
    totalParcelas: 2,
    dataPrimeiraParcela: '2026-07-10',
  })
  assert.deepEqual(
    duas.map((o) => o.data_prevista),
    ['2026-07-10', '2026-08-10'],
  )

  const tres = gerarOcorrenciasDaSerie({
    serieId: 's3',
    tipoOp: 'Saida',
    descricao: 'Notebook',
    totalCentavos: 10000,
    totalParcelas: 3,
    dataPrimeiraParcela: '2026-11-30',
  })
  // 10000/3 → 3334 + 3333 + 3333; nov→dez→jan (virada, clamp 30→31? não:
  // âncora é 30; jan tem 30 → 30/01)
  assert.deepEqual(tres.map((o) => o.valor), [33.34, 33.33, 33.33])
  assert.deepEqual(
    tres.map((o) => o.data_prevista),
    ['2026-11-30', '2026-12-30', '2027-01-30'],
  )
  assert.equal(somaCentavos(tres.map((o) => o.valor)), 10000)
})

teste('TESTE S9 — inválidos na série: série/tipo/descrição/quantidade/total', () => {
  const base = {
    serieId: 's-x',
    tipoOp: 'Saida',
    descricao: 'X',
    totalCentavos: 300,
    totalParcelas: 3,
    dataPrimeiraParcela: '2026-06-25',
  }
  lancaErro(() => gerarOcorrenciasDaSerie({ ...base, serieId: '' }), 'serieId')
  lancaErro(() => gerarOcorrenciasDaSerie({ ...base, serieId: '   ' }), 'serieId')
  lancaErro(() => gerarOcorrenciasDaSerie({ ...base, tipoOp: 'entrada' }), 'tipoOp')
  lancaErro(() => gerarOcorrenciasDaSerie({ ...base, tipoOp: undefined }), 'tipoOp')
  lancaErro(() => gerarOcorrenciasDaSerie({ ...base, descricao: '  ' }), 'descrição')
  lancaErro(
    () => gerarOcorrenciasDaSerie({ ...base, totalParcelas: 0 }),
    'Quantidade',
  )
  lancaErro(
    () => gerarOcorrenciasDaSerie({ ...base, totalCentavos: 2, totalParcelas: 3 }),
    'R$ 0,00',
  )
  lancaErro(
    () => gerarOcorrenciasDaSerie({ ...base, dataPrimeiraParcela: '2026-06-31' }),
    'inexistente',
  )
  lancaErro(() => gerarOcorrenciasDaSerie(null), 'serieId')
})

// ---------------------------------------------------------------------------

console.log(`\n${ok} ok, ${falhou} falharam`)
if (falhou > 0) process.exitCode = 1
