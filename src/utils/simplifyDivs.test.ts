import { load, type CheerioAPI } from 'cheerio'
import { simplifyDivs } from './simplifyDivs.js'
import { describe, expect, it } from 'vitest'

describe('simplifyDivs', () => {
    function subject(source: string, expectation: string) {
        const $: CheerioAPI = load(`<div id="content">${source}</div>`)
        const node = $('#content')[0]!
        simplifyDivs($, node)
        return expect($.html()).toBe(
            `<html><head></head><body><div id="content">${expectation}</div></body></html>`,
        )
    }

    it('should wrap sequences of phrasing content in <p> tags', () => {
        subject(
            'Some text<span>Inline text</span>More text<div>Block content</div>Even more text',
            '<p>Some text<span>Inline text</span>More text</p><div>Block content</div><p>Even more text</p>',
        )
    })

    it('should not create <p> tags for whitespace-only nodes', () => {
        subject(
            '<span>Inline text</span><span>  </span><span>More text</span>',
            '<p><span>Inline text</span><span>  </span><span>More text</span></p>',
        )
    })

    it('should handle empty content gracefully', () => {
        subject('', '')
    })
})
