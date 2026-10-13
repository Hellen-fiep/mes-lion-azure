// =====================================================================
// MES LION — Infraestrutura Microsoft Azure (Bicep)
// Cria: App Service (Linux, .NET 10) com identidade gerenciada, Azure SQL Database
// (autenticação somente Microsoft Entra ID), Storage Account (Blob) para documentos/anexos/
// backups, Application Insights + Log Analytics e, opcionalmente, login Microsoft Entra ID
// (App Service Authentication / "Easy Auth").
//
// Implantação: infra/implantar-azure.ps1 (ou: az deployment group create -g <rg> -f infra/main.bicep -p ...)
// =====================================================================
targetScope = 'resourceGroup'

@description('Prefixo dos nomes dos recursos (letras minúsculas e números).')
@minLength(3)
@maxLength(12)
param nomeBase string = 'meslion'

@description('Região do Azure. Padrão: a do grupo de recursos (ex.: brazilsouth).')
param local string = resourceGroup().location

@description('Plano do App Service (B1 = básico; S1/P0v3/P1v3 para produção com mais usuários).')
@allowed([ 'B1', 'B2', 'S1', 'S2', 'P0v3', 'P1v3', 'P2v3' ])
param skuAppService string = 'B1'

@description('Camada do Azure SQL Database (DTU). S0 atende a homologação; S1/S2 para produção.')
@allowed([ 'Basic', 'S0', 'S1', 'S2', 'S3' ])
param skuBanco string = 'S0'

@description('Login (UPN ou nome do grupo) do administrador Microsoft Entra ID do Azure SQL.')
param adminEntraLogin string

@description('Object ID (GUID) do usuário ou grupo administrador do Azure SQL.')
param adminEntraObjectId string

@description('Tipo do administrador do Azure SQL.')
@allowed([ 'User', 'Group', 'Application' ])
param adminEntraTipo string = 'User'

@description('Tenant do Microsoft Entra ID.')
param tenantId string = subscription().tenantId

@description('Habilita o botão "Entrar com Microsoft" (App Service Authentication). Requer um App Registration.')
param habilitarLoginMicrosoft bool = false

@description('Client ID (Application ID) do App Registration usado no login Microsoft. Vazio se o login Microsoft estiver desabilitado.')
param entraClientId string = ''

@secure()
@description('Segredo do App Registration (opcional; recomendado).')
param entraClientSecret string = ''

@description('Exigir login Microsoft para todo o sistema (exceto passaporte público e /healthz).')
param exigirLoginMicrosoft bool = false

@description('IPs públicos (ex.: da rede da empresa) liberados no firewall do Azure SQL para a TI/migração.')
param ipsLiberadosSql array = []

var sufixo = take(uniqueString(resourceGroup().id, nomeBase), 8)
var nomeLimpo = toLower(replace(nomeBase, '-', ''))
var nomeApp = '${nomeLimpo}-${sufixo}'
var nomePlano = 'plan-${nomeLimpo}-${sufixo}'
var nomeSql = 'sql-${nomeLimpo}-${sufixo}'
var nomeBanco = 'meslion'
var nomeStorage = take('st${nomeLimpo}${uniqueString(resourceGroup().id, nomeBase)}', 24)
var nomeContainer = 'meslion'
var nomeLogs = 'log-${nomeLimpo}-${sufixo}'
var nomeInsights = 'appi-${nomeLimpo}-${sufixo}'
var tierBanco = skuBanco == 'Basic' ? 'Basic' : 'Standard'
var papelStorageBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var tags = {
  aplicacao: 'MES LION'
  arquitetura: 'ASP.NET Core .NET 10 + Azure SQL + Blob Storage'
}

// ------------------------------------------------------------------ monitoramento
resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: nomeLogs
  location: local
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: nomeInsights
  location: local
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    IngestionMode: 'LogAnalytics'
  }
}

// ------------------------------------------------------------------ armazenamento de arquivos (Blob)
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: nomeStorage
  location: local
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Chave da conta mantida para a migração inicial a partir de um PC (connection string).
    // Depois da migração pode ser desabilitada: o MES usa identidade gerenciada.
    allowSharedKeyAccess: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: nomeContainer
  properties: { publicAccess: 'None' }
}

// ------------------------------------------------------------------ Azure SQL (somente Microsoft Entra ID)
resource sqlServer 'Microsoft.Sql/servers@2021-11-01' = {
  name: nomeSql
  location: local
  tags: tags
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: adminEntraLogin
      sid: adminEntraObjectId
      tenantId: tenantId
      principalType: adminEntraTipo
    }
  }
}

