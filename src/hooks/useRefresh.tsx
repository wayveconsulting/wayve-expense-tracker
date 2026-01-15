import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface RefreshContextType {
  /** Increments every time expenses refresh is triggered */
  expenseKey: number
  /** Increments every time mileage refresh is triggered */
  mileageKey: number
  /** Call this to trigger expense refresh across all subscribed components */
  refreshExpenses: () => void
  /** Call this to trigger mileage refresh across all subscribed components */
  refreshMileage: () => void
  /** Call this to trigger all refreshes */
  refreshAll: () => void
}

const RefreshContext = createContext<RefreshContextType>({
  expenseKey: 0,
  mileageKey: 0,
  refreshExpenses: () => {},
  refreshMileage: () => {},
  refreshAll: () => {},
})

export function useRefresh() {
  return useContext(RefreshContext)
}

interface RefreshProviderProps {
  children: ReactNode
}

export function RefreshProvider({ children }: RefreshProviderProps) {
  const [expenseKey, setExpenseKey] = useState(0)
  const [mileageKey, setMileageKey] = useState(0)

  const refreshExpenses = useCallback(() => {
    setExpenseKey(prev => prev + 1)
  }, [])

  const refreshMileage = useCallback(() => {
    setMileageKey(prev => prev + 1)
  }, [])

  const refreshAll = useCallback(() => {
    setExpenseKey(prev => prev + 1)
    setMileageKey(prev => prev + 1)
  }, [])

  return (
    <RefreshContext.Provider value={{ 
      expenseKey, 
      mileageKey, 
      refreshExpenses, 
      refreshMileage, 
      refreshAll 
    }}>
      {children}
    </RefreshContext.Provider>
  )
}
