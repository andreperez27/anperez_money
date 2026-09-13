// ============================================================================
// backfill_snapshot_condominio.mjs — Snapshot retroativo dos condomínios realizados
// ============================================================================
// A migration 36 captura o snapshot do boleto NO MOMENTO da realização (passo
// 8.5 da RPC). Condomínios já realizados ANTES dela (ex.: "Condomínio 2026/09",
// lançado em 08/09) ficaram SEM snapshot — caso previsto na própria migration:
// "o backfill fica para script separado após a aprovação do André".
//
// Este script replica, em JS, a lógica EXATA de registrar_snapshot_condominio
// (meses vigentes dos fixos, referência n/total, Gás/Água por condominio_
// consumo_mensal com fallback para a observação via parseValorObservacao) e
// grava em condominio_boleto_itens. Mesma unidade REAIS (numeric 12,2).
//
// IDEMPOTENTE: ocorrências que JÁ têm snapshot são puladas; as inserções usam
// upsert com ignoreDuplicates por (planejamento_id, cod). Rodar de novo não
// duplica nem sobrescreve.
//
// Autentica como o USUÁRIO DONO via @supabase/supabase-js (email/senha) —
// respeita RLS como os hooks. Credenciais: .env.local (SUPABASE_EMAIL/SENHA)
// ou variáveis de ambiente.
//
// Uso (DRY-RUN, só imprime):
//   node scripts/backfill_snapshot_condominio.mjs
// Para GRAVAR:
//   node scripts/backfill_snapshot_condominio.mjs --sim
// ============================================================================

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { parseValorObservacao } from '../src/lib/serieValorVariavel.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJETO = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const sim = args.includes('--sim')

// Mesmo mapa de disposição real do boleto (migration 36).
const ORDEM_POR_COD = { '1002': 1, '1050': 2, '3002': 3, '1102': 4, '15002': 5, '2002': 6 }

// Nº de meses de calendário cheios entre duas datas (b depois de a) —
// réplica JS de public.meses_cheios (migration 36).
function mesesCheios(a, b) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
}

function dataISO(parte) {
  const [ano, mes, dia] = parte.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, dia))
}

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

const env = lerEnvLocal()
const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
const apikey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!url || !apikey) {
  console.error('Faltam VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (.env.local).')
  process.exit(1)
}
const email = process.env.SUPABASE_EMAIL || env.SUPABASE_EMAIL
const senha = process.env.SUPABASE_SENHA || env.SUPABASE_SENHA
if (!email || !senha) {
  console.error('Informe o usuário dono via SUPABASE_EMAIL/SUPABASE_SENHA (variáveis de ambiente).')
  process.exit(1)
}

const supabase = createClient(url, apikey)

console.log('=== BACKFILL SNAPSHOT CONDOMÍNIO ===')
console.log(`  ${sim ? 'GRAVANDO' : 'DRY-RUN (use --sim para gravar)'}`)

const { error: erroLogin } = await supabase.auth.signInWithPassword({ email, password: senha })
if (erroLogin) {
  console.error(`[erro] falha no login: ${erroLogin.message}`)
  process.exit(1)
}
console.log(`  autenticado como ${email}`)

// 1. Condomínios realizados sem snapshot (a mesma convenção da migration:
//    origem 'recorrente' + descrição começando em "Condomínio").
const { data: realizados, error: erroRealizados } = await supabase
  .from('planejamentos')
  .select('id, user_id, descricao, data_prevista, observacao, origem')
  .eq('origem', 'recorrente')
  .eq('estado', 'realizado')
  .order('data_prevista')
if (erroRealizados) {
  console.error(`[erro] planejamentos: ${erroRealizados.message}`)
  process.exit(1)
}
const condos = realizados.filter((p) => /^condom[ií]nio/i.test(p.descricao || ''))

// 2. Itens fixos (vigência por mês) + consumo mensal disponível.
const { data: itensFixos, error: erroFixos } = await supabase
  .from('despesa_recorrente_item')
  .select('*')
