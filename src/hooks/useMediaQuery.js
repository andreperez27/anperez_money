import { useEffect, useState } from 'react'

// Observa um breakpoint de largura com máxima compatibilidade cross-browser
// (Chrome, Firefox, Edge, Safari/WebKit). Em vez de depender de
// window.matchMedia (ausente em alguns Safari antigos), mede innerWidth:
// funciona em qualquer browser moderno.
//
// query: "(max-width: 768px)" ou "(min-width: 400px)".
// Retorna true/false atualizado ao redimensionar.
export default function useMediaQuery(query) {
  const m = query.match(/\((min|max)-width:\s*(\d+)\s*px\)/)

  function medir() {
    if (!m) return false
    const ancho = window.innerWidth
    return m[1] === 'max' ? ancho <= Number(m[2]) : ancho >= Number(m[2])
  }

  const [matches, setMatches] = useState(medir)

  useEffect(() => {
    function alResize() {
      setMatches(medir())
    }
    window.addEventListener('resize', alResize)
    return () => window.removeEventListener('resize', alResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return matches
}

// Breakpoint mobile: em telas até 768px o layout passa ao modo móvil.
export const useEhMobile = () => useMediaQuery('(max-width: 768px)')

// Breakpoint de tela muito estrecha (aprox. 400px ou menos): em vez de
// duas colunas, o Dashboard empila em uma coluna.
export const useMuyEstrecho = () => useMediaQuery('(max-width: 400px)')