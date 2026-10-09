// ============================================================================
// Testes do Ponto Inteligente (src/lib/pontoCalc.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts do projeto):
//   node scripts/teste_pontoCalc.mjs
//
// Cobertura exigida pela ETAPA 07:
//   • turno que cruza a meia-noite (20:30→03:00 = 6,5h; 20:30→06:00 = 9,5h);
//   • carga padrão por dia da semana (seg–sex / sáb / domingo off);
//   • hora extra em dia normal (he = horas − base; valores em R$);
//   • domingo/feriado com base 0 e diária pela hora de saída (ate4/ate6);
//   • feriado em DIA ÚTIL tratado como dom/fer (base 0);
//   • férias avulsas (marcarFerias: zero horas, dia cumprido);
//   • fechamento semanal/mensal com dias SEM lançamento (carga cumprida);
//   • validações de data/hora/intervalo.
// Sem dependências externas — apenas node:assert.
import assert from 'node:assert/strict'
import {
  VALORES_PADRAO_PONTO,
  QUOTA_FERIAS_ANUAL,
  faltanteDoTurno,
  duracaoTurno,
  horaEmMinutos,
  baseDoDia,
  turnoPadrao,
  ehDomingo,
  ehFeriado,
  classificarDia,
  ehTurnoPadrao,
  classificarTurnoParaUI,
  calcularLancamento,
  marcarFerias,
  diasDoPeriodo,
  cargaEsperadaHoras,
  cargaCumpridaHoras,
  diasIntervaloInclusive,
  qtdDiasIntervalo,
  diasIntervaloNoAno,
  feriasUsadasNoAno,
  saldoFeriasNoAno,
  diasIntervaloNaJanela,
  fecharPeriodo,
  descontoFeriadosDoFixo,
  previstoAReceberDaSemana,
  TEMPOS_CARGA_PADRAO,
  minutosCargaDia,
  minutosCargaDiaUtil,
  formatarDuracaoHMin,
  datasFaltaPeriodo,
  calcularFalta,
  descontoFaltasDoFixo,
  creditosBancoMinutos,
  debitosBancoMinutos,
  saldoBancoMinutos,
  direitoFolgaDias,
  statusFaltasFIFO,
} from '../src/lib/pontoCalc.js'

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

// Feriados de exemplo: 2026-04-03 (sexta-feira santa) e 2026-04-21
// (tiradentes — DIA ÚTIL, terça-feira).
const FERIADOS_EX = [{ data: '2026-04-03' }, '2026-04-21']

// ---------------------------------------------------------------------------
// 1) Turno cruzando a meia-noite
caso('duração: 20:30→03:00 = 6,5h (cruza a meia-noite)', () => {
  assert.equal(duracaoTurno('20:30', '03:00'), 6.5)
})
caso('duração: 20:30→06:00 = 9,5h (cruza a meia-noite)', () => {
  assert.equal(duracaoTurno('20:30', '06:00'), 9.5)
})
caso('duração: 20:30→02:00 = 5,5h (sábado padrão)', () => {
  assert.equal(duracaoTurno('20:30', '02:00'), 5.5)
})
caso('duração: 08:00→17:00 = 9h (mesmo dia)', () => {
  assert.equal(duracaoTurno('08:00', '17:00'), 9)
})
caso('duração: 20:30→20:30 = 24h (saída igual à entrada)', () => {
  assert.equal(duracaoTurno('20:30', '20:30'), 24)
})
caso('horaEmMinutos valida e converte', () => {
  assert.equal(horaEmMinutos('20:30'), 1230)
  assert.equal(horaEmMinutos('03:05'), 185)
  assert.equal(horaEmMinutos('00:00'), 0)
})
caso('horas inválidas são rejeitadas', () => {
  for (const ruim of ['25:00', '20:60', '2030', '', '8:30', 'abc', null, undefined]) {
    assert.throws(() => horaEmMinutos(ruim), undefined, `deveria rejeitar ${JSON.stringify(ruim)}`)
  }
})

// ---------------------------------------------------------------------------
// 2) Carga padrão por dia da semana
caso('base diária: seg–sex 6,5h, sáb 5,5h, domingo 0h', () => {
  // 2026-08-10 = segunda, 15 = sábado, 16 = domingo
  assert.equal(baseDoDia('2026-08-10'), 6.5)
  assert.equal(baseDoDia('2026-08-12'), 6.5)
  assert.equal(baseDoDia('2026-08-15'), 5.5)
  assert.equal(baseDoDia('2026-08-16'), 0)
})
caso('turno padrão: seg–sex 20:30→03:00, sáb 20:30→02:00, dom null', () => {
  assert.deepEqual(turnoPadrao('2026-08-10'), { entrada: '20:30', saida: '03:00' })
  assert.deepEqual(turnoPadrao('2026-08-15'), { entrada: '20:30', saida: '02:00' })
  assert.equal(turnoPadrao('2026-08-16'), null)
})
caso('ehDomingo identifica domingos', () => {
  assert.equal(ehDomingo('2026-08-16'), true)
  assert.equal(ehDomingo('2026-08-10'), false)
})
caso('ehFeriado aceita objetos {data} e strings', () => {
  assert.equal(ehFeriado('2026-04-03', FERIADOS_EX), true)
  assert.equal(ehFeriado('2026-04-21', FERIADOS_EX), true)
  assert.equal(ehFeriado('2026-04-22', FERIADOS_EX), false)
})
caso('classificarDia: domingo e feriado → domfer; dia útil normal → he', () => {
  assert.equal(classificarDia('2026-08-16', FERIADOS_EX), 'domfer') // domingo
  assert.equal(classificarDia('2026-08-10', FERIADOS_EX), 'he')     // segunda normal
  assert.equal(classificarDia('2026-04-03', FERIADOS_EX), 'domfer') // feriado sexta
  assert.equal(classificarDia('2026-04-21', FERIADOS_EX), 'domfer') // feriado terça
})

