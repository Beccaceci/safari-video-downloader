#!/usr/bin/env bash
# ==============================================================================
# One-Click Installer & Safari Developer Configurator
# Safari Video Downloader
# ==============================================================================
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SUPPORT="$HOME/Library/Application Support/SafariVideoDownloader"

echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║         Safari Video Downloader - Installer          ║"
echo "  ║        One-Click Quick Setup for macOS Safari        ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${BOLD}[1/4] Configuring Safari Developer Settings...${NC}"
# Enable Develop menu in Safari
defaults write com.apple.Safari IncludeDevelopMenu -bool true
defaults write com.apple.Safari.SandboxBroker ShowDevelopMenu -bool true
defaults write com.apple.Safari WebKitDeveloperExtrasEnabledPreferenceKey -bool true
defaults write com.apple.Safari "com.apple.Safari.ContentPageGroupIdentifier.WebKit2DeveloperExtrasEnabled" -bool true
echo -e "${GREEN}✓ Safari Developer Menu enabled successfully.${NC}"

echo -e "\n${BOLD}[2/4] Deploying Extension to Application Support...${NC}"
mkdir -p "$APP_SUPPORT"
# Copy all extension assets
rsync -a --delete \
  --exclude ".git" \
  --exclude ".DS_Store" \
  --exclude "sample*" \
  "$DIR/" "$APP_SUPPORT/"
echo -e "${GREEN}✓ Extension bundle installed at: ${APP_SUPPORT}${NC}"

echo -e "\n${BOLD}[3/4] Registering Helper Commands...${NC}"
chmod +x "$APP_SUPPORT/scripts/"*.sh 2>/dev/null || true
echo -e "${GREEN}✓ Launch & reload scripts configured.${NC}"

echo -e "\n${BOLD}[4/4] Opening Safari Verification Page & Settings...${NC}"
# Open Safari with the mock test suite to test immediately
open -a Safari "$APP_SUPPORT/test/mock-polito.html"

# Prompt to open Safari Extensions settings
osascript << 'APPLESCRIPT' >/dev/null 2>&1 || true
tell application "Safari"
  activate
end tell
APPLESCRIPT

echo -e "\n${GREEN}${BOLD}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}   Setup Complete! Just 2 quick manual clicks in Safari:        ${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════════${NC}"
echo -e " 1. In Safari's menu bar, click ${CYAN}${BOLD}Develop${NC} > check ${CYAN}${BOLD}Allow Unsigned Extensions${NC}."
echo -e " 2. Go to ${CYAN}${BOLD}Safari > Settings > Extensions${NC} > check ${CYAN}${BOLD}Safari Video Downloader${NC}."
echo -e "\n${YELLOW}To reload tabs anytime: ${NC}./scripts/reload-safari.sh"
echo -e "${YELLOW}To test anytime:        ${NC}./scripts/open-in-safari.sh\n"
