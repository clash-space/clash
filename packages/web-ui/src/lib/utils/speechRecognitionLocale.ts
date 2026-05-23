/**
 * Map a UI locale (typically `i18n.language`) to a SpeechRecognition
 * `lang` value. The Web Speech API expects BCP-47 region-tagged values
 * (`en-US`, `zh-CN`) — bare language codes (`en`, `zh`) match nothing.
 *
 * Adding a new app locale? Add it here, not in ChatInput.
 */
const LANG_TO_SR: Record<string, string> = {
    en: 'en-US',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    de: 'de-DE',
    fr: 'fr-FR',
    es: 'es-ES',
    pt: 'pt-BR',
    ru: 'ru-RU',
};

/**
 * Resolve a UI locale string to its SpeechRecognition counterpart.
 * Falls back to passing the original through if it already looks
 * region-tagged (`en-GB`, `zh-TW`), else to `en-US`.
 */
export function resolveSpeechRecognitionLocale(uiLocale: string | undefined): string {
    if (!uiLocale) return 'en-US';
    if (uiLocale.includes('-')) return uiLocale; // already region-tagged
    const base = uiLocale.toLowerCase();
    return LANG_TO_SR[base] ?? 'en-US';
}
