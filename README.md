![cheer-reader](https://github.com/masylum/cheer-reader/blob/main/img/cheer-reader.png?raw=true)

This library is a port of the [readability.js](https://github.com/mozilla/readability) library
that uses [cheerio](https://cheerio.js.org) instead of native DOM APIs.

The goals of this port are the following:

-   **Portability**: Most runtimes and Web Workers don't support DOM apis.
    By using cheerio, we ensure that you can run readability wherever you want.
    If your goal is to run it in the main thread of the browser, you can stick to the original
    implementation.
-   **Performance**: For non-native runtimes, we rely in JSDOM to simulate native DOM APIs. JSDOM
    does a lot besides parsing HTML, and is pretty heavy and slow. **cheerio** instead is lightweight
    and fast. Overall, I've experienced that this port performs 6-8x times faster and consumes a lot
    less memory than the original one. You can even use [htmlparser2](https://github.com/fb55/htmlparser2)
    if you need more performance.
-   **Compatibility**: In order to avoid using JSOM, you could use readability's [JSDOMParser](https://github.com/mozilla/readability/blob/main/JSDOMParser.js),
    [Happy Dom](https://github.com/capricorn86/happy-dom) or [Linkedom](https://github.com/WebReflection/linkedom).
    I had compatibility problems using those alternative implementations, but **cheerio** worked flawlesly even
    with the most broken html documents that you can find on the internet. You even have the option to use
    [htmlparser2](https://github.com/fb55/htmlparser2) instead of **cheerio**'s default [parse5](https://github.com/inikulin/parse5)
    for less strict parsing.
-   **Extensability**: The original implementation is pretty hard to read and maintain. While I didn't deviate
    much from it, I tried to modernize the code base a little bit. I hope people can help me out, specially with
    the `_grabArticle` gigantic method with nested while loops. I also saw a lot of issues on the repo for top pages
    that didn't seem taken care of. It is my intention to try to fix those as I move forward.

The implementation aims to be the same and it keeps the same test set to ensure backwards compatibility.

## Installation

`cheer-reader` is available on jsr:

```bash
npx jsr add @paoramen/cheer-reader
```

## Basic usage

To parse a document, you must create a new `Readability` object from a DOM document object, and then call the [`parse()`](#parse) method. Here's an example:

```javascript
import { Readability } from 'cheer-reader'

const $ = load('html><div>yo</div></html>')
const article = new Readability($).parse()
```

## API Reference

### `new Readability($, options)`

The `options` object accepts a number of properties, all optional:

-   `debug` (boolean, default `false`): whether to enable logging.
-   `maxElemsToParse` (number, default `0` i.e. no limit): the maximum number of elements to parse.
-   `nbTopCandidates` (number, default `5`): the number of top candidates to consider when analysing how tight the competition is among candidates.
-   `charThreshold` (number, default `500`): the number of characters an article must have in order to return a result.
-   `classesToPreserve` (array): a set of classes to preserve on HTML elements when the `keepClasses` options is set to `false`.
-   `keepClasses` (boolean, default `false`): whether to preserve all classes on HTML elements. When set to `false` only classes specified in the `classesToPreserve` array are kept.
-   `disableJSONLD` (boolean, default `false`): when extracting page metadata, cheer-reader gives precedence to Schema.org fields specified in the JSON-LD format. Set this option to `true` to skip JSON-LD parsing.
-   `serializer` (function, default `$el => $el.html()`) controls how the `content` property returned by the `parse()` method is produced from the root DOM element. It may be useful to specify the `serializer` as the identity function (`$el => $el`) to obtain a cheerio element instead of a string for `content` if you plan to process it further.
-   `allowedVideoRegex` (RegExp, default `undefined` ): a regular expression that matches video URLs that should be allowed to be included in the article content. If `undefined`, the default regex is applied.
-   `linkDensityModifier` (number, default `0`): a number that is added to the base link density threshold during the shadiness checks. This can be used to penalize nodes with a high link density or vice versa.

Added options from the original implementation:

-   `extraction` (boolean, default `true`): Some libraries are only interested on the metadata and don't want to pay the price of a full extraction. When you enable this option the `content`, `textContent`, `length` and `excerpt` will be `null`.

### `parse()`

Returns an object containing the following properties:

-   `title`: article title;
-   `content`: HTML string of processed article content;
-   `textContent`: text content of the article, with all the HTML tags removed;
-   `length`: length of an article, in characters;
-   `excerpt`: article description, or short excerpt from the content;
-   `byline`: author metadata;
-   `dir`: content direction;
-   `siteName`: name of the site;
-   `lang`: content language;
-   `publishedTime`: published time;

## Security

If you're going to use `cheer-reader` with untrusted input (whether in HTML or DOM form), we **strongly** recommend you use a sanitizer library like [DOMPurify](https://github.com/cure53/DOMPurify) to avoid script injection when you use
the output of `cheer-reader`. We would also recommend using [CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) to add further defense-in-depth
restrictions to what you allow the resulting content to do. The Firefox integration of
reader mode uses both of these techniques itself. Sanitizing unsafe content out of the input is explicitly not something we aim to do as part of `cheer-reader` itself - there are other good sanitizer libraries out there, use them!

## Contributing

Please see our [Contributing](CONTRIBUTING.md) document.

## License

    Copyright (c) 2010 Arc90 Inc

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
