/** Public read-only protocol face; importing it does not construct a client or start a process. */
export { CodexHistoryReader } from './reader.js';
export { CodexReadError } from './errors.js';
export type {
  ReaderOptions, ServerIdentity, TransportObservation, ThreadMetadata, ThreadSnapshot,
  PublicTurn, PublicItem, PublicInput, SourceKind, ScanOptions, JsonValue, JsonRecord,
} from './types.js';
