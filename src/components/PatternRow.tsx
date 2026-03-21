import type { PatternInput } from '../shared/pattern-matching'

const TRANSACTION_TYPES = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'refund', label: 'Refund' },
  { value: 'cc_payment', label: 'CC Payment' },
  { value: 'internal_transfer', label: 'Transfer' },
] as const

export function PatternRow({
  pattern,
  index,
  categories,
  canRemove,
  onChange,
  onRemove,
}: {
  pattern: PatternInput
  index: number
  categories: string[]
  canRemove: boolean
  onChange: (index: number, field: keyof PatternInput, value: string | boolean) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="flex gap-1 items-center flex-wrap">
      <input
        type="text"
        value={pattern.pattern}
        onChange={(e) => onChange(index, 'pattern', e.target.value)}
        className="flex-1 min-w-[120px] rounded border border-slate-300 px-2 py-1 text-xs font-mono"
        placeholder="Pattern"
      />
      <select
        value={pattern.matchType}
        onChange={(e) => onChange(index, 'matchType', e.target.value)}
        className="rounded border border-slate-300 px-1 py-1 text-xs"
      >
        <option value="contains">Contains</option>
        <option value="starts_with">Starts with</option>
        <option value="exact">Exact</option>
      </select>
      <select
        value={pattern.defaultCategory ?? ''}
        onChange={(e) => onChange(index, 'defaultCategory', e.target.value)}
        className="rounded border border-slate-300 px-1 py-1 text-xs"
      >
        <option value="">No category</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={pattern.defaultTransactionType ?? ''}
        onChange={(e) => onChange(index, 'defaultTransactionType', e.target.value)}
        className="rounded border border-slate-300 px-1 py-1 text-xs"
      >
        <option value="">No type</option>
        {TRANSACTION_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
        <input
          type="checkbox"
          checked={!!pattern.defaultIgnored}
          onChange={(e) => onChange(index, 'defaultIgnored', e.target.checked)}
          className="rounded border-slate-300"
        />
        Ignore
      </label>
      {canRemove && (
        <button
          onClick={() => onRemove(index)}
          className="text-red-400 hover:text-red-600 text-xs px-1"
        >
          ×
        </button>
      )}
    </div>
  )
}

export function PatternBadge({ pattern }: { pattern: { pattern: string; matchType: string; defaultCategory?: string | null; defaultTransactionType?: string | null; defaultIgnored?: boolean | null } }) {
  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${pattern.defaultIgnored ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
      {pattern.pattern}
      <span className="text-slate-400">
        ({pattern.matchType.replace('_', ' ')})
      </span>
      {pattern.defaultCategory && (
        <span className="text-emerald-600 font-sans font-medium">
          [{pattern.defaultCategory}]
        </span>
      )}
      {pattern.defaultTransactionType && (
        <span className="text-blue-600 font-sans font-medium">
          {'{' + pattern.defaultTransactionType + '}'}
        </span>
      )}
      {pattern.defaultIgnored && (
        <span className="text-amber-600 font-sans font-medium">
          [ignored]
        </span>
      )}
    </div>
  )
}
