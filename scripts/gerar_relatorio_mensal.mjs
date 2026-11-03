// ============================================================================
// GERADOR DO RELATÃ“RIO MENSAL EM PDF (avaliaÃ§Ã£o â€” 02/11/2026)
// ============================================================================
// Gera o "RelatÃ³rio Mensal" do Anperez_money no novo formato (melhorias vs. o
// PDF do app antigo), buscando os dados do Supabase via REST (login/senha do
// .env.local â€” mesmo padrÃ£o do backup_supabase.mjs) e usando as MESMAS libs
// puras que alimentam as abas de RelatÃ³rios:
//
//   node scripts/gerar_relatorio_mensal.mjs 2026-09
//   node scripts/gerar_relatorio_mensal.mjs 2026-09 --saida "C:\caminho"
//
// SaÃ­da padrÃ£o: pasta relatorios_mensais do contador (nome de arquivo igual ao
// do app antigo, p/ conviver: relatorio_mensal_2026_09.pdf).
//
// SeÃ§Ãµes (ordem do PDF antigo + melhorias acordadas):
//   KPIs do mÃªs Â· Horas trabalhadas Â· Recebimentos (com semana de trabalho) Â·
//   MovimentaÃ§Ãµes (resumo) Â· Detalhamento (entradas + saÃ­das por categoria com
//   subtotais) Â· Faturas (status + vencimento em dia Ãºtil) Â· Saldos (contas +
//   caixinhas + patrimÃ´nio total).
// RodapÃ©: "Gerado pelo ANPEREZ MONEY em dd/mm/yyyy hh:mm" + paginaÃ§Ã£o.
// ============================================================================
import { writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

import { formatoReal, formatarData, hoje } from '../src/lib/compartilhados.js'
import { definirPeriodo } from '../src/lib/periodos.js'
import { calcularEntradasDespesas } from '../src/lib/relatorioEntradasDespesas.js'
import {
  calcularGastoPorCategoria,
  analisarCategoria,
} from '../src/lib/relatorioPdf.js'
import { calcularRecebidoHoras } from '../src/lib/relatorioRecebidoHoras.js'
import { espelhoControlePonto } from '../src/lib/controlePontoCalc.js'
import { calcularSaldosFinais } from '../src/lib/relatorioPdf.js'
import { adicionarDiasISO } from '../src/lib/saldoProjetado.js'
import { vencimentoRealISO } from '../src/lib/diaUtil.js'
import { semanaIso } from '../src/lib/semana.js'

const DIR = dirname(fileURLToPath(import.meta.url))
const PROJETO = resolve(DIR, '..')
const ENV_LOCAL = resolve(PROJETO, '.env.local')
const SAIDA_PADRAO = 'C:/Users/andre/Desktop/contas/contabilidade total/relatorios_mensais'

// ---------------------------------------------------------------------------
// Args + env + login REST
// ---------------------------------------------------------------------------
function lerArgs() {
  const args = { _: [] }
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === '--saida') {
      args.saida = process.argv[++i]
    } else {
      args._.push(a)
    }
  }
  return args
}

function carregarEnv() {
  const env = {}
  try {
    for (const linha of readFileSync(ENV_LOCAL, 'utf8').split('\n')) {
      const l = linha.trim()
      if (!l || l.startsWith('#') || !l.includes('=')) continue
      const [chave, ...resto] = l.split('=')
      env[chave.trim()] = resto.join('=').trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    // sem .env.local
  }
  return env
}

async function restGet(url, apikey, token) {
  const out = []
  let offset = 0
  while (true) {
    const sep = url.includes('?') ? '&' : '?'
    const req = await fetch(`${url}${sep}offset=${offset}&limit=1000`, {
      headers: { apikey, Authorization: `Bearer ${token}` },
    })
    if (!req.ok) throw new Error(`GET ${url} â†’ ${req.status}: ${await req.text()}`)
    const lote = await req.json()
    out.push(...(lote ?? []))
    if ((lote ?? []).length < 1000) return out
    offset += 1000
  }
}

async function login(env) {
  const url = env.VITE_SUPABASE_URL
  const apikey = env.VITE_SUPABASE_ANON_KEY
  if (!url || !apikey) throw new Error('Faltam VITE_SUPABASE_URL/ANON_KEY no .env.local')
  const email = env.SUPABASE_EMAIL
  const senha = env.SUPABASE_SENHA
  if (!email || !senha) throw new Error('Faltam SUPABASE_EMAIL/SENHA no .env.local')
  const req = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  })
  const corpo = await req.json().catch(() => null)
  if (!req.ok || !corpo?.access_token) {
    throw new Error(`Falha no login (${req.status}): ${JSON.stringify(corpo)}`)
  }
  return { url, apikey, token: corpo.access_token }
}

