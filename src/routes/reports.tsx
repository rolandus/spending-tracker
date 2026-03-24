import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getMonthlySpendingByCategory,
  getMonthlySpendingTrend,
  getPaymentMethodBreakdown,
  getYearOverYearComparison,
  getAvailablePeriods,
  getIncomeAverages,
  getExpenseAverages,
} from '../server/functions/reports'

export const Route = createFileRoute('/reports')({
  loader: async () => {
    const periods = await getAvailablePeriods()

    // Default to the most recent month
    const latestMonth = periods.months[0]
    let year = new Date().getFullYear()
    let month = new Date().getMonth() + 1

    if (latestMonth) {
      const [y, m] = latestMonth.split('-')
      year = parseInt(y!)
      month = parseInt(m!)
    }

    const [categoryBreakdown, trend, paymentMethods, incomeAverages, expenseAverages] = await Promise.all([
      getMonthlySpendingByCategory({ data: { year, month } }),
      getMonthlySpendingTrend({ data: { months: 12 } }),
      getPaymentMethodBreakdown({ data: { year, month } }),
      getIncomeAverages(),
      getExpenseAverages(),
    ])

    return { periods, categoryBreakdown, trend, paymentMethods, incomeAverages, expenseAverages, selectedYear: year, selectedMonth: month }
  },
  component: ReportsPage,
})

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const BAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-purple-500', 'bg-cyan-500', 'bg-orange-500', 'bg-indigo-500',
  'bg-teal-500', 'bg-pink-500', 'bg-lime-500', 'bg-red-500',
  'bg-sky-500', 'bg-yellow-500', 'bg-violet-500', 'bg-fuchsia-500',
]

const METHOD_COLORS: Record<string, string> = {
  credit: 'bg-blue-500',
  ach: 'bg-emerald-500',
  check: 'bg-amber-500',
  cash: 'bg-rose-500',
  transfer: 'bg-purple-500',
  direct_deposit: 'bg-cyan-500',
  unknown: 'bg-slate-400',
}

