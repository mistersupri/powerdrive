import multer from "multer";

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "500", 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Memory storage keeps buffer in RAM during transit to write and compute SHA-256 atomically
const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 50, // Allow up to 50 files per batch
  },
  fileFilter: (req, file, cb) => {
    // Whitelist all standard files
    cb(null, true);
  },
});

