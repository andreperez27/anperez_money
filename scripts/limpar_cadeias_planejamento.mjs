// ============================================================================
// LIMPAR CADEIAS DE MIGRAÇÃO DE ATRASO (one-off, 30/10/2026)
// ============================================================================
// O bug do botão "Jogar p/ próx. semana" (corrigido hoje: +7 da própria
// ocorrência) empilhou elos repetidos nas cadeias de atraso: a mesma pendência
// era migrada de novo a cada clique e cada elo ficava 'migrado' com
// valor_pendente igual, sem lançamento. Visualmente o Planejamento mostra a
// mesma dívida 4-6 vezes (as linhas 'migrado' NÃO entram nos totais —
// src/lib/planejamentoCalc.js), então a limpeza é organizacional: nenhum
// saldo, recebimento ou relatório muda.
//
// REGRA (por cadeia, seguindo origem_atraso_id):
//   • MANTER a primeira linha (raiz) e a última (destino atual);
//   • MANTER qualquer elo com lançamento (realizado/cancelado) — histórico;
//   • APAGAR os elos do meio que estão 'migrado' e sem lancamento_id;
//   • RELIGAR cada linha mantida na anterior mantida (a FK é ON DELETE SET
//     NULL, então a religação é explícita depois dos deletes).
//
// Uso:
//   node scripts/limpar_cadeias_planejamento.mjs            → prévia (dry-run)
//   node scripts/limpar_cadeias_planejamento.mjs --aplicar  → aplica
//
// Antes de aplicar, rode o backup: scripts/backup_semanal.bat
// ============================================================================
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const ENV_LOCAL = resolve(DIR, '..', '.env.local')

const CAMPOS =
  'id,tipo_op,descricao,valor,data_prevista,estado,origem,origem_atraso_id,' +
  'lancamento_id,ano_semana_trabalho,semana_trabalho,criado_em'

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
    // sem .env.local: usa process.env
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
      Prefer: metodo === 'GET' ? undefined : 'return=representation',
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
  const email = env.SUPABASE_EMAIL || process.env.SUPABASE_EMAIL
  const senha = env.SUPABASE_SENHA || process.env.SUPABASE_SENHA
  if (!url || !apikey) throw new Error('Faltam VITE_SUPABASE_URL/ANON_KEY no .env.local')
  if (!email || !senha) throw new Error('Faltam SUPABASE_EMAIL/SUPABASE_SENHA no .env.local')

  const { status, corpo } = await rest(
    `${url}/auth/v1/token?grant_type=password`,
    apikey,
    apikey,
    'POST',
    { email, password: senha },
  )
  if (status !== 200 || !corpo?.access_token) {
    throw new Error(`Falha no login (${status}): ${JSON.stringify(corpo)}`)
  }
  return { url, apikey, token: corpo.access_token }
}

