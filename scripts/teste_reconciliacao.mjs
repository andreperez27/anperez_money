// ============================================================================
// Testes dos cálculos puros da reconciliação do extrato (Etapa A+B+C).
// Rodar: node scripts/teste_reconciliacao.mjs
// Sem banco e sem navegador: testa as funções reais usadas pela página
// (src/lib/extratoCalc.js + src/lib/compartilhados.js).
// Saída: "ok"/"FALHOU" por caso; exit 1 se qualquer caso falhar.
// ============================================================================

import assert from 'node:assert/strict'
import {
  somarEfeito,
  resumirMovimentacoes,
  saldoNoFimDoPeriodo,
  montarFiltroAntesDaJanela,
  saldosProgressivos,
} from '../src/lib/extratoCalc.js'
import { hoje, dataCivil } from '../src/lib/compartilhados.js'

let passou = 0
let falhou = 0

function caso(nome, fn) {
  try {
    fn()
    console.log(`ok      — ${nome}`)
    passou++
  } catch (e) {
    console.log(`FALHOU  — ${nome}: ${e.message}`)
    falhou++
  }
}

const mov = (tipo_op, valor, categoria = null) => ({ tipo_op, valor, categoria })

// ---------------------------------------------------------------------------
// TESTE 3 (§3 do pedido): exemplo numérico da regra do saldo do período
// Abertura 1000 | Entrada 500 | Saída 200 | Enviada 100 | Recebida 300 → 1500
caso('exemplo da regra: 1000+500−200−100+300 = 1500', () => {
  const linhas = [
    mov('Entrada', 500),
    mov('Saida', 200),
    mov('Saida', 100, 'transferencia'), // enviada
    mov('Entrada', 300, 'transferencia'), // recebida
  ]
  const r = resumirMovimentacoes(linhas)
  assert.equal(r.entradas, 500)
  assert.equal(r.saidas, 200)
  assert.equal(r.transfEnviadas, 100)
  assert.equal(r.transfRecebidas, 300)
  assert.equal(r.transferencias, 200)
  assert.equal(r.saldo, 500 - 200 + 200)
  assert.equal(saldoNoFimDoPeriodo(1000, r), 1500)
})

// TESTE 5: transferência interna dentro do período NÃO vira Entrada/Saída
caso('transferência interna fora de Entradas/Saídas, dentro do saldo', () => {
  const r = resumirMovimentacoes([
    mov('Entrada', 50),
    mov('Saida', 120, 'transferencia'),
  ])
  assert.equal(r.entradas, 50)
  assert.equal(r.saidas, 0)
  assert.equal(r.transferencias, -120)
  assert.equal(r.saldo, 50 - 120)
})

// TESTE 7: caixinha GUARDAR é saída comum de fluxo (linha em movimentacoes)
caso('caixinha guardar conta como Saída', () => {
  const r = resumirMovimentacoes([mov('Entrada', 900), mov('Saida', 250)])
  assert.equal(r.saidas, 250)
  assert.equal(r.saldo, 650)
})

// TESTE 8: caixinha RESGATAR é entrada comum de fluxo
caso('caixinha resgatar conta como Entrada', () => {
  const r = resumirMovimentacoes([mov('Entrada', 80)])
  assert.equal(r.entradas, 80)
})

// TESTE 9: múltiplos lançamentos no mesmo dia — soma independe da ordem
caso('mesmo dia, ordens diferentes, mesmo resultado', () => {
  const base = [
    mov('Entrada', 100),
    mov('Saida', 30),
    mov('Entrada', 70),
    mov('Saida', 20, 'transferencia'),
    mov('Entrada', 45),
  ]
  const a = resumirMovimentacoes(base)
  const b = resumirMovimentacoes([...base].reverse())
  assert.deepEqual(a, b)
})

// TESTE 2/3/4/6: efeito líquido das linhas FUTURAS (matemática do aviso;
// o filtro data > fim acontece na query .gt do hook)
caso('efeito futuro líquido: entradas − saídas (+transf. próprias)', () => {
  const futuras = [
    mov('Saida', 100), // TESTE 2
    mov('Entrada', 400), // TESTE 3
    mov('Entrada', 50),
    mov('Saida', 200), // TESTE 4: várias futuras → líquido +150
  ]
  assert.equal(somarEfeito(futuras), 150)
  // TESTE 6: transferência futura ENVIADA aparece na conta como Saída
  assert.equal(somarEfeito([mov('Saida', 300, 'transferencia')]), -300)
})

