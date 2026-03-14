import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import {
  getCategoryRules,
  createCategoryRule,
  deleteCategoryRule,
  applyCategoryRules,
  getCategoryStats,
  previewCategoryRule,
  suggestCategories,
} from '../server/functions/categories'
import { CATEGORIES } from '../shared/categories'

export const Route = createFileRoute('/categories')({
  loader: async () => {
    const [rules, stats, rawSuggestions] = await Promise.all([
      getCategoryRules(),
      getCategoryStats(),
      suggestCategories(),
    ])

    // Resolve actual match counts for each suggestion using the same
    // starts_with LIKE query the UI will use, then sort by count desc.
    const suggestions = await Promise.all(
      rawSuggestions.map(async (s) => {
        const pattern = s.prefix.trimEnd()
        const result = await previewCategoryRule({
          data: { pattern, matchType: 'starts_with', expenseOnly: true },
        })
        return { ...s, pattern, count: result.matchCount }
      }),
    )
    suggestions.sort((a, b) => b.count - a.count)

    return { rules, stats, suggestions }
  },
  component: CategoriesPage,
})

type Suggestion = { prefix: string; pattern: string; count: number; sample: string }

function SuggestionRow({
  suggestion,
  onApplied,
}: {
  suggestion: Suggestion
  onApplied: () => void
}) {
  const [pattern, setPattern] = useState(suggestion.pattern)
  const [matchType, setMatchType] = useState<'contains' | 'starts_with' | 'exact'>('starts_with')
  const [category, setCategory] = useState('')
  const [liveCount, setLiveCount] = useState<number>(suggestion.count)
  const [applying, setApplying] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      return
    }
    if (!pattern.trim()) {
      setLiveCount(0)
      return
    }
    const timer = setTimeout(async () => {
      const result = await previewCategoryRule({ data: { pattern: pattern.trim(), matchType, expenseOnly: true } })
      setLiveCount(result.matchCount)
    }, 400)
    return () => clearTimeout(timer)
  }, [pattern, matchType])

  const handleApply = async () => {
    if (!pattern.trim() || !category) return
    setApplying(true)
    try {
      await createCategoryRule({ data: { pattern: pattern.trim(), matchType, category } })
      onApplied()
    } finally {
      setApplying(false)
    }
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2">
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={matchType}
          onChange={(e) => setMatchType(e.target.value as 'contains' | 'starts_with' | 'exact')}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="contains">Contains</option>
          <option value="starts_with">Starts with</option>
          <option value="exact">Exact</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="">Select...</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-sm">{liveCount}</td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={handleApply}
          disabled={!pattern.trim() || !category || applying}
          className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
      </td>
    </tr>
  )
}

function CategoriesPage() {
  const { rules, stats, suggestions } = Route.useLoaderData()
  const [showForm, setShowForm] = useState(false)
  const [pattern, setPattern] = useState('')
  const [matchType, setMatchType] = useState<'contains' | 'starts_with' | 'exact'>('contains')
  const [category, setCategory] = useState('')
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [applyResult, setApplyResult] = useState<string | null>(null)

  const handlePreview = async () => {
    if (!pattern.trim()) return
    const result = await previewCategoryRule({ data: { pattern: pattern.trim(), matchType } })
    setPreviewCount(result.matchCount)
  }

  const handleCreate = async () => {
    if (!pattern.trim() || !category.trim()) return
    setLoading(true)
    try {
      const result = await createCategoryRule({
        data: {
          pattern: pattern.trim(),
          matchType,
          category: category.trim(),
        },
      })
      setPattern('')
      setCategory('')
      setPreviewCount(null)
      setShowForm(false)
      setApplyResult(`Rule created! Applied to ${result.appliedCount} transaction(s).`)
      setTimeout(() => setApplyResult(null), 3000)
      // Reload data
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    await deleteCategoryRule({ data: { id } })
    window.location.reload()
  }

  const handleApplyAll = async () => {
    setLoading(true)
    try {
      const result = await applyCategoryRules()
      setApplyResult(
        `Applied ${result.rulesProcessed} rule(s), categorized ${result.totalApplied} transaction(s).`,
      )
      setTimeout(() => setApplyResult(null), 3000)
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Category Rules</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : 'New Rule'}
        </button>
      </div>

      {/* Categorization progress */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700">
            Categorization Progress
          </span>
          <span className="text-sm text-slate-500">
            {stats.categorized.toLocaleString()} / {stats.total.toLocaleString()} ({stats.percentage}%)
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2.5">
          <div
            className="bg-emerald-500 h-2.5 rounded-full transition-all"
            style={{ width: `${stats.percentage}%` }}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={handleApplyAll}
            disabled={loading || rules.length === 0}
            className="px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Apply All Rules to Uncategorized
          </button>
          {applyResult && (
            <span className="text-sm text-green-600 font-medium">{applyResult}</span>
          )}
        </div>
      </div>

      {/* New rule form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h2 className="text-lg font-semibold">Create Category Rule</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Pattern</label>
              <input
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={pattern}
                onChange={(e) => {
                  setPattern(e.target.value)
                  setPreviewCount(null)
                }}
                placeholder='e.g., NETFLIX'
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Match Type</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={matchType}
                onChange={(e) => {
                  setMatchType(e.target.value as 'contains' | 'starts_with' | 'exact')
                  setPreviewCount(null)
                }}
              >
                <option value="contains">Contains</option>
                <option value="starts_with">Starts with</option>
                <option value="exact">Exact match</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Select category...</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePreview}
              disabled={!pattern.trim()}
              className="px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Preview Matches
            </button>
            {previewCount !== null && (
              <span className="text-sm text-slate-600">
                {previewCount} uncategorized transaction(s) would match
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={handleCreate}
              disabled={!pattern.trim() || !category.trim() || loading}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create & Apply'}
            </button>
          </div>
        </div>
      )}

      {/* Suggested rules */}
      {suggestions.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold">Suggested Rules</h2>
            <p className="text-sm text-slate-500 mt-1">
              Common uncategorized patterns (2+ transactions). Edit pattern, match type, and category, then Apply.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Pattern</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Match Type</th>
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

      {/* Rules table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold">Rules ({rules.length})</h2>
        </div>
        {rules.length === 0 ? (
          <div className="px-6 py-8 text-center text-slate-500">
            No category rules yet. Create one to start bulk-categorizing transactions.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Pattern</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Match</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Category</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Priority</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-mono text-sm">{rule.pattern}</td>
                  <td className="px-4 py-2 text-slate-500">{rule.matchType.replace('_', ' ')}</td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                      {rule.category}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{rule.priority}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDelete(rule.id)}
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