// ---------------------------------------------------------------------------
// Paleta/helpers de PDF (mesmos tons de gerarPdfRelatorio.js)
// ---------------------------------------------------------------------------
const MARGEM = 14
const LARGURA = 210
const ALTURA = 297
const RODAPE = 18

const COR_BRAND = [66, 165, 245]
const COR_BRAND_ESCURA = [23, 37, 84]
const COR_VERDE = [21, 128, 61]
const COR_VERMELHA = [185, 28, 28]
const COR_TEXTO = [31, 41, 55]
const COR_CLARO = [75, 85, 99]
const COR_FUNDO_TABELA = [243, 244, 246]
const COR_AMARELA = [245, 158, 11]

const fmt = (v) => formatoReal.format(v)
const corDoSaldo = (v) => (v >= 0 ? COR_VERDE : COR_VERMELHA)

function secao(doc, texto, y) {
  doc.setFillColor(...COR_BRAND)
  doc.roundedRect(MARGEM, y, LARGURA - 2 * MARGEM, 9, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(texto, MARGEM + 4, y + 6.1)
  doc.setFont('helvetica', 'normal')
  return y + 12
}

function estilosTabela() {
  return {
    margin: { left: MARGEM, right: MARGEM },
    theme: 'grid',
    headStyles: { fillColor: COR_BRAND_ESCURA, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    styles: { font: 'helvetica', fontSize: 9, textColor: COR_TEXTO, cellPadding: 2.6 },
    alternateRowStyles: { fillColor: COR_FUNDO_TABELA },
  }
}

function novaPaginaSeNecessario(doc, y, alturaNecessaria = 30) {
  if (y > ALTURA - RODAPE - alturaNecessaria) {
    doc.addPage()
    return MARGEM + 4
  }
  return y
}

function rodape(doc, geradoEm) {
  const totalPaginas = doc.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COR_CLARO)
    doc.text(`PÃ¡gina ${i} de ${totalPaginas}`, LARGURA - MARGEM, ALTURA - 10, { align: 'right' })
    doc.text(`Gerado pelo ANPEREZ MONEY em ${geradoEm}`, MARGEM, ALTURA - 10)
  }
}

function agoraRotulo() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Semana de trabalho "28/09 a 04/10" a partir da segunda ISO gravada.
function rotuloSemana(segundaISO) {
  const s = semanaIso(segundaISO)
  return `${s.inicio.slice(8, 10)}/${s.inicio.slice(5, 7)} a ${s.fim.slice(8, 10)}/${s.fim.slice(5, 7)}`
}

// ---------------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------------
const args = lerArgs()
const mesRef = args._[0] || '2026-09'
const [ANO, MES] = mesRef.split('-').map(Number)
if (!ANO || !MES || MES < 1 || MES > 12) {
  throw new Error(`MÃªs invÃ¡lido: "${mesRef}" (use AAAA-MM, ex.: 2026-09)`)
}

const periodo = definirPeriodo('mes', `${mesRef}-15`)
const hojeISO = hoje()
const coberturaMinima = adicionarDiasISO(hojeISO, -400)
const geradoEm = agoraRotulo()

const env = carregarEnv()
const { url, apikey, token } = await login(env)
const q = (tabela, qs) => `${url}/rest/v1/${tabela}?${qs}`

