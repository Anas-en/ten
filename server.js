const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (player.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// CORS headers for all responses
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Scrape .m3u8 links using Puppeteer
async function scrapeM3U8(url) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const found = new Set();

  page.on('dialog', async dialog => await dialog.accept());

  page.on('response', async response => {
    const respUrl = response.url();
    if (respUrl.endsWith('.m3u8')) {
      console.log('Found .m3u8:', respUrl);
      found.add(respUrl);
    }
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });
//   await page.waitForTimeout(5000); // wait for JS to load
  await browser.close();

  return Array.from(found);
}

// Endpoint: scrape and return .m3u8 links
app.get('/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });

  try {
    const links = await scrapeM3U8(url);
    if (links.length === 0) return res.status(404).json({ message: 'No .m3u8 links found.' });
    res.json({ m3u8: links });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Scraping failed.' });
  }
});

// Proxy endpoint to bypass CORS
// New route: /proxy?url=https://example.com/stream.m3u8
const stream = require('stream');

app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).send('Invalid or missing URL');
  }

  try {
    const response = await axios.get(targetUrl, { responseType: 'text' });
    const contentType = response.headers['content-type'];

    if (contentType.includes('application/vnd.apple.mpegurl') || targetUrl.endsWith('.m3u8')) {
      // Rewrite .ts segment URLs to go through proxy
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const rewritten = response.data.replace(/^(?!#)(.*\.ts)/gm, segment => {
        const absolute = new URL(segment, baseUrl).href;
        return `/proxy?url=${encodeURIComponent(absolute)}`;
      });

      res.set('Content-Type', contentType);
      res.set('Access-Control-Allow-Origin', '*');
      res.send(rewritten);
    } else {
      // For .ts and other media files
      const media = await axios.get(targetUrl, { responseType: 'stream' });
      res.set('Content-Type', media.headers['content-type']);
      res.set('Access-Control-Allow-Origin', '*');
      media.data.pipe(res);
    }
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).send('Bad Gateway');
  }
});




app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});


