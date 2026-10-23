/** The four items of the consent form, in form order. */
export const CONSENT_ITEMS = [
  { key: 'treatment', short: 'Treatment', label: 'Treatment by course delegates under supervision' },
  { key: 'research', short: 'Research', label: 'Research use of anonymised data' },
  { key: 'teaching_images', short: 'Teaching images', label: 'Photos and X-rays for teaching and publication (no face or name)' },
  { key: 'follow_up', short: 'Follow-up', label: 'Follow-up visits and phone contact' },
] as const;

export type ConsentItem = (typeof CONSENT_ITEMS)[number]['key'];

export const CONSENT_LANGUAGES = ['en', 'ar'] as const;
export type ConsentLanguage = (typeof CONSENT_LANGUAGES)[number];
export const CONSENT_LANGUAGE_LABELS: Record<ConsentLanguage, string> = { en: 'English', ar: 'Arabic' };

/** A row of patient_consents_for (0072). */
export type ConsentRecord = {
  id: string;
  version_id: string;
  version_label: string;
  language: ConsentLanguage;
  signed_on: string;
  treatment: boolean;
  research: boolean;
  teaching_images: boolean;
  follow_up: boolean;
  file_id: string;
  recorded_by_name: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by_name: string | null;
  voided_reason: string | null;
  is_current: boolean;
};

/** A form version a patient can have signed. */
export type ConsentVersionOption = { id: string; label: string; effective_on: string };
