-- ============ 用户模型配置（云端同步） ============
-- 说明：每个账号一行，整份模型配置（含各条目的 API Key）以 jsonb 保存。
-- 用单行 jsonb 而不是「一条模型一行」，是因为客户端本来就以
-- { profiles, defaultId, selectedId } 作为一个整体读写，结构一一对应，改动最小。
--
-- 安全：RLS 按 auth.uid() 隔离，只有本人能读写自己的行；
--       api_key 存在 profiles 里，因此这张表的数据等同于用户凭据，不要给匿名读权限。

create table if not exists public.user_model_configs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  profiles jsonb not null default '[]'::jsonb,
  default_id text not null default '',
  selected_id text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.user_model_configs enable row level security;

-- 仅本人可读写自己的配置（select / insert / update / delete 一并覆盖）
drop policy if exists "model_config_own" on public.user_model_configs;
create policy "model_config_own"
  on public.user_model_configs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
