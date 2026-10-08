import express from 'express';
import { CheerioCrawler, PlaywrightCrawler, RequestQueue } from 'crawlee';

const app = express();

app.use(express.json());

const requestQueue = await RequestQueue.open();

/* ============================================================
   BASIC TEXT HELPERS
   ============================================================ */

function decodeHtml(text) {
    let result = String(text || '');

    for (let i = 0; i < 3; i++) {
        const decoded = result
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&#(\d+);/g, (_, n) =>
                String.fromCharCode(Number(n))
            )
            .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
                String.fromCharCode(parseInt(n, 16))
            );

        if (decoded === result) break;

        result = decoded;
    }

    return result;
}

function normalizeText(text) {
    return decodeHtml(String(text || ''))
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\r/g, '')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function normalizeForMatch(text) {
    return normalizeText(text)
        .toLowerCase()
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function words(text) {
    const normalized = normalizeForMatch(text);

    if (!normalized) {
        return [];
    }

    return normalized
        .split(/\s+/)
        .filter(Boolean);
}

function wordCount(text) {
    return words(text).length;
}

function htmlToVisibleText(html) {
    return normalizeText(
        String(html || '')
            .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
            .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
    );
}

/* ============================================================
   REMOVE OBVIOUS PAGE JUNK
   ============================================================ */

function removeJunk(html) {
    return String(html || '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')

        .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
        .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ')
        .replace(/<form\b[\s\S]*?<\/form>/gi, ' ')

        .replace(/<figure\b[\s\S]*?<\/figure>/gi, ' ')
        .replace(/<figcaption\b[\s\S]*?<\/figcaption>/gi, ' ')

        .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
        .replace(/<video\b[\s\S]*?<\/video>/gi, ' ')
        .replace(/<audio\b[\s\S]*?<\/audio>/gi, ' ');
}

/* ============================================================
   PARAGRAPH EXTRACTION
   ============================================================ */

function extractParagraphs(html) {
    const source = removeJunk(html);
    const paragraphs = [];

    const regex =
        /<(p|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;

    let match;

    while ((match = regex.exec(source)) !== null) {
        let text = match[2];

        text = text
            .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
            .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '$1')
            .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '$1')
            .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '$1')
            .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '$1')
            .replace(/<[^>]+>/g, ' ');

        text = normalizeText(text);

        if (!text) continue;

        const lower = text.toLowerCase();

        if (
            lower === 'share' ||
            lower === 'subscribe' ||
            lower === 'sign up' ||
            lower === 'advertisement' ||
            lower === 'advertising' ||
            lower === 'link copied' ||
            lower.startsWith('follow us') ||
            lower.startsWith('read more') ||
            lower.startsWith('related:')
        ) {
            continue;
        }

        if (
            /^(photo|image|credit|courtesy|source):/i.test(text) &&
            wordCount(text) < 40
        ) {
            continue;
        }

        if (text.length >= 35) {
            paragraphs.push(text);
        }
    }

    return paragraphs;
}

/* ============================================================
   BLOCKED PAGE DETECTION
   ============================================================ */

function isBlockedPage(html, text) {
    const raw = String(html || '').toLowerCase();
    const visible = String(text || '').toLowerCase();

    const visibleSignals = [
        'just a moment',
        'checking your browser',
        'verify you are human',
        "verify you're human",
        'access denied',
        'please wait while we verify',
        'enable javascript and cookies',
        'security verification',
        'bot detection',
        'bot protection'
    ];

    const rawSignals = [
        'geo.captcha-delivery.com/interstitial',
        '/cdn-cgi/challenge-platform/',
        'cf-chl-',
        '_cf_chl_',
        'px-captcha',
        'awswaf'
    ];

    for (const signal of visibleSignals) {
        if (visible.includes(signal)) {
            return true;
        }
    }

    for (const signal of rawSignals) {
        if (raw.includes(signal)) {
            return true;
        }
    }

    return false;
}

/* ============================================================
   PAGE TITLE
   ============================================================ */

function extractPageTitle(html) {
    const source = String(html || '');

    const patterns = [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
        /<title[^>]*>([\s\S]*?)<\/title>/i
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);

        if (match && match[1]) {
            return normalizeText(match[1]);
        }
    }

    return '';
}

/* ============================================================
   JSON-LD EXTRACTION
   ============================================================ */

function extractJsonLdObjects(html) {
    const source = String(html || '');
    const scripts = [];

    const regex =
        /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while ((match = regex.exec(source)) !== null) {
        scripts.push(match[1]);
    }

    const objects = [];

    function addRecursive(value) {
        if (!value) return;

        if (Array.isArray(value)) {
            for (const item of value) {
                addRecursive(item);
            }

            return;
        }

        if (typeof value !== 'object') {
            return;
        }

        objects.push(value);

        if (Array.isArray(value['@graph'])) {
            for (const item of value['@graph']) {
                addRecursive(item);
            }
        }

        for (const key of Object.keys(value)) {
            if (
                key !== '@graph' &&
                value[key] &&
                typeof value[key] === 'object'
            ) {
                addRecursive(value[key]);
            }
        }
    }

    for (const raw of scripts) {
        const candidates = [
            raw,
            decodeHtml(raw)
        ];

        let parsed = null;

        for (const candidate of candidates) {
            try {
                parsed = JSON.parse(candidate.trim());
                break;
            } catch (e) {
                // Try next representation.
            }
        }

        if (parsed) {
            addRecursive(parsed);
        }
    }

    return objects;
}

