// ============================================================================
// PONTO INTELIGENTE — lógica pura de jornada por EXCEÇÕES (src/lib/pontoCalc.js)
// ============================================================================
// Regras portadas do app antigo (Controle_Horas\dist_android\logic\calculos.py),
// adaptadas ao modelo do app novo (decidido com André em 01/09/2026):
//
//   1. CARGA PADRÃO é constante e NUNCA é lançada:
//        Seg–Sex  20:30 → 03:00  = 6,5h
//        Sáb      20:30 → 02:00  = 5,5h
//        Domingo  sem carga (off)
//      Dia sem lançamento na tabela ponto_excecoes = carga cumprida.
//   2. FERIADO vem de tabela (ponto_feriados), não de set fixo no código.
//      Folga em feriado = nada a lançar. TRABALHAR em domingo OU feriado =
//      lançamento tipo 'domfer': base 0, toda hora trabalhada é extra, e o
//      valor da diária é congelado pela HORA DE SAÍDA (mesma regra do antigo):
//        saída depois das 04:00 (e antes das 18:00) → diária maior (ate6);
//        caso contrário → diária normal (ate4).
//   3. HORA EXTRA em dia normal = lançamento tipo 'he': horas menos a base
//      do dia (6,5h seg–sex / 5,5h sáb); valor = he × R$/h. Sem adicional
//      noturno — a duração do turno que cruza a meia-noite é calculada como
//      no antigo (saida <= entrada → +1 dia).
//   3b. COMPENSAÇÃO (regra ajustada em 01/09/2026): se a CARGA HORÁRIA for
//      IGUAL à esperada (he = 0) MAS o relógio de entrada/saída fugir do
//      horário padrão, AINDA ASSIM SE LANÇA tipo 'he' (he = 0), registrando a
//      entrada e a saída para efeito de CONTROLE de que houve compensação de
//      uma hora faltante. Só o horário padrão EXATO (seg–sex 20:30→03:00 /
//      sáb 20:30→02:00) dispensa lançamento — e é o que a exportação do app
//      antigo descarta.
//   4. FÉRIAS por INTERVALO (data início/fim; dia único = início igual a fim),
//      salvas na tabela ponto_ferias (NÃO são mais exceções diárias): o dia em
//      férias conta como carga cumprida sem exigir lançamento, some do mês no
//      fecharPeriodo (diasFerias) e é abatido da carga esperada. O app controla
//      o SALDO de 15 dias por ano (QUOTA_FERIAS_ANUAL).
//   5. VALORES em R$ entram por parâmetro (config) e devem ser congelados na
//      GRAVAÇÃO pelo hook — esta lib só calcula com o que recebe.
//
// Todos os cálculos usam UTC sobre data civil 'YYYY-MM-DD' e minutos remotos
// de epoch para hora — nenhuma dependência de fuso do navegador (mesma
// disciplina de src/lib/semana.js).
// ============================================================================

// ---------------------------------------------------------------------------
// Configuração padrão (valores REAJUSTADOS do app antigo — migration 22)
// ---------------------------------------------------------------------------
export const VALORES_PADRAO_PONTO = {
  fixoSemana: 1650.0,
  heHora: 40.0,
  domferAte4: 400.0,
  domferAte6: 500.0,
}

// Carga padrão por dia da semana ISO do módulo (0 = segunda … 6 = domingo).
// null = sem carga (domingo).
export const CARGA_PADRAO = {
  0: { entrada: '20:30', saida: '03:00' },
  1: { entrada: '20:30', saida: '03:00' },
  2: { entrada: '20:30', saida: '03:00' },
  3: { entrada: '20:30', saida: '03:00' },
  4: { entrada: '20:30', saida: '03:00' },
  5: { entrada: '20:30', saida: '02:00' },
  6: null,
}

// Saldo anual de férias do André (15 dias no ano).
export const QUOTA_FERIAS_ANUAL = 15

// Base diária padrão em horas (mesma do antigo jornada_base_horas).
export const BASE_HORAS_POR_DIA = { 0: 6.5, 1: 6.5, 2: 6.5, 3: 6.5, 4: 6.5, 5: 5.5, 6: 0 }

const MS_DIA = 86_400_000

// ---------------------------------------------------------------------------
// Validação de data civil (mesma disciplina de semana.js)
// ---------------------------------------------------------------------------
export function validarDataISO(dataISO) {
  if (typeof dataISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
    throw new Error(`Data inválida ("${dataISO}"): use o formato YYYY-MM-DD.`)
  }
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  const ts = Date.UTC(ano, mes - 1, dia)
  const volta = new Date(ts)
  if (
    volta.getUTCFullYear() !== ano ||
    volta.getUTCMonth() !== mes - 1 ||
    volta.getUTCDate() !== dia
  ) {
    throw new Error(`Data inexistente no calendário ("${dataISO}").`)
  }
  return ts
}

