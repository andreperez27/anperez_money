/* global __VERSAO_APP__ */
import { useCallback, useEffect, useState } from 'react'

// Versão embutida neste bundle (gerada no build, ver vite.config.js).
const VERSAO_LOCAL = typeof __VERSAO_APP__ !== 'undefined' ? __VERSAO_APP__ : 'dev'

// Verifica se existe deploy mais novo que o bundle em execução. Compara a
// versão local com public/dist versao.json buscado com cache desabilitado.
// Checa na montagem e toda vez que a aba volta a ficar visível (caso típico
// do celular: app aberto em segundo plano por dias). Falha de rede = ignora
// silenciosamente (offline continua funcionando).
export function useVerificarVersao() {
  const [versaoRemota, setVersaoRemota] = useState(null)

  const verificar = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}versao.json`, { cache: 'no-store' })
      if (!res.ok) return
      const { versao } = await res.json()
      if (versao && versao !== VERSAO_LOCAL) setVersaoRemota(versao)
    } catch {
      // Offline ou erro transitório: mantém a versão atual sem avisar.
    }
  }, [])

  useEffect(() => {
    verificar()
    const aoVisivel = () => {
      if (document.visibilityState === 'visible') verificar()
    }
    document.addEventListener('visibilitychange', aoVisivel)
    return () => document.removeEventListener('visibilitychange', aoVisivel)
  }, [verificar])

  return { versaoLocal: VERSAO_LOCAL, versaoRemota, atualizacaoDisponivel: versaoRemota !== null }
}
