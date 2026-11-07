import { Component, type ReactNode } from 'react'
import i18n from 'i18next'

export class FeatureBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (this.state.error) return <div className="empty" role="alert"><p>{this.state.error.message}</p><button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>{i18n.t('common.retry', { defaultValue: 'Retry' })}</button></div>
    return this.props.children
  }
}
