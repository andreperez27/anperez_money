import assert from 'node:assert/strict'
import { semanaIso } from '../src/lib/semana.js'
import {
  montarLinhasSerie,
  montarLinhasRecorrentes,
  calcularCancelamentoDaquiParaFrente,
  calcularRegeneração,
  calcularRegeneraçãoRecorrente,
} from '../src/lib/planejamentoSerie.js'

// ============================================================================
// Testes do NÚCLEO de séries de planejamento (ETAPA 06 / E5-D).
// Rodar: node scripts/teste_planejamentosSerie.mjs
//
// Escopo: funções PURAS de src/lib/planejamentoSerie.js. O hook
// (usePlanejamentos.js) depende do Supabase/RLS e NÃO é testável isoladamente
// sem infraestrutura nova (que a etapa manda não criar) — então a validação do
// fluxo completo ficará para o uso manual/integrado. A semana aqui é
// re-confirmada contra semanaIso(·) (fonte única), não recalculada à mão.
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

const SERIE = '11111111-1111-1111-1111-111111111111'

// Linhas prontas de uma série (semana/estado inclusos), via a própria lib.
function construirSerie({
  totalCentavos,
  totalParcelas,
  primeira,
  descricao = 'Seguro do carro',
  tipoOp = 'Saida',
}) {
  return montarLinhasSerie({
    serieId: SERIE,
    tipoOp,
    descricao,
    totalCentavos,
    totalParcelas,
    dataPrimeiraParcela: primeira,
  }).map((linha, i) => ({
    ...linha,
    id: `oc-${i + 1}`,
    estado: 'previsto',
    criado_em: '',
  }))
}

const somaCentavos = (linhas) =>
  linhas.reduce((soma, l) => soma + Math.round(l.valor * 100), 0)

// ---------------------------------------------------------------------------
// MONTAGEM DE SÉRIE (montarLinhasSerie)
// ---------------------------------------------------------------------------

teste('S1 — série de 1 parcela: 1 linha, total 1/1, data = primeira', () => {
  const linhas = montarLinhasSerie({
    serieId: SERIE,
    tipoOp: 'Entrada',
    descricao: 'Bônus',
    totalCentavos: 50000,
    totalParcelas: 1,
    dataPrimeiraParcela: '2026-08-20',
  })
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].parcela_numero, 1)
  assert.equal(linhas[0].total_parcelas, 1)
  assert.equal(linhas[0].valor, 500)
  assert.equal(linhas[0].data_prevista, '2026-08-20')
  assert.equal(linhas[0].estado, 'previsto')
})

teste('S2 — série de 3 parcelas: números 1..3, datas mensais', () => {
  const linhas = montarLinhasSerie({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Curso',
    totalCentavos: 10000,
    totalParcelas: 3,
    dataPrimeiraParcela: '2026-07-10',
  })
  assert.equal(linhas.length, 3)
  assert.deepEqual(
    linhas.map((l) => l.parcela_numero),
    [1, 2, 3],
  )
  assert.deepEqual(
    linhas.map((l) => l.data_prevista),
    ['2026-07-10', '2026-08-10', '2026-09-10'],
  )
  assert.deepEqual(
    linhas.map((l) => l.total_parcelas),
    [3, 3, 3],
  )
})

teste('S3 — série de 10 parcelas (Seguro do carro 150000/10)', () => {
  const linhas = construirSerie({
    totalCentavos: 150000,
    totalParcelas: 10,
    primeira: '2026-06-25',
  })
  assert.equal(linhas.length, 10)
})

teste('S4 — mesmo serie_id em todas as ocorrências', () => {
  const linhas = construirSerie({
    totalCentavos: 150000,
    totalParcelas: 10,
    primeira: '2026-06-25',
  })
  assert.ok(linhas.every((l) => l.serie_id === SERIE))
})

teste('S5 — parcela_numero de 1 a N sem lacunas', () => {
  const linhas = construirSerie({
    totalCentavos: 150000,
    totalParcelas: 10,
    primeira: '2026-06-25',
  })
  assert.deepEqual(
    linhas.map((l) => l.parcela_numero),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  )
})

