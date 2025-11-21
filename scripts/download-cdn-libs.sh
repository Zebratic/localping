#!/bin/bash

# Script to download all CDN libraries locally for offline use
# This makes the project self-sustainable without internet connection

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Base directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$PROJECT_ROOT/src/public/vendor"
FONTAWESOME_DIR="$VENDOR_DIR/font-awesome"

echo -e "${GREEN}Starting CDN library download...${NC}"

# Create vendor directory
mkdir -p "$VENDOR_DIR"
mkdir -p "$FONTAWESOME_DIR"

# Function to download file
download_file() {
    local url=$1
    local output=$2
    echo -e "${YELLOW}Downloading: $url${NC}"
    curl -L -f -s "$url" -o "$output" || {
        echo "Failed to download $url"
        return 1
    }
    echo -e "${GREEN}✓ Saved to: $output${NC}"
}

# 1. Download Tailwind CSS (standalone build)
echo -e "\n${GREEN}[1/5] Downloading Tailwind CSS...${NC}"
download_file "https://cdn.tailwindcss.com" "$VENDOR_DIR/tailwindcss.js"

# 2. Download Chart.js
echo -e "\n${GREEN}[2/5] Downloading Chart.js...${NC}"
download_file "https://cdn.jsdelivr.net/npm/chart.js" "$VENDOR_DIR/chart.js"

# 3. Download Axios
echo -e "\n${GREEN}[3/5] Downloading Axios...${NC}"
download_file "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js" "$VENDOR_DIR/axios.min.js"

# 4. Download Marked (Markdown parser)
echo -e "\n${GREEN}[4/5] Downloading Marked...${NC}"
download_file "https://cdn.jsdelivr.net/npm/marked/marked.min.js" "$VENDOR_DIR/marked.min.js"

# 5. Download Font Awesome CSS and fonts
echo -e "\n${GREEN}[5/5] Downloading Font Awesome...${NC}"
download_file "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" "$FONTAWESOME_DIR/all.min.css"

# Download Font Awesome fonts (webfonts)
echo -e "${YELLOW}Downloading Font Awesome webfonts...${NC}"
mkdir -p "$FONTAWESOME_DIR/webfonts"

# Get the font file URLs from the CSS
FONT_FILES=(
    "fa-solid-900.woff2"
    "fa-regular-400.woff2"
    "fa-brands-400.woff2"
    "fa-v4compatibility.woff2"
)

for font in "${FONT_FILES[@]}"; do
    download_file "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/$font" "$FONTAWESOME_DIR/webfonts/$font"
done

# Update Font Awesome CSS to use local paths
echo -e "${YELLOW}Updating Font Awesome CSS paths...${NC}"
sed -i "s|url(../webfonts/|url(/vendor/font-awesome/webfonts/|g" "$FONTAWESOME_DIR/all.min.css"
sed -i "s|url(webfonts/|url(/vendor/font-awesome/webfonts/|g" "$FONTAWESOME_DIR/all.min.css"

echo -e "\n${GREEN}✓ All libraries downloaded successfully!${NC}"
echo -e "${GREEN}Files saved to: $VENDOR_DIR${NC}"
echo -e "\n${YELLOW}Next step: Update view files to use local paths instead of CDN URLs${NC}"

