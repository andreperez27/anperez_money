// ============================================================================
// Testes da consulta por período (F2 — listarPorPeriodo do usePlanejamentos)
// ============================================================================
// Execução (mesma convenção dos demais scripts):
//   node scripts/teste_listarPorPeriodo.mjs
//
// O hook NÃO é importável em Node puro (supabaseClient lê import.meta.env do
// Vite), então esta suíte valida o CONTRATO da consulta por partes puras:
//
//   1) validarFaixaDePeriodo (src/lib/periodos.js) — a validação que o hook
//      usa antes de consultar (formato civil, existência, inicio<=fim);
//   2) INTEGRAÇÃO CONCEITUAL (pedido F2 §16): linhas NO FORMATO EXATO que o
//      select('*') devolve, filtradas pela semântica documentada da consulta
//      (gte/lte sobre data_prevista — comparação lexicográfica segura para
//      YYYY-MM-DD estrito), fluem DIRETO para calcularResumoPlanejamentos,
//      agruparPorMes e agruparPorSemanaISO SEM adaptação;
//   3) ordenação determinística data_prevista → parcela_numero → criado_em
//      → id (mesma convenção da consulta semanal; NULLs por último, como o
//      padrão ASC do PostgreSQL).
//
// O comportamento ao vivo contra o Supabase real é verificado na etapa de UI
// (F3), quando houver página montando a consulta.
// Sem dependências externas — apenas node:assert.
import assert from 'node:assert/strict'
import { validarFaixaDePeriodo, definirPeriodo } from '../src/lib/periodos.js'
import { semanaIso } from '../src/lib/semana.js'
import { calcularResumoPlanejamentos } from '../src/lib/planejamentoCalc.js'
import {
  agruparPorMes,
  agruparPorSemanaISO,
} from '../src/lib/planejamentoAgregado.js'

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

// ---------------------------------------------------------------------------
// Linha EXATAMENTE com a forma do select('*') de planejamentos (snake_case).
function linha({
  id,
  data,
  tipoOp,
  descricao,
  valor,
  estado = 'previsto',
  serieId = null,
  parcela = null,
  criadoEm = '2026-01-01T10:00:00+00:00',
}) {
  const { ano, semana } = semanaIso(data)
  return {
    id,
    user_id: '00000000-0000-0000-0000-000000000000',
    tipo_op: tipoOp,
    descricao,
    valor,
    data_prevista: data,
    estado,
    origem: 'manual',
    conta_destino_id: null,
    ano_semana: ano,
    semana,
    lancamento_id: null,
    observacao: null,
    serie_id: serieId,
    parcela_numero: parcela?.numero ?? null,
    total_parcelas: parcela?.total ?? null,
    criado_em: criadoEm,
  }
}

// Simula a semântica da consulta: gte/lte sobre data_prevista (strings ISO
// estritas comparam igual a datas) + ordenação do contrato.
function simularListarPorPeriodo(inicioISO, fimISO, linhas) {
  const { inicio, fim } = validarFaixaDePeriodo(inicioISO, fimISO)
  const nuloPorUltimoAsc = (a, b) =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b
  return linhas
    .filter((l) => l.data_prevista >= inicio && l.data_prevista <= fim)
    .sort(
      (a, b) =>
        a.data_prevista.localeCompare(b.data_prevista) ||
        nuloPorUltimoAsc(a.parcela_numero, b.parcela_numero) ||
        String(a.criado_em).localeCompare(String(b.criado_em)) ||
        String(a.id).localeCompare(String(b.id)),
    )
}

// Compara dinheiro em CENTAVOS (soma de float nunca é comparada crua).
const centavos = (n) => Math.round(n * 100)

