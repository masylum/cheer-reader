import { type AnyNode } from 'cheerio'

const alwaysTrue = () => true

/**
 * Check if a given node has one of its ancestor tag name matching the
 * provided one.
 */
export function hasAncestorTag(
    node: AnyNode,
    tagName: string,
    maxDepth: number = 3,
    filterFn: (node: AnyNode) => boolean = alwaysTrue,
) {
    let depth = 0

    while (node.parentNode) {
        const parentNode = node.parentNode
        if (maxDepth > 0 && depth > maxDepth) return false
        if (
            parentNode.type === 'tag' &&
            parentNode.tagName === tagName &&
            filterFn(node.parentNode)
        ) {
            return true
        }

        node = parentNode
        depth++
    }

    return false
}

export function getNodeAncestors(node: AnyNode | null, maxDepth: number = 0) {
    if (!node) return []

    let i = 0
    const ancestors: AnyNode[] = []

    while (node.parentNode) {
        ancestors.push(node.parentNode)
        if (maxDepth && ++i === maxDepth) break
        node = node.parentNode
    }

    return ancestors
}