// ---------------------------------------------------------------------------
// 3b) Regra da COMPENSAÇÃO (carga igual ao padrão, horário atípico)
caso('ehTurnoPadrao: padrão exato em dia útil é verdadeiro', () => {
  assert.equal(ehTurnoPadrao('2026-08-10', '20:30', '03:00', []), true)
  assert.equal(ehTurnoPadrao('2026-08-15', '20:30', '02:00', []), true)
})
caso('ehTurnoPadrao: qualquer desvio de horário (mesmo mesma carga) é falso', () => {
  assert.equal(ehTurnoPadrao('2026-08-15', '21:30', '03:00', []), false)
  assert.equal(ehTurnoPadrao('2026-08-10', '20:30', '02:00', []), false)
})
caso('ehTurnoPadrao: dom/fer nunca é padrão (não há horário padrão)', () => {
  assert.equal(ehTurnoPadrao('2026-08-16', '20:30', '03:00', []), false)        // domingo
  assert.equal(ehTurnoPadrao('2026-04-21', '20:30', '03:00', FERIADOS_EX), false) // feriado
})
caso('classificarTurnoParaUI: padrão exato → "padrao" (dispensa lançamento)', () => {
  assert.equal(classificarTurnoParaUI('2026-08-10', { entrada: '20:30', saida: '03:00' }, {}), 'padrao')
})
caso('classificarTurnoParaUI: mesma carga, horário atípico → "compensacao"', () => {
  // sáb 21:30→03:00 = 5,5h = carga do sábado, mas foge do padrão 20:30→02:00
  assert.equal(classificarTurnoParaUI('2026-08-15', { entrada: '21:30', saida: '03:00' }, {}), 'compensacao')
  assert.equal(classificarTurnoParaUI('2026-08-10', { entrada: '21:30', saida: '04:00' }, {}), 'compensacao')
})
caso('classificarTurnoParaUI: carga acima da base → he; dom/fer → domfer', () => {
  assert.equal(classificarTurnoParaUI('2026-08-10', { entrada: '20:30', saida: '06:00' }, {}), 'he')
  assert.equal(classificarTurnoParaUI('2026-08-16', { entrada: '20:30', saida: '03:00' }, {}), 'domfer')
})
caso('compensação vira lançamento tipo he com he = 0 (registro de controle)', () => {
  const r = calcularLancamento('2026-08-15', { entrada: '21:30', saida: '03:00' }, {})
  assert.equal(r.tipo, 'he')
  assert.equal(r.horas, 5.5)
  assert.equal(r.he, 0)
  assert.equal(r.valorHe, 0)
})

// ---------------------------------------------------------------------------
// 3) Hora extra em dia normal
caso('HE seg: 20:30→06:00 (9,5h) em segunda = 3h de HE e R$ 120', () => {
  const r = calcularLancamento('2026-08-10', { entrada: '20:30', saida: '06:00' }, { feriados: [] })
  assert.deepEqual(r, {
    tipo: 'he',
    horas: 9.5,
    he: 3,
    domferQtd: 0,
    valorHe: 120.0,
    valorDomfer: 0,
  })
})
caso('HE sáb: 20:30→06:00 (9,5h) em sábado = 4h de HE e R$ 160', () => {
  const r = calcularLancamento('2026-08-15', { entrada: '20:30', saida: '06:00' }, {})
  assert.equal(r.tipo, 'he')
  assert.equal(r.horas, 9.5)
  assert.equal(r.he, 4)
  assert.equal(r.valorHe, 160.0)
})
caso('turno padrão completo (20:30→03:00) em dia útil = zero HE', () => {
  const r = calcularLancamento('2026-08-12', { entrada: '20:30', saida: '03:00' }, {})
  assert.equal(r.he, 0)
  assert.equal(r.valorHe, 0)
  assert.equal(r.horas, 6.5)
})
caso('trabalhar MENOS que a base não gera HE negativa (regra sem falta)', () => {
  const r = calcularLancamento('2026-08-12', { entrada: '22:00', saida: '03:00' }, {})
  assert.equal(r.he, 0)
  assert.equal(r.valorHe, 0)
})

