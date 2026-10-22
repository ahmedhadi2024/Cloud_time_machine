#!/usr/bin/env bash
# Builds the API tarball and the static front end into .build/.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

log "Building API bundle"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/api"

cd "$REPO_ROOT/backend"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev
# Only what the service needs at runtime: no tests, no dev tooling.
cp -r src package.json node_modules "$BUILD_DIR/api/"
tar -czf "$BUILD_DIR/api.tar.gz" -C "$BUILD_DIR/api" .
info "API bundle: $(du -h "$BUILD_DIR/api.tar.gz" | cut -f1)"

log "Building front end"
cd "$REPO_ROOT/frontend"
npm ci 2>/dev/null || npm install
npm run build
cp -r dist "$BUILD_DIR/web"
info "Front end: $(du -sh "$BUILD_DIR/web" | cut -f1)"

log "Build complete in ${BUILD_DIR}"