const brl = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ddmm = (iso) => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}`

function descreveLinha(x) {
  return (
    `${ddmm(x.data_prevista)} ${String(x.estado).padEnd(9)} ` +
    `${brl(x.valor).padStart(12)}  "${x.descricao}"  ` +
    `sem.trab=${x.semana_trabalho ?? '-'}  lanc=${x.lancamento_id ? 'sim' : '-'}`
  )
}

// Monta as cadeias: raiz → filho → neto … (a FK garante no máximo 1 filho).
function montarCadeias(linhas) {
  const porId = new Map(linhas.map((l) => [l.id, l]))
  const filhos = new Map()
  for (const l of linhas) {
    if (!l.origem_atraso_id) continue
    if (!filhos.has(l.origem_atraso_id)) filhos.set(l.origem_atraso_id, [])
    filhos.get(l.origem_atraso_id).push(l)
  }
  const raizes = linhas.filter((l) => !l.origem_atraso_id || !porId.has(l.origem_atraso_id))
  const cadeias = []
  for (const raiz of raizes) {
    const cadeia = [raiz]
    let atual = raiz
    while (filhos.has(atual.id)) {
      atual = filhos.get(atual.id)[0]
      if (cadeia.includes(atual)) break // proteção contra ciclo
      cadeia.push(atual)
    }
    if (cadeia.length > 1) cadeias.push(cadeia)
  }
  return cadeias
}

function planejar(cadeia) {
  const manter = []
  const apagar = []
  cadeia.forEach((x, i) => {
    const ehPonta = i === 0 || i === cadeia.length - 1
    const temHistorico = x.lancamento_id != null || x.estado === 'realizado' || x.estado === 'cancelado'
    if (ehPonta || temHistorico) manter.push(x)
    else if (x.estado === 'migrado') apagar.push(x)
    else manter.push(x) // estado inesperado no meio: preserva
  })
  return { manter, apagar }
}

async function buscarLinhas(ctx) {
  const { url, apikey, token } = ctx
  const { status, corpo } = await rest(
    `${url}/rest/v1/planejamentos?select=${CAMPOS}&origem_atraso_id=not.is.null&order=criado_em.asc`,
    apikey,
    token,
  )
  if (status !== 200) throw new Error(`Falha ao ler planejamentos (${status}): ${JSON.stringify(corpo)}`)
  // A raiz da cadeia não tem origem_atraso_id; busca as raízes das cadeias
  // encontradas em uma segunda consulta.
  const idsRaizes = [...new Set(corpo.map((l) => l.origem_atraso_id))]
  const { status: st2, corpo: raizes } = await rest(
    `${url}/rest/v1/planejamentos?select=${CAMPOS}&id=in.(${idsRaizes.join(',')})&order=criado_em.asc`,
    apikey,
    token,
  )
  if (st2 !== 200) throw new Error(`Falha ao ler raízes (${st2}): ${JSON.stringify(raizes)}`)
  const porId = new Map()
  for (const l of [...raizes, ...corpo]) porId.set(l.id, l)
  return [...porId.values()]
}

async function main() {
  const aplicar = process.argv.includes('--aplicar')
  const ctx = await login(carregarEnv())
  console.log(`=== LIMPEZA DAS CADEIAS DE MIGRAÇÃO ${aplicar ? '(APLICANDO)' : '(PRÉVIA — nada é gravado)'} ===`)

  const linhas = await buscarLinhas(ctx)
  const cadeias = montarCadeias(linhas)
  const longas = cadeias
    .map((c) => ({ cadeia: c, ...planejar(c) }))
    .filter((p) => p.apagar.length > 0)

  if (longas.length === 0) {
    console.log('\nNenhuma cadeia com elo repetido. Nada a fazer.')
    return
  }

  let totalApagar = 0
  for (const { cadeia, manter, apagar } of longas) {
    totalApagar += apagar.length
    console.log(`\n--- CADEIA "${cadeia[0].descricao}" (${cadeia.length} elos → ${manter.length}) ---`)
    const apagarIds = new Set(apagar.map((x) => x.id))
    for (const x of cadeia) {
      const marca = apagarIds.has(x.id) ? '[APAGAR]' : '[MANTER]'
      console.log(`  ${marca} ${descreveLinha(x)}`)
    }
  }

  console.log(
    `\nResumo: ${longas.length} cadeia(s), ${totalApagar} linha(s) 'migrado' repetida(s) a apagar. ` +
      `Nenhum valor/estado/relatório muda (linhas 'migrado' ficam fora dos totais).`,
  )

  if (!aplicar) {
    console.log('\nPrévia somente. Para aplicar: node scripts/limpar_cadeias_planejamento.mjs --aplicar')
    return
  }

  // 1) Apaga os elos repetidos (a FK origem_atraso_id é ON DELETE SET NULL).
  const idsApagar = []
  const religacoes = []
  for (const { manter, apagar } of longas) {
    idsApagar.push(...apagar.map((x) => x.id))
    for (let i = 1; i < manter.length; i++) {
      if (manter[i].origem_atraso_id !== manter[i - 1].id) {
        religacoes.push({ id: manter[i].id, origem_atraso_id: manter[i - 1].id })
      }
    }
  }

  const { url, apikey, token } = ctx
  const del = await rest(
    `${url}/rest/v1/planejamentos?id=in.(${idsApagar.join(',')})`,
    apikey,
    token,
    'DELETE',
  )
  if (del.status >= 300) throw new Error(`Falha ao apagar (${del.status}): ${JSON.stringify(del.corpo)}`)
  console.log(`\nApagadas ${idsApagar.length} linha(s).`)

  // 2) Religa cada linha mantida na anterior mantida.
  for (const r of religacoes) {
    const up = await rest(
      `${url}/rest/v1/planejamentos?id=eq.${r.id}`,
      apikey,
      token,
      'PATCH',
      { origem_atraso_id: r.origem_atraso_id },
    )
    if (up.status >= 300) throw new Error(`Falha ao religar ${r.id} (${up.status}): ${JSON.stringify(up.corpo)}`)
  }
  console.log(`Religadas ${religacoes.length} linha(s).`)

  // 3) Verificação: relê tudo e garante que nenhuma cadeia tem elo repetido.
  const depois = await buscarLinhas(ctx)
  const restantes = montarCadeias(depois).filter((c) => planejar(c).apagar.length > 0)
  if (restantes.length > 0) {
    throw new Error(`Verificação falhou: ${restantes.length} cadeia(s) ainda com elo repetido.`)
  }
  console.log('Verificação OK: nenhuma cadeia tem elo repetido.')
  console.log('\nCadeias finais:')
  for (const c of montarCadeias(depois).filter((c) => c.length > 1)) {
    console.log(`\n--- "${c[0].descricao}" (${c.length}) ---`)
    for (const x of c) console.log(`  ${descreveLinha(x)}`)
  }
}

main().catch((e) => {
  console.error('\nERRO:', e.message)
  process.exit(1)
})
