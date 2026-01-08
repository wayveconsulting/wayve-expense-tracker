import { createContext, useContext, useState, type ReactNode } from 'react'

interface YearContextType {
  year: number
  setYear: (year: number) => void
  nextYear: () => void
  prevYear: () => void
}

const YearContext = createContext<YearContextType>({
  year: new Date().getFullYear(),
  setYear: () => {},
  nextYear: () => {},
  prevYear: () => {},
})

export function useYear() {
  return useContext(YearContext)
}

interface YearProviderProps {
  children: ReactNode
}

export function YearProvider({ children }: YearProviderProps) {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)

  const nextYear = () => {
    // Don't go beyond current year
    if (year < currentYear) {
      setYear(year + 1)
    }
  }

  const prevYear = () => {
    // Don't go before 2020 (reasonable limit)
    if (year > 2020) {
      setYear(year - 1)
    }
  }

  return (
    <YearContext.Provider value={{ year, setYear, nextYear, prevYear }}>
      {children}
    </YearContext.Provider>
  )
}