// ---------------------------------------------------------------------------
// Conjunto de prova: julho–outubro/2026 + uma fora de qualquer janela
const LINHAS = [
  linha({ id: 'l-salario', data: '2026-07-05', tipoOp: 'Entrada', descricao: 'Salário', valor: 5000 }),
  linha({ id: 'l-aluguel', data: '2026-08-05', tipoOp: 'Saida', descricao: 'Aluguel', valor: 1500, criadoEm: '2026-01-02T10:00:00+00:00' }),
  linha({ id: 'l-gas', data: '2026-08-05', tipoOp: 'Saida', descricao: 'Gás', valor: 120, criadoEm: '2026-01-03T10:00:00+00:00' }),
  linha({ id: 'l-vivo', data: '2026-08-12', tipoOp: 'Saida', descricao: 'Vivo', valor: 79.9, estado: 'realizado' }),
  linha({ id: 'l-freela', data: '2026-08-20', tipoOp: 'Entrada', descricao: 'Freela', valor: 800, estado: 'cancelado' }),
  linha({ id: 'l-note-1', data: '2026-09-05', tipoOp: 'Saida', descricao: 'Notebook', valor: 900, serieId: 'serie-notebook', parcela: { numero: 1, total: 3 } }),
  linha({ id: 'l-note-2', data: '2026-09-15', tipoOp: 'Saida', descricao: 'Notebook', valor: 900, serieId: 'serie-notebook', parcela: { numero: 2, total: 3 } }),
  linha({ id: 'l-note-3', data: '2026-09-25', tipoOp: 'Saida', descricao: 'Notebook', valor: 900, serieId: 'serie-notebook', parcela: { numero: 3, total: 3 } }),
  linha({ id: 'l-das', data: '2026-10-20', tipoOp: 'Saida', descricao: 'DAS-MEI', valor: 70 }),
  linha({ id: 'l-decisetreze', data: '2027-01-10', tipoOp: 'Entrada', descricao: '13º', valor: 3000 }),
]

// ---------------------------------------------------------------------------
// 1) VALIDAÇÃO DA FAIXA (o que o hook executa antes de consultar)
caso('V1 — faixa mensal válida passa intacta', () => {
  assert.deepEqual(validarFaixaDePeriodo('2026-08-01', '2026-08-31'), {
    inicio: '2026-08-01',
    fim: '2026-08-31',
  })
})
caso('V2 — intervalo de UM ÚNICO DIA é válido', () => {
  assert.deepEqual(validarFaixaDePeriodo('2026-08-20', '2026-08-20'), {
    inicio: '2026-08-20',
    fim: '2026-08-20',
  })
})
caso('V3 — datas INVERTIDAS são rejeitadas (nunca silêncio)', () => {
  assert.throws(
    () => validarFaixaDePeriodo('2026-08-31', '2026-08-01'),
    /depois do fim/,
  )
})
caso('V4 — formato não-ISO é rejeitado', () => {
  assert.throws(() => validarFaixaDePeriodo('01/08/2026', '2026-08-31'), /YYYY-MM-DD/)
})
caso('V5 — data inexistente é rejeitada (2026-02-30)', () => {
  assert.throws(() => validarFaixaDePeriodo('2026-02-30', '2026-08-31'), /inexistente/)
})
caso('V6 — ausência de data é rejeitada', () => {
  assert.throws(() => validarFaixaDePeriodo(null, '2026-08-31'))
})

// ---------------------------------------------------------------------------
// 2) JANELAS DE CONSULTA (semana / mês / trimestre / semestre / dia / vazia)
caso('C1 — janela SEMANAL: só a ocorrência daquela semana ISO', () => {
  const p = definirPeriodo('semana', '2026-08-12')
  const itens = simularListarPorPeriodo(p.inicio, p.fim, LINHAS)
  assert.deepEqual(itens.map((l) => l.id), ['l-vivo'])
})
caso('C2 — janela MENSAL inclui empate de data resolvido por criado_em', () => {
  const p = definirPeriodo('mes', '2026-08-12')
  const itens = simularListarPorPeriodo(p.inicio, p.fim, LINHAS)
  // Aluguel (criado antes) vem ANTES do Gás no mesmo 05/08.
  assert.deepEqual(itens.map((l) => l.id), ['l-aluguel', 'l-gas', 'l-vivo', 'l-freela'])
})
caso('C3 — janela TRIMESTRAL pega julho→setembro (com a série inteira)', () => {
  const p = definirPeriodo('trimestre', '2026-08-26')
  const itens = simularListarPorPeriodo(p.inicio, p.fim, LINHAS)
  assert.deepEqual(itens.map((l) => l.id), [
    'l-salario', 'l-aluguel', 'l-gas', 'l-vivo', 'l-freela',
    'l-note-1', 'l-note-2', 'l-note-3',
  ])
})
caso('C4 — janela SEMESTRAL S2/2026 inclui outubro, exclui 2027', () => {
  const p = definirPeriodo('semestre', '2026-08-26')
  const itens = simularListarPorPeriodo(p.inicio, p.fim, LINHAS)
  assert.deepEqual(itens.map((l) => l.id), [
    'l-salario', 'l-aluguel', 'l-gas', 'l-vivo', 'l-freela',
    'l-note-1', 'l-note-2', 'l-note-3', 'l-das',
  ])
})
caso('C5 — janela de UM DIA devolve exatamente aquela ocorrência', () => {
  const itens = simularListarPorPeriodo('2026-09-15', '2026-09-15', LINHAS)
  assert.deepEqual(itens.map((l) => l.id), ['l-note-2'])
})
caso('C6 — janela VAZIA devolve [] (nunca null)', () => {
  assert.deepEqual(simularListarPorPeriodo('2030-01-01', '2030-01-31', LINHAS), [])
})

