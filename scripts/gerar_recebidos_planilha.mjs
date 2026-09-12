// ============================================================================
// GERAR RECEBIDOS PARA A PLANILHA CONTABILADE (etapa 1 de 2)
// ============================================================================
// Busca no Supabase os recebimentos REAIS do app (a partir da semana 34/2026 —
// regra 05/09/2026: de 24/08/2026 em diante o APP é a fonte) e grava um arquivo
// JSON intermediário que o script Python (sincronizar_planilha_supabase.py)
// consome para escrever na CONTABILADE_Consolidada_atualizada.xlsx.
//
// A cadeia de cálculo é EXATAMENTE a do relatório "Recebido & horas": importa a
// lib PÚRICA do app (src/lib/relatorioRecebidoHoras.js, funkcja calcularRece-
// bidoHoras) e reproduz a consulta do hook useRelatorioRecebidoHoras:
//   1) planejamentos realizados Entrada do período (data real dentro da faixa);
//   2) data real de cada recebimento via movimentacoes.data (dataRealPor-
//      Lancamento — mapa { [lancamento_id]: 'YYYY-MM-DD' });
//   3) fixo semanal padrão do Ponto (ponto_config.VALOR_FIXO_SEMANA) — a régua
//      dos extras;
//   4) extras = quanto o recebido passou do fixo da semana de TRABALHO (com a
//      regra de rateio proporcional das parcelas, igualzinho à lib).
//
// SAÍDA (JSON intermediário, NUNCA diretamente a planilha):
//   {
//     "gerado_em":        <ISO>,
//     "corte":            "2026-08-24",
//     "fixo_semana":      1650,
//     "recebidos": [
//       { "data": "2026-08-24", "valor": 1650, "valor_fixo": 1650,
//         "hora_extras": 0, "descricao": "..." },
//       ...
//     ]
//   }
//   • data        = dia real em que o dinheiro ENTROU (movimentacoes.data) ou a
//                   data_prevista quando não há lançamento;
//   • valor       = valor total do recebimento (coluna F da planilha);
//   • valor_fixo  = fatia da base (fixo) da semana de trabalho atribuída a esta
//                   linha — para recebimentos com semana de trabalho gravada é
//                   `valor − hora_extras` (garante B + C = F por linha e a soma
//                   das fatias == a base da semana, como o rateio da lib);
//                   para recebimentos avulsos (sem semana de trabalho) é null;
//   • hora_extras = extras da linha (coluna C) — a fatia do rateio da lib;
//   • descricao   = descrição salva (coluna G).
//
// Só linhas com data >= corte entram no JSON (a planilha já tem as antigas).
//
// Flags:
//   --saida CAMINHO   arquivo JSON intermediário (default: scripts/recebidos_para_planilha.json)
//   --email / --senha credenciais (ou SUPABASE_EMAIL/SUPABASE_SENHA no .env.local)
// Uso: node scripts/gerar_recebidos_planilha.mjs
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { hoje } from '../src/lib/compartilhados.js'
import { definirPeriodoPersonalizado } from '../src/lib/periodos.js'
import { semanaIso } from '../src/lib/semana.js'
import { calcularRecebidoHoras } from '../src/lib/relatorioRecebidoHoras.js'

const DIR = dirname(fileURLToPath(import.meta.url))
const ENV_LOCAL = resolve(DIR, '..', '.env.local')
const CORTE_2026 = '2026-08-24'
const DEFAULT_SAIDA = resolve(DIR, 'recebidos_para_planilha.json')

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

