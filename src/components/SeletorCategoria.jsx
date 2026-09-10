import { estilosComuns } from '../lib/compartilhados'
import { GRUPOS_CATEGORIAS } from '../lib/categorias'

// Seletor de categoria com as listas agrupadas por contexto (Entradas,
// Alimentação, Transporte, Casa, Pessoal, Outros gastos). Usado em todos os
// lançamentos (conta e cartão) para manter a categorização centralizada.
//
// ÚNICA lista de valores (fechamento 10/09/2026): o usuário só pode escolher
// entre as categorias definidas em src/lib/categorias.js. Valor salvo que não
// esteja nela (variante de acento/espaço migrada, ex.: "Transporte
// (combustivel)") NÃO ganha opção "solta" — o seletor fica sem opção
// selecionada até o usuário reescolher a categoria canônica.
//
// Props:
//   - value/onChange: select controlado (value '' = sem categoria).
//   - obrigatorio: quando true exibe o placeholder "Selecione a categoria"
//     (disabled) e marca required; quando false a primeira opção é
//     "Sem categoria".
//   - valorTodas: quando informado (ex.: filtros), a primeira opção passa a
//     ser "Todas as categorias" com esse valor sentinela (≠ '') e a opção
//     "Sem categoria" ('' ) fica logo abaixo, SELECIONÁVEL — distingue
//     "nenhuma escolhida ainda" de "quero só os lançamentos sem categoria".
//     Nesse modo o required não se aplica.
//   - id: opcional, permite associar um <label> fora do componente.
//   - estilo: estilos extras mesclados sobre estilosComuns.input.
export default function SeletorCategoria({ value, onChange, obrigatorio = false, valorTodas, id, estilo }) {
  const comTodas = Boolean(valorTodas)

  return (
    <select
      id={id}
      value={value}
      onChange={onChange}
      required={!comTodas && obrigatorio}
      style={{ ...estilosComuns.input, ...estilo }}
    >
      {comTodas ? (
        <>
          <option value={valorTodas}>Todas as categorias</option>
          <option value="">Sem categoria</option>
        </>
      ) : obrigatorio ? (
        <option value="" disabled>Selecione a categoria</option>
      ) : (
        <option value="">Sem categoria</option>
      )}

      {GRUPOS_CATEGORIAS.map((grupo) => (
        <optgroup key={grupo.nome} label={grupo.nome}>
          {grupo.categorias.map((categoria) => (
            <option key={categoria} value={categoria}>{categoria}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}