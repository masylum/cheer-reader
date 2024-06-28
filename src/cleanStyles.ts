import { type AnyNode, type Element } from 'cheerio'

// prettier-ignore
const PRESENTATIONAL_ATTRIBUTES = ['align', 'background', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'frame', 'hspace', 'rules', 'style', 'valign', 'vspace']
// prettier-ignore
const DEPRECATED_SIZE_ATTRIBUTE_ELEMS = new Set([ 'table', 'th', 'td', 'hr', 'pre' ])

/**
 * Remove the style attribute on every e and under.
 **/
export function cleanStyles(el: Element) {
    if (!el || el.tagName === 'svg') return

    // Remove `style` and deprecated presentational attributes
    PRESENTATIONAL_ATTRIBUTES.forEach((attr) => {
        delete el.attribs[attr]
    })

    if (!DEPRECATED_SIZE_ATTRIBUTE_ELEMS.has(el.tagName)) {
        delete el.attribs.width
        delete el.attribs.height
    }

    let cur: AnyNode | null = el.children.find((e) => e.type === 'tag') || null
    while (cur) {
        if (cur.type === 'tag') cleanStyles(cur)
        cur = cur.nextSibling
    }
}
