-- Research part 8a: patient consent. A patient signs a printed consent form (four items: treatment by course
-- delegates, research use of anonymised data, photos/X-rays for teaching, follow-up); the clinic records the answers,
-- the date, the form version and language, and uploads a scan of the signed paper.
--
-- stored_files holds uploaded bytes (consent scans now; study approval letters in 8b). Like branding_logos (0040) it has
-- no audit trigger, so audit_log never stores file bytes; the records that reference a file are audited (file id only).
-- It is closed to every role: bytes are read only through definer readers that check the area (consent_file here).
-- consent_form_versions holds the form text, seeded with v1 from docs/consent/consent-form-v1.md. A version is editable
-- until a patient first signs it (first_signed_at, kept even if that patient is later deleted). patient_consents are never edited, only voided with a reason;
-- the current consent is the latest non-voided record by date signed, then recorded time.
create table public.stored_files (
  id uuid primary key default gen_random_uuid(),
  bytes bytea not null,
  content_type text not null check (content_type in ('image/jpeg', 'application/pdf')),
  size_bytes int generated always as (octet_length(bytes)) stored check (size_bytes between 1 and 2097152),
  uploaded_by uuid default auth.uid() references public.profiles (user_id),
  uploaded_at timestamptz not null default now()
);

create table public.consent_form_versions (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (length(label) between 1 and 20 and label = trim(label)),
  effective_on date not null,
  text_en text not null check (length(trim(text_en)) between 1 and 50000),
  text_ar text not null check (length(trim(text_ar)) between 1 and 50000),
  -- clock_timestamp, not now(): versions made in one transaction still order by when they were made.
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  -- Set by the first record_consent on this version; from then on the version is locked.
  first_signed_at timestamptz
);

create table public.patient_consents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  version_id uuid not null references public.consent_form_versions (id),
  language text not null check (language in ('en', 'ar')),
  signed_on date not null,
  treatment boolean not null,
  research boolean not null,
  teaching_images boolean not null,
  follow_up boolean not null,
  file_id uuid not null unique references public.stored_files (id),
  recorded_by uuid default auth.uid() references public.profiles (user_id),
  -- clock_timestamp, not now(): two records signed the same day in one transaction still order by when recorded.
  created_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (user_id),
  voided_reason text not null default '' check (length(voided_reason) <= 500)
);
create index patient_consents_patient_idx on public.patient_consents (patient_id);
create index patient_consents_version_idx on public.patient_consents (version_id);

create trigger consent_form_versions_set_updated_at before update on public.consent_form_versions
  for each row execute function app_private.set_updated_at();
create trigger consent_form_versions_audit after insert or update or delete on public.consent_form_versions
  for each row execute function app_private.audit_row('id');
create trigger patient_consents_audit after insert or update or delete on public.patient_consents
  for each row execute function app_private.audit_row('id');

