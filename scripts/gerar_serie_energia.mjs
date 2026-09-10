// ============================================================================
// gerar_serie_energia.mjs — Cria a SÉRIE RECORRENTE de Conta de Energia (Enel)
// ============================================================================
// Proposta validada com o André (09/09/2026) a partir do boleto enel_set26.pdf:
//   • valor projetado = projetarValorVariavel (regra definitiva) sobre os N
//     últimos reais → 3+: média dos 3 últimos; menos de 3: repete o último;
//   • vencimento dia 9 (dia do boleto atual);
//   • começa no MÊS SEGUINTE ao boleto (a fatura corrente já foi lançada — a
//     série NÃO duplica setembro);
//   • conta de destino padrão = Nubank PJ (histórico do banco antigo).
//
// Usa montarLinhasRecorrentes (mesma lib da tela): valor repetido, clamp do
// dia no fim do mês, semana ISO pela fonte única, estado 'previsto'.
//
// IDEMPOTÊNCIA: aborta se já houver Enel/energia previsto/realizado a partir
// do mês de início.
//
// Uso (DRY-RUN — não grava):
//   node scripts/gerar_serie_energia.mjs
// Para GRAVAR:
//   node scripts/gerar_serie_energia.mjs --sim
// ============================================================================

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { projetarValorVariavel } from '../src/lib/mediaMovelCalc.js'
import { montarLinhasRecorrentes } from '../src/lib/planejamentoSerie.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJETO = path.resolve(__dirname, '..')

function lerEnvLocal() {
  const env = {}
  try {
    for (const linha of readFileSync(path.join(PROJETO, '.env.local'), 'utf8').split('\n')) {
      const t = linha.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const [k, ...r] = t.split('=')
      env[k.trim()] = r.join('=').trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    /* sem .env.local */
  }
  return env
}

function passarArgs() {
  const args = {}
  const lista = process.argv.slice(2)
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i]
    if (a === '--sim') args.sim = true
    else if (a === '--reais') args.reais = lista[++i]
    else if (a === '--dia') args.dia = Number(lista[++i])
    else if (a === '--mes-inicio') args.mesInicio = lista[++i]
    else if (a === '--meses') args.meses = Number(lista[++i])
    else if (a === '--conta') args.conta = lista[++i]
    else if (a === '--email') args.email = lista[++i]
    else if (a === '--senha') args.senha = lista[++i]
    else if (a.startsWith('--reais=')) args.reais = a.split('=')[1]
    else if (a.startsWith('--dia=')) args.dia = Number(a.split('=')[1])
    else if (a.startsWith('--mes-inicio=')) args.mesInicio = a.split('=')[1]
    else if (a.startsWith('--meses=')) args.meses = Number(a.split('=')[1])
    else if (a.startsWith('--conta=')) args.conta = a.split('=')[1]
    else if (a.startsWith('--email=')) args.email = a.split('=')[1]
    else if (a.startsWith('--senha=')) args.senha = a.split('=')[1]
  }
  return args
}

const args = passarArgs()
// Histórico real de energia (banco antigo + boleto set/26) — curva dos 3 últimos.
const reais = (args.reais ?? '154.90,188.72,160.59')
  .split(',')
  .map((v) => Number(v.trim()))
const valorProjetado = projetarValorVariavel({ historico: reais })
if (valorProjetado === null) {
  console.error('[erro] sem histórico real — defina --reais.')
  process.exit(1)
}
const dia = Number.isInteger(args.dia) && args.dia >= 1 && args.dia <= 31 ? args.dia : 9
const mesInicio = args.mesInicio || '2026-10'
const totalParcelas = Number.isInteger(args.meses) && args.meses > 0 ? args.meses : 24
const contaId = args.conta ?? ''

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
const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
if (error) {
  console.error(`[erro] falha no login: ${error.message}`)
  process.exit(1)
}

if (!/^\d{4}-\d{2}$/.test(mesInicio)) {
  console.error('--mes-inicio deve estar no formato YYYY-MM.')
  process.exit(1)
}

console.log('=== GERAÇÃO DA SÉRIE DE ENERGIA (ENEL) ===')
console.log(`  histórico: ${reais.join(' · ')}`)
console.log(`  projeção (regra defin.): ${valorProjetado.toFixed(2)} | vencimento dia ${dia} | início ${mesInicio} | ${totalParcelas} meses | ${args.sim ? 'GRAVANDO' : 'DRY-RUN (use --sim para gravar)'}`)

const { data: jaExistentes } = await supabase
  .from('planejamentos')
  .select('id, descricao, data_prevista, estado')
  .or('descricao.ilike.%enel%,descricao.ilike.%energia%,descricao.ilike.%eletropaulo%')
  .gte('data_prevista', `${mesInicio}-01`)
  .in('estado', ['previsto', 'realizado'])
  .limit(50)
if (jaExistentes && jaExistentes.length > 0) {
  console.error(`[aborta] já existem ${jaExistentes.length} Enel/energia a partir de ${mesInicio}:`)
  for (const p of jaExistentes.slice(0, 10)) console.error(`    ${p.data_prevista} | ${p.descricao} | ${p.estado}`)
  process.exit(1)
}

const observacao = [
  'Conta de energia (Enel) — projeção pela regra de valor variável:',
  `  média dos ${reais.length} últimos reais: ${reais.map((v) => v.toFixed(2)).join(' · ')} = ${valorProjetado.toFixed(2)}`,
  '  a média desliza conforme novos boletos reais forem lançados.',
].join('\n')

const serieId = randomUUID()
const linhas = montarLinhasRecorrentes({
  serieId,
  tipoOp: 'Saida',
  descricao: 'Enel',
  valorCentavos: Math.round(valorProjetado * 100),
  totalParcelas,
  dataPrimeiraParcela: `${mesInicio}-${String(dia).padStart(2, '0')}`,
  periodicidade: 'mensal',
  origem: 'recorrente',
  contaDestinoId: contaId || undefined,
  observacao,
})

console.log(`\n  ${linhas.length} ocorrências a criar na série ${serieId.slice(0, 8)}… (conta destino: ${contaId ? `#${contaId}` : 'sem conta'})`)
for (const l of linhas.slice(0, 5)) {
  console.log(`    ${l.data_prevista} | S${l.ano_semana}/${l.semana} | ${(l.valor).toFixed(2)}`)
}
if (linhas.length > 5) console.log(`    … mais ${linhas.length - 5} (até ${linhas[linhas.length - 1].data_prevista}).`)
const total = linhas.reduce((s, l) => s + l.valor, 0)
console.log(`  Total da série: ${total.toFixed(2)}`)
console.log('\n  Observação:')
console.log(observacao)

if (!args.sim) {
  console.log('\n  Modo DRY-RUN: nada foi gravado. Rode com --sim para criar a série.')
  process.exit(0)
}

const { error: e } = await supabase.from('planejamentos').insert(linhas)
if (e) {
  console.error(`[erro] inserindo a série: ${e.message} ${e.details ?? ''}`)
  process.exit(1)
}
console.log('\n  Série criada com sucesso (previsto, origem recorrente).')