import assert from 'node:assert/strict'
import {
  decidirAtualizacoes,
  valorFechadoDaSemana,
  semanaFechada,
  semanaDeTrabalhoDaData,
} from '../src/lib/reconciliacaoPonto.js'

// ============================================================================
// Testes da RECONCILIAÇÃO COM O PONTO (ETAPA 06/E5-G) — lib pura.
// Cobrem os 5 cenários do Passo 5 da proposta:
//   1. semana fechada com domingo trabalhado igual ao previsto → valor não muda;
//   2. semana fechada SEM domingo trabalhado → valor cai para só o fixo;
//   3. semana fechada com hora extra a mais → valor sobe;
//   4. ocorrência já realizada manualmente → não é sobrescrita;
//   5. semana futura (ainda não fechada) → mantém o valor estimado da série.
// Rodar: node scripts/teste_reconciliacaoPonto.mjs
// ============================================================================

let ok = 0
let falhou = 0

function verificar(nome, fn) {
  try {
    fn()
    ok++
    console.log(`ok      — ${nome}`)
  } catch (e) {
    falhou++
    console.error(`FALHOU  — ${nome}\n         ${e.message}`)
  }
}

// CONFIG do Ponto usada nos testes: fixo da semana. (Os valores de HE e
// dom/fer vêm prontos nas linhas ponto_excecoes — valor_he/valor_domfer.)
const CONFIG = { fixoSemana: 2130 }
// Hoje "fixo" da suíte = quinta-feira 10/09/2026.
const HOJE = '2026-09-10'

// semana 36/2026 → 31/08 (seg) a 06/09 (dom) → FECHADA em 10/09.
// semana 37/2026 → 07/09 (seg) a 13/09 (dom) → ABERTA em 10/09.
const SEMANA_FECHADA = { ano_semana_trabalho: 2026, semana_trabalho: 36 }
const SEMANA_ABERTA = { ano_semana_trabalho: 2026, semana_trabalho: 37 }

// Exceção do Ponto no formato do banco (snake_case).
const dom = (data, valorDomfer) => ({ data, tipo: 'domfer', valor_domfer: valorDomfer, valor_he: 0 })
const he = (data, valorHe) => ({ data, tipo: 'he', valor_he: valorHe, valor_domfer: 0 })

// Linha de ocorrência do Planejamento.
function linha(id, extras) {
  return {
    id,
    origem: 'jornada',
    estado: 'previsto',
    valor: 2130,
    ...extras,
  }
}

// ---------------------------------------------------------------------------
// semanaDeTrabalhoDaData — vínculo explicito
// ---------------------------------------------------------------------------
verificar('J1 — semanaDeTrabalhoDaData devolve a semana ANTERIOR à data_prevista', () => {
  // Quarta 09/09/2026 paga a semana 36/2026 (31/08–06/09).
  assert.deepEqual(semanaDeTrabalhoDaData('2026-09-09'), { ano: 2026, semana: 36 })
})
verificar('J2 — vínculo sobrevive à virada de ano ISO', () => {
  // 01/01/2026 (semana 1/2026 = 29/12/2025–04/01/2026) paga a semana ANTERIOR,
  // que pertence ao ANO ISO de 2025 (22/12 a 28/12 = semana 52/2025).
  assert.deepEqual(semanaDeTrabalhoDaData('2026-01-01'), { ano: 2025, semana: 52 })
})

// semanaFechada
verificar('J3 — semanaFechada só quando hoje > domingo', () => {
  assert.equal(semanaFechada('2026-08-31', '2026-09-06', '2026-09-10'), true)
  assert.equal(semanaFechada('2026-09-07', '2026-09-13', '2026-09-10'), false)
  assert.equal(semanaFechada('2026-09-07', '2026-09-13', '2026-09-13'), false)
})

// ---------------------------------------------------------------------------
// valorFechadoDaSemana — mesmo cálculo do card "Previsto a receber"
// ---------------------------------------------------------------------------
verificar('V1 — só o fixo quando a semana não tem exceções', () => {
  assert.equal(
    valorFechadoDaSemana({ excecoes: [], config: CONFIG, inicioISO: '2026-08-31', fimISO: '2026-09-06' }),
    2130,
  )
})
verificar('V2 — fixo + domingo (adição do dom/fer)', () => {
  const ex = [dom('2026-09-06', 480)]
  assert.equal(
    valorFechadoDaSemana({ excecoes: ex, config: CONFIG, inicioISO: '2026-08-31', fimISO: '2026-09-06' }),
    2610,
  )
})
verificar('V3 — fixo + hora extra', () => {
  const ex = [he('2026-09-02', 200)]
  assert.equal(
    valorFechadoDaSemana({ excecoes: ex, config: CONFIG, inicioISO: '2026-08-31', fimISO: '2026-09-06' }),
    2330,
  )
})

