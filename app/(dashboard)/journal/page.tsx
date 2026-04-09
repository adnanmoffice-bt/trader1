'use client'
import { useEffect, useState } from 'react'

interface JournalEntry {
  id: string
  trade_id: string | null
  date: string
  type: string
  tags: string[]
  notes: string
  psychology_score: number | null
  setup_type: string | null
  mistakes: string[]
  lessons: string
  created_at: string
}

const SETUP_TYPES = ['BB_SQUEEZE', 'EMA_CROSS', 'BREAKOUT', 'REVERSAL', 'SCALP', 'SWING', 'OTHER']
const TAG_PRESETS = ['FOMO', 'PATIENCE', 'OVERSIZE', 'PERFECT_ENTRY', 'EARLY_EXIT', 'HELD_WINNER', 'REVENGE_TRADE', 'PLAN_FOLLOWED']

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    type: 'day' as 'day' | 'trade' | 'plan',
    notes: '',
    psychology_score: 3,
    setup_type: '',
    tags: [] as string[],
    mistakes: [] as string[],
    lessons: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/journal?limit=30').then(r => r.json()).then(d => setEntries(d.data ?? [])).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await res.json()
      if (d.success && d.data) {
        setEntries(prev => [d.data, ...prev])
        setShowForm(false)
        setForm({ type: 'day', notes: '', psychology_score: 3, setup_type: '', tags: [], mistakes: [], lessons: '' })
      }
    } catch { /* */ }
    setSaving(false)
  }

  const toggleTag = (tag: string) => {
    setForm(f => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag],
    }))
  }

  const psyEmoji = (score: number) => ['', '😰', '😟', '😐', '🙂', '😎'][score] || ''

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-[11px] font-bold" style={{ color: 'var(--amber)' }}>TRADING JOURNAL</span>
        <div className="flex-1" />
        <button onClick={() => setShowForm(!showForm)}
          className="px-3 py-1 text-[9px] font-bold rounded"
          style={{ background: 'var(--amber)', color: '#000' }}>
          {showForm ? 'CANCEL' : '+ NEW ENTRY'}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {/* New entry form */}
        {showForm && (
          <div className="p-4 mx-3 my-2 rounded" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[8px] font-bold block mb-1" style={{ color: 'var(--text-3)' }}>TYPE</label>
                <div className="flex gap-1">
                  {(['day', 'trade', 'plan'] as const).map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                      className="px-2 py-0.5 text-[9px] font-bold rounded"
                      style={{ color: form.type === t ? '#000' : 'var(--text-3)', background: form.type === t ? 'var(--amber)' : 'var(--bg-3)' }}>
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[8px] font-bold block mb-1" style={{ color: 'var(--text-3)' }}>PSYCHOLOGY (1-5)</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(s => (
                    <button key={s} onClick={() => setForm(f => ({ ...f, psychology_score: s }))}
                      className="w-7 h-7 text-[11px] rounded flex items-center justify-center"
                      style={{ background: form.psychology_score === s ? 'var(--amber)' : 'var(--bg-3)', color: form.psychology_score === s ? '#000' : 'var(--text-2)' }}>
                      {psyEmoji(s)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-3">
              <label className="text-[8px] font-bold block mb-1" style={{ color: 'var(--text-3)' }}>TAGS</label>
              <div className="flex flex-wrap gap-1">
                {TAG_PRESETS.map(tag => (
                  <button key={tag} onClick={() => toggleTag(tag)}
                    className="px-2 py-0.5 text-[8px] font-bold rounded"
                    style={{
                      color: form.tags.includes(tag) ? '#000' : 'var(--text-3)',
                      background: form.tags.includes(tag) ? 'var(--blue)' : 'var(--bg-3)',
                    }}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label className="text-[8px] font-bold block mb-1" style={{ color: 'var(--text-3)' }}>SETUP TYPE</label>
              <div className="flex flex-wrap gap-1">
                {SETUP_TYPES.map(st => (
                  <button key={st} onClick={() => setForm(f => ({ ...f, setup_type: st }))}
                    className="px-2 py-0.5 text-[8px] font-bold rounded"
                    style={{
                      color: form.setup_type === st ? '#000' : 'var(--text-3)',
                      background: form.setup_type === st ? 'var(--purple)' : 'var(--bg-3)',
                    }}>
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label className="text-[8px] font-bold block mb-1" style={{ color: 'var(--text-3)' }}>NOTES</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full h-20 p-2 text-[10px] rounded resize-none"
                style={{ background: 'var(--bg-1)', color: 'var(--text-0)', border: '1px solid var(--border)' }}
                placeholder="What happened today? What did you learn?" />
            </div>

            <div className="mb-3">
              <label className="text-[8px] font-bold block mb-1" style={{ color: 'var(--text-3)' }}>LESSONS LEARNED</label>
              <textarea value={form.lessons} onChange={e => setForm(f => ({ ...f, lessons: e.target.value }))}
                className="w-full h-12 p-2 text-[10px] rounded resize-none"
                style={{ background: 'var(--bg-1)', color: 'var(--text-0)', border: '1px solid var(--border)' }}
                placeholder="Key takeaway from today..." />
            </div>

            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 text-[10px] font-bold rounded"
              style={{ background: 'var(--green)', color: '#000', opacity: saving ? 0.5 : 1 }}>
              {saving ? 'SAVING...' : 'SAVE ENTRY'}
            </button>
          </div>
        )}

        {/* Entries list */}
        <div className="flex flex-col gap-px" style={{ background: 'var(--border)' }}>
          {entries.map(e => (
            <div key={e.id} className="p-3" style={{ background: 'var(--bg-1)' }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{
                    background: e.type === 'day' ? 'var(--blue)' : e.type === 'trade' ? 'var(--green)' : 'var(--purple)',
                    color: '#000',
                  }}>{e.type.toUpperCase()}</span>
                  <span className="text-[10px] font-bold" style={{ color: 'var(--text-0)' }}>{e.date}</span>
                  {e.psychology_score && <span className="text-[11px]">{psyEmoji(e.psychology_score)}</span>}
                </div>
                {e.setup_type && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>{e.setup_type}</span>}
              </div>

              {e.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {e.tags.map(t => (
                    <span key={t} className="text-[7px] font-bold px-1 py-0.5 rounded" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>{t}</span>
                  ))}
                </div>
              )}

              {e.notes && <div className="text-[9px] mb-1" style={{ color: 'var(--text-1)' }}>{e.notes}</div>}
              {e.lessons && <div className="text-[9px] italic" style={{ color: 'var(--cyan)' }}>Lesson: {e.lessons}</div>}
              {e.mistakes.length > 0 && (
                <div className="text-[8px] mt-0.5" style={{ color: 'var(--red)' }}>Mistakes: {e.mistakes.join(', ')}</div>
              )}
            </div>
          ))}

          {entries.length === 0 && (
            <div className="p-6 text-center" style={{ background: 'var(--bg-1)' }}>
              <div className="text-[11px] font-bold mb-1" style={{ color: 'var(--text-2)' }}>No journal entries yet</div>
              <div className="text-[9px]" style={{ color: 'var(--text-3)' }}>Start journaling to track your trading psychology and patterns</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
