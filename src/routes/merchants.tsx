import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getMerchants,
  createMerchant,
  deleteMerchant,
  applyMerchantRules,
  suggestMerchants,
} from '../server/functions/merchants'
import { CATEGORIES } from '../shared/categories'

export const Route = createFileRoute('/merchants')({
  loader: async () => {
    const [merchantList, suggestions] = await Promise.all([
      getMerchants(),
      suggestMerchants(),
    ])
    return { merchants: merchantList, suggestions }
  },
  component: MerchantsPage,
})

function MerchantsPage() {
  const { merchants: merchantList, suggestions } = Route.useLoaderData()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [pattern, setPattern] = useState('')
  const [matchType, setMatchType] = useState<'contains' | 'starts_with' | 'exact'>('contains')
  const [defaultCategory, setDefaultCategory] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim() || !pattern.trim()) return
    setLoading(true)
    try {
      const result = await createMerchant({
        data: {
          name: name.trim(),
          pattern: pattern.trim(),
          matchType,
          defaultCategory: defaultCategory || null,
        },
      })
      setMessage(
        `"${name}" created! Matched ${result.matched} transaction(s)${result.categorized ? `, categorized ${result.categorized}` : ''}.`,
      )
      setName('')
      setPattern('')
      setDefaultCategory('')
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

  const handleUseSuggestion = (sample: string) => {
    // Use the first word as the pattern (often the merchant identifier)
    const firstWord = sample.split(/\s+/)[0] ?? sample
    setPattern(firstWord)
    setName(firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase())
    setShowForm(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Merchants</h1>
        <div className="flex gap-2">
          <button
            onClick={handleApplyAll}
            disabled={loading || merchantList.length === 0}
            className="px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Re-apply All
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : 'New Merchant'}
          </button>
        </div>
      </div>

      {message && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          {message}
        </div>
      )}

      {/* New merchant form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h2 className="text-lg font-semibold">Create Merchant</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                Pattern
              </label>
              <input
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g., AMZN"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Match Type
              </label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as any)}
              >
                <option value="contains">Contains</option>
                <option value="starts_with">Starts with</option>
                <option value="exact">Exact match</option>
              </select>
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
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || !pattern.trim() || loading}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create & Apply'}
            </button>
          </div>
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
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Pattern</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Match</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Category</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Transactions</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {merchantList.map((m) => (
                <tr key={m.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-medium">{m.name}</td>
                  <td className="px-4 py-2 font-mono text-sm text-slate-600">{m.pattern}</td>
                  <td className="px-4 py-2 text-slate-500">{m.matchType.replace('_', ' ')}</td>
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

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold">Suggested Merchants</h2>
            <p className="text-sm text-slate-500 mt-1">
              Common description patterns without a merchant assigned (2+ occurrences).
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Prefix</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">Sample</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Count</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">Action</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{s.prefix}</td>
                  <td className="px-4 py-2 text-slate-500 truncate max-w-xs" title={s.sample}>
                    {s.sample}
                  </td>
                  <td className="px-4 py-2 text-right">{s.count}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleUseSuggestion(s.sample)}
                      className="text-blue-600 hover:text-blue-700 text-sm"
                    >
                      Use
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
