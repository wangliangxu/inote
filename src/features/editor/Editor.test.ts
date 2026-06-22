import { describe, expect, it } from 'vitest'
import { MDXEDITOR_SUPPRESS_HTML_PROCESSING } from './Editor'

describe('Editor MDXEditor configuration', () => {
  it('disables HTML processing in rich text mode', () => {
    expect(MDXEDITOR_SUPPRESS_HTML_PROCESSING).toBe(true)
  })
})
