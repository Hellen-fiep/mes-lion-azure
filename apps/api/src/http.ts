// =====================================================================
// Pipeline HTTP (equivalente ao Program.cs do servidor .NET):
//   cabeçalhos de segurança → compressão (Brotli/gzip) → frontend estático (wwwroot, no-cache) →
//   cookies → corpo bruto das rotas /api (até 512 MB, aceita Content-Encoding gzip/br) → rotas → filtro de erros.
// Também publica a documentação Swagger/OpenAPI em /api/docs.
// =====================================================================
import path from 'node:path';
import { constants as zlib } from 'node:zlib';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { TIPO_JSON } from './comum/respostas';
import { pastaFrontend } from './configuracao/carregar-configuracao';
import type { ConfiguracaoMes } from './configuracao/opcoes';
import { Plataforma } from './plataforma';

/** Tipos compactados nas respostas (os mesmos do servidor .NET). */
const COMPACTAVEIS = new Set([
  'application/json',
  'text/plain',
  'text/html',
  'text/css',
  'application/javascript',
  'text/javascript',
  'image/svg+xml',
]);

const TIPOS_ESTATICOS: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export const CAMINHO_SWAGGER = 'api/docs';

export function configurarHttp(app: NestExpressApplication, cfg: ConfiguracaoMes): void {
  const o = cfg.opcoes.servidor;
  const limiteMB = Math.max(32, o.limiteRequisicaoMB);
  const expressApp: express.Express = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  // No Azure App Service o TLS termina no front-end: X-Forwarded-Proto/For valem (cookies "Secure", IP real).
  if (Plataforma.noAzureAppService) expressApp.set('trust proxy', true);

  app.use((_req: Request, res: Response, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  if (o.compressaoRespostas) {
    app.use(
      compression({
        level: 1, // rápido: o estado do MES pode ter dezenas de MB
        brotli: { params: { [zlib.BROTLI_PARAM_QUALITY]: 1 } },
        filter: (_req, res) =>
          COMPACTAVEIS.has(
            String(res.getHeader('Content-Type') ?? '')
              .split(';')[0]
              .trim()
              .toLowerCase(),
          ),
      }),
    );
  }

  // Frontend (o mesmo do MES original): servido antes das rotas, sempre revalidado pelo navegador.
  app.useStaticAssets(pastaFrontend(cfg.raizConteudo), {
    index: ['index.html'],
    redirect: false,
    setHeaders: (res: Response, arquivo: string) => {
      res.setHeader('Cache-Control', 'no-cache');
      const tipo = TIPOS_ESTATICOS[path.extname(arquivo).toLowerCase()];
      if (tipo) res.setHeader('Content-Type', tipo);
    },
  });

  app.use(cookieParser());
  // Corpo das rotas /api lido como bytes (o estado do MES é gravado exatamente como enviado); multipart fica com o multer.
  app.use(
    '/api',
    express.raw({
      type: (req) => !/^multipart\//i.test(String(req.headers['content-type'] ?? '')),
      limit: limiteMB * 1024 * 1024,
      inflate: o.aceitarUploadCompactado,
    }),
  );
  const erroCorpo: ErrorRequestHandler = (
    err: { status?: number; statusCode?: number; type?: string },
    _req,
    res,
    next,
  ) => {
    const status = err?.status ?? err?.statusCode;
    if (!status || res.headersSent) return next(err);
    if (err.type === 'request.aborted') return; // o navegador desistiu
    const mensagem =
      err.type === 'entity.too.large'
        ? `Requisição excede o limite de ${limiteMB} MB.`
        : err.type === 'encoding.unsupported'
          ? 'Content-Encoding não suportado.'
          : 'Corpo da requisição inválido (conteúdo compactado corrompido?).';
    res.status(status).setHeader('Content-Type', TIPO_JSON);
    res.end(JSON.stringify({ error: mensagem }));
  };
  app.use(erroCorpo);

  if (cfg.opcoes.api.swagger) configurarSwagger(app);
}

export function configurarSwagger(app: NestExpressApplication): void {
  const config = new DocumentBuilder()
    .setTitle('MES LION — API')
    .setDescription(
      'API do MES LION em NestJS + Prisma (SQL Server / Azure SQL). Mesmo contrato HTTP do servidor .NET: o frontend atual funciona ' +
        'sem alterações.\n\n' +
        '**Navegador:** `POST /api/auth/login` grava os cookies HttpOnly `MESSESSION` (JWT de acesso, 15 min) e `MESREFRESH` ' +
        '(refresh token rotativo, só para /api); a renovação é automática em qualquer rota.\n\n' +
        '**Clientes de API (apps, integrações):** `POST /api/auth/token` devolve `accessToken` (Bearer) e `refreshToken`; ' +
        'renove em `POST /api/auth/refresh`.',
    )
    .setVersion(Plataforma.versao)
    .addCookieAuth('MESSESSION', { type: 'apiKey', in: 'cookie', name: 'MESSESSION' }, 'MESSESSION')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const documento = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(CAMINHO_SWAGGER, app, documento, {
    jsonDocumentUrl: `${CAMINHO_SWAGGER}-json`,
    customSiteTitle: 'MES LION — API',
    swaggerOptions: { persistAuthorization: true, withCredentials: true },
  });
}
