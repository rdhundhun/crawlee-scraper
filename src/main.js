// src/main.js
import express from 'express';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';

const app = express();
app.use(express.json());

// 1. Open a global RequestQueue to hold URLs from n8n
const requestQueue = await RequestQueue.open();

// 2. Configure the Crawlee crawler (using Playwright since your current file uses it)
const crawler = new PlaywrightCrawler({
    requestQueue,
    // You can keep maxRequestsPerCrawl here if you want, or remove it for unlimited
    maxRequestsPerCrawl: 1000, 
    async requestHandler({ request, page, log, pushData }) {
        const title = await page.title();
        log.info(`Scraped: ${request.url} - ${title}`);

        // Extract your article data here (adjust selectors as needed)
        const articleText = await page.locator('article').innerText().catch(() => 'No article found');
        
        // Save results to the dataset
        await pushData({ title, url: request.loadedUrl, text: articleText });
    },
});

// 3. Create the API endpoint that n8n will call
app.post('/scrape', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // Add the URL from n8n to the crawler's queue
    await crawler.addRequests([url]);
    
    // Start the crawler if it's not already running
    if (!crawler.running) {
        crawler.run().catch(err => console.error(err));
    }

    res.json({ success: true, message: `Added ${url} to the queue.` });
});

// 4. Start the Express server so it never exits
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Crawlee server listening on port ${PORT}`);
});