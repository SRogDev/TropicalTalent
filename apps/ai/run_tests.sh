#!/bin/bash
# Test runner script for TropicalTalent AI
# Usage: ./run_tests.sh [option]

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Default: Run all tests with coverage
if [ "$1" == "" ] || [ "$1" == "all" ]; then
    print_header "Running All Tests with Coverage"
    uv run pytest --cov=app --cov-report=html --cov-report=term -v
    print_success "All tests completed!"
    echo "Coverage report generated in htmlcov/index.html"

# Unit tests only
elif [ "$1" == "unit" ]; then
    print_header "Running Unit Tests"
    uv run pytest -m unit -v

# Integration tests only
elif [ "$1" == "integration" ]; then
    print_header "Running Integration Tests"
    uv run pytest -m integration -v

# Fast tests (exclude slow)
elif [ "$1" == "fast" ]; then
    print_header "Running Fast Tests"
    uv run pytest -m "not slow" -v

# Auth tests only
elif [ "$1" == "auth" ]; then
    print_header "Running Authentication Tests"
    uv run pytest -m auth -v

# Run with coverage check (fail if below 85%)
elif [ "$1" == "coverage" ]; then
    print_header "Running Tests with Coverage Check (85% minimum)"
    uv run pytest --cov=app --cov-report=term --cov-fail-under=85 -v
    if [ $? -eq 0 ]; then
        print_success "Coverage threshold met!"
    else
        print_error "Coverage below 85%!"
        exit 1
    fi

# Quick check (fast tests only, no coverage)
elif [ "$1" == "quick" ]; then
    print_header "Quick Test Run"
    uv run pytest -m "not slow" -x --tb=line
    print_success "Quick check passed!"

# Run specific test file
elif [ "$1" == "file" ] && [ "$2" != "" ]; then
    print_header "Running Test File: $2"
    uv run pytest "$2" -v

# Run failed tests only
elif [ "$1" == "failed" ]; then
    print_header "Running Failed Tests from Last Run"
    uv run pytest --lf -v

# Parallel execution (fast)
elif [ "$1" == "parallel" ]; then
    print_header "Running Tests in Parallel"
    uv run pytest -n auto --cov=app -v
    print_success "Parallel tests completed!"

# Debug mode (verbose, show print statements, stop on first failure)
elif [ "$1" == "debug" ]; then
    print_header "Running Tests in Debug Mode"
    uv run pytest -vv -s -x --tb=long

# Watch mode (requires uv run pytest-watch)
elif [ "$1" == "watch" ]; then
    print_header "Running Tests in Watch Mode"
    print_warning "This requires pytest-watch: uv tool install pytest-watch"
    uv run ptw -- -v

# Generate HTML report
elif [ "$1" == "report" ]; then
    print_header "Generating Test Report"
    uv run pytest --cov=app --cov-report=html --html=test_report.html --self-contained-html
    print_success "Reports generated:"
    echo "  - Coverage: htmlcov/index.html"
    echo "  - Test results: test_report.html"

# CI mode (strict, with coverage check)
elif [ "$1" == "ci" ]; then
    print_header "Running Tests in CI Mode"
    uv run pytest --cov=app --cov-report=xml --cov-report=term --cov-fail-under=85 -v --tb=short
    if [ $? -eq 0 ]; then
        print_success "CI tests passed!"
    else
        print_error "CI tests failed!"
        exit 1
    fi

# Help
elif [ "$1" == "help" ] || [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    echo "TropicalTalent AI Test Runner"
    echo ""
    echo "Usage: ./run_tests.sh [option]"
    echo ""
    echo "Options:"
    echo "  all          Run all tests with coverage (default)"
    echo "  unit         Run only unit tests"
    echo "  integration  Run only integration tests"
    echo "  fast         Run fast tests (exclude slow tests)"
    echo "  auth         Run authentication tests"
    echo "  coverage     Run tests and fail if coverage < 85%"
    echo "  quick        Quick check (fast tests, no coverage)"
    echo "  file <path>  Run specific test file"
    echo "  failed       Run only failed tests from last run"
    echo "  parallel     Run tests in parallel"
    echo "  debug        Run tests in debug mode (verbose)"
    echo "  watch        Run tests in watch mode (auto-reload)"
    echo "  report       Generate HTML reports"
    echo "  ci           CI mode (strict, with coverage check)"
    echo "  help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./run_tests.sh                      # Run all tests"
    echo "  ./run_tests.sh unit                 # Run unit tests"
    echo "  ./run_tests.sh file tests/test_auth.py  # Run specific file"
    echo "  ./run_tests.sh coverage             # Check coverage threshold"

else
    print_error "Unknown option: $1"
    echo "Run './run_tests.sh help' for usage information"
    exit 1
fi
