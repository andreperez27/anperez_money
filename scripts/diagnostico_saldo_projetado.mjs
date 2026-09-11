// ============================================================================
// DIAGNÓSTICO do card "Saldo projetado" (dupla contagem de 'realizado').
// ============================================================================
// Somente LEITURA (REST autenticado como o dono, respeita RLS). Reproduz a
// MESMA cadeia do app (useSaldoProjetado + montarProjecao + calcularSaldoProjetado)
// com os dados reais e imprime, uma a uma:
//   1) contas ativas e o saldo inicial (soma dos saldo_atual);
//   2) as movimentações reais REVERTIDAS na base (data > véspera da semana);
//   3) a base da projeção (saldo real ao fim da véspera);
//   4) os itens que entram no somatório (montarProjecao), marcando ESTADO,
//      ORIGEM, DESTINO_PADRAO e se há movimentação real equivalente — a
//      suspeita é o 'realizado' somando de novo por cima da base;
//   5) a série calculada e o saldo ao fim do horizonte (90 dias).
// Uso:  node scripts/diagnostico_saldo_projetado.mjs
// E-mail/senha são pedidos no terminal (ou SUPABASE_EMAIL/SUPABASE_SENHA).
// ============================================================================
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { hoje } from '../src/lib/compartilhados.js'
import { definirPeriodo } from '../src/lib/periodos.js'
import { adicionarDiasISO } from '../src/lib/saldoProjetado.js'

const DIR = dirname(fileURLToPath(import.meta.url))
const ENV_LOCAL = resolve(DIR, '..', '.env.local')

