#!/usr/bin/env bash
# Manual failed-rollout + rollback demo (same logic the Jenkins pipeline automates).
# Usage: ./scripts/rollback-demo.sh <dockerhub-user>/water-dashboard
set -uo pipefail
REPO="${1:?usage: $0 <dockerhub-user>/water-dashboard}"
APP=water-dashboard
render() { sed -e "s#__IMAGE__#$REPO:$1#" -e "s#__APP_VERSION__#$1#" -e "s#__CHANGE_CAUSE__#manual demo: $1#" deployment.yaml; }

echo "== 1. Build & deploy stable release v-stable"
docker build -t "$REPO:v-stable" --build-arg APP_VERSION=v-stable . || exit 1
render v-stable | kubectl apply -f - && kubectl rollout status deploy/$APP --timeout=120s || exit 1

echo "== 2. Build & deploy deliberately FAULTY release v-faulty"
docker build -t "$REPO:v-faulty" --build-arg APP_VERSION=v-faulty --build-arg FAULTY=true . || exit 1
render v-faulty | kubectl apply -f -

echo "== 3. Watch the rollout"
if kubectl rollout status deploy/$APP --timeout=120s; then
  echo "Rollout unexpectedly succeeded"; exit 1
fi
echo "!! Rollout FAILED – diagnostics:"
kubectl get pods -l app=$APP -o wide
kubectl describe deploy/$APP | grep -A4 Conditions

echo "== 4. Automatic rollback"
kubectl rollout undo deploy/$APP && kubectl rollout status deploy/$APP --timeout=120s || exit 1

echo "== 5. Verify restored release"
kubectl rollout history deploy/$APP
kubectl get pods -l app=$APP
kubectl exec deploy/$APP -- wget -qO- http://127.0.0.1/health.json
echo "Dashboard: http://localhost:30080"
