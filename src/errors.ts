/**
 * Error types
 */
export class PrometheusParseError extends Error {
  constructor(message: string, public line?: string, public lineNumber?: number) {
    super(message);
    this.name = 'PrometheusParseError';
  }
}

export class OTLPConversionError extends Error {
  constructor(message: string, public metric?: string) {
    super(message);
    this.name = 'OTLPConversionError';
  }
}