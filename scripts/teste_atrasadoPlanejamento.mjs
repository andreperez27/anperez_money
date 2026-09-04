// ============================================================================
// Testes do indicador "Atrasado" (src/components/planejamento/comum.js)
// ============================================================================
// Execução:
//   node scripts/teste_atrasadoPlanejamento.mjs
//
// Cobertura exigida (Parte 1 da revisão do André):
//   • previsto com data no PASSADO ainda previsto (não lançado/cancelado) → atrasado;
//   • previsto com data no passado já REALIZADO → NÃO atrasado;
//   • previsto com data FUTURA → NÃO atrasado;
//   • previsto cancelado → NÃO atrasado;
//   • o item de HOJE não é "atrasado", apenas "disponível";
//   • vale para qualquer origem (manual, recorrente, jornada).
// A derivação "Disponível"/"Atrasado" é pura (somente estilo/derivação de
// estado), validável sem React.
import assert from 'node:assert/strict'
import { ehAtrasado, ehDisponivel } from '../src/components/planejamento/comum.js'

let passou = 0
let falhou = 0

function caso(nome, funcao) {
  try {
    funcao()
    console.log(`ok      — ${nome}`)
    passou++
  } catch (e) {
    console.error(`FALHOU  — ${nome}: ${e.message}`)
    falhou++
  }
}

const HOJE = '2026-09-03'
const PASSADO = '2026-08-28' // < HOJE
const FUTURO = '2026-09-10' // > HOJE

const base = (sobre) => ({
  id: 'x',
  descricao: 'Pagamento fixo Semanal',
  valor: 2130,
  tipo_op: 'Entrada',
  data_prevista: PASSADO,
  estado: 'previsto',
  origem: 'jornada',
  ...sobre,
})

caso('previsto com data no passado (origem jornada) está atrasado', () => {
  assert.equal(ehAtrasado(base({}), HOJE), true)
  assert.equal(ehDisponivel(base({}), HOJE), true)
})

caso('previsto com data no passado, origem manual, está atrasado', () => {
  assert.equal(ehAtrasado(base({ origem: 'manual' }), HOJE), true)
})

caso('previsto com data no passado, origem recorrente, está atrasado', () => {
  assert.equal(ehAtrasado(base({ origem: 'recorrente' }), HOJE), true)
})

caso('previsto com data no passado já REALIZADO não está atrasado', () => {
  assert.equal(ehAtrasado(base({ estado: 'realizado' }), HOJE), false)
})

caso('previsto com data no passado CANCELADO não está atrasado', () => {
  assert.equal(ehAtrasado(base({ estado: 'cancelado' }), HOJE), false)
})

caso('previsto com data no passado em OUTRO estado (ex.: incompleto) não está atrasado', () => {
  assert.equal(ehAtrasado(base({ estado: 'outro' }), HOJE), false)
})

caso('previsto com data FUTURA não está atrasado', () => {
  assert.equal(ehAtrasado(base({ data_prevista: FUTURO }), HOJE), false)
})

caso('previsto exatamente para HOJE não está atrasado (apenas disponível)', () => {
  const itemHoje = base({ data_prevista: HOJE })
  assert.equal(ehAtrasado(itemHoje, HOJE), false)
  assert.equal(ehDisponivel(itemHoje, HOJE), true)
})

caso('"Atrasado" tem precedência sobre "Disponível" quando a data já passou', () => {
  // O item do passado passa em ambos; a UI exibe "Atrasado" (primeiro branch).
  const passado = base({})
  assert.equal(ehAtrasado(passado, HOJE), true)
  assert.equal(ehDisponivel(passado, HOJE), true)
})

caso('realizado para hoje: nem atrasado nem disponível', () => {
  const itemHoje = base({ data_prevista: HOJE, estado: 'realizado' })
  assert.equal(ehAtrasado(itemHoje, HOJE), false)
  assert.equal(ehDisponivel(itemHoje, HOJE), false)
})

caso('sem data_prevista válida não quebra (não atrasado)', () => {
  assert.equal(ehAtrasado(base({ data_prevista: null }), HOJE), false)
  assert.equal(ehAtrasado(base({ data_prevista: undefined }), HOJE), false)
})

caso('estado previsto com data passada no futuro-fictício (ato: hoje longo) não atrasa', () => {
  assert.equal(ehAtrasado(base({}), '2026-01-01'), false)
})

console.log(`\n${passou} test(es) passaram, ${falhou} falharam.`)
process.exit(falhou > 0 ? 1 : 0)