teste('S6 — total_parcelas correto (10 em todas)', () => {
  const linhas = construirSerie({
    totalCentavos: 150000,
    totalParcelas: 10,
    primeira: '2026-06-25',
  })
  assert.deepEqual(
    linhas.map((l) => l.total_parcelas),
    new Array(10).fill(10),
  )
})

teste('S7 — valores somam exatamente o total (150000 centavos)', () => {
  const linhas = construirSerie({
    totalCentavos: 150000,
    totalParcelas: 10,
    primeira: '2026-06-25',
  })
  assert.equal(somaCentavos(linhas), 150000)
  assert.ok(linhas.every((l) => l.valor === 150))
})

teste('S8 — datas corretas: primeira 25/06/2026, última 25/03/2027', () => {
  const linhas = construirSerie({
    totalCentavos: 150000,
    totalParcelas: 10,
    primeira: '2026-06-25',
  })
  assert.equal(linhas[0].data_prevista, '2026-06-25')
  assert.equal(linhas[9].data_prevista, '2027-03-25')
})

teste('S9 — semana calculada via semanaIso; cruza mês e ano', () => {
  const linhas = construirSerie({
    totalCentavos: 150000,
    totalParcelas: 10,
    primeira: '2026-06-25',
  })
  // cada linha bate exatamente com a fonte única
  for (const l of linhas) {
    const { ano, semana } = semanaIso(l.data_prevista)
    assert.equal(l.ano_semana, ano)
    assert.equal(l.semana, semana)
  }
  // atravessa o ano: a última parcela pertence a 2027
  assert.ok(linhas.some((l) => l.ano_semana === 2027))
  assert.equal(linhas[0].semana, semanaIso('2026-06-25').semana)
})

teste('S10 — nenhuma parcela órfã / fora de 1..N', () => {
  const linhas = construirSerie({
    totalCentavos: 150000,
    totalParcelas: 10,
    primeira: '2026-06-25',
  })
  for (const l of linhas) {
    assert.ok(l.serie_id, 'todo registro deve ter serie_id')
    assert.ok(Number.isInteger(l.parcela_numero), 'parcela inteira')
    assert.ok(l.parcela_numero >= 1 && l.parcela_numero <= l.total_parcelas)
    assert.ok(l.total_parcelas > 0)
  }
})

// ---------------------------------------------------------------------------
// PERIODICIDADE SEMANAL (montarLinhasSerie) — semana via fonte única
// ---------------------------------------------------------------------------

teste('W1 — série semanal: 52 semanas e datas de 7 em 7 dias', () => {
  const linhas = montarLinhasSerie({
    serieId: SERIE,
    tipoOp: 'Entrada',
    descricao: 'Salário fixo',
    totalCentavos: 165000 * 52,
    totalParcelas: 52,
    dataPrimeiraParcela: '2026-01-05',
    periodicidade: 'semanal',
  })
  assert.equal(linhas.length, 52)
  assert.equal(linhas[0].data_prevista, '2026-01-05')
  assert.equal(linhas[1].data_prevista, '2026-01-12')
  assert.equal(linhas[51].data_prevista, '2026-12-28')
})

teste('W2 — série semanal: ano_semana/semana bater com semanaIso em cada linha', () => {
  const linhas = montarLinhasSerie({
    serieId: SERIE,
    tipoOp: 'Entrada',
    descricao: 'Salário fixo',
    totalCentavos: 165000 * 52,
    totalParcelas: 52,
    dataPrimeiraParcela: '2026-01-05',
    periodicidade: 'semanal',
  })
  for (const l of linhas) {
    const { ano, semana } = semanaIso(l.data_prevista)
    assert.equal(l.ano_semana, ano)
    assert.equal(l.semana, semana)
  }
  // semanas distintas para datas semanais distintas (não repete mês)
  const semanas = new Set(linhas.map((l) => l.semana))
  assert.ok(semanas.size >= 50, 'não deve colapsar as 52 semanas')
})

