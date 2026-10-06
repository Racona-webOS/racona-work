/**
 * Válaszcím (Reply-To) ellenőrzése — függőség nélküli, a felület is használja
 * (specs/notifications.md, D6).
 */

/**
 * A core (valibot `email()`) ezt a formát fogadja el; ami ezen nem megy át,
 * azt a core elutasítaná, és a levél ki sem menne. „Név <cím>” nem megengedett.
 */
const EMAIL_PATTERN = /^[\w+-]+(?:\.[\w+-]+)*@[\da-z]+(?:[.-][\da-z]+)*\.[a-z]{2,}$/iu;

export const REPLY_TO_MAX_LENGTH = 254;

export function isValidReplyTo(value: string): boolean {
	return value.length <= REPLY_TO_MAX_LENGTH && EMAIL_PATTERN.test(value);
}
