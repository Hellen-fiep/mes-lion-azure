<#
=====================================================================
 MES LION — Implantação no Microsoft Azure (Azure CLI + Bicep)
 Pré-requisitos: Azure CLI (az) com permissão de Colaborador na assinatura/grupo e
 o pacote MES_LION_AZURE_app-service.zip (pasta azure\ do pacote ou release do CI).
 Uso:
   .\implantar-azure.ps1 -GrupoRecursos rg-meslion -Regiao brazilsouth -Pacote .\MES_LION_AZURE_app-service.zip
=====================================================================
#>
param(
    [string]$GrupoRecursos = 'rg-meslion',
    [string]$Regiao = 'brazilsouth',
    [string]$NomeBase = 'meslion',
    [string]$SkuAppService = 'B1',
    [string]$SkuBanco = 'S0',
    [string]$Pacote = '',
    [switch]$LoginMicrosoft,
    [string]$EntraClientId = ''
)
$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI (az) não encontrado. Instale: https://aka.ms/installazurecliwindows' }
az account show 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { az login | Out-Null }

$conta = az account show | ConvertFrom-Json
$eu = az ad signed-in-user show | ConvertFrom-Json
Write-Host "Assinatura: $($conta.name)  |  Administrador do Azure SQL: $($eu.userPrincipalName)"

Write-Host "Criando/atualizando o grupo de recursos $GrupoRecursos em $Regiao..."
az group create -n $GrupoRecursos -l $Regiao -o none

$ipPublico = ''
try { $ipPublico = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 10).Trim() } catch { }
$ips = if ($ipPublico) { "[`"$ipPublico`"]" } else { '[]' }

Write-Host 'Implantando infraestrutura (App Service, Azure SQL, Storage, Application Insights)...'
$saida = az deployment group create -g $GrupoRecursos -f (Join-Path $aqui 'main.bicep') `
    -p nomeBase=$NomeBase skuAppService=$SkuAppService skuBanco=$SkuBanco `
       adminEntraLogin=$($eu.userPrincipalName) adminEntraObjectId=$($eu.id) adminEntraTipo=User `
       habilitarLoginMicrosoft=$($LoginMicrosoft.IsPresent.ToString().ToLower()) entraClientId=$EntraClientId `
       ipsLiberadosSql=$ips `
    --query properties.outputs -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Falha na implantação do Bicep.' }

$app = $saida.nomeAplicacao.value
Write-Host ''
Write-Host "App Service: $app  ->  $($saida.urlAplicacao.value)" -ForegroundColor Green
Write-Host "Azure SQL:   $($saida.servidorSql.value) / $($saida.bancoSql.value)"
Write-Host "Storage:     $($saida.contaStorage.value)"

# Permissões da identidade gerenciada no Azure SQL (requer sqlcmd moderno com autenticação Entra ID)
$sql = (Get-Content (Join-Path $aqui 'permissoes_identidade_gerenciada.sql') -Raw).Replace('NOME_DO_APP', $app)
$sqlTmp = Join-Path $env:TEMP "meslion_permissoes_$app.sql"
Set-Content -Path $sqlTmp -Value $sql -Encoding UTF8
if (Get-Command sqlcmd -ErrorAction SilentlyContinue) {
    Write-Host 'Concedendo permissões da identidade gerenciada no Azure SQL (sqlcmd)...'
    sqlcmd -S $saida.servidorSql.value -d $saida.bancoSql.value --authentication-method ActiveDirectoryAzCli -i $sqlTmp
    if ($LASTEXITCODE -ne 0) { Write-Host "AVISO: execute manualmente o script $sqlTmp no Editor de consultas do Portal." -ForegroundColor Yellow }
} else {
    Write-Host "AVISO: sqlcmd não encontrado. Execute o script $sqlTmp no Portal do Azure > Banco SQL > Editor de consultas (logado como $($eu.userPrincipalName))." -ForegroundColor Yellow
}

if ($Pacote) {
    Write-Host "Publicando o aplicativo ($Pacote)..."
    az webapp deploy -g $GrupoRecursos -n $app --src-path $Pacote --type zip -o none
    Write-Host "Aplicativo publicado: $($saida.urlAplicacao.value)" -ForegroundColor Green
} else {
    Write-Host 'Pacote não informado: publique depois com'
    Write-Host "  az webapp deploy -g $GrupoRecursos -n $app --src-path MES_LION_AZURE_app-service.zip --type zip"
}
Write-Host ''
Write-Host 'Próximos passos: migrar os dados (docs/AZURE.md, seção "Migração dos dados") e validar em /healthz.'
