#!/bin/bash

set -euo pipefail

PACKAGE_TGZ="$(npm pack --ignore-scripts --silent | tail -n 1)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR" "$PACKAGE_TGZ"
}
trap cleanup EXIT

cp "$PACKAGE_TGZ" "$TMP_DIR/promotel.tgz"
cd "$TMP_DIR"

npm init -y >/dev/null
npm install --silent ./promotel.tgz

node --input-type=module -e "await import('@platformatic/promotel')"
node --input-type=module -e "await import('@platformatic/promotel/server')"
