// These are the list of HTML entities that need to be escaped.
const HTML_ESCAPE_MAP = {
    lt: '<',
    gt: '>',
    amp: '&',
    quot: '"',
    apos: "'",
} as const

/**
 * Converts some of the common HTML entities in string to their corresponding characters.
 */
export function unescapeHtmlEntities(str: string | null | undefined) {
    if (!str) return str

    return str
        .replace(/&(quot|amp|apos|lt|gt);/g, (_, tag) => {
            const index = tag as keyof typeof HTML_ESCAPE_MAP
            return HTML_ESCAPE_MAP[index]
        })
        .replace(/&#(?:x([0-9a-z]{1,4})|([0-9]{1,4}));/gi, (_, hex, numStr) => {
            const num = parseInt(hex || numStr, hex ? 16 : 10)
            return String.fromCharCode(num)
        })
}