teste('W3 — série semanal: valor fixo em cada ocorrência', () => {
  const linhas = montarLinhasSerie({
    serieId: SERIE,
    tipoOp: 'Entrada',
    descricao: 'Salário fixo',
    totalCentavos: 165000 * 4,
    totalParcelas: 4,
    dataPrimeiraParcela: '2026-08-03',
    periodicidade: 'semanal',
  })
  assert.ok(linhas.every((l) => l.valor === 1650))
})

teste('W4 — regeneração semanal preserva a cadência (periodicidade repassada)', () => {
  const serie = montarLinhasSerie({
    serieId: SERIE,
    tipoOp: 'Entrada',
    descricao: 'Salário fixo',
    totalCentavos: 165000 * 4,
    totalParcelas: 4,
    dataPrimeiraParcela: '2026-08-03',
    periodicidade: 'semanal',
  }).map((l, i) => ({ ...l, id: `oc-${i + 1}`, estado: 'previsto', criado_em: '' }))

  const r = calcularRegeneração(serie, {})
  assert.ok(r.linhasParaInserir.length, 4)
  // a regeneração sem o campo pega a periodicidade da PRÓPRIA série (todas as
  // linhas nascem sem o atributo no banco; se estiver ausente, regenera com o
  // default mensal — exigência do contrato atual é apenas não quebrar a API,
  // então só validamos que o caminho não lança e mantém as 4 linhas).
  assert.ok(r.linhasParaInserir.length === 4)

  // Caminho explícito: regenerar passando periodicidade semanal.
  const r2 = calcularRegeneração(serie, { periodicidade: 'semanal' })
  assert.deepEqual(
    r2.linhasParaInserir.map((l) => l.data_prevista),
    ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'],
  )
  for (const l of r2.linhasParaInserir) {
    const { ano, semana } = semanaIso(l.data_prevista)
    assert.equal(l.ano_semana, ano)
    assert.equal(l.semana, semana)
  }
})

// ---------------------------------------------------------------------------
// CANCELAMENTO DAQUI-PARA-FRENTE (calcularCancelamentoDaquiParaFrente)
// ---------------------------------------------------------------------------

teste('C1 — cancela da parcela alvo em diante (3..6)', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  const { ids } = calcularCancelamentoDaquiParaFrente(serie, 'oc-3')
  assert.deepEqual(ids, ['oc-3', 'oc-4', 'oc-5', 'oc-6'])
})

teste('C2 — parcelas anteriores à alvo permanecem fora (1 e 2)', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  const { ids } = calcularCancelamentoDaquiParaFrente(serie, 'oc-3')
  assert.equal(ids.includes('oc-1'), false)
  assert.equal(ids.includes('oc-2'), false)
})

teste('C3 — realizado nunca entra no conjunto de cancelamento', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  serie[0].estado = 'realizado' // oc-1 (parcela 1)
  serie[1].estado = 'realizado' // oc-2 (parcela 2)
  const { ids } = calcularCancelamentoDaquiParaFrente(serie, 'oc-3')
  // alvo parcela 3 → cancela previsto 3..6; realizadas 1,2 ficam de fora
  assert.deepEqual(ids, ['oc-3', 'oc-4', 'oc-5', 'oc-6'])
})

teste('C4 — cancelado permanece cancelado (não re-cancelado)', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  serie[3].estado = 'cancelado' // oc-4 já cancelado
  const { ids } = calcularCancelamentoDaquiParaFrente(serie, 'oc-3')
  assert.equal(ids.includes('oc-4'), false)
  assert.deepEqual(ids, ['oc-3', 'oc-5', 'oc-6'])
})

teste('C5 — alvo sem série é rejeitado pela lib (avulsa é caso do hook)', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  const avulsa = { ...serie[0], serie_id: null, id: 'avulsa-1' }
  lancaErro(
    () => calcularCancelamentoDaquiParaFrente([avulsa], 'avulsa-1'),
    'não pertence a uma série',
  )
})

