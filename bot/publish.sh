#!/usr/bin/env bash
# live 가지 저장 : 이번 실행에서 바뀐 파일만 최신 live 위에 덮어, 커밋 1개짜리로 올림
# (5분 점검과 장 마감 정리가 서로의 결과를 지우지 않게 함. 이력이 쌓이지 않아 저장소가 커지지 않음)
set -e
URL="${PUSH_URL:-https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git}"
cd live
changed=$(git status --porcelain | sed 's/^...//')
[ -z "$changed" ] && { echo "바뀐 파일 없음"; exit 0; }
for try in 1 2 3; do
  tmp=$(mktemp -d)
  git fetch -q origin live && git archive FETCH_HEAD | tar -x -C "$tmp"
  for f in $changed; do f="${f%/}"; mkdir -p "$tmp/$(dirname "$f")"; rm -rf "$tmp/$f"; cp -r "$f" "$tmp/$f"; done
  ( cd "$tmp" && git init -q -b live . && git config user.name "judgment-universe-bot" && git config user.email "actions@users.noreply.github.com" && git add -A && git commit -q -m "$1 $(date -u +%Y-%m-%dT%H:%MZ)" && git push -q -f "$URL" live:live ) && { rm -rf "$tmp"; echo "저장 완료 : $(echo $changed | tr '\n' ' ')"; exit 0; }
  rm -rf "$tmp"; sleep 5
done
echo "저장 실패"; exit 1
