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
        .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, function (_, hex, numStr) {
            let num = parseInt(hex || numStr, hex ? 16 : 10)

            // these character references are replaced by a conforming HTML parser
            if (
                num == 0 ||
                num > 0x10ffff ||
                (num >= 0xd800 && num <= 0xdfff)
            ) {
                num = 0xfffd
            }

            return String.fromCodePoint(num)
        })
}