// TESTE 1/13: SEM futuros, abertura + período == saldo_atual (identidade);
// divergência tem que ser detectável — nunca corrigida automaticamente
caso('sem futuros: abertura+período fecha exato com o saldo_atual', () => {
  const antes = [mov('Entrada', 1000)] // histórico pré-período
  const periodoLinhas = [
    mov('Entrada', 500),
    mov('Saida', 200),
    mov('Saida', 100, 'transferencia'),
    mov('Entrada', 300, 'transferencia'),
  ]
  const saldoAtual = somarEfeito([...antes, ...periodoLinhas]) // autoridade
  const calculado =
    somarEfeito(antes) + resumirMovimentacoes(periodoLinhas).saldo
  assert.equal(calculado, saldoAtual)
})

caso('com futuros: saldo no fim ≠ saldo_atual (divergência explicável)', () => {
  const historico = [
    mov('Entrada', 1000),
    ...[
      mov('Entrada', 500),
      mov('Saida', 200),
    ],
    mov('Saida', 300, 'transferencia'), // FUTURA ao período
  ]
  const saldoAtual = somarEfeito(historico) // 1000
  const abertura = somarEfeito(historico.slice(0, 1)) // 1000
  const r = resumirMovimentacoes(historico.slice(1, 3)) // +300
  const fimPeriodo = saldoNoFimDoPeriodo(abertura, r) // 1300
  assert.notEqual(fimPeriodo, saldoAtual)
  assert.equal(fimPeriodo - saldoAtual, 300) // exatamente o efeito futuro
})

// TESTE 12: data civil após 21h no UTC−3 não pode "pular" para amanhã
caso('dataCivil às 22:30 locais mantém o DIA civil (não UTC)', () => {
  const noite = new Date(2026, 7, 10, 22, 30, 0) // 10/08/2026 22:30 local
  assert.equal(dataCivil(noite), '2026-08-10')
  const madrugada = new Date(2026, 0, 2, 0, 5, 0) // 02/01 00:05 local
  assert.equal(dataCivil(madrugada), '2026-01-02')
})

caso('hoje() tem formato YYYY-MM-DD com padding', () => {
  assert.match(hoje(), /^\d{4}-\d{2}-\d{2}$/)
})

caso('saldoNoFimDoPeriodo sem abertura devolve null (card oculto)', () => {
  assert.equal(saldoNoFimDoPeriodo(null, resumirMovimentacoes([])), null)
})

// TESTE §8 (evidência real Nubank PJ): abertura + movimento = saldo atual
caso('caso real: 158,69 + 2.050,00 − 705,23 − 1.069,11 = 434,35', () => {
  const linhas = [
    mov('Entrada', '2050.00'),
    mov('Saida', '705.23'),
    mov('Saida', '1069.11', 'transferencia'),
  ]
  const r = resumirMovimentacoes(linhas)
  assert.equal(r.saldo.toFixed(2), '275.66') // movimento líquido
  const fim = saldoNoFimDoPeriodo(158.69, r)
  // comparação em centavos para imunidade a ruído de ponto flutuante
  assert.equal(Math.round(fim * 100), 43435)
})

// JANELA "Últimos N": filtro do complemento na ordenação documentada
caso('filtro da janela monta o or() com data/criado_em/id', () => {
  assert.equal(
    montarFiltroAntesDaJanela({
      data: '2026-08-10',
      criado_em: '2026-08-10T12:00:00+00:00',
      id: 'abc-123',
    }),
    [
      'data.lt.2026-08-10',
      'and(data.eq.2026-08-10,criado_em.lt.2026-08-10T12:00:00+00:00)',
      'and(data.eq.2026-08-10,criado_em.eq.2026-08-10T12:00:00+00:00,id.gt.abc-123)',
    ].join(','),
  )
})