-- A deleted consent record (only through delete_patient's cascade) takes its scan with it.
create function app_private.delete_consent_file() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.stored_files where id = old.file_id;
  return old;
end $$;
create trigger patient_consents_delete_file after delete on public.patient_consents
  for each row execute function app_private.delete_consent_file();

-- Versions and records: reads obey RLS (View on Patients). stored_files: no access at all. Nobody writes directly.
revoke all on public.stored_files, public.consent_form_versions, public.patient_consents from public, anon, authenticated;
grant select on public.consent_form_versions, public.patient_consents to authenticated;
alter table public.stored_files enable row level security;
alter table public.consent_form_versions enable row level security;
alter table public.patient_consents enable row level security;

create policy patient_consents_select on public.patient_consents for select to authenticated
  using (public.is_active_user());
create policy patient_consents_area_read on public.patient_consents as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

create policy consent_form_versions_select on public.consent_form_versions for select to authenticated
  using (public.is_active_user());
create policy consent_form_versions_area_read on public.consent_form_versions as restrictive for select to authenticated
  using ((select public.can('patients', 'view')));

-- v1, from the draft (English and Arabic sections; headings, the draft note and the footer line left out).
insert into public.consent_form_versions (label, effective_on, text_en, text_ar) values (
  'v1', '2026-10-23',
  replace($en$**{company_name}**
**Consent to treatment, follow-up, teaching and research**

Patient name: {patient_name}  File no.: {file_no}
Course: {course_name}  Date: {date}

### About your treatment
You are being treated during a dental implant training course. Your treatment, which may include implant surgery and the crowns or bridges fitted on the implants, will be carried out by qualified dentists who are attending the course (“course delegates”). They work under the direct supervision of experienced specialists. The treatment, its expected benefits, risks, alternatives and costs have been explained to you separately, and you can ask questions at any time.

Please read each item below and tick **Yes** or **No**. You may accept some items and refuse others. If you refuse items 2 or 3, this will not affect your treatment or the care you receive.

**1. Treatment by course delegates**
I agree to be treated by course delegates under the supervision of the course specialists.
☐ Yes ☐ No

**2. Use of my anonymised data for research**
I agree that information from my dental records may be used for research and published in scientific journals or presentations. This includes my treatment details, the results of my check-ups, and my general health information as it relates to implant treatment. Before it is used, my name, phone number, address and any other details that could identify me will be removed and replaced with a code. Only the clinic team will be able to link the code to me.
☐ Yes ☐ No

**3. Photos and X-rays for teaching and publication**
I agree that clinical photographs of my mouth and my X-rays may be shown in lectures, course materials and scientific publications. My face and name will not be shown.
☐ Yes ☐ No

**4. Follow-up visits and contact**
I agree to attend follow-up visits after treatment, and to be contacted by phone to arrange them.
☐ Yes ☐ No

### Your rights
- Your records are kept confidential. Only the clinic team can see them.
- You can ask questions about your treatment or about how your information is used at any time.
- You will receive a copy of this form on request.

I confirm that I have read this form, or that it has been read to me, in a language I understand. I have had the chance to ask questions, and my answers above are my own free choice.

Patient (or legal guardian) signature: ____________________ Date: __________
Name of guardian and relationship, if applicable: ____________________

Witness / clinic staff name: ____________________ Signature: ____________________$en$, chr(13), ''),
  replace($ar$**{company_name}**
**إقرار موافقة على العلاج والمتابعة والتعليم والبحث العلمي**

اسم المريض: {patient_name}  رقم الملف: {file_no}
الدورة: {course_name}  التاريخ: {date}

### عن العلاج
سيتم علاجك أثناء دورة تدريبية في زراعة الأسنان. قد يشمل العلاج جراحة زراعة الأسنان وتركيب التيجان أو الجسور على الزرعات. يقوم بالعلاج أطباء أسنان مؤهلون من المشاركين في الدورة («المتدرّبون»)، تحت الإشراف المباشر لأخصائيين ذوي خبرة. وقد شُرح لك العلاج وفوائده المتوقعة ومخاطره وبدائله وتكلفته بشكل منفصل، ويمكنك طرح أي أسئلة في أي وقت.

يرجى قراءة كل بند مما يلي ووضع علامة أمام **نعم** أو **لا**. يمكنك الموافقة على بعض البنود ورفض غيرها. ولن يؤثر رفضك للبند ٢ أو البند ٣ على علاجك أو على الرعاية المقدمة لك.

**١. العلاج بواسطة المتدرّبين في الدورة**
أوافق على أن يتم علاجي بواسطة المتدرّبين في الدورة تحت إشراف أخصائيي الدورة.
☐ نعم ☐ لا

**٢. استخدام بياناتي بعد إخفاء هويتي في البحث العلمي**
أوافق على استخدام المعلومات الواردة في ملفي الطبي في البحث العلمي، وعلى نشرها في المجلات العلمية أو العروض العلمية. ويشمل ذلك تفاصيل علاجي، ونتائج زيارات المتابعة، ومعلوماتي الصحية العامة ذات الصلة بعلاج الزراعة. وقبل استخدامها يُحذف اسمي ورقم هاتفي وعنواني وأي بيانات أخرى قد تدل على هويتي، ويُستبدل بها رمز. ولا يستطيع ربط هذا الرمز بي إلا فريق العيادة.
☐ نعم ☐ لا

**٣. الصور والأشعة لأغراض التعليم والنشر**
أوافق على عرض الصور الإكلينيكية لفمي وصور الأشعة الخاصة بي في المحاضرات والمواد التعليمية للدورة والمنشورات العلمية، دون إظهار وجهي أو اسمي.
☐ نعم ☐ لا

**٤. زيارات المتابعة والتواصل**
أوافق على حضور زيارات المتابعة بعد العلاج، وعلى التواصل معي هاتفيًا لتحديد مواعيدها.
☐ نعم ☐ لا

### حقوقك
- تُحفظ بياناتك بسرية تامة، ولا يطّلع عليها إلا فريق العيادة.
- يمكنك في أي وقت الاستفسار عن علاجك أو عن طريقة استخدام بياناتك.
- تحصل على نسخة من هذا الإقرار عند طلبها.

أُقرّ بأنني قرأت هذا الإقرار، أو قُرئ عليّ، بلغة أفهمها، وأُتيحت لي فرصة طرح الأسئلة، وأن إجاباتي أعلاه نابعة من اختياري الحر.

توقيع المريض (أو الولي/الوصي القانوني): ____________________ التاريخ: __________
اسم الولي/الوصي وصلة القرابة (إن وُجد): ____________________

اسم الشاهد / موظف العيادة: ____________________ التوقيع: ____________________$ar$, chr(13), '')
);

create function public.record_consent(
  p_patient uuid, p_version uuid, p_language text, p_signed_on date, p_treatment boolean, p_research boolean,
  p_teaching_images boolean, p_follow_up boolean, p_file bytea, p_content_type text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_effective date;
  v_file uuid;
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');

  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  -- The version row is locked: it can't be edited while it is being signed, and first_signed_at is set once.
  select effective_on into v_effective from public.consent_form_versions where id = p_version for update;
  if not found then
    perform app_private.fail('Choose the form version that was signed.');
  end if;
  if p_language is null or p_language not in ('en', 'ar') then
    perform app_private.fail('Choose the language of the signed form.');
  end if;
  if p_signed_on is null then
    perform app_private.fail('Enter the date the form was signed.');
  end if;
  if p_signed_on > public.cairo_today() then
    perform app_private.fail('The date signed can''t be in the future.');
  end if;
  if p_signed_on < v_effective then
    perform app_private.fail('The date signed is before this form version took effect.');
  end if;
  if p_treatment is null or p_research is null or p_teaching_images is null or p_follow_up is null then
    perform app_private.fail('Answer all four items (yes or no).');
  end if;
  if p_file is null or octet_length(p_file) = 0 then
    perform app_private.fail('Upload the signed form.');
  end if;
  if octet_length(p_file) > 2097152 then
    perform app_private.fail('The file is too large: 2 MB at most.');
  end if;
  if p_content_type is null
     or not ((p_content_type = 'image/jpeg' and substring(p_file from 1 for 3) = '\xffd8ff'::bytea)
             or (p_content_type = 'application/pdf' and substring(p_file from 1 for 5) = '\x255044462d'::bytea)) then
    perform app_private.fail('Upload a JPEG image or a PDF.');
  end if;

  update public.consent_form_versions set first_signed_at = now() where id = p_version and first_signed_at is null;
  insert into public.stored_files (bytes, content_type) values (p_file, p_content_type) returning id into v_file;
  insert into public.patient_consents (patient_id, version_id, language, signed_on, treatment, research, teaching_images,
                                       follow_up, file_id)
  values (p_patient, p_version, p_language, p_signed_on, p_treatment, p_research, p_teaching_images, p_follow_up, v_file)
  returning id into v_id;
  return v_id;
end $$;

create function public.void_consent(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    perform app_private.fail('Say why this consent record is being voided.');
  end if;
  if length(trim(p_reason)) > 500 then
    perform app_private.fail('Keep the reason under 500 characters.');
  end if;
  perform 1 from public.patient_consents where id = p_id and voided_at is null for update;
  if not found then perform app_private.fail('Consent record not found.'); end if;
  update public.patient_consents
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_id;
end $$;

-- Adds (p_id null) or edits a form version. Admin only; a version a patient has signed is locked.
create function public.save_consent_version(
  p_id uuid, p_label text, p_effective_on date, p_text_en text, p_text_ar text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_label text := trim(coalesce(p_label, ''));
  v_id uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  if not public.is_admin() then
    perform app_private.fail('Only an admin can change the consent form.');
  end if;

  if p_id is not null then
    perform 1 from public.consent_form_versions where id = p_id for update;
    if not found then perform app_private.fail('Form version not found.'); end if;
    if exists (select 1 from public.consent_form_versions where id = p_id and first_signed_at is not null)
       or exists (select 1 from public.patient_consents where version_id = p_id) then
      perform app_private.fail('This form version has been signed by patients and can''t be changed. Add a new version instead.');
    end if;
  end if;

  if length(v_label) not between 1 and 20 then
    perform app_private.fail('Enter a label for the form version (up to 20 characters).');
  end if;
  if exists (select 1 from public.consent_form_versions where label = v_label and id is distinct from p_id) then
    perform app_private.fail('A form version with this label already exists.');
  end if;
  if p_effective_on is null then
    perform app_private.fail('Enter the date this version takes effect.');
  end if;
  if length(trim(coalesce(p_text_en, ''))) = 0 or length(trim(coalesce(p_text_ar, ''))) = 0 then
    perform app_private.fail('Enter the English and Arabic text of the form.');
  end if;
  if length(trim(p_text_en)) > 50000 or length(trim(p_text_ar)) > 50000 then
    perform app_private.fail('Keep each text under 50000 characters.');
  end if;

  if p_id is null then
    insert into public.consent_form_versions (label, effective_on, text_en, text_ar)
    values (v_label, p_effective_on, trim(p_text_en), trim(p_text_ar))
    returning id into v_id;
  else
    v_id := p_id;
    update public.consent_form_versions
    set label = v_label, effective_on = p_effective_on, text_en = trim(p_text_en), text_ar = trim(p_text_ar)
    where id = v_id;
  end if;
  return v_id;
exception
  when unique_violation then
    perform app_private.fail('A form version with this label already exists.');
    return null;
end $$;

revoke execute on function public.record_consent(uuid, uuid, text, date, boolean, boolean, boolean, boolean, bytea, text) from public, anon;
grant execute on function public.record_consent(uuid, uuid, text, date, boolean, boolean, boolean, boolean, bytea, text) to authenticated;
revoke execute on function public.void_consent(uuid, text) from public, anon;
grant execute on function public.void_consent(uuid, text) to authenticated;
revoke execute on function public.save_consent_version(uuid, text, date, text, text) from public, anon;
grant execute on function public.save_consent_version(uuid, text, date, text, text) to authenticated;

-- Every form version, newest effective first; in_use = a patient has signed it (then it's locked).
create function public.consent_versions()
returns table (id uuid, label text, effective_on date, text_en text, text_ar text, created_at timestamptz,
               updated_at timestamptz, in_use boolean)
language sql stable security invoker set search_path = '' as $$
  select v.id, v.label, v.effective_on, v.text_en, v.text_ar, v.created_at, v.updated_at,
         v.first_signed_at is not null as in_use
  from public.consent_form_versions v
  order by v.effective_on desc, v.created_at desc;
$$;

-- The version that prints: latest effective on or before today, then the latest made.
create function public.current_consent_version()
returns table (id uuid, label text, effective_on date, text_en text, text_ar text)
language sql stable security invoker set search_path = '' as $$
  select v.id, v.label, v.effective_on, v.text_en, v.text_ar
  from public.consent_form_versions v
  where v.effective_on <= public.cairo_today()
  order by v.effective_on desc, v.created_at desc
  limit 1;
$$;

-- A patient's consent records, voided ones included, current first then newest first. No file bytes.
create function public.patient_consents_for(p_patient uuid)
returns table (id uuid, version_id uuid, version_label text, language text, signed_on date, treatment boolean,
               research boolean, teaching_images boolean, follow_up boolean, file_id uuid, recorded_by_name text, created_at timestamptz, voided_at timestamptz,
               voided_by_name text, voided_reason text, is_current boolean)
language sql stable security invoker set search_path = '' as $$
  with current_record as (
    select pc.id from public.patient_consents pc
    where pc.patient_id = p_patient and pc.voided_at is null
    order by pc.signed_on desc, pc.created_at desc
    limit 1
  )
  select pc.id, pc.version_id, v.label, pc.language, pc.signed_on, pc.treatment, pc.research, pc.teaching_images,
         pc.follow_up, pc.file_id,
         coalesce(nullif(rb.full_name, ''), rb.email), pc.created_at, pc.voided_at,
         coalesce(nullif(vb.full_name, ''), vb.email), pc.voided_reason,
         pc.id in (select id from current_record) as is_current
  from public.patient_consents pc
  join public.consent_form_versions v on v.id = pc.version_id
  left join public.profiles rb on rb.user_id = pc.recorded_by
  left join public.profiles vb on vb.user_id = pc.voided_by
  where pc.patient_id = p_patient
  order by pc.id in (select id from current_record) desc, pc.signed_on desc, pc.created_at desc;
$$;

-- The scan of one of this patient's consent records; no row for any other file, or without View on Patients.
-- Definer because stored_files is closed to every role; the area check is explicit.
create function public.consent_file(p_patient uuid, p_file uuid)
returns table (bytes bytea, content_type text)
language sql stable security definer set search_path = '' as $$
  select f.bytes, f.content_type
  from public.stored_files f
  where (select public.can('patients', 'view'))
    and f.id = p_file
    and exists (select 1 from public.patient_consents pc where pc.file_id = f.id and pc.patient_id = p_patient);
$$;

revoke execute on function public.consent_versions(), public.current_consent_version(), public.patient_consents_for(uuid),
  public.consent_file(uuid, uuid) from public, anon;
grant execute on function public.consent_versions(), public.current_consent_version(), public.patient_consents_for(uuid),
  public.consent_file(uuid, uuid) to authenticated;