/* ============================================================
   STRUCTURED LIVE UPDATE HELPERS
   ============================================================ */

function isBlogPostingObject(obj) {
    const type = obj && obj['@type'];

    if (Array.isArray(type)) {
        return type.some(
            x =>
                String(x).toLowerCase() === 'blogposting'
        );
    }

    return (
        String(type || '').toLowerCase() === 'blogposting'
    );
}

function getStructuredLiveUpdates(html) {
    const objects = extractJsonLdObjects(html);
    const updates = [];

    for (const obj of objects) {
        if (!isBlogPostingObject(obj)) {
            continue;
        }

        const body =
            typeof obj.articleBody === 'string'
                ? normalizeText(obj.articleBody)
                : '';

        if (wordCount(body) < 20) {
            continue;
        }

        updates.push({
            id:
                obj['@id'] ||
                obj.url ||
                '',

            headline:
                normalizeText(
                    obj.headline || ''
                ),

            body,

            published: obj.datePublished || '',

            modified: obj.dateModified || '',

            url:
                typeof obj.url === 'string'
                    ? obj.url
                    : ''
        });
    }

    return updates;
}

function scoreStructuredLiveUpdate(
    update,
    storyTitle,
    storyDescription
) {
    const body =
        normalizeForMatch(update.body);

    const headline =
        normalizeForMatch(update.headline);

    const title =
        normalizeForMatch(storyTitle);

    const description =
        normalizeForMatch(storyDescription);

    const bodyWords =
        new Set(words(body));

    const titleWords =
        words(title).filter(
            word => word.length >= 4
        );

    const descriptionWords =
        words(description).filter(
            word => word.length >= 4
        );

    let score = 0;

    let titleOverlap = 0;

    for (const word of titleWords) {
        if (bodyWords.has(word)) {
            titleOverlap++;
        }
    }

    score += Math.min(
        titleOverlap * 7,
        70
    );

    let descriptionOverlap = 0;

    for (const word of descriptionWords) {
        if (bodyWords.has(word)) {
            descriptionOverlap++;
        }
    }

    score += Math.min(
        descriptionOverlap * 10,
        100
    );

    if (
        title &&
        headline &&
        (
            headline.includes(title) ||
            title.includes(headline)
        )
    ) {
        score += 60;
    }

    const titlePhrases = [];

    for (
        let i = 0;
        i < titleWords.length - 1;
        i++
    ) {
        titlePhrases.push(
            `${titleWords[i]} ${titleWords[i + 1]}`
        );
    }

    for (const phrase of titlePhrases) {
        if (body.includes(phrase)) {
            score += 12;
        }
    }

    const wc =
        wordCount(update.body);

    if (wc >= 500) {
        score += 25;
    } else if (wc >= 300) {
        score += 15;
    } else if (wc >= 150) {
        score += 5;
    }

    return score;
}

function extractStructuredLiveUpdate(
    html,
    storyTitle,
    storyDescription
) {
    const updates =
        getStructuredLiveUpdates(html);

    if (!updates.length) {
        return null;
    }

    const scored =
        updates.map(update => ({
            ...update,

            score:
                scoreStructuredLiveUpdate(
                    update,
                    storyTitle,
                    storyDescription
                )
        }));

    scored.sort(
        (a, b) =>
            b.score - a.score
    );

    const best =
        scored[0];

    if (!best) {
        return null;
    }

    if (best.score < 25) {
        return null;
    }

    return best;
}

/* ============================================================
   EXACT DOM ELEMENT FINDER
   ============================================================ */

function findElementById(html, id) {
    const source = String(html || '');

    if (!id) {
        return null;
    }

    const possibleIds = [
        String(id),
        `block-${id}`
    ];

    for (const candidateId of possibleIds) {
        const escaped =
            candidateId.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

        const regex =
            new RegExp(
                `<([a-zA-Z][\\w:-]*)\\b[^>]*\\bid=["']${escaped}["'][^>]*>`,
                'i'
            );

        const match =
            regex.exec(source);

        if (!match) {
            continue;
        }

        return {
            tag: match[1].toLowerCase(),
            start: match.index,
            openEnd: regex.lastIndex,
            id: candidateId
        };
    }

    const decoded =
        decodeHtml(source);

    for (const candidateId of possibleIds) {
        const escaped =
            candidateId.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

        const regex =
            new RegExp(
                `<([a-zA-Z][\\w:-]*)\\b[^>]*\\bid=["']${escaped}["'][^>]*>`,
                'i'
            );

        const match =
            regex.exec(decoded);

        if (!match) {
            continue;
        }

        return {
            tag: match[1].toLowerCase(),
            start: match.index,
            openEnd: regex.lastIndex,
            id: candidateId,
            decodedSource: decoded
        };
    }

    return null;
}

/* ============================================================
   MATCH CLOSING TAG
   ============================================================ */

