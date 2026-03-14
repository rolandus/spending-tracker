import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import {
  getMerchants,
  createMerchant,
  deleteMerchant,
  applyMerchantRules,
  suggestMerchants,
  previewMerchantPatterns,
  getMerchantStats,
} from '../server/functions/merchants'
import { CATEGORIES } from '../shared/categories'

type PatternInput = { pattern: string; matchType: 'contains' | 'starts_with' | 'exact' }

export const Route = createFileRoute('/merchants')({
  loader: async () => {
    const [merchantList, rawSuggestions, stats] = await Promise.all([
      getMerchants(),
      suggestMerchants(),
      getMerchantStats(),
    ])

    // Resolve actual match counts using previewMerchantPatterns, then sort desc
    const suggestions = await Promise.all(
      rawSuggestions.map(async (s) => {
        const pattern = s.prefix.trimEnd()
        const result = await previewMerchantPatterns({
          data: { patterns: [{ pattern, matchType: 'starts_with' }] },
        })
        return { ...s, pattern, count: result.matchCount }
      }),
    )
    suggestions.sort((a, b) => b.count - a.count)

    return { merchants: merchantList, suggestions, stats }
  },
  component: MerchantsPage,
})

type Suggestion = { prefix: string; pattern: string; count: number; sample: string }

