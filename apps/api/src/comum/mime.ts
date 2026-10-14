// Tipo de conteúdo pelo nome do arquivo (ServicoArquivos.TipoPorNome do servidor .NET).
const TIPOS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.json': 'application/json',
  '.xml': 'text/xml',
  '.zip': 'application/x-zip-compressed',
  '.gz': 'application/x-gzip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.dwg': 'application/acad',
  '.step': 'application/step',
  '.stp': 'application/step',
};

export function tipoPorNome(nome: string): string {
  const n = nome.toLowerCase();
  const ponto = n.lastIndexOf('.');
  if (ponto < 0) return 'application/octet-stream';
  return TIPOS[n.slice(ponto)] ?? 'application/octet-stream';
}

/** Extensão (minúscula, com ponto) como o Path.GetExtension do .NET. */
export function extensao(nome: string): string {
  const base = nome.replace(/\\/g, '/').split('/').pop() ?? '';
  const ponto = base.lastIndexOf('.');
  return ponto <= -1 || ponto === base.length - 1 ? '' : base.slice(ponto).toLowerCase();
}
