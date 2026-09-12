// ============================================================================
// BACKUP das tabelas do Supabase (plano gratuito não tem backup automático)
// ============================================================================
// Exporta TODAS as tabelas do app para arquivos CSV (um por tabela) numa pasta
// com a data do dia, dentro do projeto:
//
//   backups/backup_YYYY-MM-DD/
//     contas.csv, movimentacoes.csv, cartoes.csv, ...  (+ manifest.json)
//
// Autentica via REST como o dono (mesma lógica do gerar_recebidos_planilha.mjs
// e do diagnostico_saldo_projetado.mjs) → respeita RLS, sem expor chaves.
//
// Paginação robusta: cada tabela é lida em blocos de 5000 linhas (offset),
// então o tamanho das tabelas (ex.: movimentacoes) não importa. As colunas são
// descobertas da primeira linha e exportadas em CSV UTF-8 com BOM (abre
// direto no Excel) + um manifest.json com data/hora, contagem por linha e as
// colunas de cada tabela para conferência.
//
// USO:
//   node scripts/backup_supabase.mjs              → grava em backups/backup_<hoje>
//   node scripts/backup_supabase.mjs --dest PASTA → pasta de saída customizada
// E-mail/senha: SUPABASE_EMAIL/SUPABASE_SENHA no .env.local ou prompt.
//
// AGENDAMENTO (Windows): crie uma tarefa no Agendador de Tarefas executando
//   node C:\Users\andre\Desktop\Anperez_money\scripts\backup_supabase.mjs
// ou `npm run backup` num bat com o %USERPROFILE% correto. Exemplo de bat:
//   @echo off
//   cd /d C:\Users\andre\Desktop\Anperez_money
//   node scripts/backup_supabase.mjs >> backups\backup.log 2>&1
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { dataCivil } from '../src/lib/compartilhados.js'

const DIR = dirname(fileURLToPath(import.meta.url))
const PROJETO = resolve(DIR, '..')
const ENV_LOCAL = resolve(PROJETO, '.env.local')
const DEFAULT_DEST = resolve(PROJETO, 'backups', `backup_${dataCivil(new Date())}`)

// Todas as tabelas do schema (migrations; ordem alfabética). planejamento_series
// NÃO é tabela — são colunas (serie_id/parcela_numero/total_parcelas) dentro de
// planejamentos (migration 09), já exportadas junto.
const TABELAS = [
  'caixinha_movimentacoes',
  'caixinhas',
  'cartoes',
  'compras',
  'contas',
  'despesa_recorrente_item',
  'fatura_pagamentos',
  'movimentacoes',
  'parcelas',
  'planejamentos',
  'ponto_config',
  'ponto_excecoes',
  'ponto_feriados',
  'ponto_ferias',
  'transferencias',
]

