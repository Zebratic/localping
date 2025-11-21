/**
 * In-memory cache service for database queries
 * Improves performance by caching frequently accessed data
 */

class CacheService {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 60000; // 60 seconds default TTL
    this.maxSize = 1000; // Maximum cache entries
  }

  /**
   * Generate a cache key from collection name and query
   */
  generateKey(collection, query, options = {}) {
    const queryStr = JSON.stringify(query || {});
    const optionsStr = JSON.stringify(options || {});
    return `${collection}:${queryStr}:${optionsStr}`;
  }

  /**
   * Get cached value
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set cached value with TTL
   */
  set(key, value, ttl = null) {
    // If cache is too large, remove oldest entries
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, { value, expiresAt, createdAt: Date.now() });
  }

  /**
   * Remove entry from cache
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Invalidate all entries for a collection
   */
  invalidateCollection(collection) {
    const keysToDelete = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${collection}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Invalidate all cache entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Remove oldest entries when cache is full
   */
  evictOldest() {
    const entries = Array.from(this.cache.entries())
      .map(([key, value]) => ({ key, createdAt: value.createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt);

    // Remove oldest 10% of entries
    const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i].key);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    let expired = 0;
    let active = 0;

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      total: this.cache.size,
      active,
      expired,
      maxSize: this.maxSize,
    };
  }
}

// Singleton instance
const cacheService = new CacheService();

module.exports = cacheService;