// ---------------------------------------------------------------------------
// 3) RETORNO COMPATÍVEL — fluxo direto para cálculo e agregação (§16)
caso('I1 — itens vão DIRETO para calcularResumoPlanejamentos (mês)', () => {
  const p = definirPeriodo('mes', '2026-08-12')
  const itens = simularListarPorPeriodo(p.inicio, p.fim, LINHAS)
  const { totais, contagens } = calcularResumoPlanejamentos(itens)
  // Cancelado (freela) fica FORA dos totais; realizado (vivo) DENTRO delas.
  assert.equal(centavos(totais.entradas), 0)
  assert.equal(centavos(totais.saidas), centavos(1500 + 120 + 79.9))
  assert.equal(centavos(totais.resultado), centavos(-(1500 + 120 + 79.9)))
  assert.deepEqual(contagens, { previsto: 2, realizado: 1, cancelado: 1 })
})
caso('I2 — resumo do TRIMESTRE fecha com todas as 8 ocorrências ativas', () => {
  const p = definirPeriodo('trimestre', '2026-08-26')
  const itens = simularListarPorPeriodo(p.inicio, p.fim, LINHAS)
  const { totais } = calcularResumoPlanejamentos(itens)
  assert.equal(centavos(totais.entradas), centavos(5000)) // freela cancelado fora
  assert.equal(centavos(totais.saidas), centavos(1500 + 120 + 79.9 + 900 * 3))
})
caso('I3 — itens vão DIRETO para agruparPorMes (trimestre → 3 meses)', () => {
  const p = definirPeriodo('trimestre', '2026-08-26')
  const itens = simularListarPorPeriodo(p.inicio, p.fim, LINHAS)
  const grupos = agruparPorMes(itens)
  assert.deepEqual(
    grupos.map((g) => g.chave),
    ['2026-07', '2026-08', '2026-09'],
  )
})
caso('I4 — itens vão DIRETO para agruparPorSemanaISO (semana → W33)', () => {
  const p = definirPeriodo('semana', '2026-08-12')
  const grupos = agruparPorSemanaISO(simularListarPorPeriodo(p.inicio, p.fim, LINHAS))
  assert.equal(grupos.length, 1)
  assert.deepEqual(
    { ano: grupos[0].ano, semana: grupos[0].semana },
    { ano: 2026, semana: 33 },
  )
})
caso('I5 — janela vazia alimenta o resumo sem erro (tudo zerado)', () => {
  const { totais, contagens } = calcularResumoPlanejamentos([])
  assert.deepEqual(totais, { entradas: 0, saidas: 0, resultado: 0 })
  assert.deepEqual(contagens, { previsto: 0, realizado: 0, cancelado: 0 })
})
caso('I6 — série dentro da janela mantém parcela_numero/serie_id intatos', () => {
  const p = definirPeriodo('trimestre', '2026-08-26')
  const itens = simularListarPorPeriodo(p.inicio, p.fim, LINHAS)
  const nota = itens.find((l) => l.id === 'l-note-2')
  assert.equal(nota.serie_id, 'serie-notebook')
  assert.equal(nota.parcela_numero, 2)
  assert.equal(nota.total_parcelas, 3)
})

// ---------------------------------------------------------------------------
console.log(`\n${passou} ok, ${falhou} falharam`)
if (falhou > 0) process.exitCode = 1
