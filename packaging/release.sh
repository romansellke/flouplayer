#!/bin/bash
# Prepares a release: bumps __version__ in app/__init__.py, checks that
# CHANGELOG.md has a section for it, commits and creates the annotated tag
# vX.Y.Z. Nothing is pushed -- see docs/releasing.md.
#
# Usage: packaging/release.sh 0.5.0
set -e
cd "$(dirname "$0")/.."

VERSION="${1:-}"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 X.Y.Z   (Semantic Versioning, e.g. 0.5.0)"
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "The working tree has uncommitted changes -- commit or stash them first."
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  echo "Tag v$VERSION already exists."
  exit 1
fi
if ! grep -q "^## \[$VERSION\] - [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}" CHANGELOG.md; then
  echo "CHANGELOG.md has no section '## [$VERSION] - YYYY-MM-DD'."
  echo "Move the entries from [Unreleased] into it first."
  exit 1
fi

sed -i "s/^__version__ = .*/__version__ = \"$VERSION\"/" app/__init__.py
grep -q "__version__ = \"$VERSION\"" app/__init__.py || { echo "Could not update app/__init__.py"; exit 1; }

git add app/__init__.py CHANGELOG.md
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "Flou Player $VERSION"
echo
echo "Created commit and tag v$VERSION. To publish: git push origin HEAD v$VERSION"
