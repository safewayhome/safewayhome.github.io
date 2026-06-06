#!/usr/bin/env bash
# Publish the team board to a GitHub *organization* named like the desired URL, i.e.
# org "safewayhome"  →  https://safewayhome.github.io/
#
# PREREQUISITE (web, ~1 min, only you can do it): create the free org first at
#   https://github.com/account/organizations/new   (choose the FREE plan, name it 'safewayhome')
#
# Then just run:   ./deploy-to-org.sh            (defaults to org 'safewayhome')
#            or:   ./deploy-to-org.sh myorgname
set -euo pipefail

ORG="${1:-safewayhome}"
REPO="${ORG}.github.io"
cd "$(dirname "$0")"

# 0. sanity: org must exist + gh must be authed
if ! gh api "orgs/${ORG}" >/dev/null 2>&1; then
  echo "✗ Organisationen '${ORG}' finns inte ännu."
  echo "  Skapa den (gratis) här först:  https://github.com/account/organizations/new"
  exit 1
fi

# 1. create the public repo in the org (idempotent)
if ! gh repo view "${ORG}/${REPO}" >/dev/null 2>&1; then
  gh repo create "${ORG}/${REPO}" --public \
    --description "LedMig team board: realtime whiteboard + timeline + progress"
fi

# 2. push the current board to it
git remote remove pub 2>/dev/null || true
git remote add pub "git@github.com:${ORG}/${REPO}.git"
git push -u pub main

# 3. switch Pages to the Actions build (not the legacy raw-branch build)
gh api -X POST "repos/${ORG}/${REPO}/pages" -f build_type=workflow 2>/dev/null \
  || gh api -X PUT "repos/${ORG}/${REPO}/pages" -f build_type=workflow 2>/dev/null || true

# 4. re-run the deploy workflow now that Pages = workflow, then wait
sleep 5
RID="$(gh run list --repo "${ORG}/${REPO}" --workflow 'Deploy team board to GitHub Pages' --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
[ -n "${RID:-}" ] && gh run rerun "${RID}" --repo "${ORG}/${REPO}" 2>/dev/null || true

echo
echo "▸ Deployar… följ live:  gh run watch --repo ${ORG}/${REPO}"
echo "✅ Klar inom någon minut på:  https://${ORG}.github.io/"
