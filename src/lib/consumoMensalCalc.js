// ============================================================================
// CONSUMOS MENSAIS (água/gás) — lib PURA do relatório "Consumos" (Relatórios)
// ============================================================================
// Fonte: condominio_consumo_mensal (mes_referencia = mês do CONSUMO, não do
// boleto — existe defasagem de 1 mês entre os dois, aceita). Por linha:
//   consumo (m³)  = leitura_atual − leitura_anterior
//   valor por m³  = valor / consumo (null quando consumo <= 0)
// Escopo da aba: só 'agua' e 'gas' ganham UI; outros tipos (energia,
// combustível) são AGRUPADOS normalmente aqui para não travar o crescimento
// futuro — quem filtra o que exibe é o componente.
// ============================================================================

export const TIPO_AGUA = 'agua'
export const TIPO_GAS = 'gas'

// Ordem de exibição da aba (tipos com UI). Tipos fora desta lista continuam
// agrupados em `porTipo`, só não ganham card.
export const TIPOS_CONSUMO_VISIVEIS = [TIPO_AGUA, TIPO_GAS]

export const ROTULO_TIPO_CONSUMO = {
  [TIPO_AGUA]: 'Água',
  [TIPO_GAS]: 'Gás',
}

export const COR_TIPO_CONSUMO = {
  [TIPO_AGUA]: '#38BDF8',
  [TIPO_GAS]: '#FB923C',
}

// Cor por (tipo, métrica) para os gráficos multi-série: cada linha tem matiz
// próprio (o traço continua codificando a métrica: sólida Valor, tracejada
// Consumo, pontilhada R$/m³ — ajuda também em impressão P&B).
export const COR_SERIE_CONSUMO = {
  [TIPO_AGUA]: { valor: '#38BDF8', consumo: '#6366F1', m3: '#2DD4BF' },
  [TIPO_GAS]: { valor: '#FB923C', consumo: '#CA8A04', m3: '#65A30D' },
}

export function corSerieConsumo(tipo, metrica) {
  return COR_SERIE_CONSUMO[tipo]?.[metrica] ?? COR_TIPO_CONSUMO[tipo] ?? '#42A5F5'
}

