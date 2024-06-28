import beautify from 'js-beautify'

export function prettyPrint(html: string | null) {
    if (!html) return null

    return beautify.html(html, {
        indent_size: 4,
        indent_char: ' ',
        indent_level: 0,
        indent_with_tabs: false,
        preserve_newlines: false,
        wrap_line_length: 0,
        wrap_attributes: 'auto',
        wrap_attributes_indent_size: 4,
    })
}