function findMatchingElementEnd(
    html,
    element
) {
    const source =
        String(html || '');

    const tag =
        element.tag;

    const tagRegex =
        new RegExp(
            `<\\/?${tag}\\b[^>]*>`,
            'gi'
        );

    tagRegex.lastIndex =
        element.start;

    let depth = 0;
    let match;

    while (
        (match = tagRegex.exec(source)) !== null
    ) {
        const token =
            match[0];

        if (
            /^<\//.test(token)
        ) {
            depth--;

            if (depth === 0) {
                return match.index + token.length;
            }
        } else if (
            !/\/>$/.test(token)
        ) {
            depth++;
        }
    }

    return -1;
}

/* ============================================================
   CUT UNRELATED CONTENT INSIDE LIVE UPDATE
   ============================================================ */

function cutLiveUpdateBoundary(html) {
    let source =
        String(html || '');

    const boundaryPatterns = [

        /<p\b[^>]*>\s*In\s+other\s+news\s*:?\s*<\/p>/i,

        /<div\b[^>]*>\s*In\s+other\s+news\s*:?\s*<\/div>/i,

        /&lt;p\b[^&]*&gt;\s*In\s+other\s+news\s*:?\s*&lt;\/p&gt;/i,

        /<p\b[^>]*>\s*Related\s*:/i,

        /<div\b[^>]*>\s*Related\s*:/i
    ];

    let earliest = -1;

    for (const pattern of boundaryPatterns) {
        const match =
            pattern.exec(source);

        if (!match) {
            continue;
        }

        if (
            earliest === -1 ||
            match.index < earliest
        ) {
            earliest = match.index;
        }
    }

    if (earliest !== -1) {
        source =
            source.slice(
                0,
                earliest
            );
    }

    return source;
}

/* ============================================================
   EXTRACT SELECTED LIVE UPDATE FROM DOM
   ============================================================ */

function extractLiveUpdateFromDom(
    html,
    structuredUpdate
) {
    if (
        !structuredUpdate ||
        !structuredUpdate.id
    ) {
        return null;
    }

    const original =
        String(html || '');

    let source =
        original;

    let element =
        findElementById(
            source,
            structuredUpdate.id
        );

    if (!element) {
        source =
            decodeHtml(original);

        element =
            findElementById(
                source,
                structuredUpdate.id
            );
    }

    if (!element) {
        return null;
    }

    const end =
        findMatchingElementEnd(
            source,
            element
        );

    if (end === -1) {
        return null;
    }

    let blockHtml =
        source.slice(
            element.start,
            end
        );

    blockHtml =
        cutLiveUpdateBoundary(
            blockHtml
        );

    const paragraphs =
        extractParagraphs(
            blockHtml
        );

    if (!paragraphs.length) {
        return null;
    }

    const seen =
        new Set();

    const uniqueParagraphs =
        paragraphs.filter(
            paragraph => {
                const key =
                    normalizeForMatch(
                        paragraph
                    );

                if (
                    !key ||
                    seen.has(key)
                ) {
                    return false;
                }

                seen.add(key);
                return true;
            }
        );

    const body =
        uniqueParagraphs.join(
            '\n\n'
        );

    if (
        wordCount(body) < 20
    ) {
        return null;
    }

    return {
        body,

        paragraphs:
            uniqueParagraphs,

        tag:
            element.tag,

        paragraphCount:
            uniqueParagraphs.length
    };
}

/* ============================================================
   GENERIC LIVE PAGE FALLBACK
   ============================================================ */

function extractLiveUpdateFallback(
    html,
    storyTitle,
    storyDescription
) {
    const source =
        String(html || '');

    const regex =
        /<(h2|h3|h4|h5)\b[^>]*>([\s\S]*?)<\/\1>/gi;

    const headings = [];

    let match;

    while (
        (match = regex.exec(source)) !== null
    ) {
        const heading =
            normalizeText(
                match[2]
                    .replace(/<[^>]+>/g, ' ')
            );

        if (
            heading.length >= 8
        ) {
            headings.push({
                text: heading,
                index: match.index,
                end: regex.lastIndex
            });
        }
    }

    if (!headings.length) {
        return null;
    }

    const reference =
        normalizeForMatch(
            `${storyTitle} ${storyDescription}`
        );

    const referenceWords =
        new Set(
            words(reference)
                .filter(
                    word => word.length >= 4
                )
        );

    const candidates = [];

    for (
        let i = 0;
        i < headings.length;
        i++
    ) {
        const heading =
            headings[i];

        const next =
            headings[i + 1];

        let end =
            next
                ? next.index
                : source.length;

        let block =
            source.slice(
                heading.end,
                end
            );

        block =
            cutLiveUpdateBoundary(
                block
            );

        const paragraphs =
            extractParagraphs(
                block
            );

        const body =
            paragraphs.join(
                '\n\n'
            );

        if (
            wordCount(body) < 20
        ) {
            continue;
        }

        const headingWords =
            new Set(
                words(heading.text)
                    .filter(
                        word => word.length >= 4
                    )
            );

        const bodyWords =
            new Set(
                words(body)
            );

        let headingOverlap = 0;
        let bodyOverlap = 0;

        for (const word of referenceWords) {
            if (headingWords.has(word)) {
                headingOverlap++;
            }

            if (bodyWords.has(word)) {
                bodyOverlap++;
            }
        }

        let score =
            headingOverlap * 20 +
            Math.min(
                bodyOverlap * 3,
                45
            );

        const normalizedTitle =
            normalizeForMatch(
                storyTitle
            );

        const normalizedHeading =
            normalizeForMatch(
                heading.text
            );

        if (
            normalizedTitle &&
            normalizedHeading &&
            (
                normalizedTitle.includes(
                    normalizedHeading
                ) ||
                normalizedHeading.includes(
                    normalizedTitle
                )
            )
        ) {
            score += 100;
        }

        const wc =
            wordCount(body);

        if (wc >= 500) {
            score += 25;
        } else if (wc >= 300) {
            score += 15;
        } else if (wc >= 150) {
            score += 5;
        }

        candidates.push({
            heading:
                heading.text,

            body,

            paragraphs,

            score
        });
    }

    if (!candidates.length) {
        return null;
    }

    candidates.sort(
        (a, b) =>
            b.score - a.score
    );

    const best =
        candidates[0];

    if (
        !best ||
        best.score < 20
    ) {
        return null;
    }

    return best;
}

