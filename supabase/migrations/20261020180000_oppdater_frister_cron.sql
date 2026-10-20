-- Additivt. Status utledes av frist, ellers møtedato. Uten begge blir
-- status normal: manglende frist er ikke kritisk. Passert dag blir passert.
-- Idempotent. Skriver ikke tittel, sammendrag eller kategori, så
-- manuelt_redigert-rader beholder redaktørteksten.
--
-- Sametinget-høringen 1cf0dfd3: trekkHoringsfrist leser
-- «Høringsfristen er 23. november 2026» fra artikkelsiden (lest 2026-10-20).
-- Møtedatoene under er lest samme dag fra eInnsyn Moetemappe.moetedato og
-- Bergen agendapunkter.moteDato. Bare tomme motedato fylles.
--
-- Daglig jobb klones fra hent-saker-daglig og kjøres 06:30 UTC.
-- x-cron-secret skrives ikke inn her.

alter table public.varsler
  add column if not exists motedato date;

comment on column public.varsler.motedato is
  'Møtedag for politiske saker uten høringsfrist. Status bruker frist først, deretter denne.';

update public.varsler
set frist = date '2026-11-23'
where frist is distinct from date '2026-11-23'
  and kilde ilike '%sametinget.no/aktuelt/horing-behov-for-samiske-tilbud-ordninger-og-tiltak-i-sor-norge-valgkrets.55024.aspx%';

update public.varsler v
set motedato = d.dato
from (
  values
    ('ms_01kqw9a90mea0tkjpbrba6vm7x', date '2026-05-12'),
    ('ms_01kqeg3mtvegptkpjk8gzxxfhs', date '2026-05-13'),
    ('ms_01kkhjm8vwew3tvdy2x94zpnvz', date '2026-03-18'),
    ('ms_01kqeg3e97eber3maadssygk1x', date '2026-05-13'),
    ('ms_01kjszsh03e8bv2sdjkk95yxwv', date '2026-03-10'),
    ('ms_01kjwjmqnrebqte362he517nhw', date '2026-03-11'),
    ('ms_01kssr4j3mevvtgrq2m81f5x45', date '2026-06-10'),
    ('ms_01khbfkpfcen1avay3z9yqyhyf', date '2026-02-11'),
    ('ms_01kn3z2d6ben1ankbx8sk7gp9h', date '2026-04-15'),
    ('ms_01kqwphmx0ew5svr07yn3bhem8', date '2026-05-28'),
    ('ms_01kqa2r7k2e3ttghmwtrmm6c0b', date '2026-05-05'),
    ('ms_01kq7941rwej88qjvkt9m321ve', date '2026-05-05'),
    ('ms_01kq793wete8jbdwsgba06vnb0', date '2026-05-07'),
    ('ms_01kpza7ywpenjbdy65bsabrhzm', date '2026-05-05'),
    ('ms_01kpdjvt2ne98rgfnhn3fks05h', date '2026-04-15'),
    ('ms_01kqw9ah7gerx9w42gv347n9gr', date '2026-05-12'),
    ('ms_01khbfkq2aezp8b5cr5ca3trb5', date '2026-02-11'),
    ('ms_01ks64y9wnezgbkngzp2f6yran', date '2026-06-01'),
    ('ms_01kfd4rmkqeb490zxtfkn9hhke', date '2026-01-27'),
    ('ms_01m0cd61ahefa9jtv0k6vx3c0r', date '2026-08-26'),
    ('ms_01m20gmwb2ebbt19bpqjxp7v3v', date '2026-09-24'),
    ('ms_01m2mytvzreczsyaaq30gdehwa', date '2026-09-23'),
    ('ms_01m39svva4ey3vksnjsznjmqrx', date '2026-09-29'),
    ('ms_01m0cd5zvbe3f8m6sga267n8xz', date '2026-08-26'),
    ('ms_01m13xjyzwe8v9bw40jsyk33j1', date '2026-09-16'),
    ('ms_01m1p30wgee0z8npk5ra39vymq', date '2026-09-17'),
    ('ms_01m22y2538ezjr23mbf5z13jd8', date '2026-09-15'),
    ('ms_01m251cfzvedbrjm7vk3ktxftt', date '2026-09-17'),
    ('ms_01m077v0qnea19zx3eq53ncgvz', date '2026-08-24')
) as d(sak, dato)
where v.motedato is null
  and v.kilde ~ ('/moetesak/' || d.sak || '($|[/?#])');

