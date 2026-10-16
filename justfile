set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments := true

# Create and bootstrap a sibling worktree for a new or existing branch.
ws branch:
    #!/usr/bin/env bash
    set -euo pipefail
    branch="$1"
    primary="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    slug="${branch//\//-}"
    target="$(dirname "$primary")/$(basename "$primary")--$slug"
    reference="$(dirname "$primary")/leyline"

    if git show-ref --verify --quiet "refs/heads/$branch"; then
        git worktree add "$target" "$branch"
    else
        git worktree add -b "$branch" "$target"
    fi

    if git -C "$reference" rev-parse --git-dir >/dev/null 2>&1; then
        (cd "$target" && LEYLINE_REFERENCE="$reference" FORGE_REFERENCE="$reference/forge" bun run bootstrap)
    else
        (cd "$target" && bun run bootstrap)
    fi

    echo "Ready: $target"
