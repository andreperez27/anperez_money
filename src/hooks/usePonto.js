import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  VALORES_PADRAO_PONTO,
  TEMPOS_CARGA_PADRAO,
  QUOTA_FERIAS_ANUAL,
  DESTINOS_VALIDOS,
  validarDataISO,
  calcularLancamento,
  calcularFalta,
  datasFaltaPeriodo,
  minutosCargaDia,
  minutosCargaDiaUtil,
  fecharPeriodo,
  cargaEsperadaHoras,
  diasIntervaloNoAno,
  saldoFeriasNoAno,
  creditosBancoMinutos,
  debitosBancoMinutos,
  saldoBancoMinutos,
  direitoFolgaDias,
  statusFaltasFIFO,
  formatarDuracaoHMin,
  horaEmMinutos,
  minutosEmHora,
} from '../lib/pontoCalc'

// Domínio do Ponto Inteligente (ETAPA 07/08).
//
// Modelo por EXCEÇÕES (decidido com André): a carga padrão (seg–sex
// 20:30→03:00, sáb 20:30→02:00, dom off) é constante da lib e NUNCA é
// lançada — linha em ponto_excecoes só existe para o que foge do padrão:
// hora extra ('he') e trabalho em domingo/feriado ('domfer'). FÉRIAS são
// INTERVALOS na tabela ponto_ferias (data início/fim; dia único = início
// igual a fim) com saldo de 15 dias por ano — não são mais exceções diárias.
//
// - Sem filtro user_id no código: quem isola é a RLS (como nos demais hooks).
// - Os VALORES em R$ são calculados aqui com a config vigente (ponto_config,
//   global) e CONGELADOS na linha: reajuste futuro da config não retrocalcula
//   registros passados (mesma disciplina do app antigo no upsert_registro).
// - feriados, config e ferias são globais/por-usuário carregados uma vez;
//   exceções são por usuário e seguem a janela do `alvo` (inicio/fim do
//   período visível).
// Lê a config global (ponto_config) e devolve o objeto de cálculo com
// números, aplicando os valores reajustados como fallback para chaves
// ausentes (ex.: banco ainda sem a migration).
function configParaCalculo(linhas = []) {
  const mapa = {}
  for (const l of linhas) mapa[l.chave] = Number(l.valor)
  // Tempos da carga em minutos (migration 41); fallback deriva da constante
  // existente (nenhum literal novo de horário aqui).
  const tempos = {
    utilEntrada: mapa.CARGA_UTIL_ENTRADA ?? TEMPOS_CARGA_PADRAO.utilEntrada,
    utilSaida: mapa.CARGA_UTIL_SAIDA ?? TEMPOS_CARGA_PADRAO.utilSaida,
    sabadoEntrada: mapa.CARGA_SABADO_ENTRADA ?? TEMPOS_CARGA_PADRAO.sabadoEntrada,
    sabadoSaida: mapa.CARGA_SABADO_SAIDA ?? TEMPOS_CARGA_PADRAO.sabadoSaida,
  }
  return {
    fixoSemana: mapa.VALOR_FIXO_SEMANA ?? VALORES_PADRAO_PONTO.fixoSemana,
    heHora: mapa.VALOR_HE_NORMAL ?? VALORES_PADRAO_PONTO.heHora,
    domferAte4: mapa.VALOR_DOMINGO_ATE4 ?? VALORES_PADRAO_PONTO.domferAte4,
    domferAte6: mapa.VALOR_DOMINGO_ATE6 ?? VALORES_PADRAO_PONTO.domferAte6,
    temposCarga: tempos,
  }
}