// ---------------------------------------------------------------------------
// REGENERAÇÃO (calcularRegeneração) — D4
// ---------------------------------------------------------------------------

teste('R1 — regeneração toca somente previsto; realizado/cancelado preservados', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  serie[0].estado = 'realizado' // oc-1
  serie[1].estado = 'realizado' // oc-2
  serie[2].estado = 'cancelado' // oc-3

  const r = calcularRegeneração(serie, {})
  // histórico preservado
  assert.deepEqual([...r.numerosPreservados].sort(), [1, 2, 3])
  // só previstas são removidas (oc-4, oc-5, oc-6)
  assert.deepEqual(r.idsPrevistoARemover.sort(), ['oc-4', 'oc-5', 'oc-6'])
  // novas previstas não reocupam números preservados
  const numerosNovos = r.linhasParaInserir.map((l) => l.parcela_numero)
  assert.ok(numerosNovos.every((n) => n >= 4))
  for (const p of r.numerosPreservados) assert.equal(numerosNovos.includes(p), false)
})

teste('R2 — aumenta o total por nova soma (valores e datas recalculadas)', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  const r = calcularRegeneração(serie, { total_centavos: 120000 })
  assert.equal(r.novoTotalCentavos, 120000)
  assert.equal(r.novoTotalParcelas, 6)
  assert.equal(r.linhasParaInserir.length, 6) // nada preservado
  assert.equal(somaCentavos(r.linhasParaInserir), 120000)
  assert.ok(r.linhasParaInserir.every((l) => l.valor === 200))
  assert.equal(r.linhasParaInserir[0].data_prevista, '2026-06-10')
})

teste('R3 — bloqueia reduzir abaixo da maior parcela já realizada', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  serie[4].estado = 'realizado' // parcela 5 realizada
  lancaErro(
    () => calcularRegeneração(serie, { total_parcelas: 4 }),
    'maior parcela já realizada é 5',
  )
})

teste('R4 — default de nova soma = total atual da série', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  const r = calcularRegeneração(serie, {})
  assert.equal(r.novoTotalCentavos, 60000)
  assert.equal(somaCentavos(r.linhasParaInserir), 60000)
  assert.equal(r.linhasParaInserir.length, 6)
})

teste('R5 — novas ocorrências têm semana coerente com a data (via semanaIso)', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  })
  const r = calcularRegeneração(serie, { total_centavos: 120000 })
  for (const l of r.linhasParaInserir) {
    const { ano, semana } = semanaIso(l.data_prevista)
    assert.equal(l.ano_semana, ano)
    assert.equal(l.semana, semana)
    assert.ok(l.serie_id)
    assert.ok(l.parcela_numero >= 1 && l.parcela_numero <= l.total_parcelas)
  }
})

teste('R6 — regeneração cruzando o ano mantém datas/semanas corretas', () => {
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-11-30', // nov→dez→jan→fev→mar→abr (virada)
  })
  const r = calcularRegeneração(serie, { total_centavos: 60000, total_parcelas: 6 })
  assert.equal(r.linhasParaInserir[0].data_prevista, '2026-11-30')
  const ultimasDatas = r.linhasParaInserir.map((l) => l.data_prevista)
  // 30/11 → 30/12 → 30/01 → 28/02 (clamp) → 30/03 (âncora) → 30/04
  assert.deepEqual(ultimasDatas, [
    '2026-11-30',
    '2026-12-30',
    '2027-01-30',
    '2027-02-28',
    '2027-03-30',
    '2027-04-30',
  ])
  assert.ok(r.linhasParaInserir.some((l) => l.ano_semana === 2027))
  for (const l of r.linhasParaInserir) {
    const { ano, semana } = semanaIso(l.data_prevista)
    assert.equal(l.ano_semana, ano)
    assert.equal(l.semana, semana)
  }
})

teste('R7 — série vazia/inválida é rejeitada', () => {
  lancaErro(() => calcularRegeneração([], {}), 'Série vazia')
  lancaErro(() => calcularRegeneração(null, {}), 'Série vazia')
})

