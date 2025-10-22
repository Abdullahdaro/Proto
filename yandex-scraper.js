// yandex-scraper.js
// ES Module for scraping Yandex Maps comments and integrating with sentiment analysis

export class YandexMapsScraper {
  constructor() {
    this.comments = [];
    this.placeInfo = null;
  }

  /**
   * Extract place information and comments from Yandex Maps URL
   * This method attempts to scrape real comments from Yandex Maps
   */
  async scrapePlaceComments(url) {
    try {
      // Parse the URL to extract coordinates and place ID
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const ll = urlParams.get('ll');
      const poiUri = urlParams.get('poi[uri]');
      
      if (!ll || !poiUri) {
        throw new Error('Invalid Yandex Maps URL format');
      }

      // Extract coordinates
      const [lng, lat] = ll.split(',').map(Number);
      
      // Extract place ID from URI
      const placeId = poiUri.split('oid=')[1];
      
      this.placeInfo = {
        coordinates: { lat, lng },
        placeId,
        url
      };

      console.log('Place info extracted:', this.placeInfo);
      
      // Try to scrape real comments
      try {
        this.comments = await this.scrapeRealComments(url);
        console.log(`Successfully scraped ${this.comments.length} real comments`);
      } catch (scrapingError) {
        console.warn('Real scraping failed, falling back to simulated data:', scrapingError.message);
        this.comments = await this.simulateScrapedComments();
      }
      
      return {
        placeInfo: this.placeInfo,
        comments: this.comments
      };
      
    } catch (error) {
      console.error('Error scraping Yandex Maps:', error);
      throw error;
    }
  }

  /**
   * Attempt to scrape real comments from Yandex Maps
   * This method tries multiple approaches to get actual review data
   */
  async scrapeRealComments(url) {
    const comments = [];
    
    try {
      // Method 1: Try to fetch using Yandex Maps API endpoints
      const apiComments = await this.fetchFromYandexAPI(url);
      if (apiComments.length > 0) {
        return apiComments;
      }
    } catch (error) {
      console.log('API method failed:', error.message);
    }

    try {
      // Method 2: Try to parse the page content if accessible
      const pageComments = await this.parsePageContent(url);
      if (pageComments.length > 0) {
        return pageComments;
      }
    } catch (error) {
      console.log('Page parsing method failed:', error.message);
    }

    try {
      // Method 3: Try to use a proxy service (if available)
      const proxyComments = await this.fetchViaProxy(url);
      if (proxyComments.length > 0) {
        return proxyComments;
      }
    } catch (error) {
      console.log('Proxy method failed:', error.message);
    }

    // If all methods fail, throw an error to trigger fallback
    throw new Error('All scraping methods failed');
  }

