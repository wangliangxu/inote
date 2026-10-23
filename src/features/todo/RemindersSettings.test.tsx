// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  state: { config: { supported: true, enabled: false, calendarId: '' }, error: '' },
  connect: vi.fn(), configure: vi.fn(), sync: vi.fn(),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./useReminderSync', () => ({ useReminderSync: () => mocks.state }))
vi.mock('./reminders', () => ({ connectReminders: mocks.connect, configureReminders: mocks.configure, syncReminders: mocks.sync }))
import { RemindersSettings } from './RemindersSettings'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = { config: { supported: true, enabled: false, calendarId: '' }, error: '' }
})
afterEach(cleanup)

describe('Reminders connection settings', () => {
  it('requires an explicit connection and chosen list before enabling', async () => {
    mocks.connect.mockResolvedValue({ calendars: [{ id: 'list-id', title: 'iNote', source: 'iCloud' }], defaultCalendarId: 'list-id' })
    mocks.configure.mockResolvedValue({ supported: true, enabled: true, calendarId: 'list-id' })
    render(<RemindersSettings vaultRoot="/notes" />)
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'reminders.enable' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'reminders.connect' }))
    await screen.findByRole('option', { name: 'iNote (iCloud)' })
    fireEvent.click(screen.getByRole('button', { name: 'reminders.enable' }))
    await waitFor(() => expect(mocks.configure).toHaveBeenCalledWith(true, 'list-id'))
  })
  it('shows access denial and allows retry without enabling sync', async () => {
    mocks.connect.mockRejectedValue('Access denied')
    render(<RemindersSettings vaultRoot="/notes" />)
    fireEvent.click(screen.getByRole('button', { name: 'reminders.connect' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Access denied')
    expect(mocks.configure).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'reminders.connect' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('shows sync failures separately and provides retry and disable actions', async () => {
    mocks.state = { config: { supported: true, enabled: true, calendarId: 'list' }, error: 'List removed' }
    mocks.configure.mockResolvedValue({ supported: true, enabled: false, calendarId: 'list' })
    render(<RemindersSettings vaultRoot="/notes" />)
    expect(screen.getByRole('alert').textContent).toBe('List removed')
    fireEvent.click(screen.getByRole('button', { name: 'reminders.syncNow' }))
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith('/notes'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'reminders.disable' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'reminders.disable' }))
    await waitFor(() => expect(mocks.configure).toHaveBeenCalledWith(false, 'list'))
  })
  it('does not offer native actions on unsupported platforms', () => {
    mocks.state.config.supported = false
    render(<RemindersSettings vaultRoot="/notes" />)
    expect(screen.getByText('reminders.macOnly')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
