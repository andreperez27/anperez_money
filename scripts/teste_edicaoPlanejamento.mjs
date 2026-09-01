import assert from 'node:assert/strict'
import { montarAlteracoesEdicao } from '../src/lib/edicaoPlanejamento.js'

// ============================================================================
// Testes da função PURA de edição parcial de planejamento (ETAPA 06 / problema
// 2 do andaime 01/09/2026). Rodar: node scripts/teste_edicaoPlanejamento.mjs
//
// Garante que o EditarPlanejamentoForm NUNCA sobrescreve campos não tocados:
// o hook editarPlanejamento é parcial e só recebe o que mudou. Estes testes
// cobrem o problema 2 (teste obrigatório 3): carregar+salvar descrição/valor/
// data sem apagar campos não tocados.
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

// Item típico de um planejamento avulso previsto (como vem do hook).
const ITEM = {
  id: 'plano-1',
  tipo_op: 'Saida',
  descricao: 'Seguro do carro',
  valor: 141.15,
  data_prevista: '2026-09-10',
  destino_padrao: null,
  cartao_padrao_id: null,
  série: null,
}

// Helpers de cenário: nenhum campo tocado (só reenvia os mesmos valores).
const camposIntactos = {
  descricao: ITEM.descricao,
  valor: ITEM.valor,
  dataPrevista: ITEM.data_prevista,
  tipoOp: ITEM.tipo_op,
  destino: 'conta',
  contaId: '',
  cartaoId: '',
}

// ---------------------------------------------------------------------------

teste('E1 — nada tocado → {} (nenhum campo é reenviado)', () => {
  const alteracoes = montarAlteracoesEdicao({ item: ITEM, ...camposIntactos })
  assert.deepEqual(alteracoes, {})
})

teste('E2 — muda só a descrição → só { descricao }', () => {
  const alteracoes = montarAlteracoesEdicao({
    item: ITEM,
    ...camposIntactos,
    descricao: 'Seguro do carro (renovado)',
  })
  assert.deepEqual(alteracoes, { descricao: 'Seguro do carro (renovado)' })
})

teste('E3 — muda só o valor → só { valor }', () => {
  const alteracoes = montarAlteracoesEdicao({
    item: ITEM,
    ...camposIntactos,
    valor: 160,
  })
  assert.deepEqual(alteracoes, { valor: 160 })
})

teste('E4 — muda só a data → só { data_prevista }', () => {
  const alteracoes = montarAlteracoesEdicao({
    item: ITEM,
    ...camposIntactos,
    dataPrevista: '2026-10-01',
  })
  assert.deepEqual(alteracoes, { data_prevista: '2026-10-01' })
})

teste('E5 — muda só o tipo → só { tipo_op }', () => {
  const alteracoes = montarAlteracoesEdicao({
    item: ITEM,
    ...camposIntactos,
    tipoOp: 'Entrada',
  })
  assert.deepEqual(alteracoes, { tipo_op: 'Entrada' })
})

teste('E6 — muda descrição + data juntas → só os dois campos', () => {
  const alteracoes = montarAlteracoesEdicao({
    item: ITEM,
    ...camposIntactos,
    descricao: 'Netflix',
    dataPrevista: '2026-12-05',
  })
  assert.deepEqual(alteracoes, { descricao: 'Netflix', data_prevista: '2026-12-05' })
})

// ---------------------------------------------------------------------------
// DESTINO (mesma semântica do antigo "Editar destino")
// ---------------------------------------------------------------------------

teste('D1 — define CARTÃO em item sem destino → { destino_padrao, cartao_padrao_id }', () => {
  const alteracoes = montarAlteracoesEdicao({
    item: ITEM,
    ...camposIntactos,
    destino: 'cartao',
    cartaoId: 'cartao-1',
  })
  assert.deepEqual(alteracoes, {
    destino_padrao: 'cartao',
    cartao_padrao_id: 'cartao-1',
  })
})

