#!/bin/bash
# Helper script to open YouTube mock test page in Safari
DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_PAGE="$DIR/test/mock-youtube.html"
echo "Opening Safari with YouTube mock test page: $TEST_PAGE"
open -a Safari "$TEST_PAGE"