resource sqlFirewallAzure 'Microsoft.Sql/servers/firewallRules@2021-11-01' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlFirewallIps 'Microsoft.Sql/servers/firewallRules@2021-11-01' = [for (ip, i) in ipsLiberadosSql: {
  parent: sqlServer
  name: 'empresa-${i}'
  properties: {
    startIpAddress: ip
    endIpAddress: ip
  }
}]

resource sqlDb 'Microsoft.Sql/servers/databases@2021-11-01' = {
  parent: sqlServer
  name: nomeBanco
  location: local
  tags: tags
  sku: {
    name: skuBanco
    tier: tierBanco
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    requestedBackupStorageRedundancy: 'Local'
  }
}

// ------------------------------------------------------------------ App Service (Linux, .NET 10)
resource plano 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: nomePlano
  location: local
  tags: tags
  kind: 'linux'
  sku: { name: skuAppService }
  properties: { reserved: true }
}

var connectionStringSql = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Database=${nomeBanco};Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connect Timeout=60'

var configuracoesBase = [
  { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
  { name: 'ASPNETCORE_FORWARDEDHEADERS_ENABLED', value: 'true' }
  { name: 'MesLion__Banco__Provedor', value: 'SqlServer' }
  { name: 'MesLion__Banco__CriarBancoSeNaoExistir', value: 'false' }
  { name: 'MesLion__Banco__AplicarScriptsAutomaticamente', value: 'true' }
  { name: 'MesLion__Arquivos__Provedor', value: 'AzureBlob' }
  { name: 'MesLion__Arquivos__AzureBlob__ContaUrl', value: storage.properties.primaryEndpoints.blob }
  { name: 'MesLion__Arquivos__AzureBlob__Container', value: nomeContainer }
  { name: 'MesLion__Arquivos__AzureBlob__UsarIdentidadeGerenciada', value: 'true' }
  { name: 'MesLion__Publicacao__UrlBasePublica', value: 'https://${nomeApp}.azurewebsites.net' }
  { name: 'MesLion__Autenticacao__EntraId__Habilitado', value: string(habilitarLoginMicrosoft) }
  { name: 'MesLion__Seed__ArquivoInicial', value: 'Dados/MES_LION_DATA.json' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
  { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
  { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'true' }
]
var configuracoesSegredo = (habilitarLoginMicrosoft && !empty(entraClientSecret)) ? [
  { name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET', value: entraClientSecret }
] : []

resource app 'Microsoft.Web/sites@2022-09-01' = {
  name: nomeApp
  location: local
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plano.id
    httpsOnly: true
    clientAffinityEnabled: true
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/healthz'
      appSettings: concat(configuracoesBase, configuracoesSegredo)
      connectionStrings: [
        {
          name: 'MesLion'
          connectionString: connectionStringSql
          type: 'SQLAzure'
        }
      ]
    }
  }
}

// O MES grava documentos/anexos/backups no Blob com a identidade gerenciada do App Service.
resource papelBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, app.id, papelStorageBlobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', papelStorageBlobDataContributor)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ------------------------------------------------------------------ login Microsoft Entra ID (opcional)
resource autenticacao 'Microsoft.Web/sites/config@2022-09-01' = if (habilitarLoginMicrosoft) {
  parent: app
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      requireAuthentication: exigirLoginMicrosoft
      unauthenticatedClientAction: exigirLoginMicrosoft ? 'RedirectToLoginPage' : 'AllowAnonymous'
      redirectToProvider: 'azureactivedirectory'
      excludedPaths: [ '/passaporte', '/healthz' ]
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
          clientId: entraClientId
          clientSecretSettingName: empty(entraClientSecret) ? null : 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
        }
        validation: {
          allowedAudiences: [ 'api://${entraClientId}', entraClientId ]
        }
      }
    }
    login: {
      tokenStore: { enabled: true }
    }
  }
}

// ------------------------------------------------------------------ saídas
output urlAplicacao string = 'https://${app.properties.defaultHostName}'
output nomeAplicacao string = app.name
output identidadeAplicacao string = app.identity.principalId
output servidorSql string = sqlServer.properties.fullyQualifiedDomainName
output bancoSql string = nomeBanco
output contaStorage string = storage.name
output urlBlob string = storage.properties.primaryEndpoints.blob
output applicationInsights string = insights.name
