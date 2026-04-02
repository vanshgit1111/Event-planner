#!/bin/sh
# EventMind start script — bypasses dotenvx to properly launch backend

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Read API key from .env
GEMINI_API_KEY=$(grep "^GEMINI_API_KEY=" .env | cut -d= -f2-)
export GEMINI_API_KEY

echo "──────────────────────────────────────"
echo "  Starting EventMind AI Backend..."
echo "  API Key: ${GEMINI_API_KEY:0:8}..."
echo "──────────────────────────────────────"

# Start backend in background
GEMINI_API_KEY="$GEMINI_API_KEY" node backend/server.js &
BACKEND_PID=$!
echo "Backend started (PID $BACKEND_PID)"

# Start Vite frontend
node_modules/.bin/vite

# When vite exits, also kill backend
kill $BACKEND_PID 2>/dev/null
