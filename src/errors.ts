/**
 * Error types
 */
export class PrometheusParseError extends Error {
  line?: string;
  lineNumber?: number;

  constructor(message: string, line?: string, lineNumber?: number) {
    super(message);
    this.name = 'PrometheusParseError';
    this.line = line;
    this.lineNumber = lineNumber;
  }
}

export class OTLPConversionError extends Error {
  metric?: string;

  constructor(message: string, metric?: string) {
    super(message);
    this.name = 'OTLPConversionError';
    this.metric = metric;
  }
}