// ---------------------------------------------------------------------------
// 4) Domingo/feriado — base 0, diária pela hora de saída
caso('domingo 20:30→03:00 (6,5h) = domfer 1, diária ate4 (400)', () => {
  const r = calcularLancamento('2026-08-16', { entrada: '20:30', saida: '03:00' }, {})
  assert.deepEqual(r, {
    tipo: 'domfer',
    horas: 6.5,
    he: 0,
    domferQtd: 1,
    valorHe: 0,
    valorDomfer: 400.0,
  })
})
caso('domingo 20:30→06:00 = domfer 1, diária ATE6 (500) por sair após 04:00', () => {
  const r = calcularLancamento('2026-08-16', { entrada: '20:30', saida: '06:00' }, {})
  assert.equal(r.valorDomfer, 500.0)
})
caso('domingo 20:30→04:01 = ATE6; 20:30→04:00 = ATE4 (regra de borda do antigo)', () => {
  assert.equal(calcularLancamento('2026-08-16', { entrada: '20:30', saida: '04:01' }, {}).valorDomfer, 500.0)
  assert.equal(calcularLancamento('2026-08-16', { entrada: '20:30', saida: '04:00' }, {}).valorDomfer, 400.0)
})
caso('feriado em dia útil (terça 21/04) trabalhando = tratado como dom/fer', () => {
  const r = calcularLancamento('2026-04-21', { entrada: '20:30', saida: '03:00' }, { feriados: FERIADOS_EX })
  assert.equal(r.tipo, 'domfer')
  assert.equal(r.domferQtd, 1)
  assert.equal(r.valorDomfer, 400.0)
  assert.equal(r.he, 0)
})
caso('config personalizada altera os valores congeláveis', () => {
  const r = calcularLancamento('2026-08-10', { entrada: '20:30', saida: '06:00' }, {
    feriados: [],
    config: { ...VALORES_PADRAO_PONTO, heHora: 45 },
  })
  assert.equal(r.valorHe, 135.0)
})

// ---------------------------------------------------------------------------
// 5) Férias por INTERVALO (nova regra: início/fim, saldo de 15 dias/ano)
caso('diasIntervaloInclusive: dia único = 1; intervalo conta inclusive', () => {
  assert.equal(diasIntervaloInclusive('2026-07-01', '2026-07-01'), 1)
  assert.equal(diasIntervaloInclusive('2026-07-01', '2026-07-15'), 15)
  assert.equal(diasIntervaloInclusive('2026-07-01', '2026-08-10'), 41)
})
caso('diasIntervaloInclusive rejeita fim antes do início', () => {
  assert.throws(() => diasIntervaloInclusive('2026-07-15', '2026-07-01'))
})
caso('qtdDiasIntervalo usa {data_inicio, data_fim}', () => {
  assert.equal(qtdDiasIntervalo({ data_inicio: '2026-07-01', data_fim: '2026-07-15' }), 15)
})
caso('diasIntervaloNoAno clampa pontas que cruzam o ano', () => {
  const f = { data_inicio: '2026-12-20', data_fim: '2027-01-10' }
  assert.equal(diasIntervaloNoAno(f, 2026), 12) // 20→31 = 12 dias
  assert.equal(diasIntervaloNoAno(f, 2027), 10) // 01→10 = 10 dias
})
caso('feriasUsadasNoAno soma intervalos; saldo = 15 − usados', () => {
  assert.equal(QUOTA_FERIAS_ANUAL, 15)
  const ferias = [
    { data_inicio: '2026-07-01', data_fim: '2026-07-15' }, // 15
    { data_inicio: '2026-12-20', data_fim: '2026-12-22' }, // 3
  ]
  assert.equal(feriasUsadasNoAno(ferias, 2026), 18)
  assert.equal(saldoFeriasNoAno(ferias, 2026), -3)
  assert.equal(saldoFeriasNoAno(ferias, 2027), 15)
})
caso('diasIntervaloNaJanela conta só a fatia dentro do mês', () => {
  const f = { data_inicio: '2026-07-01', data_fim: '2026-08-10' }
  assert.equal(diasIntervaloNaJanela(f, '2026-07-01', '2026-07-31'), 31) // julho inteiro
  assert.equal(diasIntervaloNaJanela(f, '2026-08-01', '2026-08-31'), 10) // 01→10
  assert.equal(diasIntervaloNaJanela(f, '2026-09-01', '2026-09-30'), 0)
})
caso('fecharPeriodo conta diasFerias dos intervalos na janela', () => {
  const resumo = fecharPeriodo([], { inicioISO: '2026-07-01', fimISO: '2026-07-31' }, [
    { data_inicio: '2026-07-01', data_fim: '2026-07-15' },
    { data_inicio: '2026-07-20', data_fim: '2026-08-05' },
  ])
  assert.equal(resumo.diasFerias, 27) // 15 em julho + 12 (20→31) do intervalo que cruza
  assert.equal(resumo.diasTrabalho, 0)
})
caso('carga esperada abate dias em férias (ficam neutros no saldo)', () => {
  // A semana 10→16/08/2026 em férias remove exatamente 38h da carga esperada
  // de agosto (seg–sex 5×6,5 + sáb 5,5); os dias viram neutros no saldo.
  const ferias = [{ data_inicio: '2026-08-10', data_fim: '2026-08-16' }]
  const cheio = cargaEsperadaHoras('2026-08-01', '2026-08-31', [])
  const comFerias = cargaEsperadaHoras('2026-08-01', '2026-08-31', [], ferias)
  assert.equal(cheio - comFerias, 38.0)
})
caso('marcarFerias (legado) continua devolvendo zero horas', () => {
  assert.deepEqual(marcarFerias(), {
    tipo: 'ferias',
    horas: 0,
    he: 0,
    domferQtd: 0,
    valorHe: 0,
    valorDomfer: 0,
  })
})

