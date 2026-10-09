create table if not exists body_jobs (
  stock text primary key,
  shop text not null,
  work text not null default '',
  pulled_at text not null
);
