#!/bin/bash

# Test script for backup/import functionality
# This script runs the backup service tests and reports any errors

echo "=========================================="
echo "Running Backup Service Tests"
echo "=========================================="
echo ""

# Run the tests
npm test -- __tests__/services/backupService.test.js

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✓ All backup service tests passed!"
    echo "=========================================="
    exit 0
else
    echo ""
    echo "=========================================="
    echo "✗ Some tests failed. Please fix errors above."
    echo "=========================================="
    exit 1
fi

