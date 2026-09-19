import assert from 'node:assert/strict'
import { proximaDataPendente, proximaSegunda, rotuloSemanaAtraso } from '../src/lib/pendenciaAtraso.js'

let passou = 0
let falhou = 0

function caso(nome, fn) {
  try {
    fn()
    console.log(`ok      — ${nome}`)
    passou += 1
  } catch (err) {
    console.log(`FALHOU  — ${nome}: ${err.message}`)
    falhou += 1
  }
}

caso('avulso cai na próxima segunda (hoje segunda → +7)', () => {
  assert.strictEqual(proximaSegunda('2026-09-14'), '2026-09-21')
  assert.strictEqual(
    proximaDataPendente({ data_prevista: '2026-09-10' }, '2026-09-17'),
    '2026-09-21',
  )
})

caso('avulso no meio da semana vai para a segunda seguinte', () => {
  assert.strictEqual(proximaSegunda('2026-09-17'), '2026-09-21')
})

caso('série mensal mantém o dia no mês seguinte', () => {
  assert.strictEqual(
    proximaDataPendente(
      { data_prevista: '2026-09-10', serie_id: 's1', periodicidade: 'mensal' },
      '2026-09-17',
    ),
    '2026-10-10',
  )
})

caso('série mensal com clamp (31/01 → 28/02)', () => {
  assert.strictEqual(
    proximaDataPendente(
      { data_prevista: '2026-01-31', serie_id: 's1' },
      '2026-02-05',
    ),
    '2026-02-28',
  )
})

caso('série semanal soma 7 dias', () => {
  assert.strictEqual(
    proximaDataPendente(
      { data_prevista: '2026-09-09', serie_id: 's1', periodicidade: 'semanal' },
      '2026-09-17',
    ),
    '2026-09-16',
  )
})

caso('rótulo usa a segunda da semana de origem', () => {
  assert.strictEqual(rotuloSemanaAtraso('2026-09-16'), 'Pendente (atraso da semana de 14/09)')
})

console.log('')
console.log(`${passou} ok, ${falhou} falharam`)
if (falhou > 0) process.exit(1)
