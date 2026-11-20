#!/bin/bash

set -euo pipefail

PACKAGE_TGZ="$PWD/$(npm pack --ignore-scripts --silent | tail -n 1)"
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

# Every supported @platformatic/prom-client major must be shared with the
# application, never duplicated (Watt ships 1.x)
for PROM_CLIENT_VERSION in 1 2; do
  echo "Checking @platformatic/prom-client@$PROM_CLIENT_VERSION"
  rm -rf node_modules package-lock.json
  npm install --silent "@platformatic/prom-client@$PROM_CLIENT_VERSION" ./promotel.tgz

  node --input-type=module -e "
    import { createRequire } from 'node:module';
    import { Counter, register } from '@platformatic/prom-client';
    import { getFromRegistry } from '@platformatic/promotel';

    const require = createRequire(import.meta.url);
    const { version } = require('@platformatic/prom-client/package.json');
    if (version.split('.')[0] !== '$PROM_CLIENT_VERSION') {
      throw new Error('Expected @platformatic/prom-client@$PROM_CLIENT_VERSION, got ' + version);
    }

    new Counter({ name: 'packed_total', help: 'Packed package check' }).inc(3);
    const { timeseries } = await getFromRegistry();
    if (timeseries[0]?.samples[0]?.value !== 3) {
      throw new Error('Default registry is not shared with the application');
    }
  "

  if [ "$(find node_modules -path '*/@platformatic/prom-client/package.json' | wc -l)" -ne 1 ]; then
    echo "ERROR: @platformatic/prom-client is installed more than once"
    find node_modules -path '*/@platformatic/prom-client/package.json'
    exit 1
  fi
done