// ---------------------------------------------------------------------------
// Horas
// ---------------------------------------------------------------------------
// '20:30' → 1230 (minutos do dia). Rejeita formatos soltos e horas inválidas.
export function horaEmMinutos(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm.trim())) {
    throw new Error(`Hora inválida ("${hhmm}"): use o formato HH:MM (ex.: 20:30).`)
  }
  const [h, m] = hhmm.trim().split(':').map(Number)
  if (h > 23 || m > 59) {
    throw new Error(`Hora inexistente ("${hhmm}").`)
  }
  return h * 60 + m
}

export function minutosEmHora(min) {
  const hh = String(Math.floor(min / 60)).padStart(2, '0')
  const mm = String(min % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

// Duração do turno cruzando a meia-noite (regra herdada do app antigo):
// saida <= entrada → +1 dia. Devolve horas com até 2 casas.
export function duracaoTurno(entrada, saida) {
  const e = horaEmMinutos(entrada)
  const s = horaEmMinutos(saida)
  const duracaoMin = s <= e ? s + 24 * 60 - e : s - e
  return Math.round((duracaoMin / 60) * 100) / 100
}

// ---------------------------------------------------------------------------
// Classificação do dia
// ---------------------------------------------------------------------------
// Dia da semana ISO do módulo: 0 = segunda … 6 = domingo.
export function diaSemanaIso(dataISO) {
  const ts = validarDataISO(dataISO)
  return (new Date(ts).getUTCDay() + 6) % 7
}

export function ehDomingo(dataISO) {
  return diaSemanaIso(dataISO) === 6
}

// feriados: array de { data: 'YYYY-MM-DD' } ou de 'YYYY-MM-DD'.
export function ehFeriado(dataISO, feriados = []) {
  return feriados.some((f) => (typeof f === 'string' ? f : f.data) === dataISO)
}

// Base diária (seg–sex 6,5h / sáb 5,5h / domingo 0h — antigo jornada_base_horas).
export function baseDoDia(dataISO) {
  return BASE_HORAS_POR_DIA[diaSemanaIso(dataISO)]
}

// Turno padrão do dia ({ entrada, saida }) ou null no domingo.
export function turnoPadrao(dataISO) {
  return CARGA_PADRAO[diaSemanaIso(dataISO)]
}

// Classifica o dia para o cálculo de exceções:
//   'domfer'  → domingo ou feriado (base 0; toda hora é extra, diária paga)
//   'he'      → dia normal (seg–sáb fora de feriado; HE = horas − base)
export function classificarDia(dataISO, feriados = []) {
  if (ehDomingo(dataISO) || ehFeriado(dataISO, feriados)) return 'domfer'
  return 'he'
}

// Horário PADRÃO EXATO do dia? Só há padrão em dia útil (seg–sáb não
// feriado); em dom/fer qualquer trabalho já é exceção. Serve para a prévia
// não sugerir lançamento do próprio padrão e identificar COMPENSAÇÃO.
export function ehTurnoPadrao(dataISO, entrada, saida, feriados = []) {
  const padrao = turnoPadrao(dataISO)
  return (
    classificarDia(dataISO, feriados) === 'he' &&
    !!padrao &&
    padrao.entrada === entrada &&
    padrao.saida === saida
  )
}

// Rótulo da exceção para a UI (informativo — NÃO altera o tipo gravado, que
// continua 'he'/'domfer' definido pela data):
//   'padrao'       → horário padrão exato em dia útil: dispensa lançamento.
//   'compensacao'  → carga igual à esperada com horário atípico: LANÇA-SE
//                    (tipo 'he', he = 0) registrando entrada/saída por
//                    controle — compensação de uma hora faltante.
//   'he'           → dia útil acima (ou abaixo) da base.
//   'domfer'       → domingo/feriado trabalhado.
export function classificarTurnoParaUI(dataISO, { entrada, saida }, { feriados = [] } = {}) {
  const tipo = classificarDia(dataISO, feriados)
  if (tipo === 'domfer') return 'domfer'
  if (ehTurnoPadrao(dataISO, entrada, saida, feriados)) return 'padrao'
  const horas = duracaoTurno(entrada, saida)
  const base = baseDoDia(dataISO)
  if (Math.abs(horas - base) < 0.005) return 'compensacao'
  return 'he'
}

// ---------------------------------------------------------------------------
// Cálculo de um lançamento de trabalho (he/domfer)
// ---------------------------------------------------------------------------
// Recebe entrada/saída reais e devolve TUDO o que a tabela ponto_excecoes
// precisa guardar, já com os valores em R$ usando a config vigente no
// momento — cabe ao hook CONGELAR esses valores no INSERT (como o antigo
// congelava no upsert_registro). A classificação por data define o tipo
// (quem escolheu "he" num domingo recebe 'domfer' — nunca contradiz a regra).
// config: { heHora, domferAte4, domferAte6 } (totais default em
// VALORES_PADRAO_PONTO; fixoSemana também entra congelado no resultado).
export function calcularLancamento(dataISO, { entrada, saida }, { feriados = [], config = VALORES_PADRAO_PONTO } = {}) {
  validarDataISO(dataISO)
  const tipo = classificarDia(dataISO, feriados)
  const horas = duracaoTurno(entrada, saida)

  if (tipo === 'domfer') {
    // base 0 → toda hora é extra; mas o lançamento conta como dom/fer, não
    // como HE da semana. Diária escolhida pela hora de saída (regra antiga):
    // depois das 04:00 e antes das 18:00 → diária maior (ate6).
    const [h, m] = saida.split(':').map(Number)
    const diariaMaior = (h > 4 && h < 18) || (h === 4 && m > 0)
    const valorDomfer = horas > 0 ? (diariaMaior ? config.domferAte6 : config.domferAte4) : 0
    return {
      tipo,
      horas,
      he: 0,
      domferQtd: horas > 0 ? 1 : 0,
      valorHe: 0,
      valorDomfer,
    }
  }

  // Dia normal: HE = horas trabalhadas menos a base do dia (min. 0 — atraso
  // abaixo da base ainda não é regra do módulo, então não gera "negativo").
  const base = baseDoDia(dataISO)
  const he = Math.max(0, Math.round((horas - base) * 100) / 100)
  return {
    tipo,
    horas,
    he,
    domferQtd: 0,
    valorHe: Math.round(he * config.heHora * 100) / 100,
    valorDomfer: 0,
  }
}

// Lançamento de FÉRIAS (avulsas, sem horário): marca o dia como cumprido.
export function marcarFerias() {
  return {
    tipo: 'ferias',
    horas: 0,
    he: 0,
    domferQtd: 0,
    valorHe: 0,
    valorDomfer: 0,
  }
}

// ---------------------------------------------------------------------------
// Férias por INTERVALO (tabela ponto_ferias) — contagem e saldo do ano
// ---------------------------------------------------------------------------
// Um período é { data_inicio, data_fim } (ISO). Dia único = início igual a fim.
// A contagem é por DIAS DE CALENDÁRIO (inclusive), como manda a regra: 15 dias
// por ano (QUOTA_FERIAS_ANUAL). Períodos não podem se sobrepor (exclusion
// constraint no banco) e o hook valida o saldo antes de gravar.
export function diasIntervaloInclusive(inicioISO, fimISO) {
  const ini = validarDataISO(inicioISO)
  const fim = validarDataISO(fimISO)
  if (fim < ini) throw new Error('inicioISO não pode ser maior que fimISO.')
  return Math.round((fim - ini) / MS_DIA) + 1
}

export function qtdDiasIntervalo({ data_inicio, data_fim }) {
  return diasIntervaloInclusive(data_inicio, data_fim)
}

// Dias do intervalo que caem dentro do ano (clampa as pontas).
export function diasIntervaloNoAno({ data_inicio, data_fim }, ano) {
  const a = String(ano)
  const ini = data_inicio < `${a}-01-01` ? `${a}-01-01` : data_inicio
  const fim = data_fim > `${a}-12-31` ? `${a}-12-31` : data_fim
  if (fim < ini) return 0
  return diasIntervaloInclusive(ini, fim)
}

// Total de dias de férias usados no ano (soma dos intervalos, sem duplicar
// sobreposições — que são rejeitadas pelo banco).
export function feriasUsadasNoAno(ferias = [], ano) {
  return ferias.reduce((acc, f) => acc + diasIntervaloNoAno(f, ano), 0)
}

// Dias ainda disponíveis no ano (15 − usados).
export function saldoFeriasNoAno(ferias = [], ano) {
  return QUOTA_FERIAS_ANUAL - feriasUsadasNoAno(ferias, ano)
}

// Carga cumprida para exibição (UI): soma da carga esperada + horas extras
// registradas + horas trabalhadas em domingo/feriado. A decisão de contar
// (ou não) o dom/fer aqui é da UI — este helper entrega a carte completa:
//   cargaEsperada + resumo.he + resumo.horasDomfer
// Separado em lib pura para teste e reuso (equivale ao total exibido no card
// "Carga horária" da semana). Sem férias/feriados extras, basta passar as
// exceções e a janela.
export function cargaCumpridaHoras(excecoes, { inicioISO, fimISO }, ferias, feriados) {
  const resumo = fecharPeriodo(excecoes, { inicioISO, fimISO }, ferias)
  const esperada = cargaEsperadaHoras(inicioISO, fimISO, feriados, ferias)
  return Math.round((esperada + resumo.he + resumo.horasDomfer) * 100) / 100
}

// Dias do intervalo que se sobrepõem à janela [inicioISO, fimISO] (inclusive).
export function diasIntervaloNaJanela({ data_inicio, data_fim }, inicioISO, fimISO) {
  const ini = inicioISO && data_inicio < inicioISO ? inicioISO : data_inicio
  const fim = fimISO && data_fim > fimISO ? fimISO : data_fim
  if (fim < ini) return 0
  return diasIntervaloInclusive(ini, fim)
}

// ---------------------------------------------------------------------------
// Períodos (mesma disciplina de semana.js: UTC + data civil)
// ---------------------------------------------------------------------------
// Devolve a lista de datas 'YYYY-MM-DD' de [inicioISO, fimISO] (inclusive),
// na ordem do calendário, somando a carga esperada total.
export function diasDoPeriodo(inicioISO, fimISO) {
  const ini = validarDataISO(inicioISO)
  const fim = validarDataISO(fimISO)
  if (fim < ini) throw new Error('inicioISO não pode ser maior que fimISO.')

  const dias = []
  for (let ts = ini; ts <= fim; ts += MS_DIA) {
    dias.push(new Date(ts).toISOString().slice(0, 10))
  }
  return dias
}

// Carga ESPERADA (em horas) de um período: soma a base padrão de cada dia
// útil (seg–sáb NÃO feriado E NÃO em férias). Domingos e feriados não somam —
// trabalhar neles é exceção domfer, não carga; dias em férias também não somam
// (o intervalo de férias conta como carga cumprida, decisão de 01/09/2026).
export function cargaEsperadaHoras(inicioISO, fimISO, feriados = [], ferias = []) {
  const emFerias = (data) =>
    ferias.some((f) => f.data_inicio <= data && data <= f.data_fim)
  return diasDoPeriodo(inicioISO, fimISO).reduce(
    (acc, data) =>
      classificarDia(data, feriados) === 'he' && !emFerias(data) ? acc + baseDoDia(data) : acc,
    0,
  )
}

// ---------------------------------------------------------------------------
// Fechamento (resumo) de um período — espelha o relatório do app antigo,
// que SUMÁRIAVA as linhas da tabela registros. Aqui a matéria-prima são as
// exceções da tabela ponto_excecoes (o resto do período é carga cumprida) e
// os INTERVALOS de férias da tabela ponto_ferias (contam diasFerias na janela).
// Ainda aceita exceções legadas com tipo 'ferias' para não quebrar relatórios
// antigos, mas o app novo só grava férias em ponto_ferias.
export function fecharPeriodo(excecoes, { inicioISO, fimISO } = {}, ferias = []) {
  const dentro = (ex) =>
    !inicioISO || !fimISO || (ex.data >= inicioISO && ex.data <= fimISO)

  let horas = 0
  let he = 0
  let horasDomfer = 0
  let domferQtdTotal = 0
  let diasTrabalho = 0
  let diasFerias = ferias.reduce(
    (acc, f) => acc + diasIntervaloNaJanela(f, inicioISO, fimISO),
    0,
  )
  let valorHeTotal = 0
  let valorDomferTotal = 0

  for (const ex of excecoes) {
    if (!dentro(ex)) continue
    if (ex.tipo === 'ferias') {
      diasFerias += 1
      continue
    }
    // O banco devolve as colunas em snake_case (domfer_qtd, valor_he,
    // valor_domfer); a lib também aceita camelCase (testes/legado) para nunca
    // zerar o card Domingos/feriados por mismatch de nome.
    const domferQtd = Number(ex.domfer_qtd ?? ex.domferQtd ?? 0)
    const valorHe = Number(ex.valor_he ?? ex.valorHe ?? 0)
    const valorDomfer = Number(ex.valor_domfer ?? ex.valorDomfer ?? 0)
    horas += Number(ex.horas || 0)
    he += Number(ex.he || 0)
    // Horas trabalhadas em domingo/feriado, separadas para o card de carga
    // total: entram na carga cumprida da semana, mas NÃO na HE (têm diária).
    if (ex.tipo === 'domfer') horasDomfer += Number(ex.horas || 0)
    domferQtdTotal += domferQtd
    valorHeTotal += valorHe
    valorDomferTotal += valorDomfer
    diasTrabalho += 1
  }

  return {
    diasTrabalho,
    diasFerias,
    horas: Math.round(horas * 100) / 100,
    he: Math.round(he * 100) / 100,
    horasDomfer: Math.round(horasDomfer * 100) / 100,
    domferQtd: domferQtdTotal,
    valorHe: Math.round(valorHeTotal * 100) / 100,
    valorDomfer: Math.round(valorDomferTotal * 100) / 100,
  }
}