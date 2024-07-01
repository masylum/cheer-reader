import type { Cheerio, Element } from 'cheerio'
import { getNextNode } from '../dom.js'

export type Candidate = Element & {
    contentScore: number
}

/**
 * Clean out elements that match the specified conditions
 **/
export function moveContentScoreToData($el: Cheerio<Element>) {
    let $next = getNextNode($el)

    while ($next?.length) {
        const next = $next[0]! as Candidate

        if (next.contentScore) {
            $next.attr('data-score', `${next.contentScore}`)
        }

        $next = getNextNode($next)
    }
}
