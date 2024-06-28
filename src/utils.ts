import { type Cheerio, type Element } from 'cheerio'
import { isElementWithoutContent } from './textUtils.js'
import { removeAndGetNext } from './dom.js'
import { getNextNode } from './dom.js'
import { hasContent } from './regexes.js'

// prettier-ignore
export const DIV_TO_P_ELEMS = new Set([ 'blockquote', 'dl', 'div', 'img', 'ol', 'p', 'pre', 'table', 'ul', ])
const TAGS_TO_SIMPLIFY = new Set(['div', 'section'])

// tslint:disable-next-line
export function isDataTable(t: any) {
    return t._readabilityDataTable
}

/**
 * Determine whether element has any children block level elements.
 */
export function hasChildBlockElement(element: Element): boolean {
    if (!element.childNodes) return false

    return element.childNodes.some((node) => {
        if (node.type !== 'tag') return false

        return DIV_TO_P_ELEMS.has(node.tagName) || hasChildBlockElement(node)
    })
}

export function isProbablyVisible($node: Cheerio<Element>) {
    if ($node.attr('aria-modal') === 'true') return false
    if ($node.attr('role') === 'dialog') return false
    if ($node.attr('hidden')) return false

    const style = $node.prop('style')
    if (style && style.display === 'none') return false
    if (style && style.visibility === 'hidden') return false

    const ariaHidden = $node.attr('aria-hidden')

    // check for "fallback-image" so that wikimedia math images are displayed
    const isFallbackImage = $node.attr('class')?.includes('fallback-image')
    if (ariaHidden && ariaHidden === 'true' && !isFallbackImage) return false

    return true
}

/**
 * Check if this node has only whitespace and a single element with given tag
 * Returns false if the DIV node contains non-empty text nodes
 * or if it contains no element with given tag or more than 1 element.
 **/
export function hasSingleTagInsideElement(element: Element, tag: string) {
    // There should be exactly 1 element child with given tag
    const elementChildren = element.children.filter((el) => el.type === 'tag')
    if (
        elementChildren.length !== 1 ||
        (elementChildren[0] as Element).tagName !== tag // TODO: Remove type assertion when we upgrade to TS 5.5
    ) {
        return false
    }

    // And there should be no text nodes with real content
    return !element.childNodes.some(
        (node) => node.type === 'text' && hasContent.test(node.data),
    )
}

export function simplifyNestedElements($articleContent: Cheerio<Element>) {
    let $node: Cheerio<Element> | null = $articleContent

    while ($node?.length) {
        const node = $node[0]!
        const id = $node.attr('id')

        if (
            node.parentNode &&
            node.parentNode.type === 'tag' &&
            TAGS_TO_SIMPLIFY.has(node.tagName) &&
            !(id && id.startsWith('readability'))
        ) {
            if (isElementWithoutContent($node)) {
                $node = removeAndGetNext($node)
                continue
            } else if (
                hasSingleTagInsideElement(node, 'div') ||
                hasSingleTagInsideElement(node, 'section')
            ) {
                const $child = $node.children().first()
                Object.entries(node.attribs).forEach(([key, value]) => {
                    $child.attr(key, value)
                })
                $node.replaceWith($child)

                $node = $child
                continue
            }
        }

        $node = getNextNode($node)
    }
}
