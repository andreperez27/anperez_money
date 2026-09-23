import assert from 'node:assert/strict'
import {
  agruparConsumoPorTipo,
  normalizarIndice,
  pontoDeLinha,
  resumoTipo,
  subtrairMes,
  valorMetrica,
  variacaoSerie,
  formatarM3,
  formatarVariacao,
  rotuloMes,
  TIPOS_CONSUMO_VISIVEIS,
} from '../src/lib/consumoMensalCalc.js'

// ============================================================================
// Testes da lib PURA do relatório "Consumos" (consumoMensalCalc.js).
// Rodar: node scripts/teste_consumoMensalCalc.mjs
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

const linha = (mes, tipo, anterior, atual, valor) => ({
  mes: `${mes}-01`,
  tipo,
  leitura_anterior: anterior,
  leitura_atual: atual,
  valor,
})

caso('ponto: consumo = atual − anterior; valorM3 = valor / consumo', () => {
  const p = pontoDeLinha(linha('2026-08', 'agua', 1296.89, 1314.19, 160.99))
  assert.equal(p.consumo.toFixed(2), '17.30')
  assert.equal(p.valorM3.toFixed(4), (160.99 / 17.3).toFixed(4))
  // Sem mes_consumo (pré-migração 39): fallback para o mes gravado.
  assert.equal(p.mes, '2026-08')
})

caso('ponto: mês exibido vem de mes_consumo (boleto out → consumo set)', () => {
  const p = pontoDeLinha({ ...linha('2026-10', 'agua', 1314.19, 1332.9, 177.38), mes_consumo: '2026-09-01' })
  assert.equal(p.mes, '2026-09')
  assert.equal(p.consumo.toFixed(2), '18.71')
})

caso('ponto: mes_consumo inválido cai no fallback do mes gravado', () => {
  const p = pontoDeLinha({ ...linha('2026-10', 'agua', 1314.19, 1332.9, 177.38), mes_consumo: 'invalido' })
  assert.equal(p.mes, '2026-10')
})

caso('subtrairMes: volta 1 mês, com virada de ano', () => {
  assert.equal(subtrairMes('2026-10'), '2026-09')
  assert.equal(subtrairMes('2026-01'), '2025-12')
  assert.equal(subtrairMes('2026-03'), '2026-02')
})

caso('ponto: linha sem as duas leituras é inválida (mês incompleto)', () => {
  assert.equal(pontoDeLinha(linha('2026-09', 'gas', null, null, null)), null)
  assert.equal(pontoDeLinha(linha('2026-09', 'gas', 700, null, 100)), null)
  assert.equal(pontoDeLinha({ mes: '2026-09-01', tipo: '', leitura_anterior: 1, leitura_atual: 2, valor: 3 }), null)
})

caso('ponto: consumo zerado/negativo não gera valorM3 (sem divisão por zero)', () => {
  assert.equal(pontoDeLinha(linha('2026-09', 'agua', 100, 100, 50)).valorM3, null)
  assert.equal(pontoDeLinha(linha('2026-09', 'agua', 100, 90, 50)).valorM3, null)
})

caso('agrupa por tipo, ordena por mês e filtra pelo período (mês do consumo)', () => {
  const comConsumo = (mes, tipo, ant, atual, valor, mesConsumo) => ({
    ...linha(mes, tipo, ant, atual, valor),
    mes_consumo: mesConsumo,
  })
  const linhas = [
    comConsumo('2026-10', 'agua', 1314.19, 1332.9, 177.38, '2026-09-01'), // boleto out → consumo set
    comConsumo('2026-07', 'agua', 1279.24, 1296.89, 156.52, '2026-07-01'), // import: consumo jul
    comConsumo('2026-08', 'gas', 692.9, 706.8, 124.08, '2026-08-01'), // import: consumo ago
    comConsumo('2026-08', 'agua', 1296.89, 1314.19, 160.99, '2026-08-01'), // import: consumo ago
  ]
  const { porTipo, meses } = agruparConsumoPorTipo(linhas, { inicio: '2026-08-01', fim: '2026-08-31' })
  assert.deepStrictEqual(Object.keys(porTipo).sort(), ['agua', 'gas'])
  assert.deepStrictEqual(porTipo.agua.map((p) => p.mes), ['2026-08'])
  assert.deepStrictEqual(porTipo.gas.map((p) => p.mes), ['2026-08'])
  assert.deepStrictEqual(meses, ['2026-08'])
})

