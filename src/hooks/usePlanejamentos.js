import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { hoje } from '../lib/compartilhados'
import { semanaIso, inicioDaSemanaIso } from '../lib/semana'
import { calcularResumoPlanejamentos } from '../lib/planejamentoCalc'
import {
  montarLinhasSerie,
  montarLinhasRecorrentes,
  calcularCancelamentoDaquiParaFrente,
  calcularRegeneração,
  calcularRegeneraçãoRecorrente,
} from '../lib/planejamentoSerie.js'
import { validarFaixaDePeriodo } from '../lib/periodos.js'
import {
  decidirAtualizacoes,
  valorFechadoDaSemana,
} from '../lib/reconciliacaoPonto.js'

// Domínio de Planejamentos (ETAPA 06/E3).
//
// Planejamento é independente da Home e da conta ativa: o módulo registra
// PREVISÕES financeiras do usuário e NÃO movimenta saldos. conta_destino_id
// é apenas uma anotação opcional; lancamento_id fica reservado para uma
// integração futura — nada é criado ou vinculado automaticamente aqui.
//
// - Sem filtro user_id no código: quem isola é a RLS da tabela
//   (política auth.uid() = user_id), como em todos os hooks do app.
// - A SEMANA é sempre derivada de data_prevista pela fonte única
//   lib/semana.js (semanaIso). A UI nunca manda ano_semana/semana:
//   combinação inconsistente é impossível por este caminho.
// - CANCELAR ≠ EXCLUIR: cancelarPlanejamento grava estado 'cancelado'
//   preservando o registro; excluirPlanejamento é a destrutiva separada.
// - Origens (manual/jornada/recorrente/outro) são tratadas de forma
//   genérica — nenhuma regra especial ainda.
const TIPOS_OP = ['Entrada', 'Saida']
const ESTADOS = ['previsto', 'realizado', 'cancelado']
const ORIGENS = ['manual', 'jornada', 'recorrente', 'outro']

// Validação completa da CRIAÇÃO antes do INSERT — só para barrar chamadas
// obviamente inválidas; a proteção definitiva continua sendo os CHECKs do
// PostgreSQL. Devolve os campos normalizados + a dupla de semana calculada
// por semanaIso(data_prevista), que também valida formato YYYY-MM-DD e
// existência real da data civil (ex.: 2026-02-30 falha aqui).
function validarCriacao({ tipo_op, descricao, valor, data_prevista, estado, origem }) {
  if (!TIPOS_OP.includes(tipo_op)) {
    throw new Error('tipo_op deve ser Entrada ou Saida.')
  }
  if (!descricao || !descricao.trim()) {
    throw new Error('Informe a descrição.')
  }
  const valorNumerico = Number(valor)
  if (!(valorNumerico > 0)) {
    throw new Error('O valor deve ser maior que zero.')
  }
  const { ano, semana } = semanaIso(data_prevista)
  if (estado !== undefined && !ESTADOS.includes(estado)) {
    throw new Error('Estado inválido (previsto, realizado ou cancelado).')
  }
  if (origem !== undefined && !ORIGENS.includes(origem)) {
    throw new Error('Origem inválida (manual, jornada, recorrente ou outro).')
  }
  return {
    descricao: descricao.trim(),
    valor: valorNumerico,
    ano_semana: ano,
    semana,
  }
}