// Mesmo dia com MAIS lançamentos que o limite: as linhas cortadas pelo
// limite pertencem à ABERTURA (não podem vazar nem faltar no cálculo)
caso('janela com mesmo dia cortado: abertura pega exatamente o corte', () => {
  const linhas = [
    { data: '2026-08-12', criado_em: '2026-08-12T15:00:00+00:00', id: 'z1', tipo_op: 'Entrada', valor: 100 },
    { data: '2026-08-10', criado_em: '2026-08-10T18:00:00+00:00', id: 'y9', tipo_op: 'Entrada', valor: 50 },
    { data: '2026-08-10', criado_em: '2026-08-10T17:00:00+00:00', id: 'y8', tipo_op: 'Saida', valor: 30 }, // borda
    { data: '2026-08-10', criado_em: '2026-08-10T16:00:00+00:00', id: 'y7', tipo_op: 'Entrada', valor: 20 }, // cortada
    { data: '2026-08-05', criado_em: '2026-08-05T09:00:00+00:00', id: 'x5', tipo_op: 'Entrada', valor: 500 }, // cortada
  ]
  // mesma ordenação do hook: data desc, criado_em desc, id asc
  const ordenadas = [...linhas].sort(
    (a, b) =>
      b.data.localeCompare(a.data) ||
      b.criado_em.localeCompare(a.criado_em) ||
      (a.id < b.id ? -1 : 1),
  )
  const janela = ordenadas.slice(0, 3) // "Últimos 3"
  const ultima = janela[janela.length - 1]

  // predicado equivalente ao filtro montado para o PostgREST
  // (data desc → fora = data menor; criado_em desc → fora = criado_em menor;
  // id asc → fora = id maior)
  const antesDaJanela = (l) =>
    l.data < ultima.data ||
    (l.data === ultima.data && l.criado_em < ultima.criado_em) ||
    (l.data === ultima.data && l.criado_em === ultima.criado_em && l.id > ultima.id)

  const cortadasReais = ordenadas.filter((l) => !janela.includes(l))
  const selecionadas = ordenadas.filter(antesDaJanela)
  assert.deepEqual(selecionadas.map((l) => l.id), cortadasReais.map((l) => l.id)) // y7 e x5

  const abertura = somarEfeito(selecionadas) // 20 + 500 = 520
  const r = resumirMovimentacoes(janela) // +100 +50 −30 = +120
  assert.equal(Math.round(saldoNoFimDoPeriodo(abertura, r) * 100), 64000) // 520+120 = total das 5 linhas
})

// SALDO PROGRESSIVO (coluna Saldo linha a linha, novo extrato)
caso('saldo progressivo: linha a linha fecha com o fim do período', () => {
  // ordem do hook: data desc, criado_em desc, id asc
  const linhas = [
    { id: 'a', data: '2026-08-21', tipo_op: 'Entrada', valor: 2050.0 },
    { id: 'b', data: '2026-08-20', tipo_op: 'Saida', valor: 20.0 },
    { id: 'c', data: '2026-08-20', tipo_op: 'Saida', valor: 86.05 },
    { id: 'd', data: '2026-08-19', tipo_op: 'Saida', valor: 1069.11 }, // transf. enviada
    { id: 'e', data: '2026-08-19', tipo_op: 'Saida', valor: 705.23 },
  ]
  const saldos = saldosProgressivos(linhas, 158.69)
  // caminho cronológico (reverso do array): e → d → c → b → a
  assert.equal(Math.round(saldos.get('e') * 100), -54654) // −546,54
  assert.equal(Math.round(saldos.get('d') * 100), -161565) // −1615,65
  assert.equal(Math.round(saldos.get('c') * 100), -170170) // −1701,70
  assert.equal(Math.round(saldos.get('b') * 100), -172170) // −1721,70
  // última linha: +2050 ⇒ 158,69 + (2050 − 705,23 − 86,05 − 20 − 1069,11)
  assert.equal(Math.round(saldos.get('a') * 100), 32830)
  // identidade com a reconciliação já validada
  const fim = saldoNoFimDoPeriodo(158.69, resumirMovimentacoes(linhas))
  assert.equal(Math.round(fim * 100), Math.round(saldos.get('a') * 100))
})

caso('saldo progressivo sem abertura devolve null (coluna mostra —)', () => {
  assert.equal(saldosProgressivos([{ id: 'x', tipo_op: 'Entrada', valor: 10 }], null), null)
})

caso('saldo progressivo em centavos não acumula deriva de ponto flutuante', () => {
  const linhas = [
    { id: 'p3', data: '2026-08-03', tipo_op: 'Entrada', valor: 0.1 },
    { id: 'p2', data: '2026-08-02', tipo_op: 'Entrada', valor: 0.1 },
    { id: 'p1', data: '2026-08-01', tipo_op: 'Entrada', valor: 0.1 },
  ]
  const saldos = saldosProgressivos(linhas, 0)
  assert.equal(saldos.get('p3'), 0.3) // float puro daria 0.30000000000000004
})

console.log(`\n${passou} ok, ${falhou} falharam`)
process.exit(falhou > 0 ? 1 : 0)
