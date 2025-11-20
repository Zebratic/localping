const axios = require('axios');

class FaviconService {
  /**
   * Get favicon for a URL
   * Tries multiple methods to find the favicon
   * @param {string} url - The URL to get favicon from (e.g., https://example.com)
   * @returns {Promise<string|null>} - Base64 encoded favicon data or null if not found
   */
  async getFavicon(url) {
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
      const htmlFavicon = await this.getFaviconFromHtml(baseUrl);
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
  async getFaviconFromHtml(baseUrl) {
    try {
      const response = await axios.get(baseUrl, {
        timeout: 5000,
        validateStatus: (status) => status < 400,
        maxRedirects: 5,
      });

      if (response.status !== 200 || !response.data) {
        return null;
      }

      const html = response.data;

      // Look for apple-touch-icon first (highest priority)
      let match = html.match(/<link[^>]*rel="apple-touch-icon"[^>]*href="([^"]+)"/i);
      if (match) {
        const iconUrl = this.resolveUrl(match[1], baseUrl);
        return await this.fetchFaviconAsBase64(iconUrl);
      }

      // Look for icon with type attribute (often higher quality)
      match = html.match(/<link[^>]*rel="icon"[^>]*type="image\/png"[^>]*href="([^"]+)"/i);
      if (match) {
        const iconUrl = this.resolveUrl(match[1], baseUrl);
        return await this.fetchFaviconAsBase64(iconUrl);
      }

      // Look for any icon
      match = html.match(/<link[^>]*rel="icon"[^>]*href="([^"]+)"/i);
      if (match) {
        const iconUrl = this.resolveUrl(match[1], baseUrl);
        return await this.fetchFaviconAsBase64(iconUrl);
      }

      // Look for shortcut icon
      match = html.match(/<link[^>]*rel="shortcut icon"[^>]*href="([^"]+)"/i);
      if (match) {
        const iconUrl = this.resolveUrl(match[1], baseUrl);
        return await this.fetchFaviconAsBase64(iconUrl);
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
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    const urlObj = new URL(baseUrl);
    if (url.startsWith('/')) {
      return `${urlObj.protocol}//${urlObj.host}${url}`;
    }

    return `${urlObj.protocol}//${urlObj.host}/${url}`;
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
}

module.exports = new FaviconService();
