import { type AnyNode, type CheerioAPI } from 'cheerio'
import { nextNode } from './dom.js'
import { isPhrasingContent } from './isPhrasingContent.js'
import { isWhitespace } from './textUtils.js'

/**
 * Replaces 2 or more successive <br> elements with a single <p>.
 *
 *  Whitespace between <br> elements are ignored. For example:
 *    <div>foo<br>bar<br> <br><br>abc</div>
 *
 *  will become:
 *    <div>foo<br>bar<p>abc</p></div>
 */
export function replaceBrs($: CheerioAPI) {
    $('br').each((_, br) => {
        const $br = $(br)
        let next: AnyNode | null = br.nextSibling

        // Whether 2 or more <br> elements have been found and replaced with a
        // <p> block.
        let replaced = false

        // If we find a <br> chain, remove the <br>s until we hit another node
        // or non-whitespace. This leaves behind the first <br> in the chain
        // (which will be replaced with a <p> later).
        next = nextNode(next)
        while (next && next.type === 'tag' && next.tagName === 'br') {
            replaced = true
            const brSibling = next.nextSibling
            $(next).remove()
            next = nextNode(brSibling)
        }

        if (!replaced) return

        // If we removed a <br> chain, replace the remaining <br> with a <p>. Add
        // all sibling nodes as children of the <p> until we hit another <br>
        // chain.
        const $p = $('<p></p>')
        $br.replaceWith($p)
        const p = $p[0]!

        next = p.nextSibling
        while (next) {
            // If we've hit another <br><br>, we're done adding children to this <p>.
            if (next.type === 'tag' && next.tagName === 'br') {
                const nextElem = nextNode(next.nextSibling)

                if (
                    nextElem &&
                    nextElem.type === 'tag' &&
                    nextElem.tagName === 'br'
                ) {
                    break
                }
            }

            if (!isPhrasingContent(next)) break

            // Otherwise, make this node a child of the new <p>.
            const sibling = next.nextSibling
            $p.append(next)
            next = sibling
        }

        if (p.type === 'tag') {
            while (p.lastChild && isWhitespace($(p.lastChild))) {
                $(p.lastChild).remove()
            }
        }

        const parentNode = p.parentNode
        if (
            parentNode &&
            parentNode.type === 'tag' &&
            parentNode.tagName === 'p'
        ) {
            parentNode.tagName = 'div'
        }
    })
}
