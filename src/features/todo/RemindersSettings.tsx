import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReminderSync } from './useReminderSync'
import { configureReminders, connectReminders, syncReminders, type ReminderCalendar } from './reminders'

export function RemindersSettings({ vaultRoot }: { vaultRoot: string }) {
  const { t } = useTranslation()
  const { config, error } = useReminderSync(vaultRoot, false)
  const [calendars, setCalendars] = useState<ReminderCalendar[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')

  async function run(action: () => Promise<void>) {
    setBusy(true); setProblem(''); setMessage('')
    try { await action() } catch (error) { setProblem(String(error)) } finally { setBusy(false) }
  }

  async function connect() {
    const result = await connectReminders()
    setCalendars(result.calendars)
    const available = result.calendars.some((calendar) => calendar.id === config.calendarId)
    const fallback = result.calendars.some((calendar) => calendar.id === result.defaultCalendarId) ? result.defaultCalendarId : result.calendars[0]?.id || ''
    setSelected(available ? config.calendarId : fallback)
    if (!result.calendars.length) setProblem(t('reminders.noLists'))
  }

  return (
    <section className="grid gap-3 rounded-lg border border-base-300 p-4" aria-label={t('reminders.title')}>
      <h3 className="font-semibold">{t('reminders.title')}</h3>
      <p className="text-sm opacity-70">{t('reminders.description')}</p>
      {!config.supported ? <p className="text-sm opacity-70">{t('reminders.macOnly')}</p> : <>
        <p className="text-sm">{config.enabled ? t('reminders.enabled') : t('reminders.disabled')}</p>
        <p className="text-sm opacity-70">{t('reminders.disableHint')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void run(connect)}>{t('reminders.connect')}</button>
          {config.enabled && <>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy || !vaultRoot} onClick={() => void run(async () => {
              await syncReminders(vaultRoot)
              setMessage(t('reminders.syncFinished'))
            })}>{t('reminders.syncNow')}</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(async () => { await configureReminders(false, config.calendarId) })}>{t('reminders.disable')}</button>
          </>}
        </div>
        {calendars.length > 0 && <>
          <label className="grid gap-2 text-sm">
            <span>{t('reminders.list')}</span>
            <select className="select select-bordered w-full" value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
              {calendars.map((calendar) => <option value={calendar.id} key={calendar.id}>{calendar.title}{calendar.source ? ` (${calendar.source})` : ''}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary btn-sm justify-self-start" disabled={busy || !selected || !vaultRoot} onClick={() => void run(async () => { await configureReminders(true, selected) })}>{t(config.enabled ? 'reminders.saveList' : 'reminders.enable')}</button>
        </>}
        {!vaultRoot && <p className="text-sm opacity-70">{t('reminders.openVault')}</p>}
        {busy && <p role="status" className="text-sm">{t('reminders.working')}</p>}
        {message && !error && !problem && <p role="status" className="text-sm">{message}</p>}
        {(problem || error) && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-error">{problem || error}</p>}
      </>}
    </section>
  )
}