console.log('Baixando dados do Supabaseâ€¦')
const [
  movsWide,
  contas,
  caixinhas,
  caixinhaMovs,
  compras,
  faturasReais,
  cartoes,
  planejamentos,
  pontoExcecoes,
  pontoFeriados,
  pontoConfig,
  pontoFerias,
] = await Promise.all([
  restGet(q('movimentacoes', `select=*&data=gte.${coberturaMinima}&data=lte.${hojeISO}&order=data.asc`), apikey, token),
  restGet(q('contas', 'select=*'), apikey, token),
  restGet(q('caixinhas', 'select=*&ativa=eq.true'), apikey, token),
  restGet(q('caixinha_movimentacoes', 'select=caixinha_id,tipo,valor,data&order=data.asc'), apikey, token),
  restGet(q('compras', `select=*&ativa=eq.true&data=gte.${periodo.inicio}&data=lte.${periodo.fim}`), apikey, token),
  restGet(q('v_faturas', `select=*&mes_fatura=eq.${mesRef}`), apikey, token),
  restGet(q('cartoes', 'select=*'), apikey, token),
  restGet(q('planejamentos', `select=*&data_prevista=gte.${periodo.inicio}&data_prevista=lte.${periodo.fim}&order=data_prevista.asc&order=parcela_numero.asc`), apikey, token),
  restGet(q('ponto_excecoes', 'select=*&order=data.asc&limit=5000'), apikey, token),
  restGet(q('ponto_feriados', 'select=data,nome&order=data.asc'), apikey, token),
  restGet(q('ponto_config', 'select=chave,valor'), apikey, token),
  restGet(q('ponto_ferias', 'select=*&order=data_inicio.asc'), apikey, token),
])

const movsPeriodo = movsWide.filter((m) => m.data >= periodo.inicio && m.data <= periodo.fim)
console.log(`movimentaÃ§Ãµes perÃ­odo: ${movsPeriodo.length} | wide (saldos): ${movsWide.length} | faturas: ${faturasReais.length}`)

// Mapas data/valor REAL por lancamento_id (regra 11/09 e 19/09/2026).
const dataRealPorLancamento = {}
const valorRealPorLancamento = {}
for (const m of movsWide) {
  dataRealPorLancamento[m.id] = m.data
  valorRealPorLancamento[m.id] = Number(m.valor)
}

// --- 1) Fluxo de caixa (entradas/saÃ­das/saldo; exclui transf. e pgto fatura)
const fluxo = calcularEntradasDespesas({ movimentacoes: movsPeriodo, periodo })

// --- 2) Ponto (horas/HE/dom-fer/faltas)
const cfgMapa = {}
for (const l of pontoConfig) cfgMapa[l.chave] = Number(l.valor)
const pontoConfigFmt = {
  fixoSemana: cfgMapa.VALOR_FIXO_SEMANA ?? 1650,
  temposCarga: {
    utilEntrada: cfgMapa.CARGA_UTIL_ENTRADA ?? 1230,
    utilSaida: cfgMapa.CARGA_UTIL_SAIDA ?? 180,
    sabadoEntrada: cfgMapa.CARGA_SABADO_ENTRADA ?? 1230,
    sabadoSaida: cfgMapa.CARGA_SABADO_SAIDA ?? 120,
  },
}
const espelho = espelhoControlePonto({
  inicio: periodo.inicio,
  fim: periodo.fim,
  hojeISO,
  excecoes: pontoExcecoes,
  feriados: pontoFeriados,
  ferias: pontoFerias,
  config: pontoConfigFmt,
  todasExcecoes: pontoExcecoes,
})
const resumoPonto = espelho.resumo

// --- 3) Recebimentos (planejamentos realizados Entrada, datas/valores reais)
const receb = calcularRecebidoHoras({
  planejamentosRealizados: planejamentos,
  fixoSemana: pontoConfigFmt.fixoSemana,
  periodo,
  dataRealPorLancamento,
  valorRealPorLancamento,
})

