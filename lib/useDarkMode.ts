'use client'
import { useEffect, useState } from 'react'

export function useDarkMode() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('twinmind-dark')
    if (saved === 'true') {
      setDark(true)
      document.documentElement.classList.add('dark')
    }
  }, [])

  const toggle = () => {
    setDark((d) => {
      const next = !d
      if (next) document.documentElement.classList.add('dark')
      else document.documentElement.classList.remove('dark')
      localStorage.setItem('twinmind-dark', String(next))
      return next
    })
  }

  return { dark, toggle }
}