teste('D2 — limpa CARTÃO (volta pra Conta) → { destino_padrao: null, cartao_padrao_id: null }', () => {
  const itemCartao = {
    ...ITEM,
    destino_padrao: 'cartao',
    cartao_padrao_id: 'cartao-1',
  }
  const alteracoes = montarAlteracoesEdicao({
    item: itemCartao,
    ...camposIntactos,
    destino: 'conta',
  })
  assert.deepEqual(alteracoes, { destino_padrao: null, cartao_padrao_id: null })
})

teste('D3 — troca o cartão mantendo o destino cartão → só { cartao_padrao_id }', () => {
  const itemCartao = {
    ...ITEM,
    destino_padrao: 'cartao',
    cartao_padrao_id: 'cartao-1',
  }
  const alteracoes = montarAlteracoesEdicao({
    item: itemCartao,
    ...camposIntactos,
    destino: 'cartao',
    cartaoId: 'cartao-2',
  })
  assert.deepEqual(alteracoes, { cartao_padrao_id: 'cartao-2' })
})

teste('D4 — mantém o mesmo cartão → nada de destino é reenviado', () => {
  const itemCartao = {
    ...ITEM,
    destino_padrao: 'cartao',
    cartao_padrao_id: 'cartao-1',
  }
  const alteracoes = montarAlteracoesEdicao({
    item: itemCartao,
    ...camposIntactos,
    destino: 'cartao',
    cartaoId: 'cartao-1',
  })
  assert.deepEqual(alteracoes, {})
})

teste('D5 — Conta: escolher uma conta grava { conta_destino_id }', () => {
  const alteracoes = montarAlteracoesEdicao({
    item: ITEM,
    ...camposIntactos,
    destino: 'conta',
    contaId: 'conta-1',
  })
  assert.deepEqual(alteracoes, { conta_destino_id: 'conta-1' })
})

teste('D6 — Conta: sem conta específica (conta já definida) limpa { conta_destino_id: null }', () => {
  const itemComConta = { ...ITEM, conta_destino_id: 'conta-1' }
  const alteracoes = montarAlteracoesEdicao({
    item: itemComConta,
    ...camposIntactos,
    destino: 'conta',
    contaId: '',
  })
  assert.deepEqual(alteracoes, { conta_destino_id: null })
})

teste('D7 — Conta: mantém a MESMA conta → nada de destino é reenviado', () => {
  const itemComConta = { ...ITEM, conta_destino_id: 'conta-1' }
  const alteracoes = montarAlteracoesEdicao({
    item: itemComConta,
    ...camposIntactos,
    destino: 'conta',
    contaId: 'conta-1',
  })
  assert.deepEqual(alteracoes, {})
})

teste('D8 — Conta em item de cartão: limpa o cartão E grava a conta escolhida', () => {
  const itemCartao = {
    ...ITEM,
    destino_padrao: 'cartao',
    cartao_padrao_id: 'cartao-1',
  }
  const alteracoes = montarAlteracoesEdicao({
    item: itemCartao,
    ...camposIntactos,
    destino: 'conta',
    contaId: 'conta-1',
  })
  assert.deepEqual(alteracoes, {
    destino_padrao: null,
    cartao_padrao_id: null,
    conta_destino_id: 'conta-1',
  })
})

teste('D9 — Cartão sobre item com conta definida: limpa o cartão e GRAVA null na conta', () => {
  const itemComConta = { ...ITEM, conta_destino_id: 'conta-1' }
  const alteracoes = montarAlteracoesEdicao({
    item: itemComConta,
    ...camposIntactos,
    destino: 'cartao',
    cartaoId: 'cartao-1',
  })
  assert.deepEqual(alteracoes, {
    destino_padrao: 'cartao',
    cartao_padrao_id: 'cartao-1',
    conta_destino_id: null,
  })
})

// ---------------------------------------------------------------------------

console.log(`\n${ok} ok, ${falhou} falharam`)
if (falhou > 0) process.exitCode = 1