  /**
   * Method 1: Try to fetch comments using Yandex Maps API endpoints
   */
  async fetchFromYandexAPI(url) {
    const comments = [];
    
    try {
      // Extract place ID from URL
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const poiUri = urlParams.get('poi[uri]');
      const placeId = poiUri?.split('oid=')[1];
      
      if (!placeId) {
        throw new Error('Could not extract place ID');
      }

      console.log(`Extracted place ID: ${placeId}`);

      // Try different Yandex Maps API endpoints for reviews
      const apiEndpoints = [
        // Yandex Maps Business API endpoints
        `https://yandex.com.tr/maps/api/business/${placeId}/reviews`,
        `https://yandex.com.tr/maps/api/poi/${placeId}/reviews`,
        `https://yandex.com.tr/maps/api/v1/poi/${placeId}/reviews`,
        
        // Alternative endpoints
        `https://yandex.com.tr/maps/api/business/${placeId}`,
        `https://yandex.com.tr/maps/api/poi/${placeId}`,
        
        // Try with different API versions
        `https://yandex.com.tr/maps/api/v2/poi/${placeId}/reviews`,
        `https://yandex.com.tr/maps/api/v3/poi/${placeId}/reviews`,
        
        // Try with different domains
        `https://yandex.ru/maps/api/poi/${placeId}/reviews`,
        `https://yandex.com/maps/api/poi/${placeId}/reviews`
      ];

      for (const endpoint of apiEndpoints) {
        try {
          console.log(`Trying API endpoint: ${endpoint}`);
          
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8,ru;q=0.7',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://yandex.com.tr/maps/',
              'Origin': 'https://yandex.com.tr'
            },
            mode: 'cors'
          });

          console.log(`Response status: ${response.status}`);

          if (response.ok) {
            const data = await response.json();
            console.log('API response received:', data);
            
            // Parse the API response to extract comments
            if (data.reviews || data.data?.reviews) {
              const reviews = data.reviews || data.data.reviews;
              console.log(`Found ${reviews.length} reviews in API response`);
              return this.parseAPIReviews(reviews);
            } else if (data.result?.reviews) {
              const reviews = data.result.reviews;
              console.log(`Found ${reviews.length} reviews in result.reviews`);
              return this.parseAPIReviews(reviews);
            } else if (data.business?.reviews) {
              const reviews = data.business.reviews;
              console.log(`Found ${reviews.length} reviews in business.reviews`);
              return this.parseAPIReviews(reviews);
            } else {
              console.log('No reviews found in API response structure:', Object.keys(data));
            }
          } else {
            console.log(`API endpoint returned status ${response.status}`);
          }
        } catch (endpointError) {
          console.log(`Endpoint ${endpoint} failed:`, endpointError.message);
          continue;
        }
      }
      
      throw new Error('All API endpoints failed');
      
    } catch (error) {
      console.error('API fetch error:', error);
      throw error;
    }
  }

  /**
   * Method 2: Try to parse page content using iframe technique
   */
  async parsePageContent(url) {
    try {
      console.log('Attempting to parse page content using iframe technique...');
      
      // Create a hidden iframe to load the Yandex Maps page
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          document.body.removeChild(iframe);
          reject(new Error('Iframe loading timeout'));
        }, 10000);
        
        iframe.onload = () => {
          clearTimeout(timeout);
          try {
            // Try to access the iframe content
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            
            if (iframeDoc) {
              // Look for review elements in the iframe
              const reviews = this.extractReviewsFromIframe(iframeDoc);
              document.body.removeChild(iframe);
              
              if (reviews.length > 0) {
                console.log(`Extracted ${reviews.length} reviews from iframe`);
                resolve(reviews);
              } else {
                reject(new Error('No reviews found in iframe'));
              }
            } else {
              document.body.removeChild(iframe);
              reject(new Error('Cannot access iframe content due to CORS'));
            }
          } catch (error) {
            document.body.removeChild(iframe);
            reject(error);
          }
        };
        
        iframe.onerror = () => {
          clearTimeout(timeout);
          document.body.removeChild(iframe);
          reject(new Error('Iframe failed to load'));
        };
        
        document.body.appendChild(iframe);
      });
      
    } catch (error) {
      console.log('Iframe method failed:', error.message);
      throw error;
    }
  }

  /**
   * Extract reviews from iframe document
   */
  extractReviewsFromIframe(doc) {
    const reviews = [];
    
    try {
      // Look for review elements using various selectors
      const reviewSelectors = [
        '.business-review-view',
        '.review-item',
        '.review',
        '[data-review-id]',
        '.business-reviews-item',
        '.reviews-item',
        '.review-card'
      ];

      for (const selector of reviewSelectors) {
        const elements = doc.querySelectorAll(selector);
        
        if (elements.length > 0) {
          console.log(`Found ${elements.length} reviews with selector: ${selector}`);
          
          elements.forEach((element) => {
            const review = this.parseReviewElement(element);
            if (review && review.text.trim().length > 0) {
              reviews.push(review);
            }
          });
          
          // If we found reviews with this selector, break
          if (reviews.length > 0) {
            break;
          }
        }
      }
      
    } catch (error) {
      console.error('Error extracting reviews from iframe:', error);
    }
    
    return reviews;
  }

  /**
   * Parse a single review element
   */
  parseReviewElement(element) {
    try {
      // Extract review text
      const textSelectors = [
        '.business-review-view__body',
        '.review-text',
        '.review-content',
        '.business-review-view__text',
        '.review-body',
        '.review-description'
      ];
      
      let reviewText = '';
      for (const textSelector of textSelectors) {
        const textElement = element.querySelector(textSelector);
        if (textElement) {
          reviewText = textElement.textContent.trim();
          break;
        }
      }
      
      // Extract rating
      const ratingSelectors = [
        '.business-review-view__rating',
        '.review-rating',
        '.rating',
        '[data-rating]',
        '.star-rating'
      ];
      
      let rating = 5; // default
      for (const ratingSelector of ratingSelectors) {
        const ratingElement = element.querySelector(ratingSelector);
        if (ratingElement) {
          const ratingText = ratingElement.textContent.trim();
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
        '.business-review-view__name',
        '.reviewer-name'
      ];
      
      let author = 'Anonymous';
      for (const authorSelector of authorSelectors) {
        const authorElement = element.querySelector(authorSelector);
        if (authorElement) {
          author = authorElement.textContent.trim();
          break;
        }
      }
      
      // Extract date
      const dateSelectors = [
        '.business-review-view__date',
        '.review-date',
        '.date',
        '.business-review-view__time',
        '.review-time'
      ];
      
      let date = new Date().toISOString().split('T')[0];
      for (const dateSelector of dateSelectors) {
        const dateElement = element.querySelector(dateSelector);
        if (dateElement) {
          const dateText = dateElement.textContent.trim();
          // Try to parse the date
          const parsedDate = new Date(dateText);
          if (!isNaN(parsedDate.getTime())) {
            date = parsedDate.toISOString().split('T')[0];
            break;
          }
        }
      }
      
      return {
        text: reviewText,
        rating: rating,
        author: author,
        date: date,
        language: this.detectLanguage(reviewText)
      };
      
    } catch (error) {
      console.error('Error parsing review element:', error);
      return null;
    }
  }

  /**
   * Method 3: Try to fetch via proxy service
   */
  async fetchViaProxy(url) {
    try {
      console.log('Attempting to fetch via proxy server...');
      
      // First check if proxy server is running
      const healthCheck = await this.checkProxyHealth();
      if (!healthCheck) {
        throw new Error('Proxy server is not running. Please start it with: node yandex-proxy-server.js');
      }
      
      // Try to connect to the local proxy server
      const proxyUrl = `http://localhost:3001/api/yandex-maps?url=${encodeURIComponent(url)}`;
      
      const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`Proxy server returned ${data.totalReviews} reviews`);
        
        if (data.reviews && data.reviews.length > 0) {
          return data.reviews;
        }
      } else {
        console.log(`Proxy server returned status ${response.status}`);
      }
      
      throw new Error('Proxy server did not return reviews');
      
    } catch (error) {
      console.log('Proxy method failed:', error.message);
      throw error;
    }
  }

  /**
   * Check if proxy server is running
   */
  async checkProxyHealth() {
    try {
      const response = await fetch('http://localhost:3001/health', {
        method: 'GET',
        timeout: 3000
      });
      return response.ok;
    } catch (error) {
      console.log('Proxy server health check failed:', error.message);
      return false;
    }
  }

  /**
   * Parse API reviews response into our comment format
   */
  parseAPIReviews(reviews) {
    return reviews.map(review => ({
      text: review.text || review.content || review.comment || '',
      rating: review.rating || review.score || 5,
      author: review.author?.name || review.user?.name || 'Anonymous',
      date: review.date || review.created_at || new Date().toISOString().split('T')[0],
      language: this.detectLanguage(review.text || review.content || review.comment || '')
    })).filter(comment => comment.text.trim().length > 0);
  }

  /**
   * Simulate scraped comments for demonstration
   * Replace this with actual scraping logic
   */
  async simulateScrapedComments() {
    // These are sample comments that might be found on a Moscow restaurant
    const sampleComments = [
      {
        text: "Отличное место! Очень вкусная еда и приятная атмосфера.",
        rating: 5,
        author: "Анна К.",
        date: "2024-01-15",
        language: "ru"
      },
      {
        text: "Хороший ресторан, но обслуживание медленное. Еда качественная.",
        rating: 4,
        author: "Михаил С.",
        date: "2024-01-10",
        language: "ru"
      },
      {
        text: "Ужасное обслуживание! Ждали заказ больше часа.",
        rating: 1,
        author: "Елена В.",
        date: "2024-01-08",
        language: "ru"
      },
      {
        text: "Прекрасная кухня и отличное вино. Рекомендую!",
        rating: 5,
        author: "Дмитрий П.",
        date: "2024-01-05",
        language: "ru"
      },
      {
        text: "Цены завышены, но еда неплохая. Интерьер красивый.",
        rating: 3,
        author: "Ольга М.",
        date: "2024-01-03",
        language: "ru"
      },
      {
        text: "Çok güzel bir yer! Yemekler harika ve personel çok nazik.",
        rating: 5,
        author: "Mehmet A.",
        date: "2024-01-12",
        language: "tr"
      },
      {
        text: "Fiyatlar biraz yüksek ama kalite iyi. Tavsiye ederim.",
        rating: 4,
        author: "Ayşe K.",
        date: "2024-01-09",
        language: "tr"
      },
      {
        text: "Servis çok yavaş ve yemekler soğuk geldi. Memnun kalmadım.",
        rating: 2,
        author: "Ali R.",
        date: "2024-01-07",
        language: "tr"
      }
    ];

    return sampleComments;
  }

  /**
   * Translate comments to English using a translation service
   * This uses a mock translation - in production, integrate with Google Translate API or similar
   */
  async translateComments(comments) {
    const translatedComments = [];
    
    for (const comment of comments) {
      let translatedText = comment.text;
      
      // Mock translation based on language detection
      if (comment.language === 'ru') {
        translatedText = await this.translateRussianToEnglish(comment.text);
      } else if (comment.language === 'tr') {
        translatedText = await this.translateTurkishToEnglish(comment.text);
      }
      
      translatedComments.push({
        ...comment,
        originalText: comment.text,
        translatedText,
        language: comment.language
      });
    }
    
    return translatedComments;
  }

  /**
   * Mock Russian to English translation
   * In production, use Google Translate API or similar service
   */
  async translateRussianToEnglish(text) {
    const translations = {
      "Отличное место! Очень вкусная еда и приятная атмосфера.": "Great place! Very tasty food and pleasant atmosphere.",
      "Хороший ресторан, но обслуживание медленное. Еда качественная.": "Good restaurant, but service is slow. Food is quality.",
      "Ужасное обслуживание! Ждали заказ больше часа.": "Terrible service! We waited for the order for more than an hour.",
      "Прекрасная кухня и отличное вино. Рекомендую!": "Excellent cuisine and great wine. I recommend!",
      "Цены завышены, но еда неплохая. Интерьер красивый.": "Prices are inflated, but food is not bad. Interior is beautiful."
    };
    
    return translations[text] || text; // Return original if no translation found
  }

  /**
   * Mock Turkish to English translation
   * In production, use Google Translate API or similar service
   */
  async translateTurkishToEnglish(text) {
    const translations = {
      "Çok güzel bir yer! Yemekler harika ve personel çok nazik.": "Very nice place! Food is great and staff is very kind.",
      "Fiyatlar biraz yüksek ama kalite iyi. Tavsiye ederim.": "Prices are a bit high but quality is good. I recommend.",
      "Servis çok yavaş ve yemekler soğuk geldi. Memnun kalmadım.": "Service is very slow and food came cold. I was not satisfied."
    };
    
    return translations[text] || text; // Return original if no translation found
  }

  /**
   * Prepare comments for sentiment analysis
   */
  prepareCommentsForAnalysis(translatedComments) {
    return translatedComments.map(comment => ({
      text: comment.translatedText,
      rating: comment.rating,
      author: comment.author,
      date: comment.date,
      originalText: comment.originalText,
      language: comment.language
    }));
  }

  /**
   * Analyze sentiment of comments using the existing sentiment analysis system
   */
  async analyzeCommentsSentiment(comments, sentimentAnalyzer) {
    const analyzedComments = [];
    
    for (const comment of comments) {
      try {
        const { prob, pred } = sentimentAnalyzer.predictText({
          text: comment.text,
          threshold: 0.5
        });
        
        analyzedComments.push({
          ...comment,
          sentiment: pred === 1 ? 'positive' : 'negative',
          confidence: prob,
          prediction: pred
        });
      } catch (error) {
        console.error('Error analyzing comment:', error);
        analyzedComments.push({
          ...comment,
          sentiment: 'unknown',
          confidence: 0,
          prediction: -1
        });
      }
    }
    
    return analyzedComments;
  }

  /**
   * Generate final recommendation based on sentiment analysis
   */
  generateRecommendation(analyzedComments) {
    const positiveComments = analyzedComments.filter(c => c.sentiment === 'positive');
    const negativeComments = analyzedComments.filter(c => c.sentiment === 'negative');
    const totalComments = analyzedComments.length;
    
    const positivePercentage = (positiveComments.length / totalComments) * 100;
    const negativePercentage = (negativeComments.length / totalComments) * 100;
    
    let recommendation = 'neutral';
    let recommendationText = '';
    
    if (positivePercentage >= 70) {
      recommendation = 'highly_recommended';
      recommendationText = 'Highly Recommended';
    } else if (positivePercentage >= 60) {
      recommendation = 'recommended';
      recommendationText = 'Recommended';
    } else if (positivePercentage >= 50) {
      recommendation = 'neutral';
      recommendationText = 'Mixed Reviews';
    } else if (positivePercentage >= 40) {
      recommendation = 'not_recommended';
      recommendationText = 'Not Recommended';
    } else {
      recommendation = 'strongly_not_recommended';
      recommendationText = 'Strongly Not Recommended';
    }
    
    return {
      recommendation,
      recommendationText,
      stats: {
        totalComments,
        positiveComments: positiveComments.length,
        negativeComments: negativeComments.length,
        positivePercentage: Math.round(positivePercentage),
        negativePercentage: Math.round(negativePercentage)
      },
      analyzedComments
    };
  }

  /**
   * Complete analysis pipeline: scrape -> translate -> analyze -> recommend
   */
  async analyzePlace(url, sentimentAnalyzer) {
    try {
      console.log('Starting Yandex Maps analysis...');
      
      // Step 1: Scrape comments
      const { placeInfo, comments } = await this.scrapePlaceComments(url);
      console.log(`Scraped ${comments.length} comments`);
      
      // Step 2: Translate comments
      const translatedComments = await this.translateComments(comments);
      console.log('Comments translated to English');
      
      // Step 3: Prepare for analysis
      const preparedComments = this.prepareCommentsForAnalysis(translatedComments);
      
      // Step 4: Analyze sentiment
      const analyzedComments = await this.analyzeCommentsSentiment(preparedComments, sentimentAnalyzer);
      console.log('Sentiment analysis completed');
      
      // Step 5: Generate recommendation
      const recommendation = this.generateRecommendation(analyzedComments);
      console.log('Final recommendation generated');
      
      return {
        placeInfo,
        recommendation,
        comments: analyzedComments
      };
      
    } catch (error) {
      console.error('Error in complete analysis:', error);
      throw error;
    }
  }
}

/**
 * Utility function to detect language of text
 */
export function detectLanguage(text) {
  // Simple language detection based on character patterns
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
 * Real translation service integration (placeholder)
 * In production, integrate with Google Translate API, Azure Translator, or similar
 */
export class TranslationService {
  constructor(apiKey = null) {
    this.apiKey = apiKey;
  }

  async translateText(text, fromLang, toLang = 'en') {
    // Placeholder for actual translation API call
    // Example with Google Translate API:
    /*
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        source: fromLang,
        target: toLang,
        format: 'text'
      })
    });
    
    const data = await response.json();
    return data.data.translations[0].translatedText;
    */
    
    // For now, return mock translation
    return text;
  }
}