function SuggestionRow({
  suggestion,
  onApplied,
}: {
  suggestion: Suggestion
  onApplied: () => void
}) {
  const [patterns, setPatterns] = useState<PatternInput[]>([
    { pattern: suggestion.pattern, matchType: 'starts_with' },
  ])
  const [name, setName] = useState(() => {
    const p = suggestion.pattern.trim()
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
  })
  const [defaultCategory, setDefaultCategory] = useState('')
  const [liveCount, setLiveCount] = useState<number>(suggestion.count)
  const [sampleDescs, setSampleDescs] = useState<string[]>([])
  const [showSamples, setShowSamples] = useState(false)
  const [applying, setApplying] = useState(false)
  const initialized = useRef(false)

  const patternsKey = JSON.stringify(patterns)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      return
    }
    const validPatterns = patterns.filter((p) => p.pattern.trim())
    if (validPatterns.length === 0) {
      setLiveCount(0)
      setSampleDescs([])
      return
    }
    const timer = setTimeout(async () => {
      const result = await previewMerchantPatterns({ data: { patterns: validPatterns } })
      setLiveCount(result.matchCount)
      setSampleDescs(result.sampleDescriptions)
    }, 400)
    return () => clearTimeout(timer)
  }, [patternsKey])

  const updatePattern = (index: number, field: keyof PatternInput, value: string) => {
    setPatterns((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    )
  }

  const addPattern = () => {
    setPatterns((prev) => [...prev, { pattern: '', matchType: 'contains' }])
  }

  const removePattern = (index: number) => {
    setPatterns((prev) => prev.filter((_, i) => i !== index))
  }

  const handleApply = async () => {
    const validPatterns = patterns.filter((p) => p.pattern.trim())
    if (!name.trim() || validPatterns.length === 0) return
    setApplying(true)
    try {
      await createMerchant({
        data: {
          name: name.trim(),
          patterns: validPatterns,
          defaultCategory: defaultCategory || null,
        },
      })
      onApplied()
    } finally {
      setApplying(false)
    }
  }

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-3 py-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
          placeholder="Name"
        />
      </td>
      <td className="px-3 py-2">
        <div className="space-y-1">
          {patterns.map((p, i) => (
            <div key={i} className="flex gap-1 items-center">
              <input
                type="text"
                value={p.pattern}
                onChange={(e) => updatePattern(i, 'pattern', e.target.value)}
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs font-mono"
                placeholder="Pattern"
              />
              <select
                value={p.matchType}
                onChange={(e) => updatePattern(i, 'matchType', e.target.value)}
                className="rounded border border-slate-300 px-1 py-1 text-xs"
              >
                <option value="contains">Contains</option>
                <option value="starts_with">Starts with</option>
                <option value="exact">Exact</option>
              </select>
              {patterns.length > 1 && (
                <button
                  onClick={() => removePattern(i)}
                  className="text-red-400 hover:text-red-600 text-xs px-1"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addPattern}
            className="text-blue-600 hover:text-blue-700 text-xs"
          >
            + Add pattern
          </button>
        </div>
      </td>
      <td className="px-3 py-2">
        <select
          value={defaultCategory}
          onChange={(e) => setDefaultCategory(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">None</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={() => setShowSamples(!showSamples)}
          className="tabular-nums text-sm text-blue-600 hover:text-blue-700 cursor-pointer"
          title="Click to toggle sample descriptions"
        >
          {liveCount}
        </button>
        {showSamples && sampleDescs.length > 0 && (
          <div className="mt-1 text-left">
            {sampleDescs.map((d, i) => (
              <div key={i} className="text-xs font-mono text-slate-500 truncate" title={d}>
                {d}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={handleApply}
          disabled={!name.trim() || patterns.every((p) => !p.pattern.trim()) || applying}
          className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
      </td>
    </tr>
  )
}

function MerchantsPage() {
  const { merchants: merchantList, suggestions, stats } = Route.useLoaderData()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [patterns, setPatterns] = useState<PatternInput[]>([
    { pattern: '', matchType: 'contains' },
  ])
  const [defaultCategory, setDefaultCategory] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<{
    matchCount: number
    sampleDescriptions: string[]
  } | null>(null)

  // Live preview for create form
  const patternsKey = JSON.stringify(patterns)
  useEffect(() => {
    const validPatterns = patterns.filter((p) => p.pattern.trim())
    if (validPatterns.length === 0) {
      setPreviewResult(null)
      return
    }
    const timer = setTimeout(async () => {
      const result = await previewMerchantPatterns({ data: { patterns: validPatterns } })
      setPreviewResult(result)
    }, 400)
    return () => clearTimeout(timer)
  }, [patternsKey])

  const updatePattern = (index: number, field: keyof PatternInput, value: string) => {
    setPatterns((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    )
  }

  const addPattern = () => {
    setPatterns((prev) => [...prev, { pattern: '', matchType: 'contains' }])
  }

  const removePattern = (index: number) => {
    setPatterns((prev) => prev.filter((_, i) => i !== index))
  }

  const handleCreate = async () => {
    const validPatterns = patterns.filter((p) => p.pattern.trim())
    if (!name.trim() || validPatterns.length === 0) return
    setLoading(true)
    try {
      const result = await createMerchant({
        data: {
          name: name.trim(),
          patterns: validPatterns,
          defaultCategory: defaultCategory || null,
        },
      })
      setMessage(
        `"${name}" created! Matched ${result.matched} transaction(s)${result.categorized ? `, categorized ${result.categorized}` : ''}.`,
      )
      setName('')
      setPatterns([{ pattern: '', matchType: 'contains' }])
      setDefaultCategory('')
      setPreviewResult(null)
      setShowForm(false)
      setTimeout(() => setMessage(null), 3000)
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    await deleteMerchant({ data: { id } })
    window.location.reload()
  }

  const handleApplyAll = async () => {
    setLoading(true)
    try {
      const result = await applyMerchantRules()
      setMessage(
        `Processed ${result.merchantsProcessed} merchant(s), matched ${result.totalMatched} transaction(s).`,
      )
      setTimeout(() => setMessage(null), 3000)
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Merchants</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : 'New Merchant'}
        </button>
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700">
            Merchant Assignment Progress
          </span>
          <span className="text-sm text-slate-500">
            {stats.assigned.toLocaleString()} / {stats.total.toLocaleString()} ({stats.percentage}%)
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2.5">
          <div
            className="bg-blue-500 h-2.5 rounded-full transition-all"
            style={{ width: `${stats.percentage}%` }}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={handleApplyAll}
            disabled={loading || merchantList.length === 0}
            className="px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Re-apply All Rules
          </button>
          {message && (
            <span className="text-sm text-green-600 font-medium">{message}</span>
          )}
        </div>
      </div>

      {/* New merchant form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h2 className="text-lg font-semibold">Create Merchant</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Merchant Name
              </label>
              <input
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Amazon"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Default Category
              </label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={defaultCategory}
                onChange={(e) => setDefaultCategory(e.target.value)}
              >
                <option value="">None</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Patterns <span className="text-slate-400 font-normal">(matched with OR logic)</span>
            </label>
            <div className="space-y-2">
              {patterns.map((p, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                    value={p.pattern}
                    onChange={(e) => updatePattern(i, 'pattern', e.target.value)}
                    placeholder="e.g., AMZN MKTP"
                  />
                  <select
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={p.matchType}
                    onChange={(e) => updatePattern(i, 'matchType', e.target.value)}
                  >
                    <option value="contains">Contains</option>
                    <option value="starts_with">Starts with</option>
                    <option value="exact">Exact match</option>
                  </select>
                  {patterns.length > 1 && (
                    <button
                      onClick={() => removePattern(i)}
                      className="text-red-500 hover:text-red-700 text-sm px-2"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addPattern}
                className="text-blue-600 hover:text-blue-700 text-sm"
              >
                + Add another pattern
              </button>
            </div>
          </div>

          {/* Live preview */}
          {previewResult && (
            <div className="bg-slate-50 rounded-md p-3">
              <p className="text-sm font-medium text-slate-700">
                {previewResult.matchCount} unassigned transaction(s) would match
              </p>
              {previewResult.sampleDescriptions.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {previewResult.sampleDescriptions.map((d, i) => (
                    <div key={i} className="text-xs font-mono text-slate-500 truncate" title={d}>
                      {d}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || patterns.every((p) => !p.pattern.trim()) || loading}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create & Apply'}
            </button>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold">Suggested Merchants</h2>
            <p className="text-sm text-slate-500 mt-1">
              Common description patterns without a merchant assigned (2+ occurrences). Edit name, patterns, and category, then Apply.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Name</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Patterns</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Category</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Count</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Action</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s, i) => (
                <SuggestionRow
                  key={i}
                  suggestion={s}
                  onApplied={() => window.location.reload()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Merchants table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold">Merchants ({merchantList.length})</h2>
        </div>
        {merchantList.length === 0 ? (
          <div className="px-6 py-8 text-center text-slate-500">
            No merchants yet. Create one to normalize transaction descriptions.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Patterns</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Category</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Transactions</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {merchantList.map((m) => (
                <tr key={m.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-medium">{m.name}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {m.patterns.map((p) => (
                        <span
                          key={p.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-700"
                        >
                          {p.pattern}
                          <span className="text-slate-400">
                            ({p.matchType.replace('_', ' ')})
                          </span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {m.defaultCategory ? (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                        {m.defaultCategory}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-600">{m.transactionCount}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="text-red-600 hover:text-red-700 text-sm"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