/* ============================================================
   NORMAL ARTICLE CONTAINERS
   ============================================================ */

function findArticleContainers(html) {
    const source =
        String(html || '');

    const candidates = [];

    const patterns = [
        {
            method:
                'semantic-article-body',

            regex:
                /<(?:div|section)\b[^>]*(?:itemprop=["']articleBody["']|class=["'][^"']*(?:article-body|article__body|article-body-content|article-content|story-body|story-content|content-body|body-content|post-content|entry-content|articleBody)[^"']*)[^>]*>([\s\S]*?)<\/(?:div|section)>/gi
        },

        {
            method:
                'article-element',

            regex:
                /<article\b[^>]*>([\s\S]*?)<\/article>/gi
        }
    ];

    for (const pattern of patterns) {
        let match;

        while (
            (match =
                pattern.regex.exec(source)) !== null
        ) {
            const paragraphs =
                extractParagraphs(
                    match[1]
                );

            if (
                paragraphs.length < 2
            ) {
                continue;
            }

            const text =
                paragraphs.join(
                    '\n\n'
                );

            if (
                wordCount(text) < 100
            ) {
                continue;
            }

            candidates.push({
                method:
                    pattern.method,

                paragraphs,

                text
            });
        }
    }

    return candidates;
}

/* ============================================================
   NORMAL ARTICLE SCORING
   ============================================================ */

function scoreContainer(
    candidate,
    storyTitle,
    storyDescription
) {
    const text =
        candidate.text;

    const wc =
        wordCount(text);

    const paragraphCount =
        candidate.paragraphs.length;

    const lower =
        normalizeForMatch(text);

    let score = 0;

    score +=
        Math.min(
            wc / 20,
            100
        );

    score +=
        Math.min(
            paragraphCount * 4,
            40
        );

    const penalties = [
        'cookie policy',
        'privacy policy',
        'terms of use',
        'newsletter',
        'subscribe',
        'advertisement',
        'related stories',
        'most read',
        'trending',
        'share this article',
        'follow us'
    ];

    for (const signal of penalties) {
        if (lower.includes(signal)) {
            score -= 25;
        }
    }

    const candidateWords =
        new Set(
            words(text)
        );

    const referenceWords = [
        ...words(storyTitle),
        ...words(storyDescription)
    ];

    let overlap = 0;

    for (const word of referenceWords) {
        if (
            word.length >= 4 &&
            candidateWords.has(word)
        ) {
            overlap++;
        }
    }

    score +=
        Math.min(
            overlap * 3,
            45
        );

    return score;
}

/* ============================================================
   NORMAL ARTICLE EXTRACTION
   ============================================================ */

function extractNormalArticle(
    html,
    storyTitle,
    storyDescription
) {
    const containers =
        findArticleContainers(
            html
        );

    if (containers.length) {
        const scored =
            containers.map(
                candidate => ({
                    ...candidate,

                    score:
                        scoreContainer(
                            candidate,
                            storyTitle,
                            storyDescription
                        )
                })
            );

        scored.sort(
            (a, b) =>
                b.score - a.score
        );

        const best =
            scored[0];

        if (
            best &&
            best.paragraphs.length >= 2 &&
            wordCount(best.text) >= 100
        ) {
            return {
                text:
                    best.text,

                method:
                    best.method
            };
        }
    }

    const source =
        removeJunk(html);

    const regex =
        /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

    const paragraphs = [];

    let match;

    while (
        (match = regex.exec(source)) !== null
    ) {
        const text =
            normalizeText(
                match[1]
                    .replace(/<[^>]+>/g, ' ')
            );

        if (
            text.length < 50
        ) {
            continue;
        }

        const lower =
            text.toLowerCase();

        if (
            lower.includes('cookie policy') ||
            lower.includes('privacy policy') ||
            lower.includes(
                'subscribe to our newsletter'
            ) ||
            lower === 'share' ||
            lower === 'link copied'
        ) {
            continue;
        }

        paragraphs.push(text);
    }

    if (!paragraphs.length) {
        return {
            text: '',
            method:
                'no-article-found'
        };
    }

    let bestStart = 0;
    let bestEnd = 0;
    let bestScore = 0;

    for (
        let start = 0;
        start < paragraphs.length;
        start++
    ) {
        let currentWords = 0;
        let currentScore = 0;

        for (
            let end = start;
            end <
                Math.min(
                    start + 40,
                    paragraphs.length
                );
            end++
        ) {
            const wc =
                wordCount(
                    paragraphs[end]
                );

            currentWords += wc;

            if (wc >= 20) {
                currentScore +=
                    Math.min(
                        wc,
                        80
                    );
            }

            if (currentWords >= 150) {
                const score =
                    currentScore +
                    Math.min(
                        currentWords / 5,
                        100
                    );

                if (
                    score > bestScore
                ) {
                    bestScore =
                        score;

                    bestStart =
                        start;

                    bestEnd =
                        end;
                }
            }
        }
    }

    if (bestScore > 0) {
        return {
            text:
                paragraphs
                    .slice(
                        bestStart,
                        bestEnd + 1
                    )
                    .join('\n\n'),

            method:
                'paragraph-cluster'
        };
    }

    return {
        text: '',
        method:
            'no-article-found'
    };
}

/* ============================================================
   UPDATE TIMESTAMP EXTRACTION
   ============================================================ */

function extractUpdateNotice(text) {
    const lines =
        String(text || '')
            .split(/\n\s*\n/)
            .map(x => x.trim())
            .filter(Boolean);

    if (!lines.length) {
        return {
            updatedFromArticle: '',
            cleanedText: text
        };
    }

    const first =
        lines[0];

    const match =
        first.match(
            /^(?:update|updated)\s+(.+?\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.|am|pm)(?:\s+[A-Z]{2,5})?(?:\s*\([^)]*\))?)\s*:\s*(.*)$/i
        );

    if (match) {
        const timestamp =
            match[1].trim();

        const remainder =
            match[2].trim();

        const cleanedLines =
            lines.slice(1);

        if (
            remainder.length >= 40
        ) {
            cleanedLines.unshift(
                remainder
            );
        }

        return {
            updatedFromArticle:
                timestamp,

            cleanedText:
                cleanedLines
                    .join('\n\n')
                    .trim()
        };
    }

    return {
        updatedFromArticle: '',
        cleanedText: text
    };
}

