// The commented out elements qualify as phrasing content but tend to be
// removed by readability when put into paragraphs, so we ignore them here.

import { type AnyNode } from 'cheerio'

// prettier-ignore
const PHRASING_ELEMS = new Set([
    // "CANVAS", "IFRAME", "SVG", "VIDEO",
    'abbr', 'audio', 'b', 'bdo', 'br', 'button', 'cite', 'code', 'data', 'datalist', 'dfn', 'em', 'embed', 'i',
    'img', 'input', 'kbd', 'label', 'mark', 'math', 'meter', 'noscript', 'object', 'output', 'progress', 'q',
    'ruby', 'samp', 'script', 'select', 'small', 'span', 'strong', 'sub', 'sup', 'textarea', 'time', 'var', 'wbr',
])
const PARENT_PHRASING_ELEMS = new Set(['a', 'del', 'ins'])

/***
 * Determine if a node qualifies as phrasing content.
 * https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/Content_categories#Phrasing_content
 **/
export function isPhrasingContent(node: AnyNode) {
    if (node.type === 'text') return true
    if (node.type !== 'tag') return false
    if (PHRASING_ELEMS.has(node.tagName)) return true

    return (
        PARENT_PHRASING_ELEMS.has(node.tagName) &&
        node.children.every(isPhrasingContent)
    )
}
