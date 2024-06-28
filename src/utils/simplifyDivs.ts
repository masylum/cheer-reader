import type { Cheerio, CheerioAPI, Element } from 'cheerio'
import { isPhrasingContent } from '../isPhrasingContent.js'
import { isWhitespace } from '../textUtils.js'

export function simplifyDivs($: CheerioAPI, node: Element) {
    let $p: Cheerio<Element> | null = null
    let childNode = node.firstChild

    while (childNode) {
        const nextSibling = childNode.nextSibling

        if (isPhrasingContent(childNode)) {
            if ($p !== null) {
                $p.append(childNode)
            } else if (!isWhitespace($(childNode))) {
                $p = $('<p></p>') as Cheerio<Element>
                $(childNode).replaceWith($p)
                $p.append(childNode)
            }
        } else if ($p !== null) {
            const $lastChild = $p.last()
            while ($lastChild.length && isWhitespace($lastChild)) {
                $lastChild.remove()
            }
            $p = null
        }

        childNode = nextSibling
    }
}
