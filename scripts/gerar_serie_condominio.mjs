// ============================================================================
// gerar_serie_condominio.mjs — Cria a SÉRIE RECORRENTE de Condomínio no banco
// ============================================================================
// Correção da causa raiz diagnosticada em 08/09/2026: o Condomínio era lançado
// mês a mês como AVULSO (origem 'recorrente', sem serie_id), então o futuro —
// ex.: a semana 41 / 10/10/2026 — ficava SEM previsão. Este script gera a
// série completa (default 24 meses, mesmo HORIZONTE sem término do app) com:
//
//   • itens FIXOS → despesa_recorrente_item, calculando os VIGENTES por mês
//     (a referência n/total das séries com fim evolui em cada mês);
//   • variáveis (Gás/Água) → regra definitiva de valor variável: média dos 3
//     últimos REAIS lançados; com menos de 3, repete o último real;
//   • semana ISO por ocorrência via src/lib/semana.js (fonte única);
//   • estado 'previsto', origem 'recorrente', periodicidade 'mensal'.
//
// IDEMPOTÊNCIA: aborta se já houver qualquer 'Condomínio%' previsto/realizado
// a partir do mês de início (você não duplica previsão de condomínio).
//
// Autentica como o USUÁRIO DONO (@supabase/supabase-js → auth de email/senha),
// respeitando RLS igual aos hooks. Credenciais: .env.local ou variáveis de
// ambiente SUPABASE_EMAIL/SUPABASE_SENHA (nunca ficam em arquivos do repo).
//
// Uso (DRY-RUN, só imprime — não grava):
//   node scripts/gerar_serie_condominio.mjs --mes-inicio 2026-10 --dia 10
// Para GRAVAR:
//   node scripts/gerar_serie_condominio.mjs --mes-inicio 2026-10 --dia 10 --sim
// ============================================================================

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { projetarOcorrenciasCondominio } from '../src/lib/despesaRecorrenteCalc.js'
import { semanaIso } from '../src/lib/semana.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJETO = path.resolve(__dirname, '..')

function lerEnvLocal() {
  const env = {}
  const arquivo = path.join(PROJETO, '.env.local')
  try {
    for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
      const t = linha.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const [chave, ...resto] = t.split('=')
      env[chave.trim()] = resto.join('=').trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    /* sem .env.local — deixa vazio */
  }
  return env
}

