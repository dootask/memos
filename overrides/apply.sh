#!/bin/bash

# Apply configuration overrides for /apps/memos subpath

set -e  # Exit on any error

echo "Applying /apps/memos configuration..."

# Check if app directory exists
if [ ! -d "app" ]; then
    echo "Error: app directory not found!"
    exit 1
fi

# Apply all configuration files by traversing overrides directory
find overrides/ -type f -name "*.mts" -o -name "*.go" -o -name "*.ts" -o -name "*.js" | while read file; do
    # Skip apply.sh and README.md
    if [[ "$file" == *"apply.sh"* ]] || [[ "$file" == *"README.md"* ]]; then
        continue
    fi
    
    # Calculate target path (remove 'overrides/' prefix)
    target="app/${file#overrides/}"
    
    # Create target directory if it doesn't exist
    mkdir -p "$(dirname "$target")"
    
    # Copy file to target location
    cp "$file" "$target"
    echo "Applied: $file -> $target"
done

echo "Configuration applied successfully."
