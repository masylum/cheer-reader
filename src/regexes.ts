// All of the regular expressions in use within readability.
// Defined up here so we don't instantiate them repeatedly in loops.
export const unlikelyCandidates =
    /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i
export const okMaybeItsACandidate =
    /and|article|body|column|content|main|shadow/i

export const positive =
    /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i
export const negative =
    /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i
export const extraneous =
    /print|archive|comment|discuss|e[-]?mail|share|reply|all|login|sign|single|utility/i
export const byline = /byline|author|dateline|writtenby|p-author/i
export const replaceFonts = /<(\/?)font[^>]*>/gi
export const normalize = /\s{2,}/g
export const videos =
    /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i
export const shareElements = /(\b|_)(share|sharedaddy)(\b|_)/i
export const nextLink = /(next|weiter|continue|>([^|]|$)|»([^|]|$))/i
export const prevLink = /(prev|earl|old|new|<|«)/i
export const tokenize = /\W+/g
export const whitespace = /^\s*$/
export const hasContent = /\S$/
export const hashUrl = /^#.+/
export const srcsetUrl = /(\S+)(\s+[\d.]+[xw])?(\s*(?:,|$))/g
export const b64DataUrl = /^data:\s*([^\s;,]+)\s*;\s*base64\s*,/i
// Commas as used in Latin, Sindhi, Chinese and various other scripts.
// see: https://en.wikipedia.org/wiki/Comma#Comma_variants
export const commas =
    /\u002C|\u060C|\uFE50|\uFE10|\uFE11|\u2E41|\u2E34|\u2E32|\uFF0C/g
// See: https://schema.org/Article
export const jsonLdArticleTypes =
    /^Article|AdvertiserContentArticle|NewsArticle|AnalysisNewsArticle|AskPublicNewsArticle|BackgroundNewsArticle|OpinionNewsArticle|ReportageNewsArticle|ReviewNewsArticle|Report|SatiricalArticle|ScholarlyArticle|MedicalScholarlyArticle|SocialMediaPosting|BlogPosting|LiveBlogPosting|DiscussionForumPosting|TechArticle|APIReference$/
// used to see if a node's content matches words commonly used for ad blocks or loading indicators
export const adWords =
    /^(ad(vertising|vertisement)?|pub(licité)?|werb(ung)?|广告|Реклама|Anuncio)$/iu
export const loadingWords =
    /^((loading|正在加载|Загрузка|chargement|cargando)(…|\.\.\.)?)$/iu