// ---------------------------------------------------------------------------
// decidirAtualizacoes — os 5 cenários do Passo 5
// ---------------------------------------------------------------------------
verificar('P1 — semana fechada com domingo trabalhado igual ao previsto: NÃO muda', async () => {
  const updates = await decidirAtualizacoes({
    linhas: [linha('j1', { ...SEMANA_FECHADA, valor: 2610 })],
    hoje: HOJE,
    buscarValorRealDaSemana: async () =>
      valorFechadoDaSemana({
        excecoes: [dom('2026-09-06', 480)],
        config: CONFIG,
        inicioISO: '2026-08-31',
        fimISO: '2026-09-06',
      }),
  })
  assert.deepEqual(updates, [])
})

verificar('P2 — semana fechada SEM domingo trabalhado: valor cai para só o fixo', async () => {
  const updates = await decidirAtualizacoes({
    linhas: [linha('j2', { ...SEMANA_FECHADA, valor: 2610 })],
    hoje: HOJE,
    buscarValorRealDaSemana: async () =>
      valorFechadoDaSemana({ excecoes: [], config: CONFIG, inicioISO: '2026-08-31', fimISO: '2026-09-06' }),
  })
  assert.deepEqual(updates, [{ id: 'j2', valor: 2130 }])
})

verificar('P3 — semana fechada com hora extra a mais: valor sobe', async () => {
  const updates = await decidirAtualizacoes({
    linhas: [linha('j3', { ...SEMANA_FECHADA, valor: 2130 })],
    hoje: HOJE,
    buscarValorRealDaSemana: async () => {
      // Soma HE de dois lançamentos na semana.
      return (
        2130 +
        valorFechadoDaSemana({
          excecoes: [he('2026-09-01', 120), he('2026-09-03', 80)],
          config: { fixoSemana: 0 },
          inicioISO: '2026-08-31',
          fimISO: '2026-09-06',
        })
      )
    },
  })
  assert.deepEqual(updates, [{ id: 'j3', valor: 2330 }])
})

verificar('P4 — ocorrência JÁ realizada manualmente: NÃO é sobrescrita', async () => {
  const updates = await decidirAtualizacoes({
    // Realizada com 2610, mas a semana fechou sem domingo (real seria 2130).
    linhas: [linha('j4', { ...SEMANA_FECHADA, estado: 'realizado', valor: 2610 })],
    hoje: HOJE,
    buscarValorRealDaSemana: async () =>
      valorFechadoDaSemana({ excecoes: [], config: CONFIG, inicioISO: '2026-08-31', fimISO: '2026-09-06' }),
  })
  assert.deepEqual(updates, [])
})

verificar('P5 — semana AINDA ABERTA (futura): mantém o valor estimado', async () => {
  const updates = await decidirAtualizacoes({
    linhas: [linha('j5', { ...SEMANA_ABERTA, valor: 2130 })],
    hoje: HOJE,
    // Mesmo que o Ponto já tivesse lançamentos, a semana não fechou → não toca.
    buscarValorRealDaSemana: async () =>
      valorFechadoDaSemana({
        excecoes: [dom('2026-09-13', 480)],
        config: CONFIG,
        inicioISO: '2026-09-07',
        fimISO: '2026-09-13',
      }),
  })
  assert.deepEqual(updates, [])
})

verificar('P6 — origem não-jornada (recorrente) nunca é reconciliada', async () => {
  const updates = await decidirAtualizacoes({
    linhas: [
      { id: 'r1', origem: 'recorrente', estado: 'previsto', valor: 100, ...SEMANA_FECHADA },
    ],
    hoje: HOJE,
    buscarValorRealDaSemana: async () => 50,
  })
  assert.deepEqual(updates, [])
})

console.log(`\n${ok} ok, ${falhou} falha(s).`)
if (falhou > 0) process.exit(1)