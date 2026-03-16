import { useState, useRef, useEffect } from 'react'

interface CategoryPickerProps {
  value: string | null
  onChange: (category: string | null) => void
  onClose: () => void
  categories: string[]
}

export function CategoryPicker({ value, onChange, onClose, categories }: CategoryPickerProps) {
  const [filter, setFilter] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const filtered = filter
    ? categories.filter((c) => c.toLowerCase().includes(filter.toLowerCase()))
    : categories

  const handleSelect = (category: string | null) => {
    onChange(category)
    onClose()
  }

  const handleCustomSubmit = () => {
    if (filter.trim()) {
      handleSelect(filter.trim())
    }
  }

  return (
    <div
      ref={ref}
      className="absolute z-20 mt-1 w-56 bg-white rounded-lg border border-slate-200 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-2 border-b border-slate-100">
        <input
          ref={inputRef}
          type="text"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Filter or type custom..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (filtered.length === 1) {
                handleSelect(filtered[0])
              } else {
                handleCustomSubmit()
              }
            }
          }}
        />
      </div>

      <div className="max-h-48 overflow-y-auto py-1">
        {value && (
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            onClick={() => handleSelect(null)}
          >
            Clear category
          </button>
        )}
        {filtered.map((cat) => (
          <button
            key={cat}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${
              cat === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'
            }`}
            onClick={() => handleSelect(cat)}
          >
            {cat}
          </button>
        ))}
        {filter.trim() && !filtered.some((c) => c.toLowerCase() === filter.trim().toLowerCase()) && (
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 border-t border-slate-100"
            onClick={handleCustomSubmit}
          >
            Use "{filter.trim()}"
          </button>
        )}
      </div>
    </div>
  )
}