const arre2 = (n) => Math.round(Number(n || 0) * 100) / 100
const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Rótulo curto de data no padrão da planilha: 'YYYY-MM-DD' → 'DD/MM/AA'.
const rotuloAnoCurto = (dataISO) => {
  const [a, m, d] = String(dataISO).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

// Descrição no MESMO padrão das linhas antigas da planilha:
//   "Pagamento referente ao período de 17/08/26 à 23/08/26" (a crase é
//   aplicada pelo Python via corrigir_crasis). O `referente` é a segunda-feira
//   da semana de trabalho; o fim é o domingo da mesma semana ISO.
function descricaoPadrao(it, semanaIsoFn) {
  if (!it.referente) return String(it.descricao ?? '').trim()
  const ref = semanaIsoFn(it.referente)
  return `Pagamento referente ao período de ${rotuloAnoCurto(ref.inicio)} a ${rotuloAnoCurto(ref.fim)}`
}

async function main() {
  const args = lerArgvs()
  const env = carregarEnv()
  const { url, apikey, token } = await login(env)
  const construtor = (tabela, select) => `${url}/rest/v1/${tabela}?select=${encodeURIComponent(select)}`

  const hojeDia = hoje()
  const periodo = definirPeriodoPersonalizado(CORTE_2026, hojeDia)

  console.log('=== GERAR RECEBIDOS PARA A PLANILHA CONTABILADE (a partir de 24/08/2026) ===')
  console.log(`corte=${CORTE_2026} | hoje=${hojeDia} | período=${periodo.inicio} a ${periodo.fim}`)

  // Fixo semanal padrão do Ponto — a régua dos extras (ponto_config.VALOR_FIXO_SEMANA).
  const { status: stCfg, corpo: cfgRows } = await rest(construtor('ponto_config', 'chave,valor'), apikey, token)
  if (stCfg !== 200) throw new Error(`Falha ponto_config (${stCfg}): ${JSON.stringify(cfgRows)}`)
  const mapaCfg = {}
  for (const l of cfgRows || []) mapaCfg[l.chave] = Number(l.valor)
  const fixoSemana = mapaCfg.VALOR_FIXO_SEMANA ?? 1650
  console.log(`fixo semanal (ponto_config.VALOR_FIXO_SEMANA) = R$ ${fmt(fixoSemana)}`)

  // 1) Planejamentos realizados Entrada do período ampliado (a lib filtra a
  //    data REAL dentro da faixa; ainda assim pedimos data_prevista >= corte
  //    para não trazer o histórico 2022–2025 todo; uma folga de 14 dias cobre
  //    pagamentos previstos logo antes do corte cujos movimentos caíram depois).
  const folga = 14 // dias antes do corte ("-14 dias" → YYYY-MM-DD da data civil)
  const inicioSql = (() => {
    const d = new Date(`${CORTE_2026}T12:00:00`)
    d.setDate(d.getDate() - folga)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  })()
  console.log(`buscando planejamentos a partir de data_prevista >= ${inicioSql} (folga ${folga}d do corte)`)

  const { status: stPlan, corpo: planores } = await rest(
    construtor('planejamentos',
      'id,lancamento_id,data_prevista,valor,valor_semanal,valor_extra_historico,descricao,' +
      'tipo_op,estado,origem,ano_semana_trabalho,semana_trabalho') +
      `&data_prevista=gte.${inicioSql}&tipo_op=eq.Entrada&estado=eq.realizado&order=data_prevista`,
    apikey, token,
  )
  if (stPlan !== 200) throw new Error(`Falha planejamentos (${stPlan}): ${JSON.stringify(planores)}`)
  const planejamentos = (planores || []).map((p) => ({
    ...p,
    lancamento_id: p.lancamento_id ?? null,
  }))
  console.log(`planejamentos realizados Entrada (data_prevista >= ${inicioSql}): ${planejamentos.length}`)

  // 2) Datas REAIS dos lançamentos — mesmo mapa do hook useRelatorioRecebidoHoras.
  const lancIds = [...new Set((planejamentos || []).map((p) => p.lancamento_id).filter((id) => id != null))]
  const datasPorLancamento = {}
  for (let i = 0; i < lancIds.length; i += 100) {
    const pedaco = lancIds.slice(i, i + 100)
    const { status: stMov, corpo: movs } = await rest(
      construtor('movimentacoes', 'id,data') + `&id=in.(${pedaco.join(',')})&limit=1000`,
      apikey, token,
    )
    if (stMov !== 200) throw new Error(`Falha movimentacoes (${stMov}): ${JSON.stringify(movs)}`)
    for (const m of movs || []) datasPorLancamento[m.id] = String(m.data).slice(0, 10)
  }
  console.log(`datas reais via movimentacoes: ${Object.keys(datasPorLancamento).length} de ${lancIds.length} lançamentos`)

  // 3) Cadeia do relatório — a lib pura do app (mesma de src/hooks/useRelatorioRecebidoHoras).
  const dados = calcularRecebidoHoras({
    planejamentosRealizados: planejamentos,
    fixoSemana,
    periodo,
    dataRealPorLancamento: datasPorLancamento,
  })

  // 4) Monta as linhas do JSON intermediário — só recebimentos com data >= corte.
  const recebidos = []
  for (const it of dados.recebimentos || []) {
    if (it.data < CORTE_2026) continue
    const extras = arre2(it.valorHorasExtras)
    // valor_fixo = fatia da base da semana desta linha: `valor − extras` quando
    // o pagamento cobriu uma semana de trabalho (referente gravado); para
    // avulsos (sem semana_trabalho, ex.: algum recebimento manual fora do
    // padrão) fica null → a coluna B fica vazia na planilha.
    const valorFixo = it.referente ? arre2(it.valor - extras) : null
    recebidos.push({
      data: it.data,
      valor: arre2(it.valor),
      valor_fixo: valorFixo,
      hora_extras: extras,
      descricao: descricaoPadrao(it, semanaIso),
    })
  }

  const saida = args.saida || DEFAULT_SAIDA
  const payload = {
    gerado_em: new Date().toISOString(),
    corte: CORTE_2026,
    fixo_semana: fixoSemana,
    recebidos,
  }
  writeFileSync(saida, JSON.stringify(payload, null, 2), 'utf8')

  const total = recebidos.reduce((s, r) => s + r.valor, 0)
  console.log('')
  console.log(`recebimentos computados pela lib (período inteiro): ${dados.recebimentos.length}`)
  console.log(`linhas NOVAS para a planilha (data >= ${CORTE_2026}): ${recebidos.length}`)
  for (const r of recebidos) {
    const fixo = r.valor_fixo === null ? '      —' : fmt(r.valor_fixo).padStart(8)
    const extra = fmt(r.hora_extras).padStart(8)
    console.log(`   ${r.data}  B=${fixo}  C=${extra}  F=${fmt(r.valor).padStart(9)}  ${r.descricao.slice(0, 60)}`)
  }
  console.log(`TOTAL (soma coluna F) = R$ ${fmt(total)}`)
  console.log('')
  console.log(`JSON intermediário gravado em: ${saida}`)
  console.log('')
  console.log('Agora rode a etapa 2 para escrever na planilha preservando os pivôs:')
  console.log('  python scripts/sincronizar_planilha_supabase.py <planilha> <json>')
}

main().catch((e) => {
  console.error(`ERRO: ${e.message}`)
  if (/login/i.test(e.message || '')) {
    console.error('Dica: confira e-mail/senha do usuário DONO no Supabase, ou use')
    console.error('variáveis de ambiente SUPABASE_EMAIL e SUPABASE_SENHA.')
  }
  process.exitCode = 1
})