if (erroFixos) {
  console.error(`[erro] despesa_recorrente_item: ${erroFixos.message}`)
  process.exit(1)
}
const { data: consumos, error: erroConsumos } = await supabase
  .from('condominio_consumo_mensal')
  .select('*')
if (erroConsumos) {
  console.error(`[erro] condominio_consumo_mensal: ${erroConsumos.message}`)
  process.exit(1)
}

let totais = { processados: 0, pulados: 0, linhas: 0 }

for (const p of condos) {
  const mes = dataISO(`${p.data_prevista.slice(0, 7)}-01`)

  // já tem snapshot? pula (idempotente)
  const { data: existentes } = await supabase
    .from('condominio_boleto_itens')
    .select('cod')
    .eq('planejamento_id', p.id)
  if (existentes && existentes.length > 0) {
    totais.pulados += 1
    console.log(`  [pula] ${p.descricao} (${p.data_prevista}) — já tem ${existentes.length} linha(s)`)
    continue
  }

  const linhas = []
  for (const d of itensFixos) {
    if (d.user_id !== p.user_id) continue
    const inicio = dataISO(d.vigencia_inicio)
    if (inicio > mes) continue
    const termino = d.vigencia_termino ? dataISO(d.vigencia_termino) : null
    if (termino && termino < mes) continue
    const ordem = ORDEM_POR_COD[d.cod] ?? 100
    const referencia = termino
      ? `${mesesCheios(inicio, mes) + 1}/${mesesCheios(inicio, termino) + 1}`
      : null
    linhas.push({
      user_id: p.user_id,
      planejamento_id: p.id,
      cod: d.cod,
      descricao: d.descricao,
      valor: d.valor,
      categoria: d.categoria,
      referencia,
      ordem,
      mes: p.data_prevista.slice(0, 7) + '-01',
    })
  }

  // Gás (1010) / Água (1052): consumo do mês no banco; fallback observação.
  const mesKey = p.data_prevista.slice(0, 7) + '-01'
  const consumoMes = (consumos || []).filter((c) => c.mes === mesKey && c.user_id === p.user_id)
  const consumoDe = (tipo) => {
    const reg = consumoMes.find((c) => c.tipo === tipo)
    if (reg) return Number(reg.valor)
    return parseValorObservacao(p.observacao, tipo === 'gas' ? '1010' : '1052')
  }
  const gas = consumoDe('gas')
  const agua = consumoDe('agua')
  if (gas != null && gas >= 0) {
    linhas.push({ user_id: p.user_id, planejamento_id: p.id, cod: '1010', descricao: 'Consumo de Gás', valor: gas, categoria: 'Consumo', referencia: null, ordem: 7, mes: mesKey })
  }
  if (agua != null && agua >= 0) {
    linhas.push({ user_id: p.user_id, planejamento_id: p.id, cod: '1052', descricao: 'Consumo de Água', valor: agua, categoria: 'Consumo', referencia: null, ordem: 8, mes: mesKey })
  }

  linhas.sort((a, b) => a.ordem - b.ordem)
  const total = linhas.reduce((s, l) => s + Number(l.valor), 0)

  console.log(`  ${p.descricao} (${p.data_prevista}): ${linhas.length} itens — total R$ ${total.toFixed(2)}`)
  for (const l of linhas) {
    console.log(`      ${l.ordem} ${l.cod} ${l.descricao} ${l.referencia ?? ''} R$ ${Number(l.valor).toFixed(2)}`)
  }

  totais.processados += 1
  if (sim) {
    const { error: erroInsercao } = await supabase
      .from('condominio_boleto_itens')
      .upsert(linhas, { onConflict: 'planejamento_id,cod', ignoreDuplicates: true })
    if (erroInsercao) {
      console.error(`    [erro] inserção: ${erroInsercao.message}`)
      process.exitCode = 1
      continue
    }
    totais.linhas += linhas.length
  }
}

console.log('')
console.log(`RESUMO: ${totais.processados} snapshot(s) ${sim ? 'gravados' : 'prontos para gravar'} (${totais.linhas} linhas), ${totais.pulados} já existente(s).`)
if (!sim) console.log('Rode com --sim para gravar de verdade.')