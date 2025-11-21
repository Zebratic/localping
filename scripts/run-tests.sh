#!/bin/bash

# Run all unit tests and report results
# This script should be run after making changes to ensure everything still works

echo "=========================================="
echo "Running All Unit Tests"
echo "=========================================="
echo ""

# Run all tests
npm test

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✓ All tests passed!"
    echo "=========================================="
    exit 0
else
    echo ""
    echo "=========================================="
    echo "✗ Some tests failed. Please fix errors above."
    echo "=========================================="
    exit 1
fi

