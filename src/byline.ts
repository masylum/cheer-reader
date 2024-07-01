import type { Cheerio, Element } from 'cheerio'
import { getInnerText } from './textUtils.js'

const MATCH_ID_AND_CLASS = /byline|author|dateline|writtenby|p-author/i

export function extractByline($node: Cheerio<Element>, matchString: string) {
    const text = getInnerText($node)
    if (!isValidByline($node.text())) return

    const isAuthor = $node.attr('rel') === 'author'
    if (isAuthor) return text

    const hasAuthorItemprop = $node.attr('itemprop')?.includes('author')
    if (hasAuthorItemprop) return text

    const bylineMatch = MATCH_ID_AND_CLASS.test(matchString)
    if (bylineMatch) return text

    return
}

/**
 * Check whether the input string could be a byline.
 * This verifies that the input is a string, and that the length
 * is less than 100 chars.
 */
export function isValidByline(byline: string) {
    const length = byline.trim().length
    return length > 0 && length < 100
}