caso('tipos futuros (energia/combustível) agrupam sem travar a estrutura', () => {
  const comConsumo = (mes, tipo, ant, atual, valor) => ({
    ...linha(mes, tipo, ant, atual, valor),
    mes_consumo: '2026-08-01',
  })
  const { porTipo } = agruparConsumoPorTipo(
    [comConsumo('2026-09', 'energia', 10, 20, 100), comConsumo('2026-09', 'agua', 1, 2, 10)],
    { inicio: '2026-08-01', fim: '2026-08-31' },
  )
  assert.ok(Array.isArray(porTipo.energia))
  assert.equal(porTipo.energia[0].consumo, 10)
  assert.ok(!TIPOS_CONSUMO_VISIVEIS.includes('energia'))
})

caso('variação: último vs anterior; null sem base ou base zerada', () => {
  assert.equal(variacaoSerie([{ consumo: 10 }, { consumo: 15 }]).toFixed(1), '50.0')
  assert.equal(variacaoSerie([{ consumo: 10 }]), null)
  assert.equal(variacaoSerie([]), null)
  assert.equal(variacaoSerie([{ consumo: 0 }, { consumo: 15 }]), null)
})

caso('resumoTipo: último ponto + variação', () => {
  const r = resumoTipo([
    { mes: '2026-07', consumo: 10 },
    { mes: '2026-08', consumo: 12 },
  ])
  assert.equal(r.ultimo.mes, '2026-08')
  assert.equal(r.variacao.toFixed(1), '20.0')
  assert.deepStrictEqual(resumoTipo([]), { ultimo: null, variacao: null })
})

caso('valorMetrica: extrai por métrica; null quando ausente', () => {
  const p = { valor: 160.99, consumo: 17.3, valorM3: 9.305 }
  assert.equal(valorMetrica(p, 'valor'), 160.99)
  assert.equal(valorMetrica(p, 'consumo'), 17.3)
  assert.equal(valorMetrica(p, 'm3'), 9.305)
  assert.equal(valorMetrica({ valor: 1, consumo: 2, valorM3: null }, 'm3'), null)
  assert.equal(valorMetrica(null, 'valor'), null)
})

caso('normalizarIndice: primeiro mês = 0%, demais em % sobre a base', () => {
  const serie = [
    { mes: '2026-07', valor: 100, consumo: 10, valorM3: 5 },
    { mes: '2026-08', valor: 150, consumo: 10, valorM3: 10 },
    { mes: '2026-09', valor: 125, consumo: 20, valorM3: null },
  ]
  assert.deepStrictEqual(normalizarIndice(serie, 'valor').map((p) => p.pct), [0, 50, 25])
  assert.deepStrictEqual(normalizarIndice(serie, 'consumo').map((p) => p.pct), [0, 0, 100])
  const m3 = normalizarIndice(serie, 'm3')
  assert.equal(m3[0].pct, 0)
  assert.equal(m3[1].pct, 100)
  assert.equal(m3[2].pct, null) // ponto ausente quebra, não zera
})

caso('normalizarIndice: base zerada ou ausente indisponibiliza a métrica', () => {
  assert.deepStrictEqual(
    normalizarIndice([{ mes: '2026-07', valor: 0 }, { mes: '2026-08', valor: 10 }], 'valor').map((p) => p.pct),
    [null, null],
  )
  assert.deepStrictEqual(normalizarIndice([], 'valor'), [])
})

caso('formatação: m3, variação e rótulo do mês', () => {
  assert.equal(formatarM3(17.3), '17,30 m³')
  assert.equal(formatarM3(null), '—')
  assert.equal(formatarVariacao(8.86), '+8,9%')
  assert.equal(formatarVariacao(-3.2), '−3,2%')
  assert.equal(formatarVariacao(null), '—')
  assert.equal(rotuloMes('2026-08'), 'Ago/26')
})

console.log(`\n${ok} testes passaram, ${falhou} falharam.`)
if (falhou > 0) process.exit(1)
