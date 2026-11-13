export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const badRequest = (m: string, code = "BAD_REQUEST") => new AppError(400, code, m);
export const unauthorized = (m = "Silakan masuk terlebih dahulu.") => new AppError(401, "UNAUTHORIZED", m);
export const forbidden = (m = "Anda tidak memiliki izin untuk tindakan ini.") => new AppError(403, "FORBIDDEN", m);
export const notFound = (m = "Data tidak ditemukan.") => new AppError(404, "NOT_FOUND", m);
export const conflict = (m: string, code = "CONFLICT") => new AppError(409, code, m);