// Hook principal do módulo. Uso:
//   usePonto({ inicioISO, fimISO }) → carrega o período já na montagem;
//   usePonto()                      → vazio até carregarPeriodo().
// Mutação bem-sucedida → atualizar() recarrega (padrão dos hooks do app).
export function usePonto({ inicioISO, fimISO } = {}) {
  const [alvo, setAlvo] = useState(inicioISO && fimISO ? { inicioISO, fimISO } : null)
  const [excecoes, setExcecoes] = useState([])
  const [feriados, setFeriados] = useState([])
  const [ferias, setFerias] = useState([])
  const [config, setConfig] = useState(VALORES_PADRAO_PONTO)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  async function buscarExcecoes(alvoAtual) {
    const { data, error } = await supabase
      .from('ponto_excecoes')
      .select('*')
      .gte('data', alvoAtual.inicioISO)
      .lte('data', alvoAtual.fimISO)
      .order('data')
    if (error) throw new Error(error.message)
    return data ?? []
  }

  async function buscarFeriadosEConfig() {
    const { data: fer, error: errFer } = await supabase
      .from('ponto_feriados')
      .select('data, nome')
      .order('data')
    if (errFer) throw new Error(errFer.message)

    const { data: cfg, error: errCfg } = await supabase
      .from('ponto_config')
      .select('chave, valor')
    if (errCfg) throw new Error(errCfg.message)

    return {
      feriados: fer ?? [],
      config: configParaCalculo(cfg ?? []),
    }
  }

  // Férias por INTERVALO (todas as do usuário — poucas por ano; o saldo dos
  // 15 dias é calculado sobre o ano, então não têm janela).
  async function buscarFerias() {
    const { data, error } = await supabase
      .from('ponto_ferias')
      .select('*')
      .order('data_inicio')
    if (error) throw new Error(error.message)
    return data ?? []
  }

  async function recarregarFerias() {
    const lista = await buscarFerias()
    setFerias(lista)
    return lista
  }

  useEffect(() => {
    let ativo = true

    async function carregar() {
      const [excs, globais, fas] = await Promise.all([
        alvo ? buscarExcecoes(alvo) : Promise.resolve([]),
        buscarFeriadosEConfig(),
        buscarFerias(),
      ])
      return { excs, ...globais, ferias: fas }
    }

    setCarregando(true)
    setErro(null)
    carregar()
      .then(({ excs, feriados: f, config: c, ferias: fas }) => {
        if (!ativo) return
        setExcecoes(excs)
        setFeriados(f)
        setFerias(fas)
        setConfig(c)
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
        setExcecoes([])
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [alvo])

  // Recarrega a janela vigente (após mutações ou mudanças externas).
  async function atualizar() {
    if (!alvo) return
    const excs = await buscarExcecoes(alvo)
    setExcecoes(excs)
    setErro(null)
  }

  // Define qual período fica visível (navegação Mês/Semana da página).
  function carregarPeriodo(inicioNovo, fimNovo) {
    setAlvo({ inicioISO: inicioNovo, fimISO: fimNovo })
  }

  // --- Exceções de trabalho (he / domfer) ---------------------------------
  // O cálculo (horas, HE, domfer_qtd e os valores R$) roda na lib pura com a
  // data + feriados + config VIGENTES, e o resultado é congelado no INSERT.
  // A classificação por data define o tipo — a lib nunca contradiz a regra
  // (ex.: feriado vira 'domfer', nunca 'he').
  async function criarExcecaoTrabalho({ dataISO, entrada, saida, destino = 'pagamento', obs }) {
    validarDataISO(dataISO)
    if (destino !== 'pagamento' && destino !== 'banco') {
      throw new Error(`Destino inválido ("${destino}"): hora extra vai para pagamento ou banco de horas.`)
    }
    const calc = calcularLancamento(dataISO, { entrada, saida }, { feriados, config })

    const payload = {
      data: dataISO,
      tipo: calc.tipo,
      entrada,
      saida,
      horas: calc.horas,
      he: calc.he,
      domfer_qtd: calc.domferQtd,
      valor_he: destino === 'banco' ? 0 : calc.valorHe,
      valor_domfer: destino === 'banco' ? 0 : calc.valorDomfer,
      valor_fixo: config.fixoSemana,
      destino,
    }
    if (obs !== undefined && obs !== null && obs !== '') payload.obs = obs

    const { error } = await supabase.from('ponto_excecoes').insert(payload)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // --- Faltas (tipo 'falta', FASE 2) --------------------------------------
  // Gera UM registro por data (período pula domingo/feriado em silêncio).
  // Aborta tudo sem gravar nada se algum dia cair em férias ou já tiver
  // lançamento (UNIQUE user/data — um dia, uma linha), listando as datas.
  async function criarFalta({ inicioISO, fimISO = null, integral = true, minutos = null, destino = 'pagamento', motivo = '' } = {}) {
    validarDataISO(inicioISO)
    if (fimISO !== null && fimISO !== undefined && fimISO !== '') validarDataISO(fimISO)
    if (!DESTINOS_VALIDOS.includes(destino)) {
      throw new Error(`Destino inválido ("${destino}"): use pagamento, banco de horas ou abonada.`)
    }
    const { datas, emFerias } = datasFaltaPeriodo(inicioISO, fimISO || inicioISO, { feriados, ferias })
    if (emFerias.length > 0) {
      throw new Error(`Dia(s) em férias não recebem falta: ${emFerias.join(', ')}.`)
    }
    if (datas.length === 0) {
      throw new Error('Nenhum dia útil no período (só domingo/feriado).')
    }
    // Conflito com lançamento existente (qualquer tipo na mesma data).
    const { data: existentes, error: erroBusca } = await supabase
      .from('ponto_excecoes')
      .select('data')
      .gte('data', datas[0])
      .lte('data', datas[datas.length - 1])
    if (erroBusca) throw new Error(erroBusca.message)
    const ocupadas = new Set((existentes ?? []).map((l) => String(l.data).slice(0, 10)))
    const conflito = datas.filter((d) => ocupadas.has(d))
    if (conflito.length > 0) {
      throw new Error(`Dia(s) já com lançamento, sem gravar nada: ${conflito.join(', ')}.`)
    }
    const motivoTexto = String(motivo ?? '').trim()
    const linhas = datas.map((data) => {
      const calc = calcularFalta(
        data,
        {
          integral,
          minutos,
          destino,
          fixoSemana: config.fixoSemana,
          tempos: config.temposCarga,
          feriados,
          ferias,
        },
      )
      return {
        data,
        tipo: 'falta',
        horas: 0,
        he: 0,
        domfer_qtd: 0,
        valor_he: 0,
        valor_domfer: 0,
        valor_fixo: config.fixoSemana,
        destino,
        minutos_falta: calc.minutos,
        valor_desconto: calc.valor_desconto,
        ...(motivoTexto !== '' ? { obs: motivoTexto } : {}),
      }
    })

    const { error } = await supabase.from('ponto_excecoes').insert(linhas)
    if (error) throw new Error(error.message)

    await atualizar()
    return datas
  }

  // Férias por INTERVALO (data início/fim; dia único = início igual a fim).
  // Valida o SALDO de 15 dias/ano antes de gravar (cada ano cruzado pelo
  // intervalo é conferido contra o que já foi usado).
  function validarSaldoNovoIntervalo({ inicioISO, fimISO }, existentes = ferias) {
    const novo = { data_inicio: inicioISO, data_fim: fimISO }
    const anoIni = Number(inicioISO.slice(0, 4))
    const anoFim = Number(fimISO.slice(0, 4))
    for (let ano = anoIni; ano <= anoFim; ano++) {
      const diasNovos = diasIntervaloNoAno(novo, ano)
      const restante = saldoFeriasNoAno(existentes, ano)
      if (diasNovos > restante) {
        throw new Error(
          `Essas férias (${diasNovos} dia(s) em ${ano}) excedem o saldo: restam ${Math.max(restante, 0)} de ${QUOTA_FERIAS_ANUAL} dias em ${ano}.`,
        )
      }
    }
  }

  async function criarFerias({ inicioISO, fimISO, obs } = {}) {
    validarDataISO(inicioISO)
    validarDataISO(fimISO)
    if (fimISO < inicioISO) throw new Error('A data de fim não pode ser anterior à de início.')

    validarSaldoNovoIntervalo({ inicioISO, fimISO })

    const payload = { data_inicio: inicioISO, data_fim: fimISO }
    if (obs !== undefined && obs !== null && obs !== '') payload.obs = obs

    const { error } = await supabase.from('ponto_ferias').insert(payload)
    if (error) throw new Error(error.message)

    await recarregarFerias()
  }

  async function excluirFerias(id) {
    const { error } = await supabase.from('ponto_ferias').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await recarregarFerias()
  }

  // Saldo disponível de férias no ano da data (ou ano numérico).
  function saldoFerias(anoOuDataISO) {
    const ano = Number(String(anoOuDataISO).slice(0, 4))
    return saldoFeriasNoAno(ferias, ano)
  }

  // Editar: recalcula tudo se data/horário mudarem; obs é texto livre.
  // Falta edita destino + motivo (sem data/minutos — errado = excluir e
  // relançar). HE respeita o destino gravado: banco mantém valor_he zerado.
  async function editarExcecao(id, { dataISO, entrada, saida, destino, obs } = {}) {
    if (dataISO !== undefined) validarDataISO(dataISO)
    const { data: atual, error: erroLeitura } = await supabase
      .from('ponto_excecoes')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (erroLeitura) throw new Error(erroLeitura.message)
    if (!atual) throw new Error('Lançamento de ponto não encontrado.')

    const tipoFinal = atual.tipo
    const payload = {}

    if (tipoFinal === 'ferias') {
      if (dataISO !== undefined) payload.data = dataISO
      if (obs !== undefined) payload.obs = obs === '' ? null : obs
    } else if (tipoFinal === 'falta') {
      // Falta: edita destino + motivo. Data/minutos NÃO mudam aqui (errado =
      // excluir e relançar, mesmo padrão das transferências do app).
      if (destino !== undefined) {
        if (!DESTINOS_VALIDOS.includes(destino)) {
          throw new Error(`Destino inválido ("${destino}"): use pagamento, banco de horas ou abonada.`)
        }
        payload.destino = destino
        // Recalcula SÓ o desconto com o fixo vigente: pagamento usa a regra
        // (integral = fixo/6, parcial proporcional); banco/abonada zeram.
        if (destino === 'pagamento') {
          const carga = minutosCargaDia(atual.data, config.temposCarga)
          const min = Number(atual.minutos_falta) || 0
          const integral = min >= carga && carga > 0
          payload.valor_desconto = integral
            ? Math.round((config.fixoSemana / 6) * 100) / 100
            : Math.round(((min / carga) * (config.fixoSemana / 6)) * 100) / 100
        } else {
          payload.valor_desconto = 0
        }
      }
      if (obs !== undefined) payload.obs = obs === '' ? null : obs
    } else {
      const novaData = dataISO ?? atual.data
      const novaEntrada = entrada ?? atual.entrada
      const novaSaida = saida ?? atual.saida
      const calc = calcularLancamento(
        novaData,
        { entrada: novaEntrada, saida: novaSaida },
        { feriados, config },
      )
      if (dataISO !== undefined) payload.data = dataISO
      if (entrada !== undefined) payload.entrada = entrada
      if (saida !== undefined) payload.saida = saida
      if (calc.tipo !== tipoFinal) payload.tipo = calc.tipo
      const destinoFinal = destino !== undefined ? destino : atual.destino
      if (destino !== undefined) {
        if (destino !== 'pagamento' && destino !== 'banco') {
          throw new Error(`Destino inválido ("${destino}"): hora extra vai para pagamento ou banco de horas.`)
        }
        payload.destino = destino
      }
      payload.horas = calc.horas
      payload.he = calc.he
      payload.domfer_qtd = calc.domferQtd
      payload.valor_he = destinoFinal === 'banco' ? 0 : calc.valorHe
      payload.valor_domfer = destinoFinal === 'banco' ? 0 : calc.valorDomfer
      payload.valor_fixo = config.fixoSemana
      if (obs !== undefined) payload.obs = obs === '' ? null : obs
    }

    if (Object.keys(payload).length === 0) {
      throw new Error('Informe ao menos um campo para editar.')
    }

    const { error } = await supabase.from('ponto_excecoes').update(payload).eq('id', id)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  async function excluirExcecao(id) {
    const { error } = await supabase.from('ponto_excecoes').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await atualizar()
  }

  // --- Feriados (calendário global) ---------------------------------------
  async function criarFeriado({ dataISO, nome }) {
    validarDataISO(dataISO)
    if (!nome || !nome.trim()) throw new Error('Informe o nome do feriado.')
    const { error } = await supabase
      .from('ponto_feriados')
      .insert({ data: dataISO, nome: nome.trim() })
    if (error) throw new Error(error.message)

    const { data: fer, error: errFer } = await supabase
      .from('ponto_feriados')
      .select('data, nome')
      .order('data')
    if (errFer) throw new Error(errFer.message)
    setFeriados(fer ?? [])
  }

  async function excluirFeriado(dataISO) {
    const { error } = await supabase.from('ponto_feriados').delete().eq('data', dataISO)
    if (error) throw new Error(error.message)

    const { data: fer, error: errFer } = await supabase
      .from('ponto_feriados')
      .select('data, nome')
      .order('data')
    if (errFer) throw new Error(errFer.message)
    setFeriados(fer ?? [])
  }

  // Resumo do período (exceções + dias de férias da janela; o resto é carga
  // cumprida) e a carga esperada (abatendo dias em férias) — ambos via lib
  // pura testável.
  const resumo = useMemo(
    () => fecharPeriodo(excecoes, alvo || undefined, ferias),
    [excecoes, alvo, ferias],
  )
  const cargaEsperada = useMemo(
    () => (alvo ? cargaEsperadaHoras(alvo.inicioISO, alvo.fimISO, feriados, ferias, excecoes) : 0),
    [alvo, feriados, ferias, excecoes],
  )
  // Saldo de horas do período: lançadas (exceções) contra o esperado.
  // Negativo = trabalhou menos que o padrão; positivo = hora a mais.
  const efetivo = useMemo(
    () => ({
      saldoHoras: Math.round((resumo.horas - cargaEsperada) * 100) / 100,
    }),
    [cargaEsperada, resumo.horas],
  )

  return {
    carregando,
    erro,
    excecoes,
    feriados,
    ferias,
    config,
    alvo,
    resumo,
    cargaEsperada,
    efetivo,
    atualizar,
    carregarPeriodo,
    criarExcecaoTrabalho,
    criarFalta,
    criarFerias,
    excluirFerias,
    saldoFerias,
    editarExcecao,
    excluirExcecao,
    criarFeriado,
    excluirFeriado,
  }
}

// ============================================================================
// BANCO DE HORAS — visão all-time por usuário (fora da janela semanal)
// ============================================================================
// Saldo/FIFO/listas precisam de TODAS as linhas (o Ponto navega por semana,
// mas o banco não tem janela). Recebe os tempos da carga (config do usePonto)
// para o "direito a folga".
export function useBancoHoras(temposCarga) {
  const [linhas, setLinhas] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  const recarregar = async () => {
    setCarregando(true)
    setErro(null)
    try {
      const { data, error } = await supabase
        .from('ponto_excecoes')
        .select('id,data,tipo,he,horas,destino,minutos_falta,valor_desconto,obs')
        .order('data')
      if (error) throw new Error(error.message)
      setLinhas(data ?? [])
    } catch (e) {
      setErro(e.message)
      setLinhas([])
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    supabase
      .from('ponto_excecoes')
      .select('id,data,tipo,he,horas,destino,minutos_falta,valor_desconto,obs')
      .order('data')
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) {
          setErro(error.message)
          setLinhas([])
        } else {
          setLinhas(data ?? [])
        }
      })
      .catch((e) => {
        if (ativo) {
          setErro(e.message)
          setLinhas([])
        }
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [])

  const calculado = useMemo(() => {
    const creditos = creditosBancoMinutos(linhas)
    const debitos = debitosBancoMinutos(linhas)
    const saldo = creditos - debitos
    const cargaDiaUtil = minutosCargaDiaUtil(temposCarga ?? TEMPOS_CARGA_PADRAO)
    const faltasBanco = (linhas ?? []).filter((l) => l && l.tipo === 'falta' && l.destino === 'banco')
    return {
      creditosMin: creditos,
      debitosMin: debitos,
      saldoMin: saldo,
      folgaDias: direitoFolgaDias(saldo, cargaDiaUtil),
      faltasStatus: statusFaltasFIFO(faltasBanco, creditos),
      lancamentos: linhas ?? [],
    }
  }, [linhas, temposCarga])

  return { carregando, erro, recarregar, ...calculado }
}