// ---------------------------------------------------------------------------
// 6) Fechamento semanal/mensal com dias SEM lançamento
caso('diasDoPeriodo: lista inclusive as pontas e soma a carga esperada', () => {
  assert.deepEqual(diasDoPeriodo('2026-08-10', '2026-08-14'), [
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
  ])
})
caso('carga esperada de uma semana comum (seg 10 → dom 16/08/2026) = 38h', () => {
  // 5×6,5 + 1×5,5 = 38h? Não: seg–sex (5) = 32,5 + sáb 5,5 = 38. Domingo 0.
  assert.equal(cargaEsperadaHoras('2026-08-10', '2026-08-16', []), 38.0)
})
caso('carga esperada com feriado no meio (terça 11/08/2026) desconta a base', () => {
  // seg(6,5) + [ter 11 feriado = 0] + qua/qui/sex (3×6,5) = 26
  assert.equal(cargaEsperadaHoras('2026-08-10', '2026-08-14', ['2026-08-11']), 26.0)
})
caso('semana com apenas uma HE lançada fecha certo (demais dias cumpridos)', () => {
  const excecoes = [
    { data: '2026-08-10', tipo: 'he', horas: 9.5, he: 3, domferQtd: 0, valorHe: 120, valorDomfer: 0 },
  ]
  const resumo = fecharPeriodo(excecoes, { inicioISO: '2026-08-10', fimISO: '2026-08-16' })
  assert.deepEqual(resumo, {
    diasTrabalho: 1,
    diasFerias: 0,
    horas: 9.5,
    he: 3,
    horasDomfer: 0,
    domferQtd: 0,
    valorHe: 120,
    valorDomfer: 0,
  })
})
caso('mês com dom/fer + férias + HE soma tudo separando categorias', () => {
  const excecoes = [
    // domingo 02/08: domfer
    { data: '2026-08-02', tipo: 'domfer', horas: 6.5, he: 0, domferQtd: 1, valorHe: 0, valorDomfer: 400 },
    // segunda 03/08: férias
    { data: '2026-08-03', tipo: 'ferias', horas: 0, he: 0, domferQtd: 0, valorHe: 0, valorDomfer: 0 },
    // quinta 06/08: HE
    { data: '2026-08-06', tipo: 'he', horas: 9.5, he: 3, domferQtd: 0, valorHe: 120, valorDomfer: 0 },
  ]
  const resumo = fecharPeriodo(excecoes, { inicioISO: '2026-08-01', fimISO: '2026-08-31' })
  assert.equal(resumo.diasFerias, 1)
  assert.equal(resumo.diasTrabalho, 2)
  assert.equal(resumo.horas, 16.0)      // 6,5 + 9,5
  assert.equal(resumo.he, 3)
  assert.equal(resumo.domferQtd, 1)
  assert.equal(resumo.valorHe, 120)
  assert.equal(resumo.valorDomfer, 400)
})
caso('fecharPeriodo sem faixa soma todas as exceções; férias não somam horas', () => {
  const resumo = fecharPeriodo([
    { data: '2026-08-03', tipo: 'ferias', horas: 0, he: 0, domferQtd: 0, valorHe: 0, valorDomfer: 0 },
    { data: '2026-08-04', tipo: 'he', horas: 6.5, he: 0, domferQtd: 0, valorHe: 0, valorDomfer: 0 },
  ])
  assert.equal(resumo.diasFerias, 1)
  assert.equal(resumo.horas, 6.5)
})

caso('fecharPeriodo lê colunas do BANCO (snake_case) — card dom/fer nunca zera', () => {
  // Formato que o select '*' do supabase devolve a partir da migration 22:
  // domfer_qtd / valor_he / valor_domfer (snake_case). O bug dos cards era
  // ler camelCase (ex.domferQtd) → domingo/feriado sempre 0.
  const excecoes = [
    { data: '2026-08-02', tipo: 'domfer', horas: 6.5, he: 0, domfer_qtd: 1, valor_he: 0, valor_domfer: 400 },
    { data: '2026-08-10', tipo: 'he', horas: 9.5, he: 3, domfer_qtd: 0, valor_he: 120, valor_domfer: 0 },
  ]
  const resumo = fecharPeriodo(excecoes, { inicioISO: '2026-08-01', fimISO: '2026-08-31' })
  assert.equal(resumo.domferQtd, 1)
  assert.equal(resumo.valorDomfer, 400)
  assert.equal(resumo.valorHe, 120)
  assert.equal(resumo.horas, 16.0)
  assert.equal(resumo.he, 3)
})

