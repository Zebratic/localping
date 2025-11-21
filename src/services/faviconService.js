const axios = require('axios');

class FaviconService {
  /**
   * Get favicon for a URL
   * Tries multiple methods to find the favicon
   * @param {string} url - The URL to get favicon from (e.g., https://example.com)
   * @returns {Promise<string|null>} - Base64 encoded favicon data or null if not found
   */
  async getFavicon(url, options = {}) {
    if (!url) return null;

    try {
      // Normalize URL
      const urlObj = new URL(url);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

      // Method 1: Try /favicon.ico
      const faviconUrl = `${baseUrl}/favicon.ico`;
      const faviconData = await this.fetchFaviconAsBase64(faviconUrl);
      if (faviconData) {
        return faviconData;
      }

      // Method 2: Try fetching HTML and looking for favicon link tag
      const htmlFavicon = await this.getFaviconFromHtml(baseUrl, options);
      if (htmlFavicon) {
        return htmlFavicon;
      }

      // Method 3: Use Google's favicon service as fallback
      const googleFavicon = await this.getFaviconFromGoogle(baseUrl);
      if (googleFavicon) {
        return googleFavicon;
      }

      return null;
    } catch (error) {
      console.error(`Error getting favicon for ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch favicon file and convert to base64
   */
  async fetchFaviconAsBase64(url) {
    try {
      const response = await axios.get(url, {
        timeout: 5000,
        responseType: 'arraybuffer',
        validateStatus: (status) => status < 400,
        maxRedirects: 5,
      });

      if (response.status === 200 && response.data && response.data.length > 0) {
        const base64 = Buffer.from(response.data).toString('base64');
        const mimeType = this.getMimeType(response.headers['content-type']);
        return `data:${mimeType};base64,${base64}`;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse HTML and extract favicon link
   */
  async getFaviconFromHtml(baseUrl, options = {}) {
    try {
      const axiosConfig = {
        timeout: options.timeout || 5000,
        validateStatus: (status) => status < 400,
        maxRedirects: options.maxRedirects || 5,
      };

      // Handle SSL/TLS options
      if (options.ignoreSsl === true) {
        const httpsAgent = require('https').Agent({ rejectUnauthorized: false });
        const httpAgent = require('http').Agent({ rejectUnauthorized: false });
        axiosConfig.httpsAgent = httpsAgent;
        axiosConfig.httpAgent = httpAgent;
      }

      // Handle authentication
      if (options.auth) {
        if (options.auth.type === 'basic') {
          axiosConfig.auth = {
            username: options.auth.username,
            password: options.auth.password,
          };
        } else if (options.auth.type === 'bearer') {
          axiosConfig.headers = {
            'Authorization': `Bearer ${options.auth.token}`,
          };
        }
      }

      const response = await axios.get(baseUrl, axiosConfig);

      if (response.status !== 200 || !response.data) {
        return null;
      }

      const html = response.data;

      // Extract all link tags with rel containing icon
      const linkMatches = html.matchAll(/<link[^>]*>/gi);
      const faviconLinks = [];
      
      for (const linkMatch of linkMatches) {
        const linkTag = linkMatch[0];
        const relMatch = linkTag.match(/rel=["']([^"']+)["']/i);
        if (relMatch && /icon/i.test(relMatch[1])) {
          const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
          if (hrefMatch) {
            faviconLinks.push({
              rel: relMatch[1].toLowerCase(),
              href: hrefMatch[1],
              priority: this.getFaviconPriority(relMatch[1])
            });
          }
        }
      }

      // Sort by priority (higher priority first)
      faviconLinks.sort((a, b) => b.priority - a.priority);

      // Try each favicon in priority order
      for (const link of faviconLinks) {
        const iconUrl = this.resolveUrl(link.href, baseUrl);
        const faviconData = await this.fetchFaviconAsBase64(iconUrl);
        if (faviconData) {
          return faviconData;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get favicon URL from HTML (returns URL string instead of base64)
   * Useful for storing just the URL
   */
  async getFaviconUrlFromHtml(baseUrl, options = {}) {
    try {
      const axiosConfig = {
        timeout: options.timeout || 5000,
        validateStatus: (status) => status < 400,
        maxRedirects: options.maxRedirects || 5,
      };

      // Handle SSL/TLS options
      if (options.ignoreSsl === true) {
        const httpsAgent = require('https').Agent({ rejectUnauthorized: false });
        const httpAgent = require('http').Agent({ rejectUnauthorized: false });
        axiosConfig.httpsAgent = httpsAgent;
        axiosConfig.httpAgent = httpAgent;
      }

      // Handle authentication
      if (options.auth) {
        if (options.auth.type === 'basic') {
          axiosConfig.auth = {
            username: options.auth.username,
            password: options.auth.password,
          };
        } else if (options.auth.type === 'bearer') {
          axiosConfig.headers = {
            'Authorization': `Bearer ${options.auth.token}`,
          };
        }
      }

      const response = await axios.get(baseUrl, axiosConfig);

      if (response.status !== 200 || !response.data) {
        return null;
      }

      const html = response.data;

      // Extract all link tags with rel containing icon
      const linkMatches = html.matchAll(/<link[^>]*>/gi);
      const faviconLinks = [];
      
      for (const linkMatch of linkMatches) {
        const linkTag = linkMatch[0];
        const relMatch = linkTag.match(/rel=["']([^"']+)["']/i);
        if (relMatch && /icon/i.test(relMatch[1])) {
          const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
          if (hrefMatch) {
            faviconLinks.push({
              rel: relMatch[1].toLowerCase(),
              href: hrefMatch[1],
              priority: this.getFaviconPriority(relMatch[1])
            });
          }
        }
      }

      // Sort by priority (higher priority first)
      faviconLinks.sort((a, b) => b.priority - a.priority);

      // Return the highest priority favicon URL
      if (faviconLinks.length > 0) {
        return this.resolveUrl(faviconLinks[0].href, baseUrl);
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Use Google's favicon service as fallback
   */
  async getFaviconFromGoogle(baseUrl) {
    try {
      const urlObj = new URL(baseUrl);
      const domain = urlObj.host;
      const googleFaviconUrl = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

      const response = await axios.get(googleFaviconUrl, {
        timeout: 5000,
        responseType: 'arraybuffer',
        validateStatus: (status) => status < 400,
        maxRedirects: 5,
      });

      if (response.status === 200 && response.data && response.data.length > 0) {
        const base64 = Buffer.from(response.data).toString('base64');
        return `data:image/png;base64,${base64}`;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Resolve relative URLs to absolute
   */
  resolveUrl(url, baseUrl) {
    // Remove query strings and fragments for matching
    const cleanUrl = url.split('?')[0].split('#')[0];
    
    if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
      return url; // Return original with query string if present
    }

    try {
      const urlObj = new URL(baseUrl);
      if (cleanUrl.startsWith('/')) {
        return `${urlObj.protocol}//${urlObj.host}${url}`;
      }

      // Handle relative paths
      const basePath = urlObj.pathname || '/';
      const baseDir = basePath.substring(0, basePath.lastIndexOf('/') + 1);
      return `${urlObj.protocol}//${urlObj.host}${baseDir}${url}`;
    } catch (error) {
      // If URL parsing fails, try simple string concatenation
      if (cleanUrl.startsWith('/')) {
        return baseUrl.replace(/\/$/, '') + url;
      }
      return baseUrl.replace(/\/$/, '') + '/' + url;
    }
  }

  /**
   * Get MIME type from content-type header
   */
  getMimeType(contentType) {
    if (!contentType) return 'image/x-icon';

    const type = contentType.split(';')[0].trim();
    if (type.includes('svg')) return 'image/svg+xml';
    if (type.includes('png')) return 'image/png';
    if (type.includes('jpeg') || type.includes('jpg')) return 'image/jpeg';
    if (type.includes('gif')) return 'image/gif';
    if (type.includes('webp')) return 'image/webp';

    return 'image/x-icon';
  }

  /**
   * Get priority for favicon rel types (higher = better)
   */
  getFaviconPriority(rel) {
    const relLower = rel.toLowerCase();
    if (relLower.includes('apple-touch-icon')) return 5;
    if (relLower.includes('icon') && relLower.includes('mask')) return 4;
    if (relLower === 'icon') return 3;
    if (relLower.includes('shortcut') && relLower.includes('icon')) return 2;
    if (relLower.includes('icon')) return 1;
    return 0;
  }
}

module.exports = new FaviconService();
