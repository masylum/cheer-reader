import {
    commas,
    b64DataUrl,
    videos,
    loadingWords,
    negative,
    adWords,
    positive,
    jsonLdArticleTypes,
    okMaybeItsACandidate,
    unlikelyCandidates,
    srcsetUrl,
    byline,
    normalize,
    shareElements,
} from './regexes.js'
import {
    type CheerioAPI,
    type Element,
    type Cheerio,
    type AnyNode,
} from 'cheerio'
import { cleanStyles } from './cleanStyles.js'
import {
    hasChildBlockElement,
    simplifyNestedElements,
    isDataTable,
    isProbablyVisible,
    hasSingleTagInsideElement,
    DIV_TO_P_ELEMS,
} from './utils.js'
import { tagToString } from './tagToString.js'
import { isPhrasingContent } from './isPhrasingContent.js'
import { unescapeHtmlEntities } from './unescapeHtmlEntities.js'
import { hasAncestorTag, getNodeAncestors } from './ancestors.js'
import {
    removeNodes,
    getNextNode,
    removeAndGetNext,
    replaceNodeTags,
    nextNode,
    removeComments,
    cleanMatchedNodes,
} from './dom.js'
import { replaceBrs } from './replaceBrs.js'
import {
    getLinkDensity,
    textSimilarity,
    getInnerText,
    isValidByline,
    wordCount,
    isElementWithoutContent,
} from './textUtils.js'
import { simplifyDivs } from './utils/simplifyDivs.js'

const FLAG_STRIP_UNLIKELYS = 0x1
const FLAG_WEIGHT_CLASSES = 0x2
const FLAG_CLEAN_CONDITIONALLY = 0x4

// Max number of nodes supported by this parser. Default: 0 (no limit)
const DEFAULT_MAX_ELEMS_TO_PARSE = 0

// The number of top candidates to consider when analysing how
// tight the competition is among candidates.
const DEFAULT_N_TOP_CANDIDATES = 5

// Element tags to score by default.
// prettier-ignore
const DEFAULT_TAGS_TO_SCORE = new Set([ 'section', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'td', 'pre' ])

// The default number of chars an article must have in order to return a result
const DEFAULT_CHAR_THRESHOLD = 500

// prettier-ignore
const UNLIKELY_ROLES = new Set(['menu', 'menubar', 'complementary', 'navigation', 'alert', 'alertdialog', 'dialog'])

