#!/bin/bash
# Helper script to open test page in Safari
DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_PAGE="$DIR/test/mock-polito.html"
echo "Opening Safari with Portale della Didattica test page: $TEST_PAGE"
open -a Safari "$TEST_PAGE"