update public.varsler v
set motedato = d.dato
from (
  values
    ('9034514', '267495', date '2026-05-06'),
    ('9034499', '265310', date '2026-01-14'),
    ('9034505', '265707', date '2026-02-04'),
    ('9034508', '266464', date '2026-03-11'),
    ('9034511', '267111', date '2026-04-15'),
    ('9034514', '267565', date '2026-05-06'),
    ('9034524', '268347', date '2026-06-03'),
    ('9034529', '268534', date '2026-06-10'),
    ('9996489', '268711', date '2026-06-22'),
    ('9034530', '269740', date '2026-09-08'),
    ('9034533', '270651', date '2026-10-14'),
    ('10477570', '270765', date '2026-10-21'),
    ('9064055', '265348', date '2026-01-28'),
    ('9064073', '267554', date '2026-05-20'),
    ('9034530', '269698', date '2026-09-08'),
    ('9034499', '265305', date '2026-01-14'),
    ('9034499', '265304', date '2026-01-14'),
    ('9034505', '265670', date '2026-02-04'),
    ('9034505', '265682', date '2026-02-04'),
    ('9034508', '266445', date '2026-03-11'),
    ('9034508', '266462', date '2026-03-11'),
    ('9034511', '267099', date '2026-04-15'),
    ('9034511', '267103', date '2026-04-15'),
    ('9034514', '267477', date '2026-05-06'),
    ('9034524', '268341', date '2026-06-03'),
    ('9034524', '268342', date '2026-06-03'),
    ('9034529', '268530', date '2026-06-10'),
    ('9034530', '269688', date '2026-09-08'),
    ('9034530', '269731', date '2026-09-08'),
    ('9034533', '270628', date '2026-10-14'),
    ('9034533', '270637', date '2026-10-14'),
    ('9089470', '266326', date '2026-03-12'),
    ('9034499', '265295', date '2026-01-14'),
    ('9034505', '265669', date '2026-02-04'),
    ('9034508', '266447', date '2026-03-11'),
    ('9034511', '267101', date '2026-04-15'),
    ('9034514', '267478', date '2026-05-06'),
    ('9034524', '268345', date '2026-06-03'),
    ('9034530', '269689', date '2026-09-08'),
    ('9064089', '270599', date '2026-10-27'),
    ('9034533', '270630', date '2026-10-14'),
    ('9034499', '265296', date '2026-01-14'),
    ('9034505', '265668', date '2026-02-04'),
    ('9034505', '265671', date '2026-02-04'),
    ('9034508', '266446', date '2026-03-11'),
    ('9034508', '266448', date '2026-03-11'),
    ('9034511', '267100', date '2026-04-15'),
    ('9034511', '267102', date '2026-04-15'),
    ('9034514', '267476', date '2026-05-06'),
    ('9034514', '267479', date '2026-05-06'),
    ('9034524', '268343', date '2026-06-03'),
    ('9034524', '268344', date '2026-06-03'),
    ('9034530', '269690', date '2026-09-08'),
    ('9034533', '270629', date '2026-10-14'),
    ('9034533', '270631', date '2026-10-14'),
    ('9064067', '267004', date '2026-04-29'),
    ('9034499', '265294', date '2026-01-14'),
    ('9034530', '269687', date '2026-09-08'),
    ('9782093', '268628', date '2026-06-11'),
    ('9034499', '265297', date '2026-01-14'),
    ('9034505', '265680', date '2026-02-04'),
    ('9034514', '267491', date '2026-05-06'),
    ('9034530', '269702', date '2026-09-08'),
    ('9034499', '265298', date '2026-01-14'),
    ('9034499', '265299', date '2026-01-14'),
    ('9034524', '268322', date '2026-06-03'),
    ('9034529', '268506', date '2026-06-10'),
    ('9034529', '268507', date '2026-06-10'),
    ('9034529', '268509', date '2026-06-10'),
    ('9034530', '269695', date '2026-09-08'),
    ('9034530', '269701', date '2026-09-08'),
    ('9034530', '269722', date '2026-09-08'),
    ('9034511', '267162', date '2026-04-15'),
    ('9034505', '265675', date '2026-02-04'),
    ('9034505', '265677', date '2026-02-04'),
    ('9034505', '265679', date '2026-02-04'),
    ('9034511', '267070', date '2026-04-15'),
    ('9034511', '267071', date '2026-04-15'),
    ('9034511', '267074', date '2026-04-15'),
    ('9034514', '267481', date '2026-05-06'),
    ('9034524', '268324', date '2026-06-03'),
    ('9034524', '268326', date '2026-06-03'),
    ('9034530', '269700', date '2026-09-08'),
    ('9034530', '269710', date '2026-09-08'),
    ('9034530', '269711', date '2026-09-08'),
    ('9034505', '265672', date '2026-02-04'),
    ('9034508', '266449', date '2026-03-11'),
    ('9034508', '266450', date '2026-03-11'),
    ('9034508', '266452', date '2026-03-11'),
    ('9034511', '267072', date '2026-04-15'),
    ('9034511', '267075', date '2026-04-15'),
    ('9034514', '267480', date '2026-05-06'),
    ('9034514', '267486', date '2026-05-06'),
    ('9034524', '268325', date '2026-06-03'),
    ('9034530', '269728', date '2026-09-08'),
    ('8997170', '268485', date '2026-06-09'),
    ('9034533', '270650', date '2026-10-14'),
    ('9034533', '270634', date '2026-10-14'),
    ('9034499', '265303', date '2026-01-14'),
    ('9034505', '265673', date '2026-02-04'),
    ('9034505', '265676', date '2026-02-04'),
    ('9034508', '266458', date '2026-03-11'),
    ('9034514', '267487', date '2026-05-06'),
    ('9034524', '268328', date '2026-06-03'),
    ('9034529', '268503', date '2026-06-10'),
    ('9034529', '268502', date '2026-06-10'),
    ('9034529', '268504', date '2026-06-10'),
    ('9034530', '269709', date '2026-09-08'),
    ('9034530', '269724', date '2026-09-08'),
    ('9034533', '270632', date '2026-10-14'),
    ('9627244', '268291', date '2026-05-28'),
    ('9059686', '268054', date '2026-05-26'),
    ('9034499', '265300', date '2026-01-14'),
    ('9034508', '266451', date '2026-03-11'),
    ('9034511', '267073', date '2026-04-15'),
    ('9034514', '267483', date '2026-05-06'),
    ('9034524', '268323', date '2026-06-03'),
    ('9034524', '268329', date '2026-06-03'),
    ('9034524', '268331', date '2026-06-03'),
    ('9034529', '268510', date '2026-06-10'),
    ('9034530', '269693', date '2026-09-08'),
    ('9034530', '269696', date '2026-09-08'),
    ('9034530', '269712', date '2026-09-08'),
    ('9034530', '269729', date '2026-09-08'),
    ('9034530', '269716', date '2026-09-08'),
    ('9034530', '269726', date '2026-09-08'),
    ('9034533', '270633', date '2026-10-14'),
    ('9449206', '266669', date '2026-03-26'),
    ('9034505', '265681', date '2026-02-04'),
    ('9034511', '267082', date '2026-04-15'),
    ('9034514', '267485', date '2026-05-06'),
    ('9034524', '268320', date '2026-06-03'),
    ('9034524', '268330', date '2026-06-03'),
    ('9034529', '268501', date '2026-06-10'),
    ('9034530', '269708', date '2026-09-08'),
    ('9034530', '269713', date '2026-09-08'),
    ('9034530', '269715', date '2026-09-08'),
    ('9034530', '269723', date '2026-09-08'),
    ('9058984', '265160', date '2026-01-06'),
    ('9034511', '267079', date '2026-04-15'),
    ('9034514', '267482', date '2026-05-06'),
    ('9034514', '267492', date '2026-05-06'),
    ('9034530', '269725', date '2026-09-08'),
    ('9064089', '270577', date '2026-10-27'),
    ('9034533', '270635', date '2026-10-14'),
    ('9034499', '265306', date '2026-01-14'),
    ('9034508', '266454', date '2026-03-11'),
    ('9034511', '267081', date '2026-04-15'),
    ('9034514', '267484', date '2026-05-06'),
    ('9034514', '267490', date '2026-05-06')
) as d(mote, sak, dato)
where v.motedato is null
  and v.kilde ~ ('/mote/' || d.mote || '/sak/' || d.sak || '($|[/?#])');

