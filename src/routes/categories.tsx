import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getCategoriesWithCounts,
  createCategory,
  renameCategory,
  deleteCategory,
} from '../server/functions/categories'

export const Route = createFileRoute('/categories')({
  loader: async () => {
    const categories = await getCategoriesWithCounts()
    return { categories }
  },
  component: CategoriesPage,
})

function CategoryRow({
  category,
  onUpdated,
}: {
  category: {
    id: number
    name: string
    sortOrder: number
    transactionCount: number
    merchantCount: number
  }
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === category.name) {
      setEditing(false)
      setName(category.name)
      return
    }
    setSaving(true)
    try {
      const res = await renameCategory({ data: { id: category.id, newName: trimmed } })
      setResult(
        `Renamed. ${res.transactionsUpdated} transaction(s), ${res.merchantsUpdated} merchant(s) updated.`,
      )
      setTimeout(() => onUpdated(), 1500)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteCategory({ data: { id: category.id } })
      onUpdated()
    } finally {
      setDeleting(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setName(category.name)
    setResult(null)
    setConfirmDelete(false)
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="px-4 py-2.5">
        {editing ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') handleCancel()
            }}
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            autoFocus
          />
        ) : (
          <span className="font-medium text-sm">{category.name}</span>
        )}
        {result && <span className="block text-xs text-green-600 mt-0.5">{result}</span>}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-sm text-slate-600">
        {category.transactionCount}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-sm text-slate-600">
        {category.merchantCount}
      </td>
      <td className="px-4 py-2.5 text-right">
        {confirmDelete ? (
          <div className="flex items-center gap-2 justify-end">
            <span className="text-xs text-red-600">
              {category.transactionCount > 0
                ? `${category.transactionCount} transaction(s) will be uncategorized`
                : 'Delete this category?'}
            </span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-2 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-40"
            >
              {deleting ? '…' : 'Confirm'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 rounded border border-slate-300 text-xs text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        ) : editing ? (
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? '…' : 'Save'}
            </button>
            <button
              onClick={handleCancel}
              className="px-2 py-1 rounded border border-slate-300 text-xs text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setEditing(true)}
              className="text-blue-600 hover:text-blue-700 text-sm"
            >
              Rename
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-red-600 hover:text-red-700 text-sm"
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

function CategoriesPage() {
  const { categories } = Route.useLoaderData()
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    setCreating(true)
    try {
      await createCategory({ data: { name: trimmed } })
      setNewName('')
      setShowForm(false)
      window.location.reload()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Categories</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : 'New Category'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') {
                  setShowForm(false)
                  setNewName('')
                }
              }}
              placeholder="Category name..."
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase">
                Name
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">
                Transactions
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">
                Merchants
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                onUpdated={() => window.location.reload()}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