// ---------------------------------------------------------------------------
// 7) Validações de entrada
caso('datas inválidas são rejeitadas', () => {
  for (const ruim of ['2026-02-30', '2026-13-01', '31/08/2026', 'abc', '']) {
    assert.throws(() => baseDoDia(ruim), undefined, `deveria rejeitar ${JSON.stringify(ruim)}`)
  }
})
caso('periodo inválido é rejeitado (início depois do fim)', () => {
  assert.throws(() => diasDoPeriodo('2026-08-16', '2026-08-10'))
})
caso('calcularLancamento exige entrada/saída e data válidas', () => {
  assert.throws(() => calcularLancamento('2026-08-10', { entrada: '', saida: null }, {}))
})

// ---------------------------------------------------------------------------
// 8) Carga cumprida: dom/fer não entra na contagem (Parte 1.2)
// ---------------------------------------------------------------------------
// Semana 03/08→09/08/2026 (seg-dom). Sábado 08/08 com HE (20:30→06:00 =
// 9,5h; base sáb = 5,5h; he = 4h). Domingo 09/08 com domfer (20:30→03:00 =
// 6,5h; base dom = 0). A carga cumprida deve ser 38h (carga esperada) + 4h
// (HE) = 42h — o domingo NÃO entra na carga, pois tem card e remuneração
// próprios (diária). O saldo deve ser +4h (só a HE isolada).
caso('cargaCumpridaHoras: dom/fer ENTRA na carga, saldo soma HE + domfer', () => {
  const excecoes = [
    // sáb 08/08: HE (saiu 06:00 = 4h a mais que a base 5,5h)
    { data: '2026-08-08', tipo: 'he', horas: 9.5, he: 4, domfer_qtd: 0, valor_he: 160, valor_domfer: 0 },
    // dom 09/08: domfer (base 0; diária ate4 = 400)
    { data: '2026-08-09', tipo: 'domfer', horas: 6.5, he: 0, domfer_qtd: 1, valor_he: 0, valor_domfer: 400 },
  ]
  const janela = { inicioISO: '2026-08-03', fimISO: '2026-08-09' }

  // Carga esperada da semana: seg–sex = 5 × 6,5 = 32,5h; sáb = 5,5h = 38h.
  const esperada = cargaEsperadaHoras(janela.inicioISO, janela.fimISO)
  assert.equal(esperada, 38)

  // Carga cumprida: 38h (esperada) + 4h (HE) + 6,5h (domfer) = 48,5h.
  const cumprida = cargaCumpridaHoras(excecoes, janela)
  assert.equal(cumprida, 48.5)

  // Saldo: +4h HE + 6,5h domfer = +10,5h (dom/fer conta na carga cumprida).
  const resumo = fecharPeriodo(excecoes, janela)
  assert.equal(resumo.he, 4)
  assert.equal(resumo.horasDomfer, 6.5)
  assert.equal(resumo.domferQtd, 1)
  // resumo.horas é a soma bruta (9,5 + 6,5 = 16) — NÃO é a carga cumprida.
  assert.equal(resumo.horas, 16)
})

// ---------------------------------------------------------------------------
// 9) Desconto do fixo por feriado na semana (regra 04/09/2026)
// ---------------------------------------------------------------------------
// Semana 31/08/2026 (seg) → 06/09/2026 (dom). Fixo 2130 → por feriado útil
// (seg–sáb) descorna 2130/6 = 355. Feriado em domingo (06/09) não desconta.
const SEMANA_FERIADO = { inicioISO: '2026-08-31', fimISO: '2026-09-06' }

caso('desconto: feriado em DIA ÚTIL (sexta) desconta 1/6 do fixo', () => {
  assert.equal(
    descontoFeriadosDoFixo(2130, [{ data: '2026-09-04' }], SEMANA_FERIADO.inicioISO, SEMANA_FERIADO.fimISO),
    355,
  )
})
caso('desconto: feriado em DOMINGO não desconta', () => {
  assert.equal(
    descontoFeriadosDoFixo(2130, [{ data: '2026-09-06' }], SEMANA_FERIADO.inicioISO, SEMANA_FERIADO.fimISO),
    0,
  )
})
caso('desconto: vários feriados úteis somam o desconto', () => {
  assert.equal(
    descontoFeriadosDoFixo(
      2130,
      [{ data: '2026-09-02' }, { data: '2026-09-04' }],
      SEMANA_FERIADO.inicioISO,
      SEMANA_FERIADO.fimISO,
    ),
    710,
  )
})
caso('desconto: feriado FORA da janela não conta', () => {
  assert.equal(
    descontoFeriadosDoFixo(2130, [{ data: '2026-09-10' }], SEMANA_FERIADO.inicioISO, SEMANA_FERIADO.fimISO),
    0,
  )
})
caso('desconto: sem janela considera todos os feriados recebidos', () => {
  assert.equal(descontoFeriadosDoFixo(2130, [{ data: '2026-09-04' }]), 355)
})
caso('desconto: aceita feriados como string no array', () => {
  assert.equal(
    descontoFeriadosDoFixo(2130, ['2026-09-04'], SEMANA_FERIADO.inicioISO, SEMANA_FERIADO.fimISO),
    355,
  )
})
caso('previstoAReceberDaSemana: fixo − desconto(feriado útil) + HE + diárias', () => {
  const resumo = { valorHe: 200, valorDomfer: 480 }
  const r = previstoAReceberDaSemana({
    fixoSemana: 2130,
    resumo,
    feriados: [{ data: '2026-09-04' }],
    inicioISO: SEMANA_FERIADO.inicioISO,
    fimISO: SEMANA_FERIADO.fimISO,
  })
  // 2130 − 355 + 200 + 480 = 2455
  assert.equal(r.valor, 2455)
  assert.equal(r.desconto, 355)
})
caso('previstoAReceberDaSemana: feriado em domingo mantém o fixo inteiro', () => {
  const resumo = { valorHe: 0, valorDomfer: 480 }
  const r = previstoAReceberDaSemana({
    fixoSemana: 2130,
    resumo,
    feriados: [{ data: '2026-09-06' }],
    inicioISO: SEMANA_FERIADO.inicioISO,
    fimISO: SEMANA_FERIADO.fimISO,
  })
  // 2130 − 0 + 0 + 480 = 2610
  assert.equal(r.valor, 2610)
  assert.equal(r.desconto, 0)
})
caso('previstoAReceberDaSemana: sem feriados mantém o soma normal', () => {
  const resumo = { valorHe: 200, valorDomfer: 0 }
  const r = previstoAReceberDaSemana({ fixoSemana: 2130, resumo })
  assert.equal(r.valor, 2330)
  assert.equal(r.desconto, 0)
})

