import winston from "winston";

export function createLogger(serviceName: string) {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
    defaultMeta: { service: serviceName },
    transports: [
      new winston.transports.File({
        filename: "logs/error.log",
        level: "error",
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: "logs/combined.log",
        maxsize: 5242880, // 5MB
        maxFiles: 10,
      }),
      new winston.transports.Console({
        level: process.env.NODE_ENV === "production" ? "warn" : "info",
        format: winston.format.combine(
          winston.format.timestamp({ format: "HH:mm:ss" }),
          winston.format.colorize({ all: true }),
          winston.format.printf(
            ({ timestamp, level, message, service, ...meta }) => {
              let output = `${timestamp} [${service || "app"}] ${level}: ${message}`;

              // Format additional metadata
              const metaKeys = Object.keys(meta);
              if (metaKeys.length > 0) {
                const cleanMeta = { ...meta };
                delete cleanMeta.timestamp;
                delete cleanMeta.service;

                if (Object.keys(cleanMeta).length > 0) {
                  // Pretty print JSON metadata
                  output += "\n" + JSON.stringify(cleanMeta, null, 2);
                }
              }

              return output;
            },
          ),
        ),
      }),
    ],
  });
}
