create table if not exists xref_archives (
  id text primary key,
  saved_at text not null,
  filename text not null,
  vauto_name text not null default '',
  dms_name text not null default '',
  vauto_as_of text,
  dms_as_of text,
  total integer not null,
  ready integer not null,
  csv text not null,
  books_json text,
  content_hash text not null unique
);

create index if not exists xref_archives_saved_idx on xref_archives (saved_at desc);

create table if not exists xref_desk (
  id text primary key,
  books_json text not null,
  updated_at text not null
);
