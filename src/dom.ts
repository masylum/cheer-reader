import { type Cheerio, type Element, type AnyNode } from 'cheerio'
import { removeElement } from 'domutils'

import { whitespace } from './regexes.js'

const alwaysTrue = () => true

export function removeNodes(
    $coll: Cheerio<Element>,
    fn: (el: Cheerio<Element>) => boolean = alwaysTrue,
) {
    for (let i = $coll.length - 1; i >= 0; i--) {
        const $node = $coll.eq(i)
        if (fn($node)) $node.remove()
    }
}

export function removeComments(node: AnyNode) {
    if ((node.type === 'tag' || node.type === 'root') && node.children) {
        for (let i = node.children.length - 1; i >= 0; i--) {
            removeComments(node.children[i]!)
        }
    } else if (
        node.type === 'comment' ||
        node.type === 'directive' ||
        node.type === 'cdata'
    ) {
        return removeElement(node)
    }
}

/**
 * Finds the next node, starting from the given node, and ignoring
 * whitespace in between. If the given node is an element, the same node is
 * returned.
 */
export function nextNode(node: AnyNode | null) {
    let next: AnyNode | null = node

    while (next && next.type === 'text' && whitespace.test(next.data)) {
        next = next.nextSibling
    }

    return next as Element | null
}

/**
 * Traverse the DOM from node to node, starting at the node passed in.
 * Pass true for the second parameter to indicate this node itself
 * (and its kids) are going away, and we want the next node over.
 *
 * Calling this in a loop will traverse the DOM depth-first.
 */
export function getNextNode(
    $node: Cheerio<AnyNode>,
    ignoreSelfAndKids: boolean = false,
) {
    // First check for kids if those aren't being ignored
    const $firstChild = $node.children().first()
    if (!ignoreSelfAndKids && $firstChild.length) return $firstChild

    // Then for siblings...
    const $next = $node.next()
    if ($next.length) return $next

    // And finally, move up the parent chain *and* find a sibling
    // (because this is depth-first traversal, we will have already
    // seen the parent nodes themselves).
    let $parent = $node.parent()
    while ($parent.length) {
        if ($parent.next().length) {
            return $parent.next()
        }
        $parent = $parent.parent()
    }

    return null
}

export function removeAndGetNext($node: Cheerio<Element>) {
    const $next = getNextNode($node, true)
    $node.remove()
    return $next
}

/**
 * Clean out elements that match the specified conditions
 **/
export function cleanMatchedNodes(
    $el: Cheerio<Element>,
    filter: (el: Cheerio<Element>) => boolean,
) {
    const $endOfSearchMarkerNode = getNextNode($el, true)
    let $next = getNextNode($el)

    while ($next && $next.length && $next !== $endOfSearchMarkerNode) {
        if (filter($next)) {
            $next = removeAndGetNext($next)
        } else {
            $next = getNextNode($next)
        }
    }
}

/**
 * Iterates over a NodeList, and calls setNodeTag for each node.
 */
export function replaceNodeTags(elements: Element[], tag: string) {
    elements.forEach((node) => {
        node.tagName = tag
    })
}
