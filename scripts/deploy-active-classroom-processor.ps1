param(
  [string]$ProjectId = "sistema-desarrollo-proyectos",
  [string]$Region = "us-central1",
  [string]$Bucket = "sistema-desarrollo-proyectos.firebasestorage.app"
)
$ErrorActionPreference = "Stop"
function Invoke-Cloud([string[]]$Arguments) {
  & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw "gcloud falló. Revisa permisos y el comando anterior." }
}
$Workspace = Split-Path -Parent $PSScriptRoot
$ProcessorAccount = "active-classroom-office@$ProjectId.iam.gserviceaccount.com"
$Service = "active-classroom-office"
$Tag = (& git -C $Workspace rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $Tag -notmatch '^[a-f0-9]{40}$') { throw "No se pudo identificar el commit probado." }
$Image = "$Region-docker.pkg.dev/$ProjectId/active-classroom/office-pdf:$Tag"

Invoke-Cloud @("services", "enable", "run.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com", "iamcredentials.googleapis.com", "--project", $ProjectId)
$Accounts = (& gcloud iam service-accounts list --project $ProjectId --format="value(email)")
if ($LASTEXITCODE -ne 0) { throw "No se pudieron consultar service accounts." }
if ($Accounts -notcontains $ProcessorAccount) { Invoke-Cloud @("iam", "service-accounts", "create", "active-classroom-office", "--project", $ProjectId, "--display-name", "Active Classroom Office processor") }
# Deliberately grant this account no data roles or private keys.
$Repositories = (& gcloud artifacts repositories list --location $Region --project $ProjectId --format="value(name)")
if ($LASTEXITCODE -ne 0) { throw "No se pudieron consultar repositorios de imágenes." }
if (-not ($Repositories | Where-Object { $_ -match '/active-classroom$' })) { Invoke-Cloud @("artifacts", "repositories", "create", "active-classroom", "--repository-format", "docker", "--location", $Region, "--project", $ProjectId) }
Invoke-Cloud @("builds", "submit", (Join-Path $Workspace "active-classroom-processor"), "--tag", $Image, "--project", $ProjectId)
Invoke-Cloud @("run", "deploy", $Service, "--image", $Image, "--region", $Region, "--project", $ProjectId, "--service-account", $ProcessorAccount, "--no-allow-unauthenticated", "--concurrency", "1", "--cpu", "2", "--memory", "2Gi", "--timeout", "420", "--min-instances", "0", "--max-instances", "2", "--set-env-vars", "STORAGE_BUCKET=$Bucket")
$FunctionAccount = (& gcloud functions describe activeClassroomDeviceSession --gen2 --region $Region --project $ProjectId --format="value(serviceConfig.serviceAccountEmail)").Trim()
if ($LASTEXITCODE -ne 0 -or $FunctionAccount -notmatch '@') { throw "No se pudo identificar identidad Functions existente." }
Invoke-Cloud @("run", "services", "add-iam-policy-binding", $Service, "--region", $Region, "--project", $ProjectId, "--member", "serviceAccount:$FunctionAccount", "--role", "roles/run.invoker")
$ProcessorUrl = (& gcloud run services describe $Service --region $Region --project $ProjectId --format="value(status.url)").Trim()
if ($LASTEXITCODE -ne 0 -or $ProcessorUrl -notmatch '^https://') { throw "No se pudo obtener URL del procesador." }
$EnvironmentPath = Join-Path $Workspace "drive/.env.$ProjectId"
$Lines = if (Test-Path -LiteralPath $EnvironmentPath) { @(Get-Content -LiteralPath $EnvironmentPath | Where-Object { $_ -notmatch '^ACTIVE_CLASSROOM_PROCESSOR_URL=' }) } else { @() }
$Lines += "ACTIVE_CLASSROOM_PROCESSOR_URL=$ProcessorUrl"
Set-Content -LiteralPath $EnvironmentPath -Value $Lines -Encoding utf8
Write-Host "Procesador privado desplegado. URL cliente no incluye secretos."
Write-Host "Functions debe tener iam.serviceAccounts.signBlob sobre su propia identidad; reutiliza el permiso existente de activación."
Write-Host 'Despliega processActiveClassroomDocument, saveActiveClassroomUnit, publishActiveClassroomUnit y refreshActiveClassroomDriveResource; después Hosting.'