// ---------------------------------------------------------------------------
// FASE 2 — faltas + banco de horas (23/09/2026)
// ---------------------------------------------------------------------------
const FALTA_SEG = (extras = {}) => ({
  tipo: 'falta',
  data: '2026-09-09',
  minutos_falta: 390,
  valor_desconto: 275,
  destino: 'pagamento',
  ...extras,
})

caso('minutosCargaDia: seg–sex 390, sáb 330, dom 0 (da config, sem literal)', () => {
  assert.equal(minutosCargaDia('2026-09-09'), 390) // quarta
  assert.equal(minutosCargaDia('2026-09-12'), 330) // sábado
  assert.equal(minutosCargaDia('2026-09-13'), 0) // domingo
  assert.equal(minutosCargaDiaUtil(), 390)
  assert.equal(minutosCargaDia('2026-09-09', { ...TEMPOS_CARGA_PADRAO, utilSaida: 120 }), 330)
})

caso('formatarDuracaoHMin: "2h05", zero neutro e negativo com sinal', () => {
  assert.equal(formatarDuracaoHMin(125), '2h05')
  assert.equal(formatarDuracaoHMin(390), '6h30')
  assert.equal(formatarDuracaoHMin(0), '0h00')
  assert.equal(formatarDuracaoHMin(-90), '-1h30')
})

caso('calcularFalta integral: minutos da carga + desconto fixo/6 vigente', () => {
  const f = calcularFalta('2026-09-09', { integral: true, destino: 'pagamento', fixoSemana: 1650 })
  assert.deepEqual(f, { tipo: 'falta', minutos: 390, valor_desconto: 275, destino: 'pagamento' })
  const sab = calcularFalta('2026-09-12', { integral: true, destino: 'pagamento', fixoSemana: 1650 })
  assert.equal(sab.minutos, 330)
  assert.equal(sab.valor_desconto, 275)
  // Fixo alterado na config reflete no desconto (nada travado no código).
  const reaj = calcularFalta('2026-09-09', { integral: true, destino: 'pagamento', fixoSemana: 1800 })
  assert.equal(reaj.valor_desconto, 300)
})

caso('calcularFalta parcial: proporcional (min/carga) × (fixo/6)', () => {
  const f = calcularFalta('2026-09-09', { integral: false, minutos: 195, destino: 'pagamento', fixoSemana: 1650 })
  assert.equal(f.minutos, 195)
  assert.equal(f.valor_desconto, 137.5) // (195/390) × 275
})

caso('calcularFalta banco/abonada: sem desconto, minutos iguais', () => {
  assert.equal(calcularFalta('2026-09-09', { integral: true, destino: 'banco', fixoSemana: 1650 }).valor_desconto, 0)
  assert.equal(calcularFalta('2026-09-09', { integral: true, destino: 'abonada', fixoSemana: 1650 }).valor_desconto, 0)
})

caso('calcularFalta rejeita domingo, feriado, férias, destino e minutos inválidos', () => {
  assert.throws(() => calcularFalta('2026-09-13', { integral: true }), /dia útil/)
  assert.throws(() => calcularFalta('2026-09-09', { integral: true, feriados: ['2026-09-09'] }), /dia útil/)
  assert.throws(
    () => calcularFalta('2026-09-09', { integral: true, ferias: [{ data_inicio: '2026-09-01', data_fim: '2026-09-30' }] }),
    /férias/,
  )
  assert.throws(() => calcularFalta('2026-09-09', { integral: true, destino: 'ferias' }), /Destino inválido/)
  assert.throws(() => calcularFalta('2026-09-09', { integral: false, minutos: 0 }), /minutos/)
})

