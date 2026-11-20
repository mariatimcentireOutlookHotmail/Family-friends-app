-- =============================================================================
-- "Also known as" names, e.g. the English name many Chinese people use
-- (陈美玲 aka Michelle). Stored as an extra row in person_names with type 'aka'.
--
-- Kept in its own migration: Postgres can't use a new enum value in the same
-- transaction that adds it.
-- =============================================================================
alter type public.name_type add value if not exists 'aka' after 'birth';