/* ============================================================
   FINAL CLEAN
   ============================================================ */

function finalClean(text) {
    let result =
        String(text || '')
            .trim();

    result =
        result.replace(
            /^(?:advertisement|advertising)\s*/i,
            ''
        );

    result =
        result.replace(
            /\n\s*(?:tags?|categories?)\s*:.*$/is,
            ''
        );

    result =
        result.replace(
            /\n\s*(?:related stories|related articles|you may also like)\s*:.*$/is,
            ''
        );

    return result.trim();
}

/* ============================================================
   FLARESOLVERR
   ============================================================ */

const FLARESOLVERR_URL =
    process.env.FLARESOLVERR_URL ||
    'http://10.0.2.5:8191/v1';

async function fetchWithFlareSolverr(url, log) {
    log.info(`FlareSolverr recovery started: ${url}`);

    try {
        const response =
            await fetch(
                FLARESOLVERR_URL,
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body: JSON.stringify({
                        cmd: 'request.get',

                        url,

                        maxTimeout: 120000
                    }),

                    signal:
                        AbortSignal.timeout(
                            130000
                        )
                }
            );

        if (!response.ok) {
            throw new Error(
                `FlareSolverr HTTP ${response.status}`
            );
        }

        const data =
            await response.json();

        if (
            data.status !== 'ok' ||
            !data.solution
        ) {
            throw new Error(
                data.message ||
                'FlareSolverr returned no solution'
            );
        }

        const html =
            data.solution.response || '';

        const status =
            data.solution.status || null;

        const finalUrl =
            data.solution.url || url;

        if (!html.trim()) {
            throw new Error(
                'FlareSolverr returned empty HTML'
            );
        }

        log.info(
            `FlareSolverr returned ${html.length} HTML characters, status ${status}`
        );

        return {
            success: true,

            html,

            status,

            url: finalUrl
        };

    } catch (error) {

        log.info(
            `FlareSolverr failed: ${error.message}`
        );

        return {
            success: false,

            html: '',

            status: null,

            url,

            error:
                error.message
        };
    }
}

/* ============================================================
   EXTRACT ARTICLE FROM RECOVERED HTML
   ============================================================ */