function carregarEnv() {
  const env = {}
  if (requirePresente(ENV_LOCAL)) {
    for (const linha of readFileSync(ENV_LOCAL, 'utf8').split('\n')) {
      const l = linha.trim()
      if (!l || l.startsWith('#') || !l.includes('=')) continue
      const [chave, ...resto] = l.split('=')
      env[chave.trim()] = resto.join('=').trim().replace(/^["']|["']$/g, '')
    }
  }
  return env
}

function requirePresente(p) {
  try {
    readFileSync(p)
    return true
  } catch {
    return false
  }
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
  if (!url || !apikey) {
    throw new Error('Faltam VITE_SUPABASE_URL/ANON_KEY no .env.local')
  }
  let email = env.SUPABASE_EMAIL || process.env.SUPABASE_EMAIL
  let senha = process.env.SUPABASE_SENHA
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

const fmt = (v) =>
  (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const env = carregarEnv()
  const { url, apikey, token } = await login(env)
  const construtor = (tabela, select) => `${url}/rest/v1/${tabela}?select=${encodeURIComponent(select)}`

  const hojeDia = hoje()
  const inicioSemana = definirPeriodo('semana', hojeDia).inicio
  const vespera = adicionarDiasISO(inicioSemana, -1)
  const coberturaMinima = adicionarDiasISO(hojeDia, -400)
  const fimHorizonte = adicionarDiasISO(hojeDia, 90)

  console.log('=== DADOS DO DIAGNÓSTICO ===')
  console.log(`hoje=${hojeDia} | semana inicia ${inicioSemana} | véspera=${vespera}`)
  console.log(`cobertura mínima (movimentações)=${coberturaMinima} | fim do horizonte=${fimHorizonte}`)
  console.log('')

  // ---- 1) contas ativas -----------------------------------------------------
  const { status: stContas, corpo: contas } = await rest(
    construtor('contas', 'id,nome,tipo,ativa,saldo_atual') + '&ativa=eq.true&order=nome',
    apikey, token,
  )
  if (stContas !== 200) throw new Error(`Falha contas (${stContas}): ${JSON.stringify(contas)}`)
  const saldoInicial = (contas || []).reduce((s, c) => s + Number(c.saldo_atual || 0), 0)
  console.log('1) CONTAS ATIVAS')
  for (const c of contas || []) {
    console.log(`   ${c.nome.padEnd(24)} R$ ${fmt(c.saldo_atual)}`)
  }
  console.log(`   SALDO INICIAL (soma contas ativas) = R$ ${fmt(saldoInicial)}`)
  console.log('')

  // ---- 2) movimentações reais das contas ativas (janela de cobertura) -------
  const ids = (contas || []).map((c) => c.id)
  const { status: stMov, corpo: movs } = await rest(
    construtor('movimentacoes', 'id,conta_id,data,tipo_op,valor,categoria,descricao') +
      `&conta_id=in.(${ids.join(',')})&data=gte.${coberturaMinima}&data=lte.${hojeDia}&order=data`,
    apikey, token,
  )
  if (stMov !== 200) throw new Error(`Falha movimentacoes (${stMov}): ${JSON.stringify(movs)}`)
  const movsSemana = (movs || [])
    .filter((m) => String(m.data) > vespera)
    .sort((a, b) => (a.data < b.data ? -1 : 1))
  console.log('2) MOVIMENTAÇÕES REAIS REVERTIDAS NA BASE (data > véspera da semana)')
  if (!movsSemana.length) console.log('   (nenhuma)')
  for (const m of movsSemana) {
    const sinal = m.tipo_op === 'Entrada' ? '+' : '-'
    console.log(`   ${m.data} ${sinal} R$ ${fmt(m.valor).padStart(10)} [${m.categoria}] ${m.descricao || ''}`)
    console.log(`       conta_id=${m.conta_id}  mov_id=${m.id}`)
  }
  console.log('')

  // ---- 3) planejamentos do horizonte (mesma consulta do app: sem histórico) --
  const { status: stPlan, corpo: plan } = await rest(
    construtor('planejamentos', '*') +
      `&data_prevista=gte.${inicioSemana}&data_prevista=lte.${fimHorizonte}` +
      '&origem=not.like.historico_*&order=data_prevista,parcela_numero,criado_em,id',
    apikey, token,
  )
  if (stPlan !== 200) throw new Error(`Falha planejamentos (${stPlan}): ${JSON.stringify(plan)}`)

  // ---- 4) cartões + faturas reais + previstos de cartão + férias + feriados --
  const { status: stCart, corpo: cartoes } = await rest(construtor('cartoes', '*'), apikey, token)
  if (stCart !== 200) throw new Error(`Falha cartoes (${stCart})`)
  const { status: stFat, corpo: faturasView } = await rest(
    construtor('v_faturas', '*') + `&cartao_id=in.(${(cartoes || []).map((c) => c.id).join(',')})`,
    apikey, token,
  )
  if (stFat !== 200) throw new Error(`Falha v_faturas (${stFat}): ${JSON.stringify(faturasView)}`)
  const { status: stPrev, corpo: previstosCartao } = await rest(
    construtor('planejamentos', '*') +
      '&estado=eq.previsto&destino_padrao=eq.cartao&cartao_padrao_id=not.is.null&order=data_prevista',
    apikey, token,
  )
  if (stPrev !== 200) throw new Error(`Falha previstosCartao (${stPrev})`)
  const { status: stFer, corpo: ferias } = await rest(
    construtor('ponto_ferias', 'data_inicio,data_fim'), apikey, token,
  )
  if (stFer !== 200) throw new Error(`Falha ponto_ferias (${stFer})`)
  const { status: stFerH, corpo: feriados } = await rest(
    construtor('ponto_feriados', 'data'), apikey, token,
  )
  if (stFerH !== 200) throw new Error(`Falha ponto_feriados (${stFerH})`)

  // ---- 5) reproduzir a cadeia com as libs do app ----------------------------
  const { calcularSaldoReal, calcularSaldoProjetado } = await import('../src/lib/saldoProjetado.js')
  const { montarProjecao } = await import('../src/lib/faturaProjecao.js')

  const base = calcularSaldoReal({
    saldoAtual: saldoInicial,
    movimentacoes: movs || [],
    dataAlvo: vespera,
    coberturaMinima,
  })
  console.log(`3) BASE DA PROJEÇÃO = saldo real ao fim da véspera = R$ ${fmt(base ?? null)}`)
  console.log('')

  const cartaoPorId = new Map((cartoes || []).map((c) => [c.id, c]))
  const faturasReais = (faturasView || [])
    .filter((f) => f && f.cartao_id && cartaoPorId.has(f.cartao_id))
    .map((f) => ({ cartao: cartaoPorId.get(f.cartao_id), mes: f.mes_fatura, valor_restante: f.valor_restante }))

  const projecao = montarProjecao({
    itensBase: plan || [],
    cartoes: cartoes || [],
    faturasReais,
    inicioISO: inicioSemana,
    fimISO: fimHorizonte,
    previstosCartaoExternos: previstosCartao || [],
    ferias: ferias || [],
    feriados: feriados || [],
  })

  console.log('4) ITENS QUE ENTRAM NO SOMATÓRIO (itensParaSomatorio, ordenados)')
  console.log('   (marcação "mov?" = existe movimentação real equivalente na véspera+ )')
  const movChave = new Map((movs || []).map((m) => [`${m.data}|${m.tipo_op}|${Number(m.valor)}`, m]))
  for (const it of projecao.itensParaSomatorio) {
    const chave = `${it.data_prevista}|${it.tipo_op}|${Number(it.valor)}`
    const temMov = movChave.has(chave)
    const ehFatura = !!it.fatura || !!it.cartao_id
    const sinal = it.tipo_op === 'Entrada' ? '+' : '-'
    console.log(
      `   ${String(it.data_prevista)} ${sinal} R$ ${fmt(it.valor).padStart(10)} ` +
        `estado=${String(it.estado).padEnd(9)} origem=${String(it.origem || '').padEnd(14)} ` +
        `dest_padrao=${String(it.destino_padrao || '').padEnd(7)} it_cartao=${ehFatura} mov?=${temMov} ${it.descricao || ''}`,
    )
  }
  console.log('')

  const saldo = calcularSaldoProjetado(base, projecao.itensParaSomatorio, {
    inicioISO: inicioSemana,
    fimISO: fimHorizonte,
  })
  console.log('5) SÉRIE ACUMULADA (saldo ao fim de cada dia com movimento)')
  for (const m of saldo.serie) {
    console.log(`   ${m.data}  R$ ${fmt(m.saldo)}`)
  }
  console.log(`   SALDO AO FIM DO HORIZONTE = R$ ${fmt(saldo.saldoAoFim)}`)
  console.log('')

  // Saldo projetado do CARD da semana/visão: saldo ao fim do período visível.
  const fimPeriodoVisivel = fimHorizonte // no diagnóstico usamos o horizonte
  const saldoCard = saldo.saldoAteData(saldo.serie, fimPeriodoVisivel, base)
  console.log(`SALDO PROJETADO (fim da faixa ${fimPeriodoVisivel}) = R$ ${fmt(saldoCard)}`)
  console.log(`SALDO REAL ATUAL (soma contas ativas)      = R$ ${fmt(saldoInicial)}`)
  console.log('')
  console.log('Comparação rápida: se o saldo projetado está bem acima do real, veja')
  console.log('nos itens acima os "estado=realizado" com mov?=false — eles somaram')
  console.log('na projeção SEM terem sido revertidos da base (dupla contagem).')
}

main().catch((e) => {
  console.error(`ERRO: ${e.message}`)
  if (/login/i.test(e.message || '') || /invalid_credentials/i.test(e.message || '')) {
    console.error('')
    console.error('Dica: confira e-mail/senha do usuário DONO no Supabase, ou use')
    console.error('variáveis de ambiente SUPABASE_EMAIL e SUPABASE_SENHA.')
  }
  process.exitCode = 1
})