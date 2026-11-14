#!/usr/bin/env bash
# live 가지를 커밋 1개짜리로 덮어씀 (이력이 쌓이지 않아 저장소가 커지지 않음)
set -e
cd live
git config user.name "judgment-universe-bot"; git config user.email "actions@users.noreply.github.com"
git checkout -q --orphan fresh
git add -A
git commit -q -m "$1 $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f origin fresh:live
