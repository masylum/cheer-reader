import {
    type CheerioAPI,
    type Cheerio,
    type Element,
    type AnyNode,
} from 'cheerio'
import { hashUrl, tokenize, normalize } from './regexes.js'

/**
 * Count the words for a given string.
 **/
export function wordCount(str: string) {
    return str.split(/\s+/).length
}

/**
 * Get the density of links as a percentage of the content
 * This is the amount of text that is inside a link divided by the total text in the node.
 **/
export function getLinkDensity($: CheerioAPI, $element: Cheerio<Element>) {
    const textLength = getInnerText($element).length
    if (textLength === 0) return 0

    let linkLength = 0

    $element.find('a').each((_, linkNode) => {
        const $linkNode = $(linkNode)
        const href = $linkNode.attr('href')
        const coefficient = href && hashUrl.test(href) ? 0.3 : 1
        linkLength += getInnerText($linkNode).length * coefficient
    })

    return linkLength / textLength
}

/**
 * Get the inner text of a node - cross browser compatibly.
 * This also strips out any excess whitespace to be found.
 **/
export function getInnerText(
    $element: Cheerio<AnyNode>,
    normalizeSpaces: boolean = true,
) {
    const textContent = $element.text().trim()

    if (normalizeSpaces) {
        return textContent.replace(normalize, ' ')
    }

    return textContent
}

export function isWhitespace($element: Cheerio<AnyNode>) {
    return getInnerText($element).length === 0 || $element.is('br')
}

export function isElementWithoutContent($element: Cheerio<Element>) {
    // Check if the element has no text content (ignoring whitespace)
    const hasNoText = $element.text().trim().length === 0

    // Check if the element has no children or only <br> or <hr> tags as children
    const children = $element.children()
    const brCount = $element.find('br').length
    const hrCount = $element.find('hr').length
    const hasOnlyBrOrHr = children.length === brCount + hrCount

    return hasNoText && (children.length === 0 || hasOnlyBrOrHr)
}

/**
 * Compares second text to first one
 *
 * 1 = same text, 0 = completely different text
 * works the way that it splits both texts into words and then finds words that are unique in second text
 * the result is given by the lower length of unique parts
 * */
export function textSimilarity(textA: string, textB: string) {
    const tokensA = textA.toLowerCase().split(tokenize).filter(Boolean)
    const tokensB = textB.toLowerCase().split(tokenize).filter(Boolean)

    if (!tokensA.length || !tokensB.length) {
        return 0
    }

    const uniqTokensB = tokensB.filter((token) => !tokensA.includes(token))
    const distanceB = uniqTokensB.join(' ').length / tokensB.join(' ').length

    return 1 - distanceB
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