function extractArticleFromRecoveredHtml(
    html,
    requestedUrl,
    log
) {
    const source = String(html || '');

    if (!source.trim()) {
        log.info(
            `Recovered HTML is empty: ${requestedUrl}`
        );

        return {
            url: requestedUrl,
            title: '',
            description: '',
            articleText: '',
            articleTextLength: 0,
            articleWordCount: 0,
            articleExtractionMethod:
                'recovered-html-empty',
            articleExtractionValid: false,
            articleExtractionFailureReason:
                'recovered-html-empty',
            articleUpdatedFromBody: '',
            articleUpdatedFromStructured: '',
            articleIsLivePage: false
        };
    }

    const title =
        extractPageTitle(source);

    const descriptionMatch =
        source.match(
            /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
        ) ||
        source.match(
            /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i
        ) ||
        source.match(
            /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i
        ) ||
        source.match(
            /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i
        );

    const description =
        descriptionMatch
            ? normalizeText(descriptionMatch[1])
            : '';

    /* ========================================================
       BLOCKED / CHALLENGE PAGE CHECK
       ======================================================== */

    if (
        isBlockedPage(
            source,
            htmlToVisibleText(source)
        )
    ) {
        log.info(
            `Recovered HTML is still blocked/challenge page: ${requestedUrl}`
        );

        return {
            url: requestedUrl,
            title,
            description,
            articleText: '',
            articleTextLength: 0,
            articleWordCount: 0,
            articleExtractionMethod:
                'recovered-blocked-page',
            articleExtractionValid: false,
            articleExtractionFailureReason:
                'recovered-page-still-blocked-or-captcha',
            articleUpdatedFromBody: '',
            articleUpdatedFromStructured: '',
            articleIsLivePage: false
        };
    }

    /* ========================================================
       LIVE PAGE DETECTION
       ======================================================== */

    const liveSignals = [
        /live updates?/i,
        /live blog/i,
        /live coverage/i,
        /live tracker/i,
        /live briefing/i,
        /minute[- ]by[- ]minute/i
    ];

    const isLivePage =
        liveSignals.some(
            pattern =>
                pattern.test(title) ||
                pattern.test(source)
        );

    let articleText = '';
    let method = '';
    let structuredUpdate = null;

    /* ========================================================
       LIVE PAGE
       ======================================================== */

    if (isLivePage) {

        structuredUpdate =
            extractStructuredLiveUpdate(
                source,
                title,
                description
            );

        if (structuredUpdate) {

            const domUpdate =
                extractLiveUpdateFromDom(
                    source,
                    structuredUpdate
                );

            if (
                domUpdate &&
                wordCount(domUpdate.body) >= 50
            ) {
                articleText =
                    domUpdate.body;

                method =
                    'recovered-live-update-dom';

            } else {
                articleText =
                    structuredUpdate.body;

                method =
                    'recovered-live-update-structured';
            }

        } else {

            const live =
                extractLiveUpdateFallback(
                    source,
                    title,
                    description
                );

            if (live) {
                articleText =
                    live.body;

                method =
                    'recovered-live-update-matched';
            }
        }

    } else {

        /* ====================================================
           NORMAL ARTICLE
           ==================================================== */

        const normal =
            extractNormalArticle(
                source,
                title,
                description
            );

        articleText =
            normal.text;

        method =
            `recovered-${normal.method}`;
    }

    /* ========================================================
       UPDATE NOTICE
       ======================================================== */

    const updateInfo =
        extractUpdateNotice(
            articleText
        );

    articleText =
        finalClean(
            updateInfo.cleanedText
        );

    /* ========================================================
       FINAL BLOCK CHECK
       ======================================================== */

    const blockedAfterExtraction =
        isBlockedPage(
            source,
            articleText
        );

    /* ========================================================
       FINAL VALIDATION
       ======================================================== */

    const finalWordCount =
        wordCount(articleText);

    const extractionValid =
        !blockedAfterExtraction &&
        finalWordCount >= 50;

    if (!extractionValid) {
        log.info(
            `Recovered extraction invalid: ${requestedUrl} (${finalWordCount} words)`
        );
    } else {
        log.info(
            `Recovered extraction valid: ${requestedUrl} (${finalWordCount} words)`
        );
    }

    return {
        url: requestedUrl,

        title,

        description,

        articleText,

        articleTextLength:
            articleText.length,

        articleWordCount:
            finalWordCount,

        articleExtractionMethod:
            blockedAfterExtraction
                ? 'recovered-blocked-page'
                : method,

        articleExtractionValid:
            extractionValid,

        articleExtractionFailureReason:
            blockedAfterExtraction
                ? 'recovered-page-still-blocked-or-captcha'
                : extractionValid
                    ? ''
                    : 'recovered-article-text-too-short',

        articleUpdatedFromBody:
            updateInfo.updatedFromArticle ||
            '',

        articleUpdatedFromStructured:
            structuredUpdate?.modified ||
            structuredUpdate?.published ||
            '',

        articleIsLivePage:
            isLivePage
    };
}

/* ============================================================
   CHEERIO CRAWLER
   ============================================================ */

const crawler = new CheerioCrawler({
    requestQueue,

    maxConcurrency: 1,

    maxRequestsPerCrawl: 1000,

    async requestHandler({
        request,
        $,
        log,
        pushData
    }) {
        const url =
            request.loadedUrl ||
            request.url;

        const html =
            $.html();

        const storyTitle =
            extractPageTitle(html);

        const storyDescription =
            $('meta[name="description"]')
                .attr('content') ||
            $('meta[property="og:description"]')
                .attr('content') ||
            '';

        /* ========================================================
           EMPTY HTML
           ======================================================== */

        if (!html.trim()) {
            await pushData({
                url,

                title:
                    storyTitle,

                description:
                    storyDescription,

                articleText: '',

                articleTextLength: 0,

                articleWordCount: 0,

                articleExtractionMethod:
                    'publisher-html-empty',

                articleExtractionValid:
                    false,

                articleExtractionFailureReason:
                    'publisher-html-empty',

                articleUpdatedFromBody:
                    '',

                articleUpdatedFromStructured:
                    '',

                articleIsLivePage:
                    false
            });

            log.info(
                `Extraction failed: empty HTML - ${url}`
            );

            return;
        }

        /* ========================================================
           BLOCKED PAGE CHECK
           ======================================================== */

        if (
            isBlockedPage(
                html,
                htmlToVisibleText(html)
            )
        ) {
            await pushData({
                url,

                title:
                    storyTitle,

                description:
                    storyDescription,

                articleText: '',

                articleTextLength: 0,

                articleWordCount: 0,

                articleExtractionMethod:
                    'blocked-page',

                articleExtractionValid:
                    false,

                articleExtractionFailureReason:
                    'publisher-blocked-or-captcha',

                articleUpdatedFromBody:
                    '',

                articleUpdatedFromStructured:
                    '',

                articleIsLivePage:
                    false
            });

            log.info(
                `Blocked/challenge page detected: ${url}`
            );

            return;
        }

        /* ========================================================
           LIVE PAGE DETECTION
           ======================================================== */

        const liveSignals = [
            /live updates?/i,
            /live blog/i,
            /live coverage/i,
            /live tracker/i,
            /live briefing/i,
            /minute[- ]by[- ]minute/i
        ];

        const isLivePage =
            liveSignals.some(
                pattern =>
                    pattern.test(storyTitle) ||
                    pattern.test(html)
            );

        let articleText = '';
        let method = '';

        let structuredUpdate = null;

        /* ========================================================
           LIVE PAGE
           ======================================================== */

        if (isLivePage) {

            structuredUpdate =
                extractStructuredLiveUpdate(
                    html,
                    storyTitle,
                    storyDescription
                );

            if (structuredUpdate) {

                const domUpdate =
                    extractLiveUpdateFromDom(
                        html,
                        structuredUpdate
                    );

                if (
                    domUpdate &&
                    wordCount(domUpdate.body) >= 50
                ) {
                    articleText =
                        domUpdate.body;

                    method =
                        'live-update-dom';

                } else {
                    articleText =
                        structuredUpdate.body;

                    method =
                        'live-update-structured';
                }

            } else {

                const live =
                    extractLiveUpdateFallback(
                        html,
                        storyTitle,
                        storyDescription
                    );

                if (live) {
                    articleText =
                        live.body;

                    method =
                        'live-update-matched';

                } else {
                    await pushData({
                        url,

                        title:
                            storyTitle,

                        description:
                            storyDescription,

                        articleText: '',

                        articleTextLength: 0,

                        articleWordCount: 0,

                        articleExtractionMethod:
                            'live-update-no-match',

                        articleExtractionValid:
                            false,

                        articleExtractionFailureReason:
                            'could-not-match-google-selected-story-to-live-update',

                        articleUpdatedFromBody:
                            '',

                        articleUpdatedFromStructured:
                            '',

                        articleIsLivePage:
                            true
                    });

                    log.info(
                        `Could not match live update: ${url}`
                    );

                    return;
                }
            }

        } else {

            /* ====================================================
               NORMAL ARTICLE
               ==================================================== */

            const normal =
                extractNormalArticle(
                    html,
                    storyTitle,
                    storyDescription
                );

            articleText =
                normal.text;

            method =
                normal.method;
        }

        /* ========================================================
           UPDATE NOTICE
           ======================================================== */

        const updateInfo =
            extractUpdateNotice(
                articleText
            );

        articleText =
            finalClean(
                updateInfo.cleanedText
            );

        /* ========================================================
           FINAL BLOCK CHECK
           ======================================================== */

        const blockedAfterExtraction =
            isBlockedPage(
                html,
                articleText
            );

        /* ========================================================
           STEP 4 OUTPUT
           ======================================================== */

        const finalWordCount =
            wordCount(articleText);

        const extractionValid =
            !blockedAfterExtraction &&
            finalWordCount >= 50;

        await pushData({
            url,

            title:
                storyTitle,

            description:
                storyDescription,

            articleText,

            articleTextLength:
                articleText.length,

            articleWordCount:
                finalWordCount,

            articleExtractionMethod:
                blockedAfterExtraction
                    ? 'blocked-page'
                    : method,

            articleExtractionValid:
                extractionValid,

            articleExtractionFailureReason:
                blockedAfterExtraction
                    ? 'publisher-blocked-or-captcha'
                    : extractionValid
                        ? ''
                        : 'article-text-too-short',

            articleUpdatedFromBody:
                updateInfo.updatedFromArticle ||
                '',

            articleUpdatedFromStructured:
                structuredUpdate?.modified ||
                structuredUpdate?.published ||
                '',

            articleIsLivePage:
                isLivePage
        });

            log.info(
            `Extracted ${finalWordCount} words from ${url} using ${method}`
        );
    },

    async failedRequestHandler({ request, log, error }) {
        log.error(
            `REQUEST FAILED: ${request.url}`
        );

        log.error(
            `ERROR MESSAGE: ${error?.message || 'unknown error'}`
        );

        log.error(
            `ERROR STACK: ${error?.stack || 'no stack available'}`
        );
    }
});


/* ============================================================
   PLAYWRIGHT CRAWLER
   ============================================================ */