caso('datasFaltaPeriodo: gera por data pulando dom/fer; férias vira conflito', () => {
  // 07/09 (seg) a 13/09 (dom): 6 dias úteis, domingo pulado em silêncio.
  const r = datasFaltaPeriodo('2026-09-07', '2026-09-13', { feriados: ['2026-09-09'] })
  assert.deepStrictEqual(r.datas, ['2026-09-07', '2026-09-08', '2026-09-10', '2026-09-11', '2026-09-12'])
  assert.deepStrictEqual(r.ignoradosDomFer, ['2026-09-09', '2026-09-13'])
  assert.deepStrictEqual(r.emFerias, [])
  const c = datasFaltaPeriodo('2026-09-07', '2026-09-08', { ferias: [{ data_inicio: '2026-09-08', data_fim: '2026-09-08' }] })
  assert.deepStrictEqual(c.datas, ['2026-09-07'])
  assert.deepStrictEqual(c.emFerias, ['2026-09-08'])
  // Dia único: fim default = início.
  assert.deepStrictEqual(datasFaltaPeriodo('2026-09-09', null, {}).datas, ['2026-09-09'])
})

caso('descontoFaltasDoFixo: soma congelados de pagamento na janela; ignora resto', () => {
  const faltas = [
    FALTA_SEG(),
    FALTA_SEG({ data: '2026-09-10', minutos_falta: 195, valor_desconto: 137.5 }),
    FALTA_SEG({ data: '2026-09-11', destino: 'banco', valor_desconto: 0 }),
    FALTA_SEG({ data: '2026-09-12', destino: 'abonada', valor_desconto: 0 }),
    { tipo: 'he', data: '2026-09-09', he: 2, valor_he: 80 },
  ]
  assert.equal(descontoFaltasDoFixo(faltas, '2026-09-07', '2026-09-13'), 412.5)
  assert.equal(descontoFaltasDoFixo(faltas, '2026-09-07', '2026-09-09'), 275)
  assert.equal(descontoFaltasDoFixo([], '2026-09-07', '2026-09-13'), 0)
})

caso('previstoAReceber: feriado + falta somam; piso zero no fixo', () => {
  const faltas = [FALTA_SEG()]
  const r = previstoAReceberDaSemana({
    fixoSemana: 1650,
    resumo: { valorHe: 80, valorDomfer: 0 },
    feriados: ['2026-09-11'],
    inicioISO: '2026-09-07',
    fimISO: '2026-09-13',
    faltas,
  })
  assert.equal(r.desconto, 275)
  assert.equal(r.descontoFaltas, 275)
  assert.equal(r.valor, 1650 - 275 - 275 + 80)
  // Piso: fixo menor que os descontos nunca negativava.
  const piso = previstoAReceberDaSemana({
    fixoSemana: 100,
    resumo: {},
    feriados: ['2026-09-11'],
    inicioISO: '2026-09-07',
    fimISO: '2026-09-13',
    faltas: [FALTA_SEG(), FALTA_SEG({ data: '2026-09-10' })],
  })
  assert.equal(piso.valor, 0)
})

caso('fecharPeriodo ignora falta (não soma horas/HE/valores nem dias)', () => {
  const r = fecharPeriodo(
    [
      { tipo: 'he', data: '2026-09-09', horas: 8.5, he: 2, valor_he: 80 },
      FALTA_SEG({ data: '2026-09-10', minutos_falta: 195, valor_desconto: 137.5, destino: 'banco' }),
    ],
    { inicioISO: '2026-09-07', fimISO: '2026-09-13' },
    [],
  )
  assert.equal(r.horas, 8.5)
  assert.equal(r.he, 2)
  assert.equal(r.valorHe, 80)
  assert.equal(r.diasTrabalho, 1)
})

caso('HE banco: conta nas horas (Resumo/Home) mas com valor zerado no Previsto', () => {
  const r = fecharPeriodo(
    [{ tipo: 'he', data: '2026-09-09', horas: 8.5, he: 2, valor_he: 0, destino: 'banco' }],
    { inicioISO: '2026-09-07', fimISO: '2026-09-13' },
    [],
  )
  assert.equal(r.he, 2) // aparece nas horas extras...
  assert.equal(r.valorHe, 0) // ...mas não vira dinheiro
  const p = previstoAReceberDaSemana({ fixoSemana: 1650, resumo: r, inicioISO: '2026-09-07', fimISO: '2026-09-13' })
  assert.equal(p.valor, 1650)
})

caso('carga esperada/cumprida espelham feriado: falta integral zera o dia, parcial abate', () => {
  const faltas = [{ tipo: 'falta', data: '2026-09-09', minutos_falta: 390 }]
  // Semana 07–13/09: base 5×6,5 + 5,5 = 38; menos 6,5 da quarta.
  assert.equal(cargaEsperadaHoras('2026-09-07', '2026-09-13', [], [], faltas), 31.5)
  const parcial = [{ tipo: 'falta', data: '2026-09-09', minutos_falta: 195 }]
  assert.equal(cargaEsperadaHoras('2026-09-07', '2026-09-13', [], [], parcial), 34.75)
  assert.equal(cargaEsperadaHoras('2026-09-07', '2026-09-13', [], [], []), 38)
})