// ---------------------------------------------------------------------------
// DESTINO PADRÃO (MIGRATION 20) — propagação para as ocorrências da série
// ---------------------------------------------------------------------------

teste('D1 — montarLinhasSerie propaga destino_padrao/cartao_padrao_id a todas as ocorrências', () => {
  const CARTAO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  const linhas = montarLinhasSerie({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Compra em cartão',
    totalCentavos: 30000,
    totalParcelas: 3,
    dataPrimeiraParcela: '2026-08-01',
    destinoPadrao: 'cartao',
    cartaoPadraoId: CARTAO,
  })
  assert.equal(linhas.length, 3)
  for (const l of linhas) {
    assert.equal(l.destino_padrao, 'cartao')
    assert.equal(l.cartao_padrao_id, CARTAO)
  }
})

teste('D2 — sem destino, as ocorrências não carregam os campos', () => {
  const linhas = montarLinhasSerie({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao: 'Sem destino',
    totalCentavos: 10000,
    totalParcelas: 2,
    dataPrimeiraParcela: '2026-08-01',
  })
  for (const l of linhas) {
    assert.equal(l.destino_padrao, undefined)
    assert.equal(l.cartao_padrao_id, undefined)
  }
})

teste('D3 — regeneração preserva o destino padrão herdado do ref', () => {
  const CARTAO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  const serie = construirSerie({
    totalCentavos: 60000,
    totalParcelas: 6,
    primeira: '2026-06-10',
  }).map((linha) => ({
    ...linha,
    destino_padrao: 'cartao',
    cartao_padrao_id: CARTAO,
  }))
  const r = calcularRegeneração(serie, { total_centavos: 90000 })
  assert.ok(r.linhasParaInserir.length > 0)
  for (const l of r.linhasParaInserir) {
    assert.equal(l.destino_padrao, 'cartao')
    assert.equal(l.cartao_padrao_id, CARTAO)
  }
})

// ---------------------------------------------------------------------------
// REGENERAÇÃO DE SÉRIE RECORRENTE (calcularRegeneraçãoRecorrente) — 01/09/2026
// ---------------------------------------------------------------------------

// Série recorrente de teste: valor MENSAL repetido (montarLinhasRecorrentes),
// com ids/estado injetados como fariam as linhas do banco.
function construirSerieRecorrente({
  totalParcelas,
  primeira,
  valorCentavos = 4490,
  descricao = 'Netflix',
  serieDataTermino = undefined,
  vetNaN = [],
  vetCancelado = [],
}) {
  return montarLinhasRecorrentes({
    serieId: SERIE,
    tipoOp: 'Saida',
    descricao,
    valorCentavos,
    totalParcelas,
    dataPrimeiraParcela: primeira,
    origem: 'recorrente',
    serieDataTermino,
  }).map((linha, i) => {
    const numero = i + 1
    const estado = vetNaN.includes(numero)
      ? 'realizado'
      : vetCancelado.includes(numero)
        ? 'cancelado'
        : 'previsto'
    return { ...linha, id: `rec-${numero}`, estado, criado_em: '' }
  })
}

teste('REC1 — recorrente: só o futuro previsto é recriado; realizado/cancelado preservados', () => {
  const serie = construirSerieRecorrente({
    totalParcelas: 6,
    primeira: '2026-06-10',
    vetNaN: [2],
    vetCancelado: [4],
  })
  const r = calcularRegeneraçãoRecorrente(serie, {})
  // Previstos eram 1,3,5,6 → todos removidos e recriados.
  assert.deepEqual(r.idsPrevistoARemover.sort(), ['rec-1', 'rec-3', 'rec-5', 'rec-6'].sort())
  // Números preservados: 2 (realizado) e 4 (cancelado) não voltam.
  assert.deepEqual(r.numerosPreservados.sort(), [2, 4].sort())
  const numerosRecriados = r.linhasParaInserir.map((l) => l.parcela_numero).sort((a, b) => a - b)
  assert.deepEqual(numerosRecriados, [1, 3, 5, 6])
  // Valor repetido (não dividido) e same serie/tipo/descricao.
  for (const l of r.linhasParaInserir) {
    assert.equal(l.valor, 44.9)
    assert.equal(l.origem, 'recorrente')
    assert.equal(l.total_parcelas, 6)
  }
})

