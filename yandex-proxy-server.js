// yandex-proxy-server.js
// Node.js server to proxy Yandex Maps requests and bypass CORS restrictions

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const app = express();
const PORT = 3001;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

/**
 * Proxy endpoint to fetch Yandex Maps page content
 */
app.get('/api/yandex-maps', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    console.log(`Fetching Yandex Maps page: ${url}`);

    // Fetch the page content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    console.log(`Page fetched successfully, length: ${html.length}`);

    // Parse the HTML to extract reviews
    const reviews = extractReviewsFromHTML(html);
    
    res.json({
      success: true,
      reviews: reviews,
      totalReviews: reviews.length,
      url: url
    });

  } catch (error) {
    console.error('Error fetching Yandex Maps:', error);
    res.status(500).json({ 
      error: 'Failed to fetch Yandex Maps data',
      message: error.message 
    });
  }
});

/**
 * Extract reviews from Yandex Maps HTML content
 */
function extractReviewsFromHTML(html) {
  const reviews = [];
  
  try {
    const $ = cheerio.load(html);
    
    // Look for review elements in the HTML
    // Yandex Maps uses various selectors for reviews
    const reviewSelectors = [
      '.business-review-view',
      '.review-item',
      '.review',
      '[data-review-id]',
      '.business-reviews-item',
      '.reviews-item'
    ];

    for (const selector of reviewSelectors) {
      const elements = $(selector);
      
      if (elements.length > 0) {
        console.log(`Found ${elements.length} reviews with selector: ${selector}`);
        
        elements.each((index, element) => {
          const $review = $(element);
          
          // Extract review text
          const textSelectors = [
            '.business-review-view__body',
            '.review-text',
            '.review-content',
            '.business-review-view__text',
            '.review-body'
          ];
          
          let reviewText = '';
          for (const textSelector of textSelectors) {
            const textElement = $review.find(textSelector);
            if (textElement.length > 0) {
              reviewText = textElement.text().trim();
              break;
            }
          }
          
          // Extract rating
          const ratingSelectors = [
            '.business-review-view__rating',
            '.review-rating',
            '.rating',
            '[data-rating]'
          ];
          
          let rating = 5; // default
          for (const ratingSelector of ratingSelectors) {
            const ratingElement = $review.find(ratingSelector);
            if (ratingElement.length > 0) {
              const ratingText = ratingElement.text().trim();
              const ratingMatch = ratingText.match(/(\d+)/);
              if (ratingMatch) {
                rating = parseInt(ratingMatch[1]);
                break;
              }
            }
          }
          
          // Extract author name
          const authorSelectors = [
            '.business-review-view__author',
            '.review-author',
            '.author-name',
            '.business-review-view__name'
          ];
          
          let author = 'Anonymous';
          for (const authorSelector of authorSelectors) {
            const authorElement = $review.find(authorSelector);
            if (authorElement.length > 0) {
              author = authorElement.text().trim();
              break;
            }
          }
          
          // Extract date
          const dateSelectors = [
            '.business-review-view__date',
            '.review-date',
            '.date',
            '.business-review-view__time'
          ];
          
          let date = new Date().toISOString().split('T')[0];
          for (const dateSelector of dateSelectors) {
            const dateElement = $review.find(dateSelector);
            if (dateElement.length > 0) {
              const dateText = dateElement.text().trim();
              // Try to parse the date
              const parsedDate = new Date(dateText);
              if (!isNaN(parsedDate.getTime())) {
                date = parsedDate.toISOString().split('T')[0];
                break;
              }
            }
          }
          
          // Only add review if we have text
          if (reviewText && reviewText.length > 0) {
            reviews.push({
              text: reviewText,
              rating: rating,
              author: author,
              date: date,
              language: detectLanguage(reviewText)
            });
          }
        });
        
        // If we found reviews with this selector, break
        if (reviews.length > 0) {
          break;
        }
      }
    }
    
    // If no reviews found with selectors, try to extract from JSON data
    if (reviews.length === 0) {
      const jsonReviews = extractReviewsFromJSON(html);
      reviews.push(...jsonReviews);
    }
    
  } catch (error) {
    console.error('Error parsing HTML:', error);
  }
  
  return reviews;
}

/**
 * Extract reviews from JSON data embedded in the page
 */
function extractReviewsFromJSON(html) {
  const reviews = [];
  
  try {
    // Look for JSON data in script tags
    const scriptRegex = /<script[^>]*>[\s\S]*?window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});[\s\S]*?<\/script>/i;
    const match = html.match(scriptRegex);
    
    if (match) {
      const jsonData = JSON.parse(match[1]);
      console.log('Found INITIAL_STATE data:', Object.keys(jsonData));
      
      // Navigate through the JSON structure to find reviews
      const findReviewsInObject = (obj, path = '') => {
        if (typeof obj !== 'object' || obj === null) return;
        
        for (const [key, value] of Object.entries(obj)) {
          const currentPath = path ? `${path}.${key}` : key;
          
          if (key.toLowerCase().includes('review') && Array.isArray(value)) {
            console.log(`Found reviews array at: ${currentPath}`);
            
            value.forEach(review => {
              if (typeof review === 'object' && review.text) {
                reviews.push({
                  text: review.text,
                  rating: review.rating || review.score || 5,
                  author: review.author?.name || review.user?.name || 'Anonymous',
                  date: review.date || review.created_at || new Date().toISOString().split('T')[0],
                  language: detectLanguage(review.text)
                });
              }
            });
          } else if (typeof value === 'object') {
            findReviewsInObject(value, currentPath);
          }
        }
      };
      
      findReviewsInObject(jsonData);
    }
    
  } catch (error) {
    console.error('Error extracting JSON reviews:', error);
  }
  
  return reviews;
}

/**
 * Simple language detection
 */
function detectLanguage(text) {
  const cyrillicPattern = /[а-яё]/i;
  const turkishPattern = /[çğıöşü]/i;
  
  if (cyrillicPattern.test(text)) {
    return 'ru';
  } else if (turkishPattern.test(text)) {
    return 'tr';
  } else {
    return 'en';
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Yandex Maps proxy server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API endpoint: http://localhost:${PORT}/api/yandex-maps?url=<yandex_url>`);
});

module.exports = app;
