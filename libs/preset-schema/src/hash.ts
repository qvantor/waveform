import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { normalizePreset } from './normalize';

const sha256Hex = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));

// name is not a part of the hash: the same sound under another name is a duplicate
export const presetHash = (data: unknown) => sha256Hex(JSON.stringify(normalizePreset(data)));