function lerArgvs() {
  const args = {}
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a.startsWith('--')) {
      const chave = a.slice(2)
      const valor = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true
      args[chave] = valor
      if (valor !== true) i++
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

async function rest(url, apikey, token, metodo = 'GET', corpo = null) {
  const req = await fetch(url, {
    method: metodo,
    headers: {
      apikey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await req.text()
  let parsed = null
  try {
    parsed = texto ? JSON.parse(texto) : null
  } catch {
    parsed = texto
  }
  return { status: req.status, corpo: parsed }
}

async function login(env) {
  const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const apikey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !apikey) throw new Error('Faltam VITE_SUPABASE_URL/ANON_KEY no .env.local')
  let email = env.SUPABASE_EMAIL || process.env.SUPABASE_EMAIL
  let senha = env.SUPABASE_SENHA || process.env.SUPABASE_SENHA
  if (!email || !senha) {
    const rl = createInterface({ input: stdin, output: stdout })
    try {
      if (!email) email = (await rl.question('E-mail do usuário dono (Supabase): ')).trim()
      if (!senha) senha = await rl.question('Senha: ')
    } finally {
      rl.close()
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
  }
  const { status, corpo } = await rest(
    `${url}/auth/v1/token?grant_type=password`,
    apikey, apikey, 'POST',
    { email, password: senha },
  )
  if (status !== 200 || !corpo || !corpo.access_token) {
    throw new Error(`Falha no login (${status}): ${JSON.stringify(corpo)}`)
  }
  return { url, apikey, token: corpo.access_token }
}

// CSV UTF-8 (com BOM para o Excel) a partir de linhas [objeto]. As colunas são
// as chaves da PRIMEIRA linha; valores aninhados (objetos) viram JSON compacto.
function linhasParaCsv(linhas) {
  if (!linhas.length) return '\uFEFF'
  const cols = Object.keys(linhas[0])
  const esc = (v) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const cab = cols.join(';')
  const corpo = linhas.map((l) => cols.map((c) => esc(l[c])).join(';'))
  return '\uFEFF' + [cab, ...corpo].join('\r\n') + '\r\n'
}

async function exportarTabela(url, apikey, token, tabela) {
  const linhas = []
  const tamPagina = 5000
  for (let offset = 0; ; offset += tamPagina) {
    const { status, corpo } = await rest(
      `${url}/rest/v1/${tabela}?select=*&limit=${tamPagina}&offset=${offset}&order=id`,
      apikey, token,
    )
    if (status !== 200) {
      // tabelas sem coluna id (ex.: ponto_config usa chave) → tenta sem order
      if (status === 400 || status === 404) {
        const fallback = await rest(
          `${url}/rest/v1/${tabela}?select=*&limit=${tamPagina}&offset=${offset}`,
          apikey, token,
        )
        if (fallback.status !== 200) {
          throw new Error(`Falha ${tabela} (${status}->${fallback.status}): ${JSON.stringify(fallback.corpo)}`)
        }
        const rows = Array.isArray(fallback.corpo) ? fallback.corpo : []
        linhas.push(...rows)
        if (rows.length < tamPagina) break
        continue
      }
      throw new Error(`Falha ${tabela} (${status}): ${JSON.stringify(corpo)}`)
    }
    const rows = Array.isArray(corpo) ? corpo : []
    linhas.push(...rows)
    if (rows.length < tamPagina) break
  }
  return linhas.map((l) => {
    const copia = {}
    for (const [k, v] of Object.entries(l)) {
      // datas do PostgREST vêm como 'YYYY-MM-DDTHH:MM:SS' — mantém como está
      copia[k] = v
    }
    return copia
  })
}

async function main() {
  const args = lerArgvs()
  const env = carregarEnv()
  const { url, apikey, token } = await login(env)

  const dest = args.dest || DEFAULT_DEST
  mkdirSync(dest, { recursive: true })

  console.log('=== BACKUP SUPABASE ===')
  console.log(`destino: ${dest}`)
  console.log('')

  const manifest = {
    gerado_em: new Date().toISOString(),
    tabelas: {},
  }

  for (const tabela of TABELAS) {
    const inicio = Date.now()
    try {
      const linhas = await exportarTabela(url, apikey, token, tabela)
      const csv = linhasParaCsv(linhas)
      writeFileSync(resolve(dest, `${tabela}.csv`), csv, 'utf8')
      const colunas = linhas.length ? Object.keys(linhas[0]) : []
      manifest.tabelas[tabela] = {
        linhas: linhas.length,
        colunas,
        arquivo: `${tabela}.csv`,
      }
      console.log(`  ok  ${tabela.padEnd(28)} ${String(linhas.length).padStart(6)} linhas  (${Date.now() - inicio} ms)`)
    } catch (e) {
      console.error(`  [erro] ${tabela}: ${e.message}`)
      manifest.tabelas[tabela] = { erro: e.message }
    }
  }

  const totalLinhas = Object.values(manifest.tabelas).reduce((s, t) => s + (t.linhas || 0), 0)
  writeFileSync(resolve(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  console.log('')
  console.log(`BACKUP CONCLUÍDO: ${Object.keys(manifest.tabelas).length} tabelas, ${totalLinhas} linhas.`)
  console.log(`Pasta: ${dest}`)
  console.log('')
  console.log('Lembrete: guarde uma cópia fora deste PC (disco externo/nuvem) —')
  console.log('um backup local não protege contra falha física do disco.')
}

main().catch((e) => {
  console.error(`ERRO: ${e.message}`)
  if (/login/i.test(e.message || '')) {
    console.error('Dica: confira e-mail/senha do usuário DONO no Supabase, ou use')
    console.error('variáveis de ambiente SUPABASE_EMAIL e SUPABASE_SENHA.')
  }
  process.exitCode = 1
})