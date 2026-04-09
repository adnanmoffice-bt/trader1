'use client'

interface PerformanceData {
  total_trades: number
  win_rate: number
  profit_factor: number
  expectancy: number
  avg_r_value: number
  current_streak: number
  streak_type: string
  current_drawdown_pct: number
  max_drawdown_pct: number
  avg_exit_efficiency_pct: number
  avg_mfe_pct: number
  avg_mae_pct: number
  kelly_fraction: number
}

function MetricCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="p-2 rounded" style={{ background: 'var(--bg-2)' }}>
      <div className="text-[7px] font-bold" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="text-[13px] font-black" style={{ color: color || 'var(--text-0)' }}>{value}</div>
      {sub && <div className="text-[7px]" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  )
}

export function PerformanceMetrics({ data }: { data: PerformanceData | null }) {
  if (!data) return <div className="p-3 text-[9px] text-center" style={{ color: 'var(--text-3)' }}>No performance data yet</div>

  const wr = data.win_rate
  const wrColor = wr >= 55 ? 'var(--green)' : wr >= 45 ? 'var(--amber)' : 'var(--red)'
  const pfColor = data.profit_factor >= 1.5 ? 'var(--green)' : data.profit_factor >= 1 ? 'var(--amber)' : 'var(--red)'
  const eeColor = data.avg_exit_efficiency_pct >= 60 ? 'var(--green)' : data.avg_exit_efficiency_pct >= 40 ? 'var(--amber)' : 'var(--red)'
  const streakColor = data.streak_type === 'win' ? 'var(--green)' : data.streak_type === 'loss' ? 'var(--red)' : 'var(--text-2)'
  const ddColor = data.current_drawdown_pct > 10 ? 'var(--red)' : data.current_drawdown_pct > 5 ? 'var(--amber)' : 'var(--green)'

  return (
    <div className="grid grid-cols-3 lg:grid-cols-4 gap-1.5 p-2">
      <MetricCard label="TRADES" value={String(data.total_trades)} />
      <MetricCard label="WIN RATE" value={`${wr.toFixed(1)}%`} color={wrColor} />
      <MetricCard label="PROFIT FACTOR" value={data.profit_factor.toFixed(2)} color={pfColor} />
      <MetricCard label="EXPECTANCY" value={data.expectancy.toFixed(2)} color={data.expectancy >= 0 ? 'var(--green)' : 'var(--red)'} />
      <MetricCard label="AVG R-VALUE" value={data.avg_r_value.toFixed(2)} color={data.avg_r_value >= 1 ? 'var(--green)' : 'var(--text-0)'} />
      <MetricCard label="EXIT EFFICIENCY" value={`${data.avg_exit_efficiency_pct.toFixed(0)}%`} color={eeColor} sub="actual/best exit" />
      <MetricCard label="AVG MFE" value={`${data.avg_mfe_pct.toFixed(1)}%`} color="var(--green)" sub="max favorable" />
      <MetricCard label="AVG MAE" value={`${data.avg_mae_pct.toFixed(1)}%`} color="var(--red)" sub="max adverse" />
      <MetricCard label="KELLY" value={`${(data.kelly_fraction * 100).toFixed(1)}%`} color="var(--blue)" sub="optimal bet size" />
      <MetricCard label="STREAK" value={`${data.current_streak} ${data.streak_type === 'win' ? 'W' : data.streak_type === 'loss' ? 'L' : '-'}`} color={streakColor} />
      <MetricCard label="DRAWDOWN" value={`${data.current_drawdown_pct.toFixed(1)}%`} color={ddColor} sub={`max: ${data.max_drawdown_pct.toFixed(1)}%`} />
    </div>
  )
}
