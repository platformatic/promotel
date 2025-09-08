#!/bin/bash

# Fetch protobuf definitions and generate TypeScript types
# This script combines fetching proto files and generating types in one operation

set -e

PROTO_DIR="proto"

# Clean proto directory
rm -rf "$PROTO_DIR"
mkdir -p "$PROTO_DIR"

# Create package.json to mark proto directory as CommonJS
echo "Creating proto package.json..."
cat > "$PROTO_DIR/package.json" << 'EOF'
{
  "type": "commonjs"
}
EOF

echo "=== Fetching protobuf definitions ==="

# Prometheus remote write protobuf using sparse checkout
PROM_VERSION="v0.47.0"
PROM_REPO="https://github.com/prometheus/prometheus.git"

git clone --filter=blob:none --no-checkout --depth 1 --branch "$PROM_VERSION" "$PROM_REPO" "$PROTO_DIR/prometheus-temp"
cd "$PROTO_DIR/prometheus-temp"
git sparse-checkout init --cone
git sparse-checkout set prompb
git checkout

# Move the proto files
mv prompb/remote.proto ../prometheus.proto
mv prompb/types.proto ../types.proto

# Fetch gogoproto separately
mkdir -p ../gogoproto

# Clean up temp directory
cd ../..
rm -rf "$PROTO_DIR/prometheus-temp"

# Fetch gogoproto from its official repository
echo "Fetching gogoproto definitions..."
GOGOPROTO_VERSION="v1.3.2"
GOGOPROTO_REPO="https://github.com/gogo/protobuf.git"

git clone --filter=blob:none --no-checkout --depth 1 --branch "$GOGOPROTO_VERSION" "$GOGOPROTO_REPO" "$PROTO_DIR/gogoproto-temp"
cd "$PROTO_DIR/gogoproto-temp"
git sparse-checkout init --cone
git sparse-checkout set gogoproto
git checkout

# Move the gogoproto files
mv gogoproto/gogo.proto ../gogoproto/gogo.proto

# Clean up temp directory
cd ../..
rm -rf "$PROTO_DIR/gogoproto-temp"

echo "Fetching OpenTelemetry protobuf definitions..."

# OpenTelemetry protobuf definitions using sparse checkout
OTLP_VERSION="v1.0.0"
OTLP_REPO="https://github.com/open-telemetry/opentelemetry-proto.git"

git clone --filter=blob:none --no-checkout --depth 1 --branch "$OTLP_VERSION" "$OTLP_REPO" "$PROTO_DIR/opentelemetry-temp"
cd "$PROTO_DIR/opentelemetry-temp"
git sparse-checkout init --cone
git sparse-checkout set opentelemetry/proto
git checkout

# Move the proto files maintaining directory structure
mv opentelemetry ../

# Clean up temp directory
cd ../..
rm -rf "$PROTO_DIR/opentelemetry-temp"

echo "Protobuf definitions fetched successfully!"

echo ""
echo "=== Generating TypeScript types ==="

echo "Generating protobuf static module..."
pbjs -t static-module -w commonjs \
  --keep-case --no-create --no-verify --no-convert --no-delimited \
  --path proto \
  -o proto/protobuf.js \
  proto/opentelemetry/proto/common/v1/common.proto \
  proto/opentelemetry/proto/resource/v1/resource.proto \
  proto/opentelemetry/proto/metrics/v1/metrics.proto \
  proto/opentelemetry/proto/collector/metrics/v1/metrics_service.proto \
  proto/prometheus.proto

echo "Generating TypeScript types..."
pbts -o proto/protobuf.d.ts proto/protobuf.js

echo "Protobuf type generation complete!"
echo ""
echo "Generated files:"
find "$PROTO_DIR" -name "*.proto" | sort
echo "  $PROTO_DIR/protobuf.js"
echo "  $PROTO_DIR/protobuf.d.ts"