// Atenção ao Number(null) === 0: nulo/vazio conta como ausente.
function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Subtrai 1 mês de um 'YYYY-MM' (defasagem leitura × cobrança, confirmada:
// a linha é gravada no mês do BOLETO, mas o consumo é do mês anterior).
export function subtrairMes(mesAno) {
  let [ano, mes] = String(mesAno).split('-').map(Number)
  mes -= 1
  if (mes < 1) {
    mes = 12
    ano -= 1
  }
  return `${ano}-${String(mes).padStart(2, '0')}`
}

// Uma linha do banco vira um ponto mensal (ou null se inválida: sem mês,
// sem tipo ou sem as duas leituras — mês ainda não completado).
// O `mes` do ponto é o mês do CONSUMO lido direto de `mes_consumo`
// (fallback: `mes`, pré-migração 39) — nenhuma subtração em tempo de
// leitura; o deslocamento (boleto − 1) é regra de GRAVAÇÃO do formulário.
export function pontoDeLinha(linha) {
  const mesConsumo = String(linha?.mes_consumo ?? '').slice(0, 7)
  const mesQueda = /^\d{4}-\d{2}$/.test(mesConsumo)
    ? mesConsumo
    : String(linha?.mes ?? '').slice(0, 7)
  const tipo = String(linha?.tipo ?? '').trim()
  const anterior = num(linha?.leitura_anterior)
  const atual = num(linha?.leitura_atual)
  const valor = num(linha?.valor)
  if (!/^\d{4}-\d{2}$/.test(mesQueda) || !tipo || anterior === null || atual === null || valor === null) {
    return null
  }
  const mes = mesQueda
  const consumo = atual - anterior
  return {
    mes,
    tipo,
    leituraAnterior: anterior,
    leituraAtual: atual,
    consumo,
    valor,
    // Valor por m³ só existe com consumo positivo (nunca divide por zero).
    valorM3: consumo > 0 ? valor / consumo : null,
  }
}

// Valor de UM ponto numa métrica ('valor' | 'consumo' | 'm3'). Null quando
// ausente (nunca zera ponto faltante).
export function valorMetrica(ponto, metrica) {
  if (!ponto) return null
  const v = metrica === 'valor' ? ponto.valor : metrica === 'consumo' ? ponto.consumo : ponto.valorM3
  if (v === null || v === undefined || v === '') return null
  return Number.isFinite(Number(v)) ? Number(v) : null
}

// Indexa UMA série em % sobre o primeiro valor válido da métrica (primeiro
// mês = 0%). Base ausente ou zerada → tudo null (métrica indisponível).
// Devolve [{ mes, pct }] na ordem da série.
export function normalizarIndice(serie, metrica) {
  const pontos = Array.isArray(serie) ? serie : []
  const base = pontos.map((p) => valorMetrica(p, metrica)).find((v) => v !== null)
  if (base === undefined || !(base > 0) && !(base < 0)) {
    return pontos.map((p) => ({ mes: p.mes, pct: null }))
  }
  return pontos.map((p) => {
    const v = valorMetrica(p, metrica)
    return { mes: p.mes, pct: v === null ? null : ((v - base) / base) * 100 }
  })
}

// Agrupa as linhas por tipo → série mensal ordenada, já filtrada pelo
// período (comparação por mês de referência, não por dia).
// Devolve { porTipo: { [tipo]: [ponto] }, meses: [meses distintos no filtro] }.
export function agruparConsumoPorTipo(linhas, { inicio, fim } = {}) {
  const mesInicio = String(inicio ?? '').slice(0, 7)
  const mesFim = String(fim ?? '').slice(0, 7)
  const porTipo = {}
  const mesesSet = new Set()
  for (const linha of linhas ?? []) {
    const ponto = pontoDeLinha(linha)
    if (!ponto) continue
    if (mesInicio && ponto.mes < mesInicio) continue
    if (mesFim && ponto.mes > mesFim) continue
    if (!porTipo[ponto.tipo]) porTipo[ponto.tipo] = []
    porTipo[ponto.tipo].push(ponto)
    mesesSet.add(ponto.mes)
  }
  for (const tipo of Object.keys(porTipo)) {
    porTipo[tipo].sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0))
  }
  return { porTipo, meses: [...mesesSet].sort() }
}

// Variação percentual do último ponto vs o anterior (null sem base: menos de
// 2 pontos ou base <= 0 — nunca divide por zero).
export function variacaoSerie(serie) {
  if (!Array.isArray(serie) || serie.length < 2) return null
  const base = serie[serie.length - 2].consumo
  const atual = serie[serie.length - 1].consumo
  if (!(base > 0)) return null
  return ((atual - base) / base) * 100
}

// Resumo de um tipo para os cards: último ponto + variação do consumo.
export function resumoTipo(serie) {
  const pontos = Array.isArray(serie) ? serie : []
  if (pontos.length === 0) return { ultimo: null, variacao: null }
  return { ultimo: pontos[pontos.length - 1], variacao: variacaoSerie(pontos) }
}

// Formatações de apresentação da aba.
export function formatarM3(valor) {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (!Number.isFinite(Number(valor))) return '—'
  return `${Number(valor).toFixed(2).replace('.', ',')} m³`
}

export function formatarVariacao(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return '—'
  const n = Number(pct)
  const sinal = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sinal}${Math.abs(n).toFixed(1).replace('.', ',')}%`
}

export function rotuloMes(mesAno) {
  const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const [ano, mes] = String(mesAno).split('-')
  return `${MES_ABREV[Number(mes) - 1]}/${String(ano).slice(2)}`
}
