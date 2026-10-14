// Testes Jest: só os erros do Logger do Nest aparecem na saída (as mensagens de inicialização e avisos esperados
// — ex.: "refresh token reutilizado" — poluiriam o relatório).
import { Logger } from '@nestjs/common';

Logger.overrideLogger(['error']);
