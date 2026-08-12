#!/bin/bash

# Cloudflare D1 Setup Script for Clash
# This script automates the creation and setup of D1 databases

set -e  # Exit on error

echo "🚀 Clash - Cloudflare D1 Setup"
echo "======================================"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found!"
    echo "Please install it with: npm install -g wrangler"
    exit 1
fi

echo "✅ Wrangler CLI found"
echo ""

# Check if logged in
echo "Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    echo "Please login to Cloudflare:"
    wrangler login
fi

echo "✅ Authenticated with Cloudflare"
echo ""

# Step 1: Create Frontend D1 Database
echo "📊 Step 1: Creating Frontend D1 Database"
echo "=========================================="
echo ""

read -p "Create frontend database? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Creating database: clash-frontend..."
    wrangler d1 create clash-frontend

    echo ""
    echo "⚠️  IMPORTANT: Copy the database_id from above and add it to:"
    echo "   - frontend/wrangler.toml"
    echo "   - frontend/.env (as CLOUDFLARE_D1_DATABASE_ID)"
    echo ""
    read -p "Press Enter when you've saved the database_id..."

    # Run migrations
    echo ""
    echo "Running frontend migrations..."
    wrangler d1 execute clash-frontend --remote --file=frontend/drizzle/d1-schema.sql

    echo "✅ Frontend database created and migrated!"
else
    echo "Skipped frontend database creation"
fi

echo ""
echo ""

# Step 2: Create Backend D1 Database
echo "📊 Step 2: Creating Backend D1 Database"
echo "========================================"
echo ""

read -p "Create backend database? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Creating database: clash-backend..."
    wrangler d1 create clash-backend

    echo ""
    echo "⚠️  IMPORTANT: Copy the database_id from above and add it to:"
    echo "   - backend/.env (as CLOUDFLARE_D1_DATABASE_ID)"
    echo ""
    read -p "Press Enter when you've saved the database_id..."

    # Run migrations
    echo ""
    echo "Running backend migrations..."
    wrangler d1 execute clash-backend --remote --file=backend/migrations/d1/0001_checkpoints.sql

    echo "✅ Backend database created and migrated!"
else
    echo "Skipped backend database creation"
fi

echo ""
echo ""

# Step 3: Generate API Token
echo "🔑 Step 3: Generate Cloudflare API Token"
echo "========================================="
echo ""
echo "You need an API token with D1 Edit permissions."
echo ""
echo "1. Go to: https://dash.cloudflare.com/profile/api-tokens"
echo "2. Click 'Create Token' → 'Create Custom Token'"
echo "3. Add permissions: Account → D1 → Edit"
echo "4. Select your account under 'Account Resources'"
echo "5. Click 'Continue' → 'Create Token'"
echo "6. Copy the token and add it to your .env files"
echo ""

read -p "Press Enter after creating the API token..."

echo ""
echo ""

# Summary
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "Next steps:"
echo ""
echo "1. Update frontend/.env with:"
echo "   CLOUDFLARE_ACCOUNT_ID=your-account-id"
echo "   CLOUDFLARE_D1_DATABASE_ID=your-frontend-db-id"
echo "   CLOUDFLARE_API_TOKEN=your-api-token"
echo ""
echo "2. Update backend/.env with:"
echo "   CLOUDFLARE_ACCOUNT_ID=your-account-id"
echo "   CLOUDFLARE_D1_DATABASE_ID=your-backend-db-id"
echo "   CLOUDFLARE_API_TOKEN=your-api-token"
echo ""
echo "3. Test the connection:"
echo "   wrangler d1 execute clash-frontend --remote --command \"SELECT name FROM sqlite_master\""
echo "   wrangler d1 execute clash-backend --remote --command \"SELECT name FROM sqlite_master\""
echo ""
echo "For detailed documentation, see D1_SETUP_GUIDE.md"
echo ""
