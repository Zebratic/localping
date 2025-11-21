# CDN Library Download Scripts

These scripts download all external CDN libraries locally to make the project self-sustainable and work offline.

## Usage

### Option 1: Bash Script (Linux/macOS)

```bash
./scripts/download-cdn-libs.sh
```

### Option 2: Node.js Script (Cross-platform)

```bash
node scripts/download-cdn-libs.js
```

## What Gets Downloaded

The scripts will download the following libraries to `src/public/vendor/`:

1. **Tailwind CSS** → `vendor/tailwindcss.js`
2. **Chart.js** → `vendor/chart.js`
3. **Axios** → `vendor/axios.min.js`
4. **Marked** (Markdown parser) → `vendor/marked.min.js`
5. **Font Awesome** → `vendor/font-awesome/all.min.css` + webfonts

## After Running

All view files have already been updated to use local paths instead of CDN URLs. The libraries will be served from `/vendor/` when the application runs.

## Notes

- Make sure you have an internet connection when running these scripts
- The scripts will create the necessary directory structure automatically
- Font Awesome CSS paths are automatically updated to point to local webfonts

