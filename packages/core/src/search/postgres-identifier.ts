import { sha256 } from "@oslojs/crypto/sha2";

const MAX_IDENTIFIER_BYTES = 63;
const encoder = new TextEncoder();

export function postgresSearchIdentifier(name: string): string {
	if (encoder.encode(name).byteLength <= MAX_IDENTIFIER_BYTES) return name;
	const digest = Array.from(sha256(encoder.encode(name)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	)
		.join("")
		.slice(0, 20);
	const prefixLength = MAX_IDENTIFIER_BYTES - digest.length - 1;
	return `${name.slice(0, prefixLength)}_${digest}`;
}
