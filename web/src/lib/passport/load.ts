import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { getBranding } from '@/lib/branding/get';
import { decodeBytea } from '@/lib/branding/image';
import { currentTenant } from '@/lib/tenant/current';
import {
  CASE_SELECT, RESTORATION_SELECT, SITE_SELECT, sortSite, toCases, toRestoration, withPlannedProducts, type RestorationRow,
} from '@/app/(app)/patients/[id]/chart-data';
import type { ImplantSite } from '@/lib/inventory/types';
import { MEDICAL_LEVELS, type MedicalLevel } from './labels';
import { printableLogo } from './versions';
import type { PassportData, PassportMedicalHistory } from './model';

/** Patient columns the passport prints: never phone, email or address. */
const PATIENT_SELECT = 'id, file_no, full_name, dob, sex';

/** Medical-history columns the passport may print (the internal notes field is left out). */
const MEDICAL_SELECT = `
  allergies, medications, smoking, cigarettes_per_day, diabetes_status, hba1c, hba1c_date, bisphosphonates_status,
  anticoagulants_status, radiotherapy_status, osteoporosis_status, periodontitis_history, bruxism,
  previous_implant_failure, other_conditions
`;

const failed = (): never => {
  throw new Error('Could not load the passport');
};

/**
 * Everything one patient's passport prints, read with the signed-in user's own client (RLS: the caller's company and
 * Patients view). The selects and shaping are the chart's (chart-data.ts), so the passport shows what the chart shows.
 * A patient's implants, restorations and cases stay far below PostgREST's 1000-row cap, as on the chart.
 * Null when the patient is not found (or not readable).
 */
export async function loadPassportData(patientId: string): Promise<PassportData | null> {
  const supabase = await createClient();
  const [me, branding, { companyId }] = await Promise.all([getCurrentProfile(), getBranding(), currentTenant()]);
  const [patient, history, sites, restorations, cases, level, logo] = await Promise.all([
    supabase.from('patients').select(PATIENT_SELECT).eq('id', patientId).maybeSingle(),
    supabase.from('medical_history').select(MEDICAL_SELECT).eq('patient_id', patientId).maybeSingle(),
    supabase.from('implant_sites').select(SITE_SELECT).eq('patient_id', patientId).order('created_at'),
    supabase.from('restorations').select(RESTORATION_SELECT).eq('patient_id', patientId).is('voided_at', null),
    supabase.from('full_arch_cases').select(CASE_SELECT).eq('patient_id', patientId).order('created_at'),
    supabase.rpc('passport_settings_current'),
    supabase.rpc('branding_logo_for', { p_company: companyId }).maybeSingle<{ bytes: string }>(),
  ]);
  // The logo is optional: if it cannot be read the passport prints without it (as the app falls back to no logo).
  for (const r of [patient, history, sites, restorations, cases, level]) if (r.error) failed();
  if (!patient.data) return null;

  const siteList = await withPlannedProducts(supabase, ((sites.data ?? []) as unknown as ImplantSite[]).map(sortSite));
  const medicalLevel = (MEDICAL_LEVELS as readonly string[]).includes(level.data as string)
    ? (level.data as MedicalLevel)
    : 'allergies_medications';

  return {
    patient: patient.data as PassportData['patient'],
    medicalHistory: (history.data ?? null) as PassportMedicalHistory | null,
    sites: siteList,
    restorations: ((restorations.data ?? []) as unknown as RestorationRow[]).map(toRestoration),
    cases: toCases(cases.data),
    branding: {
      name: branding.name,
      // PNG or JPEG only, by its bytes: a WebP logo is never handed to the renderer (the clinic name prints alone).
      logo: printableLogo(!logo.error && logo.data ? decodeBytea(logo.data.bytes) : null),
    },
    features: me?.features ?? [],
    medicalLevel,
  };
}
