import { type AnyNode, type Element } from 'cheerio'

function clean(str: string) {
    return str.replace(/\s+/g, ' ')
}

function attributesForNode(node: Element) {
    return node.attributes
        .map((attr) => `${attr.name}="${attr.value}"`)
        .join(' ')
}

export function tagToString(el: AnyNode) {
    if (!el) return '(no node)'

    if (el.type === 'text') return `#text(${clean(el.data)})`
    if (el.type === 'tag') return `<${el.tagName} ${attributesForNode(el)} />`

    return `#${el.type}`
}