teste('REC2 — recorrente: muda descrição e valor mensal (repetido), remonta futuro', () => {
  const serie = construirSerieRecorrente({
    totalParcelas: 4,
    primeira: '2026-06-10',
  })
  const r = calcularRegeneraçãoRecorrente(serie, {
    descricao: 'Netflix Premium',
    valorCentavos: 5590,
  })
  assert.ok(r.linhasParaInserir.length === 4)
  for (const l of r.linhasParaInserir) {
    assert.equal(l.descricao, 'Netflix Premium')
    assert.equal(l.valor, 55.9)
  }
  assert.equal(r.novoValorCentavos, 5590)
  assert.equal(r.novoTotalCentavos, 5590 * 4)
})

teste('REC3 — recorrente: nova data inicial recalcula total quando há término', () => {
  const serie = construirSerieRecorrente({
    totalParcelas: 6,
    primeira: '2026-06-10',
    serieDataTermino: '2026-11-10',
  })
  // Move o mês inicial p/ setembro; término nov/2026 → 3 parcelas (set/out/nov).
  const r = calcularRegeneraçãoRecorrente(serie, {
    data_primeira_parcela: '2026-09-10',
  })
  assert.equal(r.novoTotalParcelas, 3)
  for (const l of r.linhasParaInserir) {
    assert.equal(l.total_parcelas, 3)
    assert.equal(l.serie_data_termino, '2026-11-10')
  }
})

teste('REC4 — recorrente: preserva término/serie_data_termino e destino herdado', () => {
  const CARTAO = 'dddddddd-dddd-dddd-dddd-dddd-dddddddd'
  const serie = construirSerieRecorrente({
    totalParcelas: 3,
    primeira: '2026-06-10',
    serieDataTermino: '2026-08-10',
  }).map((l) => ({ ...l, destino_padrao: 'cartao', cartao_padrao_id: CARTAO }))
  const r = calcularRegeneraçãoRecorrente(serie, {})
  assert.equal(r.linhasParaInserir.length, 3)
  for (const l of r.linhasParaInserir) {
    assert.equal(l.serie_data_termino, '2026-08-10')
    assert.equal(l.destino_padrao, 'cartao')
    assert.equal(l.cartao_padrao_id, CARTAO)
  }
})

teste('REC5 — recorrente: edita o término e ele passa a valer para o futuro', () => {
  // Sem término (indefinida, 24 meses). Encurtar para 4 meses com término.
  const serie = construirSerieRecorrente({
    totalParcelas: 24,
    primeira: '2026-06-10',
  })
  const r = calcularRegeneraçãoRecorrente(serie, {
    valorCentavos: 4490,
    data_primeira_parcela: '2026-06-10',
    serie_data_termino: '2026-09-10',
  })
  assert.equal(r.novoTotalParcelas, 4)
  for (const l of r.linhasParaInserir) {
    assert.equal(l.serie_data_termino, '2026-09-10')
  }
})

teste('REC6 — recorrente: bloqueia reduzir abaixo da maior parcela já realizada', () => {
  // Série com término nov/2026 (6 parcelas, jun-nov), parcela 5 realizada.
  // Mudar o mês inicial p/ outubro encolhe o horizonte para 2 (< 5) → bloqueia.
  const serie = construirSerieRecorrente({
    totalParcelas: 6,
    primeira: '2026-06-10',
    serieDataTermino: '2026-11-10',
    vetNaN: [5],
  })
  lancaErro(
    () =>
      calcularRegeneraçãoRecorrente(serie, {
        data_primeira_parcela: '2026-10-10',
        valorCentavos: 4490,
      }),
    'maior parcela já realizada',
  )
})

// ---------------------------------------------------------------------------

console.log(`\n${ok} ok, ${falhou} falharam`)
if (falhou > 0) process.exitCode = 1