// prettier-ignore
const EMPTY_TAGS = new Set(['div', 'section', 'header', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

// prettier-ignore
const ALTER_TO_DIV_EXCEPTIONS = new Set(['div', 'article', 'section', 'p'])

// These are the classes that readability sets itself.
const CLASSES_TO_PRESERVE = ['page']

type Options = {
    debug: boolean
    maxElemsToParse: number
    nbTopCandidates: number
    charThreshold: number
    keepClasses: boolean
    classesToPreserve: string[]
    serializer: (el: Cheerio<Element> | null) => string | null
    disableJSONLD: boolean
    allowedVideoRegex: RegExp
    linkDensityModifier: number
    extraction: boolean
    baseURI?: string
}

type Metadata = {
    title?: string | null
    byline?: string | null
    excerpt?: string | null
    siteName?: string | null
    publishedTime?: string | null
    datePublished?: string | null
}

/**
 * The object that `parse` returns.
 *
 * It contains some metadata, and if the `extraction` option is set to `true` (default),
 * it also contains the extracted content.
 */
export type ReadabilityResult = {
    title: string | null
    byline: string | null
    dir: string | null
    lang: string | null
    content: string | null
    textContent: string | null
    length: number | null
    excerpt: string | null
    siteName: string | null
    publishedTime: string | null
}

const DEFAULT_OPTIONS: Options = {
    debug: false,
    maxElemsToParse: DEFAULT_MAX_ELEMS_TO_PARSE,
    nbTopCandidates: DEFAULT_N_TOP_CANDIDATES,
    charThreshold: DEFAULT_CHAR_THRESHOLD,
    classesToPreserve: CLASSES_TO_PRESERVE,
    keepClasses: false,
    serializer: ($el) => $el?.html() || null,
    disableJSONLD: false,
    allowedVideoRegex: videos,
    linkDensityModifier: 0,
    extraction: true,
}

type Candidate = Element & {
    contentScore: number
}

/**
 * Readability is the main class of the library.
 *
 * It exposes a single method, `parse`, which takes an HTML string and returns
 * an object containing the extracted content.
 */
export class Readability {
    private $: CheerioAPI
    private options: Options
    private articleTitle: string | null = null
    private articleByline: string | null = null
    private articleDir: string | null = null
    private articleLang: string | null = null
    private attempts: any[] = []
    private flags: number =
        FLAG_STRIP_UNLIKELYS | FLAG_WEIGHT_CLASSES | FLAG_CLEAN_CONDITIONALLY

    constructor($: CheerioAPI, options: Partial<Options> = {}) {
        if (!$) {
            throw new Error(
                'First argument to Readability constructor is mandatory.',
            )
        }
        this.$ = $
        this.options = { ...DEFAULT_OPTIONS, ...options }
    }

    log(...args: any[]) {
        if (!this.options.debug) return
        console.log(...args)
    }

    private postProcessContent($articleContent: Cheerio<Element> | null) {
        if (!$articleContent) return

        // Readability cannot open relative uris so we convert them to absolute uris.
        this.fixRelativeUris($articleContent)

        simplifyNestedElements($articleContent)

        if (!this.options.keepClasses) {
            this.cleanClasses($articleContent)
        }
    }

    /**
     * Removes the class="" attribute from every element in the given
     * subtree, except those that match the classesToPreserve array
     * from the options object.
     */
    private cleanClasses($el: Cheerio<Element>) {
        const classesToPreserve = this.options.classesToPreserve
        const className = ($el.attr('class') || '')
            .split(/\s+/)
            .filter((cls) => classesToPreserve.includes(cls))
            .join(' ')

        if (className) {
            $el.attr('class', className)
        } else {
            $el.removeAttr('class')
        }

        $el.children().each((_, child) => {
            this.cleanClasses(this.$(child))
        })
    }

    /**
     * Converts each <a> and <img> uri in the given element to an absolute URI,
     * ignoring #ref URIs.
     */
    private fixRelativeUris($articleContent: Cheerio<Element>) {
        const $ = this.$

        $articleContent.find('a').each((_, link) => {
            const $link = $(link)
            const href = $link.prop('href') // resolves to absolute if baseURI is set
            if (!href) return

            if (!href.includes('javascript:')) {
                $link.attr('href', href)
                return
            }
            // Remove links with javascript: URIs, since
            // they won't work after scripts have been removed from the page.
            // if the link only contains simple text content, it can be converted to a text node
            const childNodes = link.childNodes
            if (childNodes.length === 1 && childNodes[0]?.type === 'text') {
                $link.replaceWith($link.text())
            } else {
                // if the link has multiple children, they should all be preserved
                const $span = $('<span></span>')
                $span.append(link.children)
                $link.replaceWith($span)
            }
        })

        $articleContent
            .find('img, picture, figure, video, audio, source')
            .each((_, media) => {
                const $media = $(media)
                const src = $media.prop('src')
                const poster = $media.prop('poster')
                const srcset = $media.prop('srcset')

                if (src) $media.attr('src', src)
                if (poster) $media.attr('poster', poster)

                const baseURI = this.options.baseURI
                if (!baseURI || !srcset) return

                const newSrcset = srcset.replace(srcsetUrl, (_, p1, p2, p3) => {
                    return (
                        new URL(p1, this.options.baseURI).href + (p2 || '') + p3
                    )
                })

                $media.attr('srcset', newSrcset)
            })
    }

    private getArticleTitle() {
        let curTitle = ''
        let origTitle = ''

        try {
            curTitle = origTitle = getInnerText(this.$('title'))
        } catch (e) {
            /* ignore exceptions setting the title. */
        }

        let titleHadHierarchicalSeparators = false

        // If there's a separator in the title, first remove the final part
        if (/ [|\-\\/>»] /.test(curTitle)) {
            titleHadHierarchicalSeparators = / [\\/>»] /.test(curTitle)
            curTitle = origTitle.replace(/(.*)[|\-\\/>»] .*/gi, '$1')

            // If the resulting title is too short (3 words or fewer), remove
            // the first part instead:
            if (wordCount(curTitle) < 3)
                curTitle = origTitle.replace(
                    /[^|\-\\/>»]*[|\-\\/>»](.*)/gi,
                    '$1',
                )
        } else if (curTitle.indexOf(': ') !== -1) {
            // Check if we have an heading containing this exact string, so we
            // could assume it's the full title.
            const match = this.$('h1, h2')
                .toArray()
                .some((heading) => this.$(heading).text().trim() === curTitle)

            // If we don't, let's extract the title out of the original title string.
            if (!match) {
                curTitle = origTitle.substring(origTitle.lastIndexOf(':') + 1)

                // If the title is now too short, try the first colon instead:
                if (wordCount(curTitle) < 3) {
                    curTitle = origTitle.substring(origTitle.indexOf(':') + 1)
                    // But if we have too many words before the colon there's something weird
                    // with the titles and the H tags so let's just use the original title instead
                } else if (
                    wordCount(origTitle.substr(0, origTitle.indexOf(':'))) > 5
                ) {
                    curTitle = origTitle
                }
            }
        } else if (curTitle.length > 150 || curTitle.length < 15) {
            const $hOnes = this.$('h1')

            if ($hOnes.length === 1) curTitle = getInnerText($hOnes.eq(0))
        }

        curTitle = curTitle.trim().replace(normalize, ' ')
        // If we now have 4 words or fewer as our title, and either no
        // 'hierarchical' separators (\, /, > or ») were found in the original
        // title or we decreased the number of words by more than 1 word, use
        // the original title.
        const curTitleWordCount = wordCount(curTitle)
        if (
            curTitleWordCount <= 4 &&
            (!titleHadHierarchicalSeparators ||
                curTitleWordCount !=
                    wordCount(origTitle.replace(/[|\-\\/>»]+/g, '')) - 1)
        ) {
            curTitle = origTitle
        }

        return curTitle
    }

    private prepArticle($articleContent: Cheerio<Element>) {
        cleanStyles($articleContent[0]!)

        // Check for data tables before we continue, to avoid removing items in
        // those tables, which will often be isolated even though they're
        // visually linked to other content-ful elements (text, images, etc.).
        this.markDataTables($articleContent)

        this.fixLazyImages($articleContent)

        // Clean out junk from the article content
        this.cleanConditionally($articleContent, 'form')
        this.cleanConditionally($articleContent, 'fieldset')
        this.clean($articleContent, 'object')
        this.clean($articleContent, 'embed')
        this.clean($articleContent, 'footer')
        this.clean($articleContent, 'link')
        this.clean($articleContent, 'aside')

        // Clean out elements with little content that have "share" in their id/class combinations from final top candidates,
        // which means we don't remove the top candidates even they have "share".
        const shareElementThreshold = DEFAULT_CHAR_THRESHOLD

        $articleContent.children().each((_, childNode) => {
            cleanMatchedNodes(this.$(childNode), ($node) => {
                const matchString = [
                    $node.attr('class'),
                    $node.attr('id'),
                ].join(' ')
                return (
                    shareElements.test(matchString) &&
                    $node.text().length < shareElementThreshold
                )
            })
        })

        this.clean($articleContent, 'iframe')
        this.clean($articleContent, 'input')
        this.clean($articleContent, 'textarea')
        this.clean($articleContent, 'select')
        this.clean($articleContent, 'button')
        this.cleanHeaders($articleContent)

        // Do these last as the previous stuff may have removed junk
        // that will affect these
        this.cleanConditionally($articleContent, 'table')
        this.cleanConditionally($articleContent, 'ul')
        this.cleanConditionally($articleContent, 'div')

        // replace H1 with H2 as H1 should be only title that is displayed separately
        replaceNodeTags($articleContent.find('h1').toArray(), 'h2')

        // Remove extra paragraphs
        removeNodes($articleContent.find('p'), ($node) => {
            const imgCount = $node.find('img').length
            const embedCount = $node.find('embed').length
            const objectCount = $node.find('object').length

            // At this point, nasty iframes have been removed, only remain embedded video ones.
            const iframeCount = $node.find('iframe').length
            const totalCount = imgCount + embedCount + objectCount + iframeCount

            return totalCount === 0 && !getInnerText($node, false)
        })

        $articleContent.find('br').each((_, br) => {
            const $br = this.$(br)
            const next = nextNode(br.nextSibling)
            if (next?.tagName == 'p') $br.remove()
        })

        // Remove single-cell tables
        $articleContent.find('table').each((_, node) => {
            const $node = this.$(node)
            const $tbody = hasSingleTagInsideElement(node, 'tbody')
                ? $node.children().first()
                : $node
            if (!hasSingleTagInsideElement($tbody[0]!, 'tr')) return

            const $row = $tbody.children().first()
            if (!hasSingleTagInsideElement($row[0]!, 'td')) return

            const cell = $row.children().first()[0]!
            const tag = cell.childNodes.every(isPhrasingContent) ? 'p' : 'div'
            cell.tagName = tag

            $node.replaceWith(cell)
        })
    }

    private checkByline($node: Cheerio<Element>, matchString: string) {
        if (this.articleByline) return false

        const isAuthor = $node.attr('rel') === 'author'
        const hasAuthorItemprop = $node.attr('itemprop')?.includes('author')
        const bylineMatch = byline.test(matchString)

        if (
            (isAuthor || hasAuthorItemprop || bylineMatch) &&
            isValidByline($node.text())
        ) {
            this.articleByline = getInnerText($node)
            return true
        }

        return false
    }

    private grabArticle() {
        const $ = this.$

        this.log('**** grabArticle ****')
        const $page = $('body')

        // We can't grab an article if we don't have a page!
        if (!$page) {
            this.log('No body found in document. Abort.')
            return null
        }

        const pageCacheHtml = $page.html() as string

        // tslint:disable-next-line
        while (true) {
            this.log('Starting grabArticle loop')
            const stripUnlikelyCandidates =
                this.flagIsActive(FLAG_STRIP_UNLIKELYS)

            // First, node prepping. Trash nodes that look cruddy (like ones with the
            // class name "comment", etc), and turn divs into P tags where they have been
            // used inappropriately (as in, where they contain no other block level elements.)
            const elementsToScore: Cheerio<Element>[] = []
            let shouldRemoveTitleHeader = true
            let $node = getNextNode($.root())

            while ($node?.length) {
                const node = $node[0]!

                if (node.tagName === 'html') {
                    this.articleLang = $node.attr('lang') || null
                }

                const matchString = [$node.attr('class'), $node.attr('id')]
                    .filter(Boolean)
                    .join(' ')

                if (!isProbablyVisible($node)) {
                    this.log('Removing hidden node', tagToString(node))
                    $node = removeAndGetNext($node)
                    continue
                }

                // Check to see if this node is a byline, and remove it if it is.
                if (this.checkByline($node, matchString)) {
                    this.log('Removing byline', tagToString(node))
                    $node = removeAndGetNext($node)
                    continue
                }

                if (
                    shouldRemoveTitleHeader &&
                    this.headerDuplicatesTitle($node)
                ) {
                    this.log('Removing header', tagToString(node))
                    shouldRemoveTitleHeader = false
                    $node = removeAndGetNext($node)
                    continue
                }

                // Remove unlikely candidates
                if (stripUnlikelyCandidates) {
                    if (
                        unlikelyCandidates.test(matchString) &&
                        !okMaybeItsACandidate.test(matchString) &&
                        !hasAncestorTag(node, 'table') &&
                        !hasAncestorTag(node, 'code') &&
                        node.tagName !== 'body' &&
                        node.tagName !== 'a'
                    ) {
                        this.log(
                            'Removing unlikely candidate',
                            tagToString(node),
                        )
                        $node = removeAndGetNext($node)
                        continue
                    }

                    const role = $node.attr('role')
                    if (role && UNLIKELY_ROLES.has(role)) {
                        this.log(
                            `Removing content with role ${role}`,
                            tagToString(node),
                        )
                        $node = removeAndGetNext($node)
                        continue
                    }
                }

                // Remove DIV, SECTION, and HEADER nodes without any content(e.g. text, image, video, or iframe).
                if (
                    EMPTY_TAGS.has(node.tagName) &&
                    isElementWithoutContent($node)
                ) {
                    this.log(`Removing empty tag`, tagToString(node))
                    $node = removeAndGetNext($node)
                    continue
                }

                if (DEFAULT_TAGS_TO_SCORE.has(node.tagName)) {
                    elementsToScore.push($node)
                }

                if (node.tagName === 'div') {
                    simplifyDivs($, node)

                    // Sites like http://mobile.slate.com encloses each paragraph with a DIV
                    // element. DIVs with only a P element inside and no text content can be
                    // safely converted into plain P elements to avoid confusing the scoring
                    // algorithm with DIVs with are, in practice, paragraphs.
                    if (
                        hasSingleTagInsideElement($node[0]!, 'p') &&
                        getLinkDensity($, $node) < 0.25
                    ) {
                        const $newNode = $node.children().first()
                        $node.replaceWith($newNode)
                        $node = $newNode
                        elementsToScore.push($node)
                    } else if (!hasChildBlockElement(node)) {
                        node.tagName = 'p'
                        elementsToScore.push($node)
                    }
                }

                $node = getNextNode($node)
            }

            /**
             * Loop through all paragraphs, and assign a score to them based on how content-y they look.
             * Then add their score to their parent node.
             *
             * A score is determined by things like number of commas, class names, etc. Maybe eventually link density.
             **/
            const candidates: Candidate[] = []
            elementsToScore.forEach(($elementToScore) => {
                const el = $elementToScore[0]!
                const parentNode = el.parentNode
                if (!parentNode || parentNode.type !== 'tag') return

                // If this paragraph is less than 25 characters, don't even count it.
                const innerText = getInnerText($elementToScore)
                if (innerText.length < 25) return

                // Exclude nodes with no ancestor.
                const ancestors = getNodeAncestors(el, 5) as Candidate[]
                if (ancestors.length === 0) return

                let contentScore = 0

                // Add a point for the paragraph itself as a base.
                contentScore += 1

                // Add points for any commas within this paragraph.
                contentScore += innerText.split(commas).length

                // For every 100 characters in this paragraph, add another point. Up to 3 points.
                contentScore += Math.min(Math.floor(innerText.length / 100), 3)

                // Initialize and score ancestors.
                ancestors.forEach((ancestor, level) => {
                    if (
                        !ancestor.tagName ||
                        !ancestor.parentNode ||
                        ancestor.parentNode.type !== 'tag'
                    )
                        return

                    if (typeof ancestor.contentScore === 'undefined') {
                        this.addContentScore(ancestor)
                        candidates.push(ancestor)
                    }

                    // Node score divider:
                    // - parent:             1 (no division)
                    // - grandparent:        2
                    // - great grandparent+: ancestor level * 3
                    let scoreDivider: number

                    if (level === 0) scoreDivider = 1
                    else if (level === 1) scoreDivider = 2
                    else scoreDivider = level * 3

                    ancestor.contentScore += contentScore / scoreDivider
                })
            })

            // After we've calculated scores, loop through all of the possible
            // candidate nodes we found and find the one with the highest score.
            const topCandidates: Candidate[] = []
            for (let c = 0, cl = candidates.length; c < cl; c += 1) {
                const candidate = candidates[c]!

                // Scale the final candidates score based on link density. Good content
                // should have a relatively small link density (5% or less) and be mostly
                // unaffected by this operation.
                const candidateScore =
                    candidate.contentScore *
                    (1 - getLinkDensity($, $(candidate)))
                candidate.contentScore = candidateScore

                this.log(`Candidate: ${tagToString(candidate)}`, candidateScore)

                for (let t = 0; t < this.options.nbTopCandidates; t += 1) {
                    const aTopCandidate = topCandidates[t]

                    if (
                        !aTopCandidate ||
                        candidateScore > aTopCandidate.contentScore
                    ) {
                        topCandidates.splice(t, 0, candidate)
                        if (topCandidates.length > this.options.nbTopCandidates)
                            topCandidates.pop()
                        break
                    }
                }
            }

            let topCandidate = topCandidates[0] || null
            let neededToCreateTopCandidate = false
            let parentOfTopCandidate: AnyNode | Candidate | null

            // If we still have no top candidate, just use the body as a last resort.
            // We also have to copy the body node so it is something we can modify.
            if (topCandidate === null || topCandidate.tagName === 'body') {
                // Move all of the page's children into topCandidate
                const $topCandidate = $('<div></div>').append(
                    $page.contents(),
                ) as Cheerio<Element>
                $page.append($topCandidate)
                neededToCreateTopCandidate = true
                topCandidate = this.addContentScore(
                    $topCandidate[0] as Candidate,
                )
            } else if (topCandidate) {
                // Find a better top candidate node if it contains (at least three) nodes which belong to `topCandidates` array
                // and whose scores are quite closed with current `topCandidate` node.
                const alternativeCandidateAncestors: AnyNode[][] = []

                for (let i = 1; i < topCandidates.length; i++) {
                    const candidate = topCandidates[i]!
                    const threshold =
                        candidate.contentScore / topCandidate!.contentScore
                    if (threshold >= 0.75) {
                        alternativeCandidateAncestors.push(
                            getNodeAncestors(candidate),
                        )
                    }
                }

                const MINIMUM_TOPCANDIDATES = 3

                if (
                    alternativeCandidateAncestors.length >=
                    MINIMUM_TOPCANDIDATES
                ) {
                    parentOfTopCandidate = topCandidate.parentNode
                    while (
                        parentOfTopCandidate &&
                        parentOfTopCandidate.type === 'tag' &&
                        parentOfTopCandidate.tagName !== 'body'
                    ) {
                        let listsContainingThisAncestor = 0
                        for (
                            let ancestorIndex = 0;
                            ancestorIndex <
                                alternativeCandidateAncestors.length &&
                            listsContainingThisAncestor < MINIMUM_TOPCANDIDATES;
                            ancestorIndex++
                        ) {
                            listsContainingThisAncestor += Number(
                                alternativeCandidateAncestors[
                                    ancestorIndex
                                ]!.includes(parentOfTopCandidate),
                            )
                        }
                        if (
                            listsContainingThisAncestor >= MINIMUM_TOPCANDIDATES
                        ) {
                            topCandidate = this.addContentScore(
                                parentOfTopCandidate as Candidate,
                            )
                            break
                        }
                        parentOfTopCandidate = parentOfTopCandidate.parentNode
                    }
                }

                // Because of our bonus system, parents of candidates might have scores
                // themselves. They get half of the node. There won't be nodes with higher
                // scores than our topCandidate, but if we see the score going *up* in the first
                // few steps up the tree, that's a decent sign that there might be more content
                // lurking in other places that we want to unify in. The sibling stuff
                // below does some of that - but only if we've looked high enough up the DOM
                // tree.
                parentOfTopCandidate = topCandidate.parentNode
                let lastScore = topCandidate.contentScore
                // The scores shouldn't get too low.
                const scoreThreshold = lastScore / 3

                // TODO: DRY
                while (
                    parentOfTopCandidate &&
                    parentOfTopCandidate.type === 'tag' &&
                    parentOfTopCandidate.tagName !== 'body'
                ) {
                    if (!('contentScore' in parentOfTopCandidate)) {
                        parentOfTopCandidate = parentOfTopCandidate.parentNode
                        continue
                    }
                    const parentScore =
                        parentOfTopCandidate.contentScore as number
                    if (parentScore < scoreThreshold) break
                    if (parentScore > lastScore) {
                        // Alright! We found a better parent to use.
                        topCandidate = parentOfTopCandidate as Candidate
                        break
                    }
                    lastScore = parentScore
                    parentOfTopCandidate = parentOfTopCandidate.parentNode
                }

                // If the top candidate is the only child, use parent instead. This will help sibling
                // joining logic when adjacent content is actually located in parent's sibling node.
                parentOfTopCandidate = topCandidate.parentNode
                // TODO: DRY
                while (
                    parentOfTopCandidate &&
                    parentOfTopCandidate.type === 'tag' &&
                    parentOfTopCandidate.tagName != 'body' &&
                    $(parentOfTopCandidate).children().length == 1
                ) {
                    topCandidate = this.addContentScore(
                        parentOfTopCandidate as Candidate,
                    )
                    parentOfTopCandidate = topCandidate.parentNode
                }
            }

            // Now that we have the top candidate, look through its siblings for content
            // that might also be related. Things like preambles, content split by ads
            // that we removed, etc.
            let $articleContent = $('<div></div>') as Cheerio<Element>
            const siblingScoreThreshold = Math.max(
                10,
                topCandidate.contentScore * 0.2,
            )
            // Keep potential top candidate's parent node to try to get text direction of it later.
            parentOfTopCandidate = topCandidate.parentNode
            let siblings = parentOfTopCandidate
                ? $(parentOfTopCandidate).children()
                : []

            for (let s = 0, sl = siblings.length; s < sl; s++) {
                let append = false
                const sibling = siblings[s]!
                const $sibling = $(sibling)

                this.log(
                    `Looking at sibling node: ${tagToString(sibling)}`,
                    'contentScore' in sibling && sibling?.contentScore,
                )

                if (sibling === topCandidate) {
                    append = true
                } else {
                    let contentBonus = 0

                    // Give a bonus if sibling nodes and top candidates have the example same classname
                    if (
                        sibling.attribs.class === topCandidate.attribs.class &&
                        topCandidate.attribs.class?.length
                    )
                        contentBonus += topCandidate.contentScore * 0.2

                    if (
                        'contentScore' in sibling &&
                        (sibling.contentScore as number) + contentBonus >=
                            siblingScoreThreshold
                    ) {
                        append = true
                    } else if (sibling.tagName === 'p') {
                        const linkDensity = getLinkDensity($, $sibling)
                        const nodeContent = getInnerText($sibling)
                        const nodeLength = nodeContent.length

                        if (nodeLength > 80 && linkDensity < 0.25) {
                            append = true
                        } else if (
                            nodeLength < 80 &&
                            nodeLength > 0 &&
                            linkDensity === 0 &&
                            nodeContent.search(/\.( |$)/) !== -1
                        ) {
                            append = true
                        }
                    }
                }

                if (append) {
                    this.log(`Appending node: ${tagToString(sibling)}`)

                    if (!ALTER_TO_DIV_EXCEPTIONS.has(sibling.tagName)) {
                        // We have a node that isn't a common block level element, like a form or td tag.
                        // Turn it into a div so it doesn't get filtered out later by accident.
                        this.log(
                            'Altering sibling:',
                            tagToString(sibling),
                            'to div.',
                        )
                        sibling.tagName = 'div'
                    }

                    $articleContent.append(sibling)
                    // Fetch children again to make it compatible
                    // with DOM parsers without live collection support.
                    siblings = parentOfTopCandidate
                        ? $(parentOfTopCandidate).children()
                        : []
                    // siblings is a reference to the children array, and
                    // sibling is removed from the array when we call appendChild().
                    // As a result, we must revisit this index since the nodes
                    // have been shifted.
                    s -= 1
                    sl -= 1
                }
            }

            this.log('Article content pre-prep: ' + $articleContent.html())

            // So we have all of the content that we need. Now we clean it up for presentation.
            this.prepArticle($articleContent)
            this.log('Article content post-prep: ' + $articleContent.html())

            if (neededToCreateTopCandidate) {
                // We already created a fake div thing, and there wouldn't have been any siblings left
                // for the previous loop, so there's no point trying to create a new div, and then
                // move all the children over. Just assign IDs and class names here. No need to append
                // because that already happened anyway.
                $(topCandidate).attr('id', 'readability-page-1')
                $(topCandidate).attr('class', 'page')
            } else {
                const $div = $('<div></div>')
                $div.attr('id', 'readability-page-1')
                $div.attr('class', 'page')

                $articleContent.contents().each(function (_, node) {
                    $div.append($(node))
                })

                $articleContent.append($div)
            }

            this.log('Article content after paging: ' + $articleContent.html())

            let parseSuccessful = true

            // Now that we've gone through the full algorithm, check to see if
            // we got any meaningful content. If we didn't, we may need to re-run
            // grabArticle with different flags set. This gives us a higher likelihood of
            // finding the content, and the sieve approach gives us a higher likelihood of
            // finding the -right- content.
            const textLength = getInnerText($articleContent, true).length
            if (textLength < this.options.charThreshold) {
                parseSuccessful = false
                $page.html(pageCacheHtml)

                if (this.flagIsActive(FLAG_STRIP_UNLIKELYS)) {
                    this.removeFlag(FLAG_STRIP_UNLIKELYS)
                    this.attempts.push({
                        articleContent: $articleContent,
                        textLength,
                    })
                } else if (this.flagIsActive(FLAG_WEIGHT_CLASSES)) {
                    this.removeFlag(FLAG_WEIGHT_CLASSES)
                    this.attempts.push({
                        articleContent: $articleContent,
                        textLength,
                    })
                } else if (this.flagIsActive(FLAG_CLEAN_CONDITIONALLY)) {
                    this.removeFlag(FLAG_CLEAN_CONDITIONALLY)
                    this.attempts.push({
                        articleContent: $articleContent,
                        textLength,
                    })
                } else {
                    this.attempts.push({
                        articleContent: $articleContent,
                        textLength,
                    })
                    // No luck after removing flags, just return the longest text we found during the different loops
                    this.attempts.sort(function (a, b) {
                        return b.textLength - a.textLength
                    })

                    // But first check if we actually have something
                    if (!this.attempts[0].textLength) {
                        return null
                    }

                    $articleContent = this.attempts[0].articleContent
                    parseSuccessful = true
                }
            }

            if (parseSuccessful) {
                // Find out text direction from ancestors of final top candidate.
                const ancestors = [
                    parentOfTopCandidate,
                    topCandidate as AnyNode,
                ].concat(getNodeAncestors(parentOfTopCandidate))

                ancestors.some((ancestor) => {
                    if (!ancestor) return false
                    if (ancestor.type !== 'tag') return false

                    const articleDir = ancestor.attribs.dir
                    if (articleDir) {
                        this.articleDir = articleDir
                        return true
                    }

                    return false
                })

                return $articleContent
            }
        }
    }

    private getJSONLD(): Metadata {
        let metadata: Metadata | null = null

        this.$('script[type="application/ld+json"]').each((_, element) => {
            try {
                const $el = this.$(element)
                const content = $el
                    .text()
                    .replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')

                let parsed = JSON.parse(content)

                if (
                    !parsed['@context'] ||
                    !parsed['@context'].match(/^https?:\/\/schema\.org\/?$/)
                ) {
                    return
                }

                if (!parsed['@type'] && Array.isArray(parsed['@graph'])) {
                    parsed = parsed['@graph'].find((it) =>
                        (it['@type'] || '').match(jsonLdArticleTypes),
                    )
                }

                if (
                    !parsed ||
                    !parsed['@type'] ||
                    !parsed['@type'].match(jsonLdArticleTypes)
                ) {
                    return
                }

                metadata = {}

                if (
                    typeof parsed.name === 'string' &&
                    typeof parsed.headline === 'string' &&
                    parsed.name !== parsed.headline
                ) {
                    // we have both name and headline element in the JSON-LD. They should both be the same but some websites like aktualne.cz
                    // put their own name into "name" and the article title to "headline" which confuses Readability. So we try to check if either
                    // "name" or "headline" closely matches the html title, and if so, use that one. If not, then we use "name" by default.
                    const title = this.getArticleTitle()
                    const nameMatches =
                        textSimilarity(parsed.name, title) > 0.75
                    const headlineMatches =
                        textSimilarity(parsed.headline, title) > 0.75

                    if (headlineMatches && !nameMatches) {
                        metadata.title = parsed.headline
                    } else {
                        metadata.title = parsed.name
                    }
                } else if (typeof parsed.name === 'string') {
                    metadata.title = parsed.name.trim()
                } else if (typeof parsed.headline === 'string') {
                    metadata.title = parsed.headline.trim()
                }

                if (parsed.author) {
                    if (typeof parsed.author.name === 'string') {
                        metadata.byline = parsed.author.name.trim()
                    } else if (
                        Array.isArray(parsed.author) &&
                        parsed.author[0] &&
                        typeof parsed.author[0].name === 'string'
                    ) {
                        metadata.byline = parsed.author
                            .map((author: any) => author?.name?.trim())
                            .filter(Boolean)
                            .join(', ')
                    }
                }

                if (typeof parsed.description === 'string') {
                    metadata.excerpt = parsed.description.trim()
                }

                if (
                    parsed.publisher &&
                    typeof parsed.publisher.name === 'string'
                ) {
                    metadata.siteName = parsed.publisher.name.trim()
                }

                if (typeof parsed.datePublished === 'string') {
                    metadata.datePublished = parsed.datePublished.trim()
                }

                return
            } catch (err) {
                this.log(err)
            }
        })

        return metadata || {}
    }

    private getArticleMetadata(jsonld: Metadata) {
        const values: any = {}

        const metadata: Metadata = {}
        const $metaElements = this.$('meta')

        // property is a space-separated list of values
        const propertyPattern =
            /\s*(article|dc|dcterm|og|twitter)\s*:\s*(author|creator|description|published_time|title|site_name)\s*/gi

        // name is a single value
        const namePattern =
            /^\s*(?:(dc|dcterm|og|twitter|parsely|weibo:(article|webpage))\s*[-.:]\s*)?(author|creator|pub-date|description|title|site_name)\s*$/i

        // Find description tags.
        $metaElements.each((_, el) => {
            const $el = this.$(el)

            const elementName = $el.attr('name')
            const elementProperty = $el.attr('property')
            const content = $el.attr('content')
            if (!content) return

            let matches: RegExpMatchArray | null = null
            let name: string

            if (elementProperty) {
                matches = elementProperty.match(propertyPattern)
                if (matches) {
                    // Convert to lowercase, and remove any whitespace
                    // so we can match below.
                    name = matches[0].toLowerCase().replace(/\s/g, '')
                    // multiple authors
                    values[name] = content.trim()
                }
            }

            if (!matches && elementName && namePattern.test(elementName)) {
                name = elementName
                if (content) {
                    // Convert to lowercase, remove any whitespace, and convert dots
                    // to colons so we can match below.
                    name = name
                        .toLowerCase()
                        .replace(/\s/g, '')
                        .replace(/\./g, ':')
                    values[name] = content.trim()
                }
            }
        })

        // get title
        metadata.title =
            jsonld.title ||
            values['dc:title'] ||
            values['dcterm:title'] ||
            values['og:title'] ||
            values['weibo:article:title'] ||
            values['weibo:webpage:title'] ||
            values['title'] ||
            values['twitter:title'] ||
            values['parsely-title']

        if (!metadata.title) {
            // TODO: isn't this redundant?
            metadata.title = this.getArticleTitle()
        }

        // get author
        metadata.byline =
            jsonld.byline ||
            values['dc:creator'] ||
            values['dcterm:creator'] ||
            values['author'] ||
            values['parsely-author']

        // get description
        metadata.excerpt =
            jsonld.excerpt ||
            values['dc:description'] ||
            values['dcterm:description'] ||
            values['og:description'] ||
            values['weibo:article:description'] ||
            values['weibo:webpage:description'] ||
            values['description'] ||
            values['twitter:description']

        // get site name
        metadata.siteName = jsonld.siteName || values['og:site_name']

        // get article published time
        metadata.publishedTime =
            jsonld.datePublished ||
            values['article:published_time'] ||
            values['parsely-pub-date'] ||
            null

        // in many sites the meta value is escaped with HTML entities,
        // so here we need to unescape it
        metadata.title = unescapeHtmlEntities(metadata.title)
        metadata.byline = unescapeHtmlEntities(metadata.byline)
        metadata.excerpt = unescapeHtmlEntities(metadata.excerpt)
        metadata.siteName = unescapeHtmlEntities(metadata.siteName)
        metadata.publishedTime = unescapeHtmlEntities(metadata.publishedTime)

        return metadata
    }

    private addContentScore(element: Candidate) {
        if (typeof element.contentScore !== 'undefined') return element

        let contentScore = 0

        switch (element.tagName) {
            case 'div':
                contentScore += 5
                break

            case 'pre':
            case 'td':
            case 'blockquote':
                contentScore += 3
                break

            case 'address':
            case 'ol':
            case 'ul':
            case 'dl':
            case 'dd':
            case 'dt':
            case 'li':
            case 'form':
                contentScore -= 3
                break

            case 'h1':
            case 'h2':
            case 'h3':
            case 'h4':
            case 'h5':
            case 'h6':
            case 'th':
                contentScore -= 5
                break
        }

        contentScore += this.getClassWeight(element)
        element.contentScore = contentScore

        return element as Candidate
    }

    private getClassWeight(el: Element) {
        if (!this.flagIsActive(FLAG_WEIGHT_CLASSES)) return 0

        let weight = 0
        const $el = this.$(el)

        // Look for a special classname
        const className = $el.attr('class')
        if (className) {
            if (negative.test(className)) weight -= 25
            if (positive.test(className)) weight += 25
        }

        // Look for a special ID
        const id = $el.attr('id')
        if (id) {
            if (negative.test(id)) weight -= 25
            if (positive.test(id)) weight += 25
        }

        return weight
    }

    private clean($el: Cheerio<Element>, tag: string) {
        const isEmbed = ['object', 'embed', 'iframe'].includes(tag)

        removeNodes($el.find(tag), ($node) => {
            const node = $node[0]!
            // Allow youtube and vimeo videos through as people usually want to see those.
            if (isEmbed) {
                // First, check the node attributes to see if any of them contain youtube or vimeo
                for (let i = 0; i < node.attributes.length; i++) {
                    if (
                        this.options.allowedVideoRegex.test(
                            node.attributes[i]!.value,
                        )
                    ) {
                        return false
                    }
                }

                // For embed with <object> tag, check inner HTML as well.
                if (
                    node.tagName === 'object' &&
                    this.options.allowedVideoRegex.test($node.html() || '')
                ) {
                    return false
                }
            }

            return true
        })
    }

    /**
     * Return an object indicating how many rows and columns this table has.
     */
    private getRowAndColumnCount($table: Cheerio<Element>) {
        let rows = 0
        let columns = 0
        const $trs = $table.find('tr')
        const $ = this.$

        // Iterate over each 'tr'
        $trs.each((_, tr) => {
            const $tr = $(tr)
            let rowspan = $tr.attr('rowspan') || 0

            if (typeof rowspan === 'string') {
                rowspan = parseInt(rowspan, 10)
            }

            rows += rowspan || 1

            // Now look for column-related info
            let columnsInThisRow = 0
            const $cells = $tr.find('td')

            // Iterate over each 'td'
            $cells.each(function (_, cell) {
                const $cell = $(cell)
                let colspan = $cell.attr('colspan') || 0

                if (typeof colspan === 'string') {
                    colspan = parseInt(colspan, 10)
                }

                columnsInThisRow += colspan || 1
            })

            columns = Math.max(columns, columnsInThisRow)
        })

        return { rows, columns }
    }

    /**
     * Look for 'data' (as opposed to 'layout') tables, for which we use
     * similar checks as
     * https://searchfox.org/mozilla-central/rev/f82d5c549f046cb64ce5602bfd894b7ae807c8f8/accessible/generic/TableAccessible.cpp#19
     */
    private markDataTables($el: Cheerio<Element>) {
        const $tables = $el.find('table')

        $tables.each((_, table: any) => {
            const $table = this.$(table)
            const role = $table.attr('role')

            if (role === 'presentation') {
                table._readabilityDataTable = false
                return
            }

            const datatable = $table.attr('datatable')
            if (datatable === '0') {
                table._readabilityDataTable = false
                return
            }

            const summary = $table.attr('summary')
            if (summary) {
                table._readabilityDataTable = true
                return
            }

            const $caption = $table.find('caption *')
            if ($caption.length > 0) {
                table._readabilityDataTable = true
                return
            }

            // If the table has a descendant with any of these tags, consider a data table:
            if ($table.find('col, colgroup, tfoot, thead, th').length) {
                this.log('Data table because found data-y descendant')
                table._readabilityDataTable = true
                return
            }

            // Nested tables indicate a layout table:
            if ($table.find('table').length) {
                table._readabilityDataTable = false
                return
            }

            const sizeInfo = this.getRowAndColumnCount($table)

            if (sizeInfo.columns == 1 || sizeInfo.rows == 1) {
                // single colum/row tables are commonly used for page layout purposes.
                table._readabilityDataTable = false
                return
            }

            if (sizeInfo.rows >= 10 || sizeInfo.columns > 4) {
                table._readabilityDataTable = true
                return
            }

            // Now just go by size entirely:
            table._readabilityDataTable = sizeInfo.rows * sizeInfo.columns > 10
        })
    }

    /*
     * Convert images and figures that have properties like data-src into images that can be loaded without JS
     */
    private fixLazyImages($el: Cheerio<Element>) {
        $el.find('img, picture, figure').each((_, el) => {
            const $el = this.$(el)
            const src = $el.attr('src')

            // In some sites (e.g. Kotaku), they put 1px square image as base64 data uri in the src attribute.
            // So, here we check if the data uri is too short, just might as well remove it.
            if (src && b64DataUrl.test(src)) {
                // Make sure it's not SVG, because SVG can have a meaningful image in under 133 bytes.
                const parts = b64DataUrl.exec(src)
                if (parts && parts[1] === 'image/svg+xml') {
                    return
                }

                // Make sure this element has other attributes which contains image.
                // If it doesn't, then this src is important and shouldn't be removed.
                let srcCouldBeRemoved = false
                for (let i = 0; i < el.attributes.length; i++) {
                    const attr = el.attributes[i]!
                    if (attr.name === 'src') {
                        continue
                    }

                    if (/\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
                        srcCouldBeRemoved = true
                        break
                    }
                }

                // Here we assume if image is less than 100 bytes (or 133B after encoded to base64)
                // it will be too small, therefore it might be placeholder image.
                if (srcCouldBeRemoved) {
                    const b64starts = src.search(/base64\s*/i) + 7
                    const b64length = src.length - b64starts
                    if (b64length < 133) {
                        $el.removeAttr('src')
                    }
                }
            }

            el.attributes.forEach((attr) => {
                if (
                    attr.name === 'src' ||
                    attr.name === 'srcset' ||
                    attr.name === 'alt'
                ) {
                    return
                }

                let copyTo: string | null = null

                if (/\.(jpg|jpeg|png|webp)\s+\d/.test(attr.value)) {
                    copyTo = 'srcset'
                } else if (
                    /^\s*\S+\.(jpg|jpeg|png|webp)\S*\s*$/.test(attr.value)
                ) {
                    copyTo = 'src'
                }

                if (copyTo) {
                    // if this is an img or picture, set the attribute directly
                    if (el.tagName === 'img' || el.tagName === 'picture') {
                        $el.attr(copyTo, attr.value)
                    } else if (
                        el.tagName === 'figure' &&
                        !$el.find('img, picture').length
                    ) {
                        // if the item is a <figure> that does not contain an image or picture,
                        // create one and place it inside the figure
                        // see the nytimes-3 testcase for an example
                        const $img = this.$('<img />')
                        $img.attr(copyTo, attr.value)
                        $el.append($img)
                    }
                }
            })
        })
    }

    private getTextDensity($el: Cheerio<Element>, tags: string[]) {
        const textLength = getInnerText($el, true).length
        if (textLength === 0) return 0

        let childrenLength = 0

        $el.find(tags.join(', ')).each((_, child) => {
            childrenLength += getInnerText(this.$(child), true).length
        })

        return childrenLength / textLength
    }

    /**
     * Clean an element of all tags of type "tag" if they look fishy.
     * "Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.
     **/
    private cleanConditionally($el: Cheerio<Element>, tag: string) {
        const $ = this.$
        if (!this.flagIsActive(FLAG_CLEAN_CONDITIONALLY)) return

        // Gather counts for other typical elements embedded within.
        // Traverse backwards so we can remove nodes at the same time
        // without effecting the traversal.
        //
        // TODO: Consider taking into account original contentScore here.
        removeNodes($el.find(tag), ($node) => {
            const node = $node[0]!
            let isList = tag === 'ul' || tag === 'ol'

            if (tag === 'table' && isDataTable(node)) {
                return false
            }

            // Next check if we're inside a data table, in which case don't remove it as well.
            if (hasAncestorTag(node, 'table', -1, isDataTable)) {
                return false
            }

            if (hasAncestorTag(node, 'code')) {
                return false
            }

            // keep element if it has a data tables
            if ($node.find('table').toArray().some(isDataTable)) {
                return false
            }

            if (!isList) {
                let listLength = 0

                $node.find('ul, ol').each((_, list) => {
                    listLength += getInnerText($(list)).length
                })

                isList = listLength / getInnerText($node).length > 0.9
            }

            const weight = this.getClassWeight(node)

            this.log('Cleaning Conditionally', tagToString(node))

            const contentScore = 0

            if (weight + contentScore < 0) {
                return true
            }

            const charCount = getInnerText($node).split(',').length - 1
            if (charCount > 10) return false

            // If there are not very many commas, and the number of
            // non-paragraph elements is more than paragraphs or other
            // ominous signs, remove the element.
            const p = $node.find('p').length
            const img = $node.find('img').length
            const li = $node.find('li').length - 100
            const input = $node.find('input').length
            // prettier-ignore
            const headingDensity = this.getTextDensity($node, [ 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', ])

            let embedCount = 0
            const $embeds = $node.find('object, embed, iframe')

            for (let i = 0; i < $embeds.length; i++) {
                const $embed = $embeds[i]!
                // If this embed has attribute that matches video regex, don't delete it.
                for (let j = 0; j < $embed.attributes.length; j++) {
                    if (
                        this.options.allowedVideoRegex.test(
                            $embed.attributes[j]!.value,
                        )
                    ) {
                        return false
                    }
                }

                // For embed with <object> tag, check inner HTML as well.
                if (
                    $embed!.tagName === 'object' &&
                    this.options.allowedVideoRegex.test(
                        $embeds.eq(i).html() || '',
                    )
                ) {
                    return false
                }

                embedCount++
            }

            const innerText = getInnerText($node)

            // toss any node whose inner text contains nothing but suspicious words
            if (adWords.test(innerText) || loadingWords.test(innerText)) {
                return true
            }

            const contentLength = innerText.length
            const linkDensity = getLinkDensity($, $node)
            const textishTags = ['span', 'li', 'td'].concat(
                Array.from(DIV_TO_P_ELEMS),
            )
            const textDensity = this.getTextDensity($node, textishTags)
            const isFigureChild = hasAncestorTag(node, 'figure')

            // apply shadiness checks, then check for exceptions
            const shouldRemoveNode = () => {
                const errs: string[] = []

                if (!isFigureChild && img > 1 && p / img < 0.5) {
                    errs.push(`Bad p to img ratio (img=${img}, p=${p})`)
                }

                if (!isList && li > p) {
                    errs.push(
                        `Too many li's outside of a list. (li=${li} > p=${p})`,
                    )
                }

                if (input > Math.floor(p / 3)) {
                    errs.push(`Too many inputs per p. (input=${input}, p=${p})`)
                }

                if (
                    !isList &&
                    !isFigureChild &&
                    headingDensity < 0.9 &&
                    contentLength < 25 &&
                    (img === 0 || img > 2) &&
                    linkDensity > 0
                ) {
                    errs.push(
                        `Suspiciously short. (headingDensity=${headingDensity}, img=${img}, linkDensity=${linkDensity})`,
                    )
                }

                if (
                    !isList &&
                    weight < 25 &&
                    linkDensity > 0.2 + this.options.linkDensityModifier
                ) {
                    errs.push(
                        `Low weight and a little linky. (linkDensity=${linkDensity})`,
                    )
                }

                if (
                    weight >= 25 &&
                    linkDensity > 0.5 + this.options.linkDensityModifier
                ) {
                    errs.push(
                        `High weight and mostly links. (linkDensity=${linkDensity})`,
                    )
                }

                if (
                    (embedCount === 1 && contentLength < 75) ||
                    embedCount > 1
                ) {
                    errs.push(
                        `Suspicious embed. (embedCount=${embedCount}, contentLength=${contentLength})`,
                    )
                }

                if (img === 0 && textDensity === 0) {
                    errs.push(
                        `No useful content. (img=${img}, textDensity=${textDensity})`,
                    )
                }

                if (errs.length > 0) {
                    this.log('Checks failed', errs)
                    return true
                }

                return false
            }

            const haveToRemove = shouldRemoveNode()

            // Allow simple lists of images to remain in pages
            if (isList && haveToRemove) {
                for (let x = 0; x < $node.children().length; x++) {
                    const child = $node.children()[x]
                    // Don't filter in lists with li's that contain more than one child
                    if ($(child).children().length > 1) {
                        return haveToRemove
                    }
                }
                const li_count = $node.find('li').length
                // Only allow the list to remain if every li contains an image
                if (img === li_count) {
                    return false
                }
            }

            return haveToRemove
        })
    }

    /**
     * Clean out spurious headers from an Element.
     **/
    private cleanHeaders($el: Cheerio<Element>) {
        removeNodes($el.find('h1, h2'), ($node) => {
            const node = $node[0]!
            const shouldRemove = this.getClassWeight(node) < 0

            if (shouldRemove) {
                this.log('Removing header with low class weight:', node)
            }
            return shouldRemove
        })
    }

    /**
     * Check if this node is an H1 or H2 element whose content is mostly
     * the same as the article title.
     */
    private headerDuplicatesTitle($el: Cheerio<Element>) {
        if (!$el.is('h1, h2')) return false

        const heading = getInnerText($el, false)
        this.log('Evaluating similarity of header:', heading, this.articleTitle)

        if (!this.articleTitle) return false

        return textSimilarity(this.articleTitle, heading) > 0.75
    }

    private flagIsActive(flag: number) {
        return (this.flags & flag) > 0
    }

    private removeFlag(flag: number) {
        this.flags = this.flags & ~flag
    }

    /**
     * Runs readability.
     *
     * Workflow:
     *  1. Prep the document by removing script tags, css, etc.
     *  2. Build readability's DOM tree.
     *  3. Grab the article content from the current dom tree.
     *  4. Replace the current DOM tree with the new one.
     *  5. Read peacefully.
     **/
    parse(): ReadabilityResult {
        // Avoid parsing too large documents, as per configuration option
        if (this.options.maxElemsToParse > 0) {
            const numTags = this.$('*').length
            if (numTags > this.options.maxElemsToParse) {
                throw new Error(
                    'Aborting parsing document; ' + numTags + ' elements found',
                )
            }
        }

        // Extract JSON-LD metadata before removing scripts
        const jsonLd = this.options.disableJSONLD ? {} : this.getJSONLD()
        const metadata = this.getArticleMetadata(jsonLd)
        let $articleContent: Cheerio<Element> | null = null

        this.articleTitle = metadata.title || null

        if (this.options.extraction) {
            // Remove all comments
            removeComments(this.$, this.$.root()[0])

            // Remove all scripts once we've got the metadata
            removeNodes(this.$('script, noscript'))

            // Remove all style tags in head
            removeNodes(this.$('style'))

            // Replace <br> chains with <p>
            replaceBrs(this.$)

            // Replace legacy font tags with span
            replaceNodeTags(this.$('font').toArray(), 'span')

            // Main extraction
            $articleContent = this.grabArticle()
            this.log('Grabbed: ' + $articleContent?.html())

            // Finish simplifying the article content
            this.postProcessContent($articleContent)
        }

        // If we haven't found an excerpt in the article's metadata, use the article's
        // first paragraph as the excerpt. This is used for displaying a preview of
        // the article's content.
        if (!metadata.excerpt && $articleContent) {
            const $paragraphs = $articleContent.find('p')
            if ($paragraphs.length > 0) {
                metadata.excerpt = $paragraphs.first().text().trim()
            }
        }

        const textContent = $articleContent?.text() || null

        return {
            title: this.articleTitle,
            byline: metadata.byline || this.articleByline,
            dir: this.articleDir,
            lang: this.articleLang,
            content: this.options.serializer($articleContent),
            textContent,
            length: textContent?.length || null,
            excerpt: metadata.excerpt || null,
            siteName: metadata.siteName || null,
            publishedTime: metadata.publishedTime || null,
        }
    }
}