// Hook principal do domínio. Uso:
//   usePlanejamentos({ ano, semana }) → já carrega essa semana na montagem;
//   usePlanejamentos()                → lista vazia até listarPorSemana().
// Mutação bem-sucedida → atualizar() recarrega a semana vigente (padrão
// dos hooks do app; a UI nunca depende de estado local desatualizado).
export function usePlanejamentos({ ano, semana } = {}) {
  // Semana vigente da listagem; listarPorSemana troca o alvo e o efeito
  // abaixo recarrega (caminho ÚNICO de busca — sem fetch duplicado).
  const [alvo, setAlvo] = useState(ano && semana ? { ano, semana } : null)
  const [itens, setItens] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    // "ativo" evita setState depois do desmonte (padrão dos hooks do app).
    let ativo = true

    async function carregar() {
      const { data, error } = await supabase
        .from('planejamentos')
        .select('*')
        .eq('ano_semana', alvo.ano)
        .eq('semana', alvo.semana)
        // Ordenação determinística: dois planejamentos da mesma data não
        // trocam de posição entre buscas (mesmo critério de desempate do
        // extrato: campo principal + criado_em + id). O desempate extra por
        // parcela_numero entra DEPOIS da data e é inócuo para avulsas (elas
        // têm NULL, que ordena primeiro por igual) — não muda a ordem delas.
        .order('data_prevista')
        .order('parcela_numero')
        .order('criado_em')
        .order('id')
      if (error) throw new Error(error.message)
      return data ?? []
    }

    setCarregando(true)
    setErro(null)
    carregar()
      .then((dados) => {
        if (!ativo) return
        setItens(dados)
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
        setItens([])
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [alvo])

  // Recarrega a semana vigente após mutações ou mudanças externas.
  async function atualizar() {
    if (!alvo) return
    const { data, error } = await supabase
      .from('planejamentos')
      .select('*')
      .eq('ano_semana', alvo.ano)
      .eq('semana', alvo.semana)
      .order('data_prevista')
      .order('parcela_numero')
      .order('criado_em')
      .order('id')
    if (error) throw new Error(error.message)
    setItens(data ?? [])
    setErro(null)
  }

  // Define qual semana fica visível (navegação da futura página). O
  // carregamento acontece no efeito acima — mesmo contrato dos demais
  // hooks, onde parâmetros mudam e a lista se atualiza sozinha.
  function listarPorSemana(anoNovo, semanaNova) {
    setAlvo({ ano: anoNovo, semana: semanaNova })
  }

  // Consulta EXPLÍCITA por faixa de datas (ETAPA 06/F2 — aditiva). Não mexe
  // no mecanismo da semana (alvo/itens/carregando/efeito intocados): quem
  // chama recebe as ocorrências e decide o que fazer com elas. Serve às
  // futuras visões Mês/Trimestre/Semestre; a SEMANA continua pelo caminho
  // validado (listarPorSemana + efeito) — nunca os dois para o mesmo dado.
  // Mesma forma de item do select('*') semanal → compatível direto com
  // calcularResumoPlanejamentos/agruparPorMes/agruparPorSemanaISO.
  // Usa o índice idx_planejamentos_data_prevista; RLS continua filtrando
  // o user_id no banco (nenhum filtro manual aqui, como em todo o hook).
  async function listarPorPeriodo(inicioISO, fimISO) {
    const { inicio, fim } = validarFaixaDePeriodo(inicioISO, fimISO)

    const { data, error } = await supabase
      .from('planejamentos')
      .select('*')
      .gte('data_prevista', inicio)
      .lte('data_prevista', fim)
      // Ordenação IDÊNTICA à consulta semanal: determinismo garantido pelos
      // mesmos desempates (data → parcela → criado_em → id).
      .order('data_prevista')
      .order('parcela_numero')
      .order('criado_em')
      .order('id')

    if (error) throw new Error(error.message)
    return data ?? []
  }

  // Criar. ano_semana/semana NUNCA vêm da UI: nascem de data_prevista via
  // semanaIso. estado/origem/conta_destino_id/observacao ficam fora do
  // payload quando não informados — os DEFAULTs do banco prevalecem
  // (mesma convenção do criarCaixinha com objetivo opcional).
  async function criarPlanejamento(dados) {
    const { tipo_op, data_prevista, estado, origem, conta_destino_id, destino_padrao, cartao_padrao_id, observacao } = dados
    const validos = validarCriacao(dados)

    const payload = {
      tipo_op,
      descricao: validos.descricao,
      valor: validos.valor,
      data_prevista,
      ano_semana: validos.ano_semana,
      semana: validos.semana,
    }
    if (estado !== undefined) payload.estado = estado
    if (origem !== undefined) payload.origem = origem
    if (conta_destino_id !== undefined && conta_destino_id !== null && conta_destino_id !== '') {
      payload.conta_destino_id = conta_destino_id
    }
    if (destino_padrao !== undefined) payload.destino_padrao = destino_padrao
    if (cartao_padrao_id !== undefined && cartao_padrao_id !== null && cartao_padrao_id !== '') {
      payload.cartao_padrao_id = cartao_padrao_id
    }
    if (observacao !== undefined && observacao !== null && observacao !== '') {
      payload.observacao = observacao
    }

    const { error } = await supabase.from('planejamentos').insert(payload)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Editar (parcial): só os campos enviados mudam. Se data_prevista vier,
  // a dupla ano_semana/semana é RECALCULADA na hora — o registro jamais
  // fica com data e semana incompatíveis.
  async function editarPlanejamento(id, alteracoes) {
    const payload = {}
    const {
      tipo_op, descricao, valor, data_prevista, estado, origem,
      conta_destino_id, destino_padrao, cartao_padrao_id, observacao,
    } = alteracoes

    if (tipo_op !== undefined) {
      if (!TIPOS_OP.includes(tipo_op)) {
        throw new Error('tipo_op deve ser Entrada ou Saida.')
      }
      payload.tipo_op = tipo_op
    }
    if (descricao !== undefined) {
      if (!descricao || !descricao.trim()) {
        throw new Error('Informe a descrição.')
      }
      payload.descricao = descricao.trim()
    }
    if (valor !== undefined) {
      const valorNumerico = Number(valor)
      if (!(valorNumerico > 0)) {
        throw new Error('O valor deve ser maior que zero.')
      }
      payload.valor = valorNumerico
    }
    if (data_prevista !== undefined) {
      const { ano, semana } = semanaIso(data_prevista)
      payload.data_prevista = data_prevista
      payload.ano_semana = ano
      payload.semana = semana
    }
    if (estado !== undefined) {
      if (!ESTADOS.includes(estado)) {
        throw new Error('Estado inválido (previsto, realizado ou cancelado).')
      }
      payload.estado = estado
    }
    if (origem !== undefined) {
      if (!ORIGENS.includes(origem)) {
        throw new Error('Origem inválida (manual, jornada, recorrente ou outro).')
      }
      payload.origem = origem
    }
    if (conta_destino_id !== undefined) {
      payload.conta_destino_id =
        conta_destino_id === '' || conta_destino_id === null ? null : conta_destino_id
    }
    if (destino_padrao !== undefined) {
      if (destino_padrao !== null && !['conta', 'cartao'].includes(destino_padrao)) {
        throw new Error('Destino padrão inválido (conta, cartao ou null).')
      }
      payload.destino_padrao = destino_padrao
    }
    if (cartao_padrao_id !== undefined) {
      payload.cartao_padrao_id =
        cartao_padrao_id === '' || cartao_padrao_id === null ? null : cartao_padrao_id
    }
    if (observacao !== undefined) {
      payload.observacao = observacao === '' ? null : observacao
    }

    if (Object.keys(payload).length === 0) {
      throw new Error('Informe ao menos um campo para editar.')
    }

    const { error } = await supabase.from('planejamentos').update(payload).eq('id', id)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Cancelar: preserva o registro com estado 'cancelado'. Não exclui,
  // não mexe em saldo, conta ou movimentações.
  async function cancelarPlanejamento(id) {
    const { error } = await supabase
      .from('planejamentos')
      .update({ estado: 'cancelado' })
      .eq('id', id)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Excluir: operação DESTRUTIVA separada do cancelamento (CANCELAR ≠
  // EXCLUIR). A confirmação visual fica na UI.
  async function excluirPlanejamento(id) {
    const { error } = await supabase.from('planejamentos').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Excluir SÉRIE INTEIRA (decisão 01/09/2026, com André): apaga TODAS as
  // ocorrências do serie_id — previstas, canceladas E realizadas. As
  // movimentações reais já lançadas (extrato) NÃO são apagadas (tabela
  // independente); só somem os registros do Planejamento. Avulsa cai no
  // excluirPlanejamento. A confirmação (com aviso de quantidade) fica na UI.
  async function excluirSerie(id) {
    const { data: alvo, error: erroAlvo } = await supabase
      .from('planejamentos')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (erroAlvo) throw new Error(erroAlvo.message)
    if (!alvo) throw new Error('Planejamento não encontrado.')

    if (!alvo.serie_id) {
      await excluirPlanejamento(id)
      return
    }

    const { error } = await supabase
      .from('planejamentos')
      .delete()
      .eq('serie_id', alvo.serie_id)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Realizar (Efetivação — ETAPA 06/E5-F): transforma UMA previsão 'previsto'
  // em lançamento real de CONTA via RPC atômica no banco (migration 16). O
  // Postgres faz INSERT em movimentacoes + UPDATE para 'realizado' na mesma
  // transação — a trigger trg_atualizar_saldo ajusta o saldo da conta sozinha.
  // Só destinos em CONTA (movimentacoes); Cartão/compra fica para etapa futura.
  // A RPC valida propriedade/estado no servidor (nada confiado ao cliente);
  // após o sucesso, atualizar() recarrega a semana (previsão some do montante
  // 'previsto' e passa a 'realizado' — mesma convenção dos demais métodos).
  async function realizarPlanejamento(id, { conta_id, valor_real, data_realizacao } = {}) {
    const params = { p_planejamento_id: id, p_conta_id: conta_id }
    if (valor_real !== undefined && valor_real !== null && valor_real !== '') {
      params.p_valor_real = Number(valor_real)
    }
    if (data_realizacao) params.p_data_realizacao = data_realizacao

    const { error } = await supabase.rpc('realizar_planejamento', params)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Realizar em CARTÃO (Efetivação Cartão — migration 19): transforma UMA
  // previsão 'previsto' (de DESPESA) em COMPRA no cartão de crédito via RPC
  // atômica. O banco valida estado/posse do cartão no servidor e reutiliza a
  // RPC criar_compra com n_parcelas=1 (à vista) — a compra gera UMA parcela na
  // fatura sem mexer no saldo da conta (só o pagamento da fatura o faz). O
  // registro fica 'realizado' com lancamento_tipo='compra' e lancamento_id
  // apontando para compras.id. Após o sucesso, atualizar() recarrega a semana.
  async function realizarPlanejamentoCartao(id, { cartao_id, valor_real, data_compra } = {}) {
    const params = { p_planejamento_id: id, p_cartao_id: cartao_id }
    if (valor_real !== undefined && valor_real !== null && valor_real !== '') {
      params.p_valor_real = Number(valor_real)
    }
    if (data_compra) params.p_data_compra = data_compra

    const { error } = await supabase.rpc('realizar_planejamento_cartao', params)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Criar SÉRIE parcelada. As ocorrências nascem na lib pura
  // (planejamentoSerie → parcelas → semanaIso), então o hook só gera o
  // serie_id e insere o lote inteiro numa ÚNICA requisição. A semana NUNCA
  // vem da UI — montarLinhasSerie a calcula de data_prevista via semanaIso.
  // Insert NÃO envia user_id (padrão do projeto: DEFAULT auth.uid() preenche
  // no banco, como em useContas/useMovimentacoes); estado inicial 'previsto';
  // validações obviamente inválidas são barradas pela lib + CHECKs do banco.
  async function criarSerieParcelada(dados) {
    const serieId = crypto.randomUUID()
    const linhas = montarLinhasSerie({ ...dados, serieId })
    const { error } = await supabase.from('planejamentos').insert(linhas)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Criar SÉRIE RECORRENTE (despesa fixa mensal — ETAPA 06/P4 evoluída).
  // Difere de criarSerieParcelada porque o VALOR é o mesmo repetido em cada
  // ocorrência (repetirValorEmOcorrencias → montarLinhasRecorrentes), em vez
  // de um total dividido. Aceita serie_data_termino opcional (migration 21),
  // propagado a cada linha como metadado informativo do término. A semana
  // nunca vem da UI (montarLinhasRecorrentes a calcula via semanaIso).
  async function criarSerieRecorrente(dados) {
    const serieId = crypto.randomUUID()
    const linhas = montarLinhasRecorrentes({ ...dados, serieId })
    const { error } = await supabase.from('planejamentos').insert(linhas)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // Cancelar SÉRIE a partir de uma ocorrência (decisão D5). Se a alvo for
  // AVULSA (sem serie_id), cancela somente ela (E5-D.1 §3). Para série,
  // cancela as ocorrências da mesma série com parcela >= a atual e estado
  // 'previsto'; realizadas e canceladas nunca são tocadas; nada anterior à
  // parcela atual muda. Nunca usa DELETE.
  async function cancelarSerieAPartirDe(id) {
    const { data: alvo, error: erroAlvo } = await supabase
      .from('planejamentos')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (erroAlvo) throw new Error(erroAlvo.message)
    if (!alvo) throw new Error('Planejamento não encontrado.')

    if (!alvo.serie_id) {
      await cancelarPlanejamento(id)
      return
    }

    const { data: serie, error: erroSerie } = await supabase
      .from('planejamentos')
      .select('id, serie_id, parcela_numero, estado')
      .eq('serie_id', alvo.serie_id)
    if (erroSerie) throw new Error(erroSerie.message)

    const { ids } = calcularCancelamentoDaquiParaFrente(serie ?? [], id)
    if (ids.length > 0) {
      const { error } = await supabase
        .from('planejamentos')
        .update({ estado: 'cancelado' })
        .in('id', ids)
      if (error) throw new Error(error.message)
    }

    await atualizar()
  }

  // Regenerar SÉRIE (decisão D4): reconstrói SOMENTE o futuro previsto.
  // A lib calcularRegeneração mantém realizado/cancelado imutáveis, recalcula
  // o resto via parcelas + semanaIso e devolve o que inserir. DELETE físico
  // apenas das previstas antigas; as novas entram num lote único. Bloqueia
  // reduzir o total abaixo da maior parcela já realizada.
  // Em 01/09/2026 passou a ROTEAR pela origem da série: recorrente usa
  // calcularRegeneraçãoRecorrente (valor MENSAL repetido — montarLinhas...
  // Recorrentes); parcelada/manual usa calcularRegeneração (divide o total).
  async function regenerarSerie(id, alteracoes) {
    const { data: alvo, error: erroAlvo } = await supabase
      .from('planejamentos')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (erroAlvo) throw new Error(erroAlvo.message)
    if (!alvo) throw new Error('Planejamento não encontrado.')
    if (!alvo.serie_id) throw new Error('Ocorrência não pertence a uma série.')

    const { data: serie, error: erroSerie } = await supabase
      .from('planejamentos')
      .select('*')
      .eq('serie_id', alvo.serie_id)
    if (erroSerie) throw new Error(erroSerie.message)
    if (!serie || serie.length === 0) throw new Error('Série não encontrada.')

    const recursiva = alvo.origem === 'recorrente'
    const { idsPrevistoARemover, linhasParaInserir } = recursiva
      ? calcularRegeneraçãoRecorrente(serie, alteracoes)
      : calcularRegeneração(serie, alteracoes)

    if (idsPrevistoARemover.length > 0) {
      const { error: errDelete } = await supabase
        .from('planejamentos')
        .delete()
        .in('id', idsPrevistoARemover)
      if (errDelete) throw new Error(errDelete.message)
    }
    if (linhasParaInserir.length > 0) {
      const { error: errInsert } = await supabase
        .from('planejamentos')
        .insert(linhasParaInserir)
      if (errInsert) throw new Error(errInsert.message)
    }

    await atualizar()
  }

  // Consulta EXPLÍCITA de TODOS os planejamentos 'previsto' com destino
  // Cartão, sem janela de período (fonte da PROJEÇÃO da fatura). A fatura
  // projetada respeita o dia_fechamento do cartão e cai no mês do VENCIMENTO
  // (que pode ser diferente do mês da data_prevista da compra). Para projetá-la
  // em qualquer período em que o vencimento caia, precisamos conhecer o previsto
  // mesmo fora do período visível — daí esta consulta ampla. Retorna a MESMA
  // forma de item de select('*') (compatível com calcularMesFatura/montarProjecao).
  // Sem filtro user_id: a RLS isola o usuário no banco (como nos demais métodos).
  async function listarPrevistosCartao() {
    const { data, error } = await supabase
      .from('planejamentos')
      .select('*')
      .eq('estado', 'previsto')
      .eq('destino_padrao', 'cartao')
      .not('cartao_padrao_id', 'is', null)
      .order('data_prevista')
    if (error) throw new Error(error.message)
    return data ?? []
  }

  // --- RECONCILIAÇÃO COM O PONTO (ETAPA 06/E5-G) -----------------------------
  // Lazy: ao carregar o Planejamento, percorre TODAS as ocorrências origin
  // 'jornada' ainda 'previsto' cuja semana de trabalho JÁ FECHOU e, se o valor
  // real do Ponto (fixo + HE + dom/fer) difere do previsto, atualiza o valor
  // da ocorrência. Fica aqui, não num cron: é disparada no carregamento dos
  // dados (mesma filosofia da regra "fatura vencida é considerada paga").
  // Ocorrências 'realizado'/'cancelado' ou com semana ainda aberta nunca são
  // tocadas; falhas ao ler o Ponto não derrubam a listagem.
  async function reconciliarComPonto() {
    const { data: jornadas, error } = await supabase
      .from('planejamentos')
      .select('*')
      .eq('estado', 'previsto')
      .eq('origem', 'jornada')
    if (error) throw new Error(error.message)
    if (!jornadas || jornadas.length === 0) return

    // Config (fixo/HE/dom) e férias do Ponto — globais; lidas uma vez.
    const [cfgRes, feriasRes] = await Promise.all([
      supabase.from('ponto_config').select('chave, valor'),
      supabase.from('ponto_ferias').select('data_inicio, data_fim'),
    ])
    if (cfgRes.error) throw new Error(cfgRes.error.message)
    if (feriasRes.error) throw new Error(feriasRes.error.message)
    const mapaCfg = {}
    for (const l of cfgRes.data ?? []) mapaCfg[l.chave] = Number(l.valor)
    const fixoSemana = mapaCfg.VALOR_FIXO_SEMANA ?? 1650
    const ferias = feriasRes.data ?? []

    // Cache das exceções de cada semana (evita re-buscar a mesma semana várias
    // vezes quando há mais de uma ocorrência vinculada a ela).
    const cacheExcecoes = new Map()
    const buscarValorRealDaSemana = async ({ inicioISO, fimISO }) => {
      let excs = cacheExcecoes.get(inicioISO + '|' + fimISO)
      if (excs === undefined) {
        const { data, error: err } = await supabase
          .from('ponto_excecoes')
          .select('*')
          .gte('data', inicioISO)
          .lte('data', fimISO)
        if (err) throw new Error(err.message)
        excs = data ?? []
        cacheExcecoes.set(inicioISO + '|' + fimISO, excs)
      }
      return valorFechadoDaSemana({
        excecoes: excs,
        config: { fixoSemana },
        ferias,
        inicioISO,
        fimISO,
      })
    }

    const updates = await decidirAtualizacoes({
      linhas: jornadas,
      hoje: hoje(),
      buscarValorRealDaSemana,
    })

    // Valores podem diferir por linha → atualiza individualmente (são poucas;
    // Supabase não aplica payloads distintos num update em lote único).
    for (const u of updates) {
      const { error: errUpd } = await supabase
        .from('planejamentos')
        .update({ valor: u.valor })
        .eq('id', u.id)
      if (errUpd) throw new Error(errUpd.message)
    }

    if (updates.length > 0 && alvo) await atualizar()
  }

  // Dispara a reconciliação de forma LAZY no carregamento: após a listagem
  // montar, verifica (em segundo plano, sem bloquear a renderização) se há
  // ocorrências jornada a reconciliar. O guarda em useState/useEffect evita
  // repetir a cada mudança de estado — roda uma vez por montagem do hook.
  const [reconciliei, setReconciliei] = useState(false)
  useEffect(() => {
    if (reconciliei || !alvo) return
    let ativo = true
    reconciliarComPonto()
      .catch(() => {
        // Falha silenciosa: a reconciliação re-tenta na próxima navegação;
        // nunca quebra a experiência de listar planejamentos.
      })
      .finally(() => {
        if (ativo) setReconciliei(true)
      })
    return () => {
      ativo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo, reconciliei])

  // Período da semana vigente, SEMPRE pela fonte única semana.js.
  const periodo = useMemo(() => {
    if (!alvo) return null
    try {
      const inicio = inicioDaSemanaIso(alvo.ano, alvo.semana)
      return { inicio, fim: semanaIso(inicio).fim }
    } catch {
      return null
    }
  }, [alvo])

  // Totais/contagens vêm da função PURA testável (planejamentoCalc.js).
  const resumo = useMemo(() => calcularResumoPlanejamentos(itens), [itens])

  return {
    carregando,
    erro,
    itens,
    // Dupla (ano, semana) atualmente carregada — a página usa para navegar
    // via listarPorSemana (o hook ignora mudanças de props após a montagem).
    alvo,
    periodo,
    totais: resumo.totais,
    contagens: resumo.contagens,
    atualizar,
    listarPorSemana,
    listarPorPeriodo,
    listarPrevistosCartao,
    criarPlanejamento,
    editarPlanejamento,
    cancelarPlanejamento,
    excluirPlanejamento,
    excluirSerie,
    realizarPlanejamento,
    realizarPlanejamentoCartao,
    criarSerieParcelada,
    criarSerieRecorrente,
    cancelarSerieAPartirDe,
    regenerarSerie,
    reconciliarComPonto,
  }
}
