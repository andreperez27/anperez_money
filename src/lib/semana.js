// ============================================================================
// SEMANA ISO 8601 — fonte única de verdade do projeto para calendário semanal
// ============================================================================
// Usada pelo módulo Planejamento (visão principal por semanas numeradas) e por
// qualquer código futuro que precise de "Semana 33 — 10/08/2026 a 16/08/2026".
//
// REGRA DO PROJETO: NENHUM outro lugar calcula semana. Nem o banco (a tabela
// planejamentos só guarda ano_semana/semana como cache preenchido aqui), nem
// bibliotecas externas, nem Date.prototype com métodos locais. Uma única
// implementação evita que duas telas mostrem números diferentes para a mesma
// data — divergência real entre ferramentas (.NET, moment etc.) nos finais de
// ano já foi documentada na auditoria da ETAPA 06.
//
// Regras ISO 8601 implementadas:
//   • semana começa na SEGUNDA e termina no DOMINGO;
//   • a quinta-feira da semana define o ANO e o NÚMERO da semana;
//   • semana 1 é a semana que contém 4 de janeiro (= semana da primeira
//     quinta-feira do ano);
//   • anos têm 52 ou 53 semanas (53 quando 1º/jan cai em quinta, ou em
//     quarta-feira em ano bissexto).
//
// Toda a aritmética é UTC sobre a DATA CIVIL (os componentes de YYYY-MM-DD são
// lidos como números e montados com Date.UTC). Nada usa getDay() local,
// locale do navegador ou fuso — "2026-08-10" significa o dia civil inteiro,
// em qualquer timezone onde o app esteja rodando.
// ============================================================================

const MS_DIA = 86_400_000
const MS_SEMANA = 7 * MS_DIA

// Converte timestamp UTC (meio-dia não é necessário: tudo aqui é puro UTC)
// de volta para 'YYYY-MM-DD'. Interno.
function isoDe(ts) {
  return new Date(ts).toISOString().slice(0, 10)
}

// Lê e valida uma data civil estrita. Aceita SOMENTE 'YYYY-MM-DD' com mês/dia
// reais no calendário gregoriano ('2026-02-30' e '2026-13-01' são rejeitados,
// assim como formatos soltos tipo '10/08/2026' ou 'abc'). Devolve o timestamp
// UTC da meia-noite desse dia civil. Interno — lança Error com mensagem clara.
function tsDe(dataISO) {
  if (typeof dataISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
    throw new Error(`Data inválida ("${dataISO}"): use o formato YYYY-MM-DD.`)
  }
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  const ts = Date.UTC(ano, mes - 1, dia)
  // Rodada de volta: se os componentes mudaram, a data não existe
  // (ex.: 31/02 vira 03/03 na aritmética — aí rejeitamos).
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

// Dia da semana ISO: 0 = segunda ... 6 = domingo. Interno.
function dowIso(ts) {
  return (new Date(ts).getUTCDay() + 6) % 7
}

// Segunda-feira da semana 1 do ano ISO informado = segunda da semana que
// contém 4 de janeiro (4/jan está SEMPRE na semana 1 pela norma).
// Interno.
function primeiraSegundaDe(ano) {
  const quatroJan = Date.UTC(ano, 0, 4)
  return quatroJan - dowIso(quatroJan) * MS_DIA
}

// ============================================================================
// API PÚBLICA
// ============================================================================

// Calcula o ano ISO, número ISO e intervalo (segunda→domingo) da data civil.
//
// semanaIso('2026-08-10') → { ano: 2026, semana: 33,
//                             inicio: '2026-08-10', fim: '2026-08-16' }
// semanaIso('2026-08-17') → { ano: 2026, semana: 34,
//                             inicio: '2026-08-17', fim: '2026-08-23' }
// semanaIso('2025-12-29') → { ano: 2026, semana: 1, ... }  (virada de ano!)
// semanaIso('2027-01-01') → { ano: 2026, semana: 53, ... } (pertence a 2026!)
export function semanaIso(dataISO) {
  const ts = tsDe(dataISO)

  // A QUINTA-FEIRA desta semana carrega o ano e o número oficiais: ela nunca
  // sai da semana, então é a âncora imune às bordas de janeiro/dezembro.
  const quintaTs = ts + (3 - dowIso(ts)) * MS_DIA
  const ano = new Date(quintaTs).getUTCFullYear()

  const primeiraSegunda = primeiraSegundaDe(ano)
  const semana = Math.round((quintaTs - primeiraSegunda) / MS_SEMANA) + 1

  const dow = dowIso(ts)
  return {
    ano,
    semana,
    inicio: isoDe(ts - dow * MS_DIA),
    fim: isoDe(ts + (6 - dow) * MS_DIA),
  }
}

// Caminho inverso, usado pela navegação da tela: devolve a segunda-feira da
// semana `semana` do ano ISO `ano`. Rejeita semanas que não existem naquele
// ano (ex.: (2027, 53) — 2027 tem 52 semanas) em vez de vazar silenciosamente
// para o ano seguinte.
export function inicioDaSemanaIso(ano, semana) {
  if (!Number.isInteger(ano) || !Number.isInteger(semana)) {
    throw new Error(`Ano/semana inválidos (${ano}, ${semana}): use inteiros.`)
  }
  if (semana < 1 || semana > 53) {
    throw new Error(`Semana inválida (${semana}): o ano ISO tem de 1 a 53 semanas.`)
  }
  const candidata = primeiraSegundaDe(ano) + (semana - 1) * MS_SEMANA

  // Confirmação pela própria fonte da verdade: a segunda candidata precisa
  // realmente pertencer à dupla (ano, semana) pedida.
  const conferencia = semanaIso(isoDe(candidata))
  if (conferencia.ano !== ano || conferencia.semana !== semana) {
    throw new Error(
      `A semana ${semana} não existe no ano ${ano} (a data cairia em ${conferencia.semana}/${conferencia.ano}).`,
    )
  }
  return conferencia.inicio
}
