import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface RefreshContextType {
  /** Increments every time a refresh is triggered */
  refreshKey: number
  /** Call this to trigger a refresh across all subscribed components */
  triggerRefresh: () => void
}

const RefreshContext = createContext<RefreshContextType>({
  refreshKey: 0,
  triggerRefresh: () => {},
})

export function useRefresh() {
  return useContext(RefreshContext)
}

interface RefreshProviderProps {
  children: ReactNode
}

export function RefreshProvider({ children }: RefreshProviderProps) {
  const [refreshKey, setRefreshKey] = useState(0)

  const triggerRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1)
  }, [])

  return (
    <RefreshContext.Provider value={{ refreshKey, triggerRefresh }}>
      {children}
    </RefreshContext.Provider>
  )
}