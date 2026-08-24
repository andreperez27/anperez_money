import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { semanaIso, inicioDaSemanaIso } from '../lib/semana'
import { calcularResumoPlanejamentos } from '../lib/planejamentoCalc'
import {
  montarLinhasSerie,
  calcularCancelamentoDaquiParaFrente,
  calcularRegeneração,
} from '../lib/planejamentoSerie.js'
import { validarFaixaDePeriodo } from '../lib/periodos.js'

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
    const { tipo_op, data_prevista, estado, origem, conta_destino_id, observacao } = dados
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
      conta_destino_id, observacao,
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

    const { idsPrevistoARemover, linhasParaInserir } = calcularRegeneração(serie, alteracoes)

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
    criarPlanejamento,
    editarPlanejamento,
    cancelarPlanejamento,
    excluirPlanejamento,
    criarSerieParcelada,
    cancelarSerieAPartirDe,
    regenerarSerie,
  }
}
