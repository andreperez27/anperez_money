// ============================================================================
// LEVANTAMENTO do consumo real de condomínio (SOMENTE LEITURA — 22/09/2026)
// ============================================================================
// Cruza condominio_consumo_mensal com as ocorrências de Condomínio
// (previsto/realizado) para achar dano do bug "1055 trava o mês inteiro":
//   A: previsto + 1055 com só UM item registrado no consumo (trava parcial);
//   B: realizado + 1055 com só UM item registrado (estimativa congelada no
//      realizado → contamina a média móvel, que lê realizado);
//   C: linhas de consumo em mês sem ocorrência (órfãs);
//   D: consumo registrado mas ocorrência SEM 1055;
//   E: ocorrência com 1055 mas SEM nenhuma linha de consumo.
// Só imprime no stdout — não grava nada, não altera nada.
// Uso: node scripts/levantar_consumo_condominio.mjs
// ============================================================================
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const PROJETO = resolve(DIR, '..')

function lerEnv() {
  const env = {}
  try {
    for (const linha of readFileSync(resolve(PROJETO, '.env.local'), 'utf8').split('\n')) {
      const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2]
    }
  } catch { /* sem .env.local */ }
  return env
}

async function rest(url, apikey, token) {
  const req = await fetch(url, {
    headers: { apikey, Authorization: `Bearer ${token}` },
  })
  const texto = await req.text()
  try {
    return { status: req.status, corpo: texto ? JSON.parse(texto) : null }
  } catch {
    return { status: req.status, corpo: texto }
  }
}

function parseValorObs(obs, cod) {
  if (!obs) return null
  const linha = String(obs).split('\n').find((l) => {
    const t = l.trim()
    return t.startsWith(`${cod} `) || t.startsWith(`${cod}\t`)
  })
  if (!linha) return null
  const m = linha.match(/R\$\s*([\d.,]+)/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const tem1055 = (obs) =>
  String(obs ?? '').split('\n').some((l) => {
    const t = l.trim()
    return t === '1055' || t.startsWith('1055 ') || t.startsWith('1055\t')
  })

const BRL = (v) => (v === null || v === undefined ? '—' : `R$ ${Number(v).toFixed(2).replace('.', ',')}`)

const env = lerEnv()
const url = env.VITE_SUPABASE_URL
const apikey = env.VITE_SUPABASE_ANON_KEY
const { status, corpo } = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.SUPABASE_EMAIL, password: env.SUPABASE_SENHA }),
}).then(async (r) => ({ status: r.status, corpo: await r.json().catch(() => null) }))
if (status !== 200 || !corpo?.access_token) throw new Error(`Falha no login (${status})`)
const token = corpo.access_token

async function get(tabela, query) {
  const r = await rest(`${url}/rest/v1/${tabela}?${query}`, apikey, token)
  if (r.status !== 200) throw new Error(`GET ${tabela} → ${r.status}: ${JSON.stringify(r.corpo)}`)
  return r.corpo ?? []
}

const consumo = await get(
  'condominio_consumo_mensal',
  'select=mes,mes_consumo,tipo,valor,leitura_atual,leitura_anterior&order=mes.asc&order=tipo.asc&limit=500',
)
const ocorrencias = await get(
  'planejamentos',
  'select=id,data_prevista,estado,valor,observacao,serie_id&origem=eq.recorrente&descricao=ilike.Condom%C3%ADnio%25&estado=in.(previsto,realizado)&order=data_prevista.asc&limit=500',
)

console.log(`\n== condominio_consumo_mensal: ${consumo.length} linha(s) ==`)
for (const c of consumo) {
  console.log(
    `  ${c.mes} consumo=${String(c.mes_consumo ?? '?').slice(0, 7)} ${c.tipo}: ${BRL(c.valor)} (atual=${c.leitura_atual ?? '—'} anterior=${c.leitura_anterior ?? '—'})`,
  )
}

console.log(`\n== ocorrências Condomínio previsto/realizado: ${ocorrencias.length} ==`)
const porMes = new Map()
for (const o of ocorrencias) {
  const mes = String(o.data_prevista).slice(0, 7)
  if (!porMes.has(mes)) porMes.set(mes, { consumo: { gas: null, agua: null }, ocorrencias: [] })
  porMes.get(mes).ocorrencias.push(o)
}
for (const c of consumo) {
  const mes = String(c.mes).slice(0, 7)
  if (!porMes.has(mes)) porMes.set(mes, { consumo: { gas: null, agua: null }, ocorrencias: [] })
  if (c.tipo === 'gas' || c.tipo === 'agua') porMes.get(mes).consumo[c.tipo] = c
}

const flags = { A: [], B: [], C: [], D: [], E: [] }
for (const [mes, { consumo: cons, ocorrencias: ocs }] of [...porMes.entries()].sort()) {
  const g = cons.gas
  const a = cons.agua
  const nCons = (g ? 1 : 0) + (a ? 1 : 0)
  for (const o of ocs) {
    const m1055 = tem1055(o.observacao)
    const gObs = parseValorObs(o.observacao, '1010')
    const aObs = parseValorObs(o.observacao, '1052')
    console.log(
      `  ${mes} ${o.estado} valor=${BRL(o.valor)} 1055=${m1055 ? 'SIM' : 'não'} ` +
        `obs(1010=${BRL(gObs)} 1052=${BRL(aObs)}) consumo(gas=${g ? BRL(g.valor) : '—'} agua=${a ? BRL(a.valor) : '—'})`,
    )
    if (o.estado === 'previsto' && m1055 && nCons === 1) flags.A.push(mes)
    if (o.estado === 'realizado' && m1055 && nCons === 1) flags.B.push(mes)
    if (m1055 && nCons === 0) flags.E.push(`${mes} (${o.estado})`)
    if (!m1055 && nCons > 0) flags.D.push(`${mes} (${o.estado}, ${nCons} item(ns))`)
  }
  if (ocs.length === 0 && nCons > 0) flags.C.push(mes)
}

console.log('\n== FLAGS ==')
console.log(`A (previsto+1055 com só 1 item no consumo — trava parcial): ${flags.A.join(', ') || 'nenhum'}`)
console.log(`B (realizado+1055 com só 1 item — estimativa congela média): ${flags.B.join(', ') || 'nenhum'}`)
console.log(`C (consumo sem ocorrência no mês): ${flags.C.join(', ') || 'nenhum'}`)
console.log(`D (consumo registrado mas ocorrência sem 1055): ${flags.D.join(', ') || 'nenhum'}`)
console.log(`E (1055 sem nenhuma linha de consumo): ${flags.E.join(', ') || 'nenhum'}`)
