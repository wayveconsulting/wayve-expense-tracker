import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface SettingsContextType {
  darkMode: boolean
  setDarkMode: (value: boolean) => void
  showFab: boolean
  setShowFab: (value: boolean) => void
}

const SettingsContext = createContext<SettingsContextType>({
  darkMode: false,
  setDarkMode: () => {},
  showFab: true,
  setShowFab: () => {},
})

export function useSettings() {
  return useContext(SettingsContext)
}

interface SettingsProviderProps {
  children: ReactNode
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  // Initialize from localStorage (with defaults)
  const [darkMode, setDarkModeState] = useState(() => {
    const saved = localStorage.getItem('settings:darkMode')
    return saved === 'true'
  })

  const [showFab, setShowFabState] = useState(() => {
    const saved = localStorage.getItem('settings:showFab')
    return saved !== 'false' // Default to true
  })

  // Apply dark mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // Persist dark mode
  const setDarkMode = (value: boolean) => {
    setDarkModeState(value)
    localStorage.setItem('settings:darkMode', String(value))
  }

  // Persist show FAB
  const setShowFab = (value: boolean) => {
    setShowFabState(value)
    localStorage.setItem('settings:showFab', String(value))
  }

  return (
    <SettingsContext.Provider value={{ darkMode, setDarkMode, showFab, setShowFab }}>
      {children}
    </SettingsContext.Provider>
  )
}