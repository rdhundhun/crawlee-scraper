// src/main.js

import express from 'express';
import { CheerioCrawler, RequestQueue } from 'crawlee';

const app = express();

app.use(express.json());

// Shared queue for URLs received from n8n
const requestQueue = await RequestQueue.open();

// Step 3:
// Lightweight normal-page acquisition using CheerioCrawler.
// Playwright and FlareSolverr will be added in later steps.
const crawler = new CheerioCrawler({
    requestQueue,

    maxConcurrency: 1,

    maxRequestsPerCrawl: 1000,

    async requestHandler({ request, $, log, pushData }) {
        const url = request.loadedUrl || request.url;

        const title =
            $('title').first().text().trim() ||
            $('h1').first().text().trim();

        const articleText = $('article')
            .text()
            .replace(/\s+/g, ' ')
            .trim();

        log.info(`Scraped: ${url}`);

        await pushData({
            url,
            title,
            text: articleText,
        });
    },
});

// n8n will call this endpoint later.
app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({
            success: false,
            error: 'URL is required',
        });
    }

    try {
        await crawler.addRequests([url]);

        if (!crawler.running) {
            crawler.run().catch((error) => {
                console.error('Crawler error:', error);
            });
        }

        return res.json({
            success: true,
            message: `Added ${url} to the Crawlee queue.`,
        });
    } catch (error) {
        console.error('Failed to queue URL:', error);

        return res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Crawlee Cheerio server listening on port ${PORT}`);
});