caso('banco: saldo positivo/negativo/zero e folga só com saldo > 0', () => {
  const exc = (tipo, destino, heOuMin) => (tipo === 'he'
    ? { tipo, destino, he: heOuMin }
    : { tipo, destino, minutos_falta: heOuMin })
  assert.equal(saldoBancoMinutos([exc('he', 'banco', 2), exc('falta', 'banco', 60)]), 60)
  assert.equal(saldoBancoMinutos([exc('he', 'banco', 1)]), 60)
  assert.equal(saldoBancoMinutos([exc('falta', 'banco', 60)]), -60)
  assert.equal(saldoBancoMinutos([]), 0)
  // Pagamento e abonada nunca entram no banco.
  assert.equal(saldoBancoMinutos([exc('he', 'pagamento', 2), exc('falta', 'abonada', 60)]), 0)
  assert.equal(creditosBancoMinutos([exc('he', 'banco', 1.5)]), 90)
  assert.equal(debitosBancoMinutos([exc('falta', 'banco', 45)]), 45)
  assert.equal(direitoFolgaDias(780, 390), 2)
  assert.equal(direitoFolgaDias(0, 390), 0)
  assert.equal(direitoFolgaDias(-60, 390), 0)
})

caso('faltanteDoTurno: saída antecipada devolve os minutos (20:30→01:00 = 120)', () => {
  assert.deepEqual(faltanteDoTurno('2026-09-09', { entrada: '20:30', saida: '01:00' }, {}), { minutos: 120 })
})

caso('faltanteDoTurno: carga cumprida, HE a mais, dom/fer e padrão dão null', () => {
  // 21:30→04:00 = 6,5h = carga cheia (caso 2: nada a fazer).
  assert.equal(faltanteDoTurno('2026-09-09', { entrada: '21:30', saida: '04:00' }, {}), null)
  assert.equal(faltanteDoTurno('2026-09-09', { entrada: '20:30', saida: '06:00' }, {}), null)
  assert.equal(faltanteDoTurno('2026-09-13', { entrada: '20:30', saida: '01:00' }, {}), null) // domingo
  assert.equal(faltanteDoTurno('2026-09-09', { entrada: '20:30', saida: '01:00' }, { feriados: ['2026-09-09'] }), null)
  assert.equal(faltanteDoTurno('2026-09-09', { entrada: '20:30', saida: '03:00' }, {}), null) // padrão
})

caso('FIFO: compensada quando créditos cobrem o acumulado; senão pendente', () => {
  const faltas = [
    { data: '2026-09-10', minutos_falta: 200 },
    { data: '2026-09-08', minutos_falta: 300 },
  ]
  const st = statusFaltasFIFO(faltas, 400)
  assert.deepStrictEqual(st.map((s) => [s.data, s.status]), [
    ['2026-09-08', 'compensada'],
    ['2026-09-10', 'pendente'],
  ])
  assert.equal(st[1].acumulado, 500)
  const tudo = statusFaltasFIFO(faltas, 500)
  assert.ok(tudo.every((s) => s.status === 'compensada'))
})

caso('banco soma HE e dom/fer pelo relógio (390 min no turno padrão)', () => {
  const exc = [
    { tipo: 'he', destino: 'banco', he: 2 },
    { data: '2026-09-06', tipo: 'domfer', destino: 'banco', horas: 6.5, valor_domfer: 0 },
    { data: '2026-09-07', tipo: 'domfer', destino: 'pagamento', horas: 6.5, valor_domfer: 400 },
  ]
  assert.equal(creditosBancoMinutos(exc), 120 + 390)
  assert.equal(saldoBancoMinutos(exc), 120 + 390)
})

caso('dom/fer no banco: diária zerada fora do Previsto; desconto de feriado igual nos dois destinos', () => {
  const base = { tipo: 'domfer', horas: 6.5, domfer_qtd: 1 }
  const rBanco = fecharPeriodo(
    [{ ...base, data: '2026-09-06', valor_domfer: 0, destino: 'banco' }],
    { inicioISO: '2026-08-31', fimISO: '2026-09-06' },
    [],
  )
  const rPago = fecharPeriodo(
    [{ ...base, data: '2026-09-06', valor_domfer: 400, destino: 'pagamento' }],
    { inicioISO: '2026-08-31', fimISO: '2026-09-06' },
    [],
  )
  assert.equal(rBanco.horasDomfer, 6.5) // horas continuam (trabalhadas)
  assert.equal(rBanco.valorDomfer, 0) // ...mas sem diária a receber
  const pBanco = previstoAReceberDaSemana({ fixoSemana: 1650, resumo: rBanco, inicioISO: '2026-08-31', fimISO: '2026-09-06' })
  const pPago = previstoAReceberDaSemana({ fixoSemana: 1650, resumo: rPago, inicioISO: '2026-08-31', fimISO: '2026-09-06' })
  assert.equal(pBanco.valor, 1650)
  assert.equal(pPago.valor, 2050)
})

console.log(`\n${passou} ok, ${falhou} falharam`)
process.exit(falhou > 0 ? 1 : 0)