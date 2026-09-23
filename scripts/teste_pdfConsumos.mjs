import assert from 'node:assert/strict'
import { mesesDoAno, montarSecoesConsumos } from '../src/lib/gerarPdfConsumos.js'

// ============================================================================
// Testes dos BLOCOS do PDF de Consumos (gerarPdfConsumos.js — parte pura).
// Rodar: node scripts/teste_pdfConsumos.mjs
// O render jsPDF (montarPdfConsumos) não é testado aqui (precisa de DOM
// só no exemplo manual); a lógica de seções/séries/tabela, sim.
// ============================================================================

let ok = 0
let falhou = 0

function caso(nome, fn) {
  try {
    fn()
    ok += 1
    console.log(`ok      — ${nome}`)
  } catch (e) {
    falhou += 1
    console.error(`FALHOU  — ${nome}\n          ${e.message}`)
  }
}

const ponto = (mes, consumo, valor, m3 = null) => ({
  mes,
  leituraAnterior: 0,
  leituraAtual: consumo,
  consumo,
  valor,
  valorM3: m3 ?? (consumo > 0 ? valor / consumo : null),
})

const porTipoAno = {
  agua: [
    ponto('2026-06', 16.0, 152.9),
    ponto('2026-08', 17.3, 160.99),
    ponto('2026-09', 18.71, 177.38),
  ],
  gas: [ponto('2026-08', 13.9, 124.08)],
}

caso('mesesDoAno: eixo fixo Jan–Dez', () => {
  const meses = mesesDoAno(2026)
  assert.equal(meses.length, 12)
  assert.equal(meses[0], '2026-01')
  assert.equal(meses[11], '2026-12')
})

caso('seção: resumo do ano (total consumo, total pago, médio por m³)', () => {
  const [agua] = montarSecoesConsumos({ porTipoAno, tipos: ['agua'], metricas: ['valor'], ano: 2026 })
  assert.equal(agua.rotulo, 'Água')
  assert.equal(agua.resumo.consumoTotal.toFixed(2), (16.0 + 17.3 + 18.71).toFixed(2))
  assert.equal(agua.resumo.valorTotal.toFixed(2), (152.9 + 160.99 + 177.38).toFixed(2))
  assert.equal(agua.resumo.valorMedioM3.toFixed(4), ((152.9 + 160.99 + 177.38) / (16.0 + 17.3 + 18.71)).toFixed(4))
})

caso('seção: série Jan–Dez com gap onde não há dado (nunca zero)', () => {
  const [agua] = montarSecoesConsumos({ porTipoAno, tipos: ['agua'], metricas: ['consumo'], ano: 2026 })
  const serie = agua.series[0]
  assert.equal(serie.pontos.length, 12)
  assert.equal(serie.pontos[0].valor, null) // jan sem dado = gap
  assert.equal(serie.pontos[5].valor, 16.0) // jun
  assert.equal(serie.pontos[8].valor, 18.71) // set
  assert.equal(serie.pontos[11].valor, null) // dez sem dado = gap
})

caso('seção: tipos vazios = todas com dado, na ordem dos chips', () => {
  const secoes = montarSecoesConsumos({ porTipoAno, tipos: [], metricas: ['valor'], ano: 2026 })
  assert.deepStrictEqual(secoes.map((s) => s.tipo), ['agua', 'gas'])
})

caso('seção: tipo sem dado no ano é pulado', () => {
  const secoes = montarSecoesConsumos({ porTipoAno: { agua: porTipoAno.agua }, tipos: ['agua', 'gas'], metricas: ['valor'], ano: 2026 })
  assert.deepStrictEqual(secoes.map((s) => s.tipo), ['agua'])
})

caso('seção: cada linha tem cor própria por (tipo, métrica)', () => {
  const [agua] = montarSecoesConsumos({ porTipoAno, tipos: ['agua'], metricas: ['valor', 'consumo', 'm3'], ano: 2026 })
  const cores = agua.series.map((s) => s.corSerie)
  assert.deepStrictEqual(cores, ['#38BDF8', '#6366F1', '#2DD4BF'])
  assert.equal(new Set(cores).size, 3)
})

caso('seção: 2 métricas indexam em % (primeiro mês = 0%)', () => {
  const [agua] = montarSecoesConsumos({ porTipoAno, tipos: ['agua'], metricas: ['valor', 'consumo'], ano: 2026 })
  assert.equal(agua.indexado, true)
  assert.equal(agua.series.length, 2)
  const valor = agua.series.find((s) => s.metrica === 'valor')
  const jun = valor.pontos.find((p) => p.mes === '2026-06')
  const set = valor.pontos.find((p) => p.mes === '2026-09')
  assert.equal(jun.valor, 0)
  assert.equal(set.valor.toFixed(1), (((177.38 - 152.9) / 152.9) * 100).toFixed(1))
  assert.equal(valor.traco, 'solido')
  const consumo = agua.series.find((s) => s.metrica === 'consumo')
  assert.equal(consumo.traco, 'tracejado')
})

caso('seção: 1 métrica plota bruto (sem indexação)', () => {
  const [agua] = montarSecoesConsumos({ porTipoAno, tipos: ['agua'], metricas: ['consumo'], ano: 2026 })
  assert.equal(agua.indexado, false)
  assert.equal(agua.series[0].pontos.find((p) => p.mes === '2026-09').valor, 18.71)
})

caso('seção: tabela reusa os pontos da série (mesmo dado do gráfico)', () => {
  const [agua] = montarSecoesConsumos({ porTipoAno, tipos: ['agua'], metricas: ['valor'], ano: 2026 })
  assert.equal(agua.tabela.length, 3)
  assert.deepStrictEqual(
    agua.tabela.map((l) => l.mes),
    ['2026-06', '2026-08', '2026-09'],
  )
  assert.equal(agua.tabela[2].valor, 177.38)
})

console.log(`\n${ok} testes passaram, ${falhou} falharam.`)
if (falhou > 0) process.exit(1)