function parseValorObservacao(observacao, cod) {
  if (!observacao) return null
  const linha = String(observacao)
    .split('\n')
    .find((l) => {
      const t = l.trim()
      return t.startsWith(`${cod} `) || t.startsWith(`${cod}\t`)
    })
  if (!linha) return null
  const m = linha.match(/R\$\s*([\d.,]+)/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function formatarMoedaBR(valor) {
  const centavos = Math.round(Math.abs(Number(valor)) * 100)
  const inteiro = Math.floor(centavos / 100)
  const dec = String(centavos % 100).padStart(2, '0')
  return `R$ ${String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

function passarArgs() {
  const args = {}
  const lista = process.argv.slice(2)
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i]
    if (a === '--sim') args.sim = true
    else if (a.startsWith('--mes-inicio=')) args.mesInicio = a.split('=')[1]
    else if (a.startsWith('--dia=')) args.dia = Number(a.split('=')[1])
    else if (a.startsWith('--meses=')) args.meses = Number(a.split('=')[1])
    else if (a.startsWith('--email=')) args.email = a.split('=')[1]
    else if (a.startsWith('--senha=')) args.senha = a.split('=')[1]
    else if (a === '--mes-inicio' || a === '--dia' || a === '--meses' || a === '--email' || a === '--senha') {
      args[a.slice(2)] = lista[++i]
    }
  }
  return args
}

const args = passarArgs()
const mesInicio = args.mesInicio || '2026-10'
const dia = Number.isInteger(args.dia) && args.dia >= 1 && args.dia <= 31 ? args.dia : 10
const totalMeses = Number.isInteger(args.meses) && args.meses > 0 ? args.meses : 24

if (!/^\d{4}-\d{2}$/.test(mesInicio)) {
  console.error('--mes-inicio deve estar no formato YYYY-MM.')
  process.exit(1)
}

const env = lerEnvLocal()
const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
const apikey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!url || !apikey) {
  console.error('Faltam VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (.env.local).')
  process.exit(1)
}

const email = args.email || process.env.SUPABASE_EMAIL || env.SUPABASE_EMAIL
const senha = args.senha || process.env.SUPABASE_SENHA || env.SUPABASE_SENHA
if (!email || !senha) {
  console.error('Informe o usuário dono via SUPABASE_EMAIL/SUPABASE_SENHA (variáveis de ambiente) ou --email/--senha.')
  process.exit(1)
}

const supabase = createClient(url, apikey)

console.log('=== GERAÇÃO DA SÉRIE DE CONDOMÍNIO ===')
console.log(`  inicio ${mesInicio} · vencimento dia ${dia} · ${totalMeses} meses | ${args.sim ? 'GRAVANDO' : 'DRY-RUN (use --sim para gravar)'}`)

const { data: sessao, error: erroLogin } = await supabase.auth.signInWithPassword({ email, password: senha })
if (erroLogin || !sessao) {
  console.error(`[erro] falha no login: ${erroLogin?.message ?? 'sem sessão'}`)
  process.exit(1)
}
console.log(`  autenticado como ${sessao.user?.email}`)

// 1) Idempotência: já existe 'Condomínio%' previsto/realizado a partir do mês?
const { data: jaExistentes } = await supabase
  .from('planejamentos')
  .select('id, descricao, data_prevista, estado')
  .ilike('descricao', 'Condomínio%')
  .gte('data_prevista', `${mesInicio}-01`)
  .in('estado', ['previsto', 'realizado'])
  .limit(50)
if (jaExistentes && jaExistentes.length > 0) {
  console.error(`[aborta] já existem ${jaExistentes.length} previsões/realizados de Condomínio a partir de ${mesInicio}:`)
  for (const p of jaExistentes.slice(0, 10)) {
    console.error(`    ${p.data_prevista} | ${p.descricao} | ${p.estado}`)
  }
  console.error('  Para não duplicar, não gero a série. Exclua/cancele essas linhas se for recriar.')
  process.exit(1)
}

// 2) Itens fixos (vigência por mês é filtrada dentro do cálculo puro).
const { data: itens } = await supabase
  .from('despesa_recorrente_item')
  .select('cod, descricao, valor, categoria, vigencia_inicio, vigencia_termino')
  .limit(5000)
if (!itens) {
  console.error('[erro] não consegui ler despesa_recorrente_item.')
  process.exit(1)
}

// 3) Histórico real de Gás/Água: condomínios REALIZADOS (um valor por mês,
//    do mais recente para o mais antigo; depois inverte para ordem cronológica).
const { data: realizados } = await supabase
  .from('planejamentos')
  .select('data_prevista, observacao')
  .eq('estado', 'realizado')
  .eq('origem', 'recorrente')
  .ilike('descricao', 'Condomínio%')
  .order('data_prevista', { ascending: false })
  .limit(60)

const gasHistorico = []
const aguaHistorico = []
const mesesVistos = new Set()
for (const r of realizados ?? []) {
  if (!r.data_prevista) continue
  const chaveMes = r.data_prevista.slice(0, 7)
  if (mesesVistos.has(chaveMes)) continue
  mesesVistos.add(chaveMes)
  const g = parseValorObservacao(r.observacao, '1010')
  const a = parseValorObservacao(r.observacao, '1052')
  if (g !== null) gasHistorico.push(g)
  if (a !== null) aguaHistorico.push(a)
  if (mesesVistos.size >= 36) break
}
gasHistorico.reverse()
aguaHistorico.reverse()
console.log(`  históricos reais: Gás ${gasHistorico.length} mês(es) [${gasHistorico.join(', ')}] · Água ${aguaHistorico.length} [${aguaHistorico.join(', ')}]`)

// 4) Projeção purda da série (regra definitiva + fixos vigentes por mês).
const ocorrencias = projetarOcorrenciasCondominio({
  itens,
  historicoGas: gasHistorico,
  historicoAgua: aguaHistorico,
  mesInicio,
  diaVencimento: dia,
  totalMeses,
})

// 5) Monta linhas prontas para INSERT (semana via fonte única, série nova).
const serieId = randomUUID()
const linhas = ocorrencias.map((o, idx) => {
  const { ano, semana } = semanaIso(o.dataPrevista)
  return {
    tipo_op: 'Saida',
    descricao: 'Condomínio',
    valor: o.valor,
    data_prevista: o.dataPrevista,
    ano_semana: ano,
    semana,
    estado: 'previsto',
    serie_id: serieId,
    parcela_numero: idx + 1,
    total_parcelas: ocorrencias.length,
    origem: 'recorrente',
    periodicidade: 'mensal',
    observacao: o.observacao,
  }
})

console.log(`\n  ${linhas.length} ocorrências a criar na série ${serieId.slice(0, 8)}…`)
for (const l of linhas.slice(0, 6)) {
  console.log(`    ${l.data_prevista} | S${l.ano_semana}/${l.semana} | ${formatarMoedaBR(l.valor)} | ${l.descricao}`)
}
if (linhas.length > 6) console.log(`    … mais ${linhas.length - 6} ocorrências (até ${linhas[linhas.length - 1].data_prevista}).`)
console.log(`\n  Total da série: ${formatarMoedaBR(linhas.reduce((s, l) => s + l.valor, 0))}`)

if (!args.sim) {
  console.log('\n  Modo DRY-RUN: nada foi gravado. Rode com --sim para criar a série.')
  process.exit(0)
}

const { error } = await supabase.from('planejamentos').insert(linhas)
if (error) {
  console.error(`[erro] inserindo a série: ${error.message}`)
  console.error(`  detalhe: ${error.details ?? ''}`)
  process.exit(1)
}
console.log('\n  Série criada com sucesso. Ela segue a regra definitiva de valor variável e cobre o horizonte.')