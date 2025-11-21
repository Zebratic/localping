#!/usr/bin/env node

/**
 * Script to download all CDN libraries locally for offline use
 * This makes the project self-sustainable without internet connection
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PROJECT_ROOT = path.join(__dirname, '..');
const VENDOR_DIR = path.join(PROJECT_ROOT, 'src', 'public', 'vendor');
const FONTAWESOME_DIR = path.join(VENDOR_DIR, 'font-awesome');

// Colors for console output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Create directories
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Download file function
function downloadFile(url, outputPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }
    
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const file = fs.createWriteStream(outputPath);
    
    const request = protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        file.close();
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        
        // Handle redirects - resolve relative URLs
        let redirectUrl = response.headers.location;
        if (!redirectUrl) {
          reject(new Error(`Redirect without location header from ${url}`));
          return;
        }
        
        // Resolve relative URLs
        if (redirectUrl.startsWith('/')) {
          redirectUrl = `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`;
        } else if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
          redirectUrl = new URL(redirectUrl, url).href;
        }
        
        return downloadFile(redirectUrl, outputPath, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });
    
    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      reject(err);
    });
    
    file.on('error', (err) => {
      file.close();
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      reject(err);
    });
  });
}

async function main() {
  log('Starting CDN library download...', 'green');
  
  // Create directories
  ensureDir(VENDOR_DIR);
  ensureDir(FONTAWESOME_DIR);
  ensureDir(path.join(FONTAWESOME_DIR, 'webfonts'));
  
  const downloads = [
    {
      name: 'Tailwind CSS',
      url: 'https://cdn.tailwindcss.com',
      output: path.join(VENDOR_DIR, 'tailwindcss.js')
    },
    {
      name: 'Chart.js',
      url: 'https://cdn.jsdelivr.net/npm/chart.js',
      output: path.join(VENDOR_DIR, 'chart.js')
    },
    {
      name: 'Axios',
      url: 'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js',
      output: path.join(VENDOR_DIR, 'axios.min.js')
    },
    {
      name: 'Marked',
      url: 'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
      output: path.join(VENDOR_DIR, 'marked.min.js')
    },
    {
      name: 'Font Awesome CSS',
      url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
      output: path.join(FONTAWESOME_DIR, 'all.min.css')
    }
  ];
  
  // Download main libraries
  for (let i = 0; i < downloads.length; i++) {
    const item = downloads[i];
    log(`[${i + 1}/${downloads.length}] Downloading ${item.name}...`, 'green');
    log(`  URL: ${item.url}`, 'yellow');
    
    try {
      await downloadFile(item.url, item.output);
      log(`  ✓ Saved to: ${item.output}`, 'green');
    } catch (error) {
      log(`  ✗ Failed: ${error.message}`, 'yellow');
      throw error;
    }
  }
  
  // Download Font Awesome fonts
  log('\nDownloading Font Awesome webfonts...', 'yellow');
  const fontFiles = [
    'fa-solid-900.woff2',
    'fa-regular-400.woff2',
    'fa-brands-400.woff2',
    'fa-v4compatibility.woff2'
  ];
  
  for (const font of fontFiles) {
    const url = `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/${font}`;
    const output = path.join(FONTAWESOME_DIR, 'webfonts', font);
    
    log(`  Downloading ${font}...`, 'yellow');
    try {
      await downloadFile(url, output);
      log(`  ✓ Saved: ${font}`, 'green');
    } catch (error) {
      log(`  ✗ Failed to download ${font}: ${error.message}`, 'yellow');
    }
  }
  
  // Update Font Awesome CSS to use local paths
  log('\nUpdating Font Awesome CSS paths...', 'yellow');
  const cssPath = path.join(FONTAWESOME_DIR, 'all.min.css');
  let cssContent = fs.readFileSync(cssPath, 'utf8');
  
  // Replace relative paths with absolute paths
  cssContent = cssContent.replace(/url\(\.\.\/webfonts\//g, 'url(/vendor/font-awesome/webfonts/');
  cssContent = cssContent.replace(/url\(webfonts\//g, 'url(/vendor/font-awesome/webfonts/');
  
  fs.writeFileSync(cssPath, cssContent);
  log('  ✓ Updated CSS paths', 'green');
  
  log('\n✓ All libraries downloaded successfully!', 'green');
  log(`Files saved to: ${VENDOR_DIR}`, 'green');
  log('\nNext step: Update view files to use local paths instead of CDN URLs', 'yellow');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