// --- 4) Gasto por categoria + detalhe (compras + movs SaÃ­da)
const gastoCategoria = calcularGastoPorCategoria({ movimentacoes: movsPeriodo, compras, periodo })
const detalheCategoria = new Map()
for (const l of gastoCategoria.linhas) {
  const info = analisarCategoria({
    categoria: l.categoria,
    movimentacoes: movsPeriodo,
    compras,
    periodo,
    limite: 1000,
    incluirEntradas: false,
  })
  detalheCategoria.set(l.categoria, info.lancamentos)
}

// --- 5) Faturas reais do mÃªs (v_faturas) com vencimento em dia Ãºtil
const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]))
const faturas = faturasReais
  .map((f) => {
    const cartao = cartaoPorId.get(f.cartao_id)
    const vencimento = vencimentoRealISO(f.mes_fatura, cartao?.dia_vencimento ?? 1, pontoFeriados)
    return {
      cartao: cartao?.nome ?? 'CartÃ£o',
      vencimento,
      valor: Number(f.valor_total) || 0,
      pago: Number(f.valor_pago) || 0,
      restante: Number(f.valor_restante) || 0,
      status: f.status ?? 'aberta',
    }
  })
  .sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1))

// --- 6) Saldos finais (contas + caixinhas + patrimÃ´nio)
const saldos = calcularSaldosFinais({
  contas,
  movimentacoes: movsWide,
  fimISO: periodo.fim,
  coberturaMinima,
})
// Caixinhas: saldo RECONSTRUÃDO em periodo.fim (replay de caixinha_movimentacoes â€”
// guardar/rendimento somam, resgatar/taxa subtraem). O replay completo fecha
// exatamente com o saldo atual (validado em 02/11/2026: 204,51).
const sinalCaixinha = (tipo) => (tipo === 'resgatar' || tipo === 'taxa' ? -1 : 1)
const saldoCaixinhaEm = new Map()
for (const m of caixinhaMovs) {
  if (String(m.data) > periodo.fim) continue
  saldoCaixinhaEm.set(
    m.caixinha_id,
    (saldoCaixinhaEm.get(m.caixinha_id) ?? 0) + sinalCaixinha(m.tipo) * (Number(m.valor) || 0),
  )
}
const saldoCaixinha = (c) =>
  Math.round((saldoCaixinhaEm.has(c.id) ? saldoCaixinhaEm.get(c.id) : 0) * 100) / 100
const totalCaixinhas = caixinhas.reduce((a, c) => a + saldoCaixinha(c), 0)
const patrimonioTotal = (saldos.total ?? 0) + totalCaixinhas
// ===========================================================================
// RENDER DO PDF â€” delegado a src/lib/gerarPdfRelatorioMensal.js
// ===========================================================================
import { gerarPdfRelatorioMensal } from '../src/lib/gerarPdfRelatorioMensal.js'

const detalheObj = {}
for (const l of gastoCategoria.linhas ?? []) {
  detalheObj[l.categoria] = detalheCategoria.get(l.categoria) ?? []
}

const dados = {
  fluxo,
  resumoPonto: espelho.resumo,
  receb,
  gastoCategoria,
  detalheCategoria: detalheObj,
  faturas,
  saldos,
  caixinhas: caixinhas.map((c) => ({ nome: c.nome, saldo: saldoCaixinha(c) })),
  totalCaixinhas,
  patrimonioTotal,
}

const { doc, nomeArquivo } = gerarPdfRelatorioMensal({ periodo, dados, previa: true })
const pastaSaida = args.saida || SAIDA_PADRAO
const caminho = resolve(pastaSaida, nomeArquivo)
writeFileSync(caminho, Buffer.from(doc.output('arraybuffer')))
console.log(`PDF gerado: ${caminho}`)
console.log(`  Entradas ${fmt(fluxo.totalEntradas)} | SaÃ­das ${fmt(fluxo.totalDespesas)} | Saldo ${fmt(fluxo.saldo)}`)
console.log(`  Recebido ${fmt(receb.totalRecebido)} | Extras ${fmt(receb.totalValorHorasExtras)}`)
console.log(`  PatrimÃ´nio em ${formatarData(periodo.fim)}: ${fmt(patrimonioTotal)}`)
