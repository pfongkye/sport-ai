#!/usr/bin/env bash
# Installs the SportAI git hooks. Run once per clone:
#   ./deploy/git-hooks/install.sh
#
# Uses core.hooksPath so the versioned hooks in deploy/git-hooks/ are used
# directly (no copying into .git/hooks, which isn't tracked).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

chmod +x deploy/git-hooks/pre-commit
git config core.hooksPath deploy/git-hooks

echo "✓ Installed git hooks (core.hooksPath = deploy/git-hooks)."
echo "  pre-commit secret guard is now active for this clone."
echo "  To disable: git config --unset core.hooksPath"