function ReportsPage() {
  const { periods, categoryBreakdown, trend, paymentMethods, incomeAverages, expenseAverages, selectedYear, selectedMonth } =
    Route.useLoaderData()

  const [tab, setTab] = useState<'monthly' | 'trend' | 'payment' | 'yoy' | 'averages'>('monthly')
  const [yoyYear1, setYoyYear1] = useState(periods.years[1] ?? periods.years[0] ?? 2024)
  const [yoyYear2, setYoyYear2] = useState(periods.years[0] ?? 2025)
  const [yoyData, setYoyData] = useState<Awaited<ReturnType<typeof getYearOverYearComparison>> | null>(null)
  const [yoyLoading, setYoyLoading] = useState(false)

  const handleLoadYoY = async () => {
    setYoyLoading(true)
    try {
      const data = await getYearOverYearComparison({ data: { year1: yoyYear1, year2: yoyYear2 } })
      setYoyData(data)
    } finally {
      setYoyLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Spending Reports</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {([
          ['monthly', 'Monthly Breakdown'],
          ['trend', 'Trend'],
          ['payment', 'Payment Methods'],
          ['yoy', 'Year over Year'],
          ['averages', 'Averages'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Monthly Breakdown */}
      {tab === 'monthly' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
              </h2>
              <span className="text-lg font-bold text-slate-700">
                Total: {formatCurrency(categoryBreakdown.grandTotal)}
              </span>
            </div>

            {categoryBreakdown.rows.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No expense data for this period.</p>
            ) : (
              <div className="space-y-2">
                {categoryBreakdown.rows.map((row, i) => {
                  const pct = categoryBreakdown.grandTotal > 0
                    ? (row.total / categoryBreakdown.grandTotal) * 100
                    : 0
                  return (
                    <div key={row.category} className="flex items-center gap-3">
                      <span className="w-32 text-sm text-slate-700 truncate" title={row.category}>
                        {row.category}
                      </span>
                      <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]} transition-all`}
                          style={{ width: `${Math.max(pct, 1)}%` }}
                        />
                      </div>
                      <span className="w-24 text-sm text-right font-mono text-slate-700">
                        {formatCurrency(row.total)}
                      </span>
                      <span className="w-12 text-xs text-right text-slate-400">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trend */}
      {tab === 'trend' && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-lg font-semibold mb-4">Monthly Spending Trend</h2>

          {trend.rows.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No expense data available.</p>
          ) : (
            <div className="space-y-2">
              {trend.rows.map((row) => {
                const pct = trend.maxTotal > 0 ? (row.total / trend.maxTotal) * 100 : 0
                const [y, m] = row.yearMonth.split('-')
                const label = `${MONTH_NAMES[parseInt(m!) - 1]?.substring(0, 3)} ${y}`
                return (
                  <div key={row.yearMonth} className="flex items-center gap-3">
                    <span className="w-20 text-sm text-slate-700">{label}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                    <span className="w-24 text-sm text-right font-mono text-slate-700">
                      {formatCurrency(row.total)}
                    </span>
                    <span className="w-12 text-xs text-right text-slate-400">
                      {row.count}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Payment Methods */}
      {tab === 'payment' && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              Payment Methods — {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </h2>
            <span className="text-lg font-bold text-slate-700">
              Total: {formatCurrency(paymentMethods.grandTotal)}
            </span>
          </div>

          {paymentMethods.rows.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No expense data for this period.</p>
          ) : (
            <div className="space-y-2">
              {paymentMethods.rows.map((row) => {
                const pct = paymentMethods.grandTotal > 0
                  ? (row.total / paymentMethods.grandTotal) * 100
                  : 0
                const color = METHOD_COLORS[row.method] ?? 'bg-slate-400'
                return (
                  <div key={row.method} className="flex items-center gap-3">
                    <span className="w-32 text-sm text-slate-700 capitalize">
                      {row.method.replace('_', ' ')}
                    </span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color} transition-all`}
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                    <span className="w-24 text-sm text-right font-mono text-slate-700">
                      {formatCurrency(row.total)}
                    </span>
                    <span className="w-12 text-xs text-right text-slate-400">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Averages */}
      {tab === 'averages' && (
        <div className="space-y-6">
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h2 className="text-lg font-semibold">Monthly Income Averages</h2>

          {incomeAverages.oldestMonth && incomeAverages.newestMonth ? (
            <>
              <p className="text-sm text-slate-500">
                {(() => {
                  const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                  const [oy, om] = incomeAverages.oldestMonth!.split('-')
                  const [ny, nm] = incomeAverages.newestMonth!.split('-')
                  return `${SHORT_MONTHS[parseInt(om!) - 1]} ${oy} – ${SHORT_MONTHS[parseInt(nm!) - 1]} ${ny}`
                })()}
              </p>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Category</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Monthly Average</th>
                  </tr>
                </thead>
                <tbody>
                  {incomeAverages.rows.map((row) => (
                    <tr key={row.category} className="border-b border-slate-100">
                      <td className="px-3 py-2">{row.category}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(row.monthlyAverage)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(incomeAverages.totalMonthlyAverage)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-slate-500 text-center py-8">No income data available.</p>
          )}
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h2 className="text-lg font-semibold">Monthly Expense Averages</h2>

          {expenseAverages.oldestMonth && expenseAverages.newestMonth ? (
            <>
              <p className="text-sm text-slate-500">
                {(() => {
                  const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                  const [oy, om] = expenseAverages.oldestMonth!.split('-')
                  const [ny, nm] = expenseAverages.newestMonth!.split('-')
                  return `${SHORT_MONTHS[parseInt(om!) - 1]} ${oy} – ${SHORT_MONTHS[parseInt(nm!) - 1]} ${ny}`
                })()}
              </p>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Category</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Monthly Average</th>
                  </tr>
                </thead>
                <tbody>
                  {expenseAverages.rows.map((row) => (
                    <tr key={row.category} className="border-b border-slate-100">
                      <td className="px-3 py-2">{row.category}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(row.monthlyAverage)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(expenseAverages.totalMonthlyAverage)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-slate-500 text-center py-8">No expense data available.</p>
          )}
        </div>
        </div>
      )}

      {/* Year over Year */}
      {tab === 'yoy' && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h2 className="text-lg font-semibold">Year-over-Year Comparison</h2>

          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Year 1</label>
              <select
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={yoyYear1}
                onChange={(e) => setYoyYear1(Number(e.target.value))}
              >
                {periods.years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Year 2</label>
              <select
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={yoyYear2}
                onChange={(e) => setYoyYear2(Number(e.target.value))}
              >
                {periods.years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleLoadYoY}
              disabled={yoyLoading}
              className="px-4 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {yoyLoading ? 'Loading...' : 'Compare'}
            </button>
          </div>

          {yoyData && (
            <div>
              <div className="flex items-center gap-4 mb-3 text-sm">
                <span className="font-semibold">{yoyData.year1}: {formatCurrency(yoyData.year1GrandTotal)}</span>
                <span className="text-slate-400">vs</span>
                <span className="font-semibold">{yoyData.year2}: {formatCurrency(yoyData.year2GrandTotal)}</span>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Category</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">{yoyData.year1}</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">{yoyData.year2}</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {yoyData.rows.map((row) => {
                    const change = row.year2Total - row.year1Total
                    const changePct = row.year1Total > 0 ? (change / row.year1Total) * 100 : 0
                    return (
                      <tr key={row.category} className="border-b border-slate-100">
                        <td className="px-3 py-2">{row.category}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatCurrency(row.year1Total)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatCurrency(row.year2Total)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${change > 0 ? 'text-red-600' : change < 0 ? 'text-green-600' : ''}`}>
                          {change > 0 ? '+' : ''}{formatCurrency(change)}
                          {row.year1Total > 0 && (
                            <span className="text-xs text-slate-400 ml-1">
                              ({changePct > 0 ? '+' : ''}{changePct.toFixed(0)}%)
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!yoyData && (
            <p className="text-slate-500 text-center py-8">
              Select two years and click Compare to see the breakdown.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
