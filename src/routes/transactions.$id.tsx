import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getTransaction, updateTransaction } from '../server/functions/transactions'
import { CategoryPicker } from '../components/CategoryPicker'
import { CATEGORIES } from '../shared/categories'

export const Route = createFileRoute('/transactions/$id')({
  loader: async ({ params }) => {
    return getTransaction({ data: { id: Number(params.id) } })
  },
  component: TransactionDetailPage,
})

const TRANSACTION_TYPES = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'internal_transfer', label: 'Internal Transfer' },
  { value: 'cc_payment', label: 'CC Payment' },
  { value: 'refund', label: 'Refund' },
  { value: 'unknown', label: 'Unknown' },
]

function formatCurrency(amount: number): string {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return amount < 0 ? `-$${formatted}` : `$${formatted}`
}

function TransactionDetailPage() {
  const txn = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()

  const [category, setCategory] = useState(txn.category ?? '')
  const [notes, setNotes] = useState(txn.notes ?? '')
  const [transactionType, setTransactionType] = useState(txn.transactionType)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [togglingIgnored, setTogglingIgnored] = useState(false)

  const handleToggleIgnored = async () => {
    setTogglingIgnored(true)
    try {
      await updateTransaction({
        data: { id: txn.id, ignored: txn.ignored ? 0 : 1 },
      })
      router.invalidate()
    } finally {
      setTogglingIgnored(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateTransaction({
        data: {
          id: txn.id,
          category: category || null,
          notes: notes || null,
          transactionType: transactionType as any,
        },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    (category || null) !== (txn.category || null) ||
    (notes || null) !== (txn.notes || null) ||
    transactionType !== txn.transactionType

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate({ to: '/transactions' })}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          &larr; Back to transactions
        </button>
      </div>

      {txn.ignored === 1 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-yellow-600 text-sm font-medium">
              This transaction is ignored and excluded from all reports and analytics.
            </span>
          </div>
          <button
            onClick={handleToggleIgnored}
            disabled={togglingIgnored}
            className="px-3 py-1 rounded-md bg-yellow-100 text-yellow-700 text-sm font-medium hover:bg-yellow-200 disabled:opacity-50"
          >
            {togglingIgnored ? 'Restoring...' : 'Unignore'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">{txn.description}</h1>
              <p className="text-sm text-slate-500 mt-1">{txn.accountName}</p>
            </div>
            {!txn.ignored && (
              <button
                onClick={handleToggleIgnored}
                disabled={togglingIgnored}
                className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-500 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {togglingIgnored ? 'Ignoring...' : 'Ignore'}
              </button>
            )}
          </div>
        </div>

        {/* Read-only fields */}
        <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 border-b border-slate-200">
          <Field label="Date" value={txn.date} />
          <Field label="Posted Date" value={txn.postedDate ?? '—'} />
          <Field label="Amount">
            <span className={`font-mono font-semibold ${txn.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {formatCurrency(txn.amount)}
            </span>
          </Field>
          <Field label="Payment Method" value={txn.paymentMethod?.replace('_', ' ') ?? '—'} />
          <Field label="Check Number" value={txn.checkNumber ?? '—'} />
          <Field label="Cardholder" value={txn.cardholder ?? '—'} />
          <Field label="Source Category" value={txn.sourceCategory ?? '—'} />
          <Field label="Source File" value={txn.sourceFile} />
          <Field label="Import Hash">
            <span className="font-mono text-xs text-slate-400 break-all">{txn.importHash}</span>
          </Field>
        </div>

        {/* Editable fields */}
        <div className="px-6 py-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Edit</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Transaction Type</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={transactionType}
                onChange={(e) => setTransactionType(e.target.value as any)}
              >
                {TRANSACTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="relative">
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <button
                type="button"
                onClick={() => setCategoryPickerOpen((o) => !o)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-left bg-white hover:bg-slate-50"
              >
                {category || <span className="text-slate-400">Select a category...</span>}
              </button>
              {categoryPickerOpen && (
                <CategoryPicker
                  value={category || null}
                  categories={[...CATEGORIES]}
                  onChange={(val) => setCategory(val ?? '')}
                  onClose={() => setCategoryPickerOpen(false)}
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this transaction..."
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {saved && (
              <span className="text-sm text-green-600 font-medium">Saved!</span>
            )}
            {hasChanges && !saved && (
              <span className="text-sm text-slate-400">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="text-sm mt-0.5">{children ?? value}</dd>
    </div>
  )
}