const playwrightCrawler = new PlaywrightCrawler({
    maxConcurrency: 1,

    maxRequestsPerCrawl: 100,

    async requestHandler({ request, page, log }) {
        const url =
            request.loadedUrl ||
            request.url;

        log.info(`Playwright recovery started: ${url}`);

        await page.waitForLoadState('domcontentloaded');

        const html =
            await page.content();

        const storyTitle =
            await page.title();

        const storyDescription =
            await page
                .locator('meta[name="description"]')
                .getAttribute('content')
                .catch(() => null) ||
            await page
                .locator('meta[property="og:description"]')
                .getAttribute('content')
                .catch(() => null) ||
            '';

        if (!html.trim()) {
            log.info(
                `Playwright recovery received empty HTML: ${url}`
            );

            return {
                url,
                title: storyTitle,
                description: storyDescription,
                articleText: '',
                articleTextLength: 0,
                articleWordCount: 0,
                articleExtractionMethod:
                    'publisher-html-empty',
                articleExtractionValid: false,
                articleExtractionFailureReason:
                    'publisher-html-empty',
                articleUpdatedFromBody: '',
                articleUpdatedFromStructured: '',
                articleIsLivePage: false
            };
        }

        if (
            isBlockedPage(
                html,
                htmlToVisibleText(html)
            )
        ) {
            log.info(
                `Playwright recovery found blocked page: ${url}`
            );

            return {
                url,
                title: storyTitle,
                description: storyDescription,
                articleText: '',
                articleTextLength: 0,
                articleWordCount: 0,
                articleExtractionMethod:
                    'blocked-page',
                articleExtractionValid: false,
                articleExtractionFailureReason:
                    'publisher-blocked-or-captcha',
                articleUpdatedFromBody: '',
                articleUpdatedFromStructured: '',
                articleIsLivePage: false
            };
        }

        const liveSignals = [
            /live updates?/i,
            /live blog/i,
            /live coverage/i,
            /live tracker/i,
            /live briefing/i,
            /minute[- ]by[- ]minute/i
        ];

        const isLivePage =
            liveSignals.some(
                pattern =>
                    pattern.test(storyTitle) ||
                    pattern.test(html)
            );

        let articleText = '';
        let method = '';
        let structuredUpdate = null;

        if (isLivePage) {
            structuredUpdate =
                extractStructuredLiveUpdate(
                    html,
                    storyTitle,
                    storyDescription
                );

            if (structuredUpdate) {
                const domUpdate =
                    extractLiveUpdateFromDom(
                        html,
                        structuredUpdate
                    );

                if (
                    domUpdate &&
                    wordCount(domUpdate.body) >= 50
                ) {
                    articleText =
                        domUpdate.body;

                    method =
                        'live-update-dom';
                } else {
                    articleText =
                        structuredUpdate.body;

                    method =
                        'live-update-structured';
                }
            } else {
                const live =
                    extractLiveUpdateFallback(
                        html,
                        storyTitle,
                        storyDescription
                    );

                if (live) {
                    articleText =
                        live.body;

                    method =
                        'live-update-matched';
                }
            }
        } else {
            const normal =
                extractNormalArticle(
                    html,
                    storyTitle,
                    storyDescription
                );

            articleText =
                normal.text;

            method =
                normal.method;
        }

        const updateInfo =
            extractUpdateNotice(
                articleText
            );

        articleText =
            finalClean(
                updateInfo.cleanedText
            );

        const blockedAfterExtraction =
            isBlockedPage(
                html,
                articleText
            );

        const finalWordCount =
            wordCount(articleText);

        const extractionValid =
            !blockedAfterExtraction &&
            finalWordCount >= 50;

        log.info(
            `Playwright extracted ${finalWordCount} words from ${url} using ${method}`
        );

        return {
            url,
            title: storyTitle,
            description: storyDescription,
            articleText,
            articleTextLength: articleText.length,
            articleWordCount: finalWordCount,
            articleExtractionMethod:
                blockedAfterExtraction
                    ? 'blocked-page'
                    : method,
            articleExtractionValid:
                extractionValid,
            articleExtractionFailureReason:
                blockedAfterExtraction
                    ? 'publisher-blocked-or-captcha'
                    : extractionValid
                        ? ''
                        : 'article-text-too-short',
            articleUpdatedFromBody:
                updateInfo.updatedFromArticle || '',
            articleUpdatedFromStructured:
                structuredUpdate?.modified ||
                structuredUpdate?.published ||
                '',
            articleIsLivePage:
                isLivePage
        };
    }
});

/* ============================================================
   SCRAPE ENDPOINT
   ============================================================ */

app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({
            success: false,
            error: 'URL is required',
        });
    }

    try {
        if (crawler.running) {
            const result = await crawler.addRequests([url]);

            return res.json({
                success: true,
                message: `Added ${url} to the running Crawlee queue.`,
                requestId: result?.processedRequests?.[0]?.uniqueKey || null,
            });
        }

        crawler.run([url]).catch(error => {
            console.error('Crawler error:', error);
        });

        return res.json({
            success: true,
            message: `Started Crawlee for ${url}.`,
            requestId: null,
        });
    } catch (error) {
        console.error('Failed to start crawler:', error);

        return res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/* ============================================================
   SERVER
   ============================================================ */

const PORT =
    process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(
        `Crawlee Cheerio server listening on port ${PORT}`
    );
});