update public.varsler
set status = case
  when coalesce(frist, motedato) is null then 'normal'
  when coalesce(frist, motedato) < (timezone('Europe/Oslo', now()))::date then 'passert'
  when coalesce(frist, motedato) <= (timezone('Europe/Oslo', now()))::date + 7 then 'kritisk'
  when coalesce(frist, motedato) <= (timezone('Europe/Oslo', now()))::date + 21 then 'viktig'
  else 'normal'
end
where status is distinct from (
  case
    when coalesce(frist, motedato) is null then 'normal'
    when coalesce(frist, motedato) < (timezone('Europe/Oslo', now()))::date then 'passert'
    when coalesce(frist, motedato) <= (timezone('Europe/Oslo', now()))::date + 7 then 'kritisk'
    when coalesce(frist, motedato) <= (timezone('Europe/Oslo', now()))::date + 21 then 'viktig'
    else 'normal'
  end
);

comment on column public.varsler.status is
  'kritisk | viktig | normal | passert. Settes fra frist, ellers motedato. Uten dato er verdien normal.';

do $cron$
declare
  cmd text;
begin
  if exists (select 1 from cron.job where jobname = 'oppdater-frister-daglig') then
    perform cron.unschedule('oppdater-frister-daglig');
  end if;

  select command into cmd
  from cron.job
  where jobname = 'hent-saker-daglig';

  if cmd is null or position('/functions/v1/hent-saker' in cmd) = 0 then
    raise warning 'oppdater-frister-daglig ble ikke planlagt: fant ikke hent-saker-daglig med kjent URL';
    return;
  end if;

  cmd := replace(cmd, '/functions/v1/hent-saker', '/functions/v1/oppdater-frister');
  perform cron.schedule('oppdater-frister-daglig', '30 6 * * *', cmd);
end
$cron$;
