#!/bin/bash

# Test environment management script
# Starts/stops Docker containers for integration testing

set -e

COMPOSE_FILE="test/fixtures/docker-compose.yml"
PROJECT_NAME="promotel-test"

function start_env() {
    echo "Starting test environment..."
    
    # Check if Docker Compose file exists
    if [ ! -f "$COMPOSE_FILE" ]; then
        echo "ERROR: Docker Compose file not found at $COMPOSE_FILE"
        echo "Make sure the test fixtures are in place."
        exit 1
    fi
    
    # Start services
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d --build
    
    echo "Waiting for services to be ready..."
    
    # Wait for test app to be ready
    wait_for_service "http://localhost:3000/health" "Test App"
    
    # Wait for OTLP collector to be ready using health check endpoint
    wait_for_service "http://localhost:13133" "OTLP Collector"
    
    echo "Test environment is ready!"
    echo ""
    echo "Services running:"
    echo "  Test App:        http://localhost:3000"
    echo "  Test App Metrics: http://localhost:3000/metrics"
    echo "  OTLP Collector:  http://localhost:4318"
    echo "  Prometheus:      http://localhost:9090"
}

function stop_env() {
    echo "Stopping test environment..."
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v
    echo "Test environment stopped."
}

function wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=1
    
    echo "Waiting for $name to be ready at $url..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "$url" > /dev/null 2>&1; then
            echo "$name is ready!"
            return 0
        fi
        echo "Attempt $attempt/$max_attempts: $name not ready yet..."
        sleep 2
        ((attempt++))
    done
    
    echo "ERROR: $name failed to start after $max_attempts attempts"
    return 1
}

function wait_for_port() {
    local host=$1
    local port=$2
    local name=$3
    local max_attempts=30
    local attempt=1
    
    echo "Waiting for $name to be ready on $host:$port..."
    
    while [ $attempt -le $max_attempts ]; do
        if nc -z "$host" "$port" > /dev/null 2>&1; then
            echo "$name is ready!"
            return 0
        fi
        echo "Attempt $attempt/$max_attempts: $name not ready yet..."
        sleep 2
        ((attempt++))
    done
    
    echo "ERROR: $name failed to start after $max_attempts attempts"
    return 1
}

# Main script logic
case "$1" in
    start)
        start_env
        ;;
    stop)
        stop_env
        ;;
    *)
        echo "Usage: $0 {start|stop}"
        echo "  start - Start the test environment"
        echo "  stop  - Stop the test environment"
        exit 1
        ;;
esac