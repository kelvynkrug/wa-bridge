/**
 * Erro estruturado compartilhado entre o gate de envio e a camada HTTP. A API
 * traduz `status`/`code`/`detail` diretamente para o formato de erro do contrato.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: unknown;

  constructor(code: string, status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}
