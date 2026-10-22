# Manual failed-rollout + rollback demo for Windows / Docker Desktop (same logic Jenkins automates).
# Usage: .\scripts\rollback-demo.ps1 -Repo <dockerhub-user>/water-dashboard
param([Parameter(Mandatory = $true)][string]$Repo)
$App = "water-dashboard"

function Deploy-Release([string]$Tag) {
    (Get-Content deployment.yaml -Raw) `
        -replace '__IMAGE__', "${Repo}:$Tag" `
        -replace '__APP_VERSION__', $Tag `
        -replace '__CHANGE_CAUSE__', "manual demo: $Tag" | kubectl apply -f -
}

Write-Host "== 1. Build & deploy stable release v-stable" -ForegroundColor Cyan
docker build -t "${Repo}:v-stable" --build-arg APP_VERSION=v-stable .; if ($LASTEXITCODE) { exit 1 }
Deploy-Release "v-stable"
kubectl rollout status deploy/$App --timeout=120s; if ($LASTEXITCODE) { exit 1 }

Write-Host "== 2. Build & deploy deliberately FAULTY release v-faulty" -ForegroundColor Cyan
docker build -t "${Repo}:v-faulty" --build-arg APP_VERSION=v-faulty --build-arg FAULTY=true .; if ($LASTEXITCODE) { exit 1 }
Deploy-Release "v-faulty"

Write-Host "== 3. Watch the rollout" -ForegroundColor Cyan
kubectl rollout status deploy/$App --timeout=120s
if ($LASTEXITCODE -eq 0) { Write-Host "Rollout unexpectedly succeeded"; exit 1 }
Write-Host "!! Rollout FAILED - diagnostics:" -ForegroundColor Red
kubectl get pods -l app=$App -o wide

Write-Host "== 4. Automatic rollback" -ForegroundColor Yellow
kubectl rollout undo deploy/$App
kubectl rollout status deploy/$App --timeout=120s; if ($LASTEXITCODE) { exit 1 }

Write-Host "== 5. Verify restored release" -ForegroundColor Green
kubectl rollout history deploy/$App
kubectl get pods -l app=$App
kubectl exec deploy/$App -- wget -qO- http://127.0.0.1/health.json
Write-Host "Dashboard: http://localhost:30080"
