-- ============ 会话分享（只读链接） ============
-- 说明：分享内容为创建时的快照；token 为 128bit 随机值，不可枚举。
-- 任何持有链接的人可只读查看（select using true），仅本人可创建/撤销自己的分享。

create table if not exists public.shared_conversations (
  token text primary key,
  -- 归属：默认取当前登录用户，与 projects / conversations 的归属方式一致
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  title text not null default '共享会话',
  project_name text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists shared_conversations_user_id_idx
  on public.shared_conversations (user_id);

alter table public.shared_conversations enable row level security;

-- 只读分享：任何人均可通过 token 读取（随机 token 不可枚举）
drop policy if exists "shared_select_anyone" on public.shared_conversations;
create policy "shared_select_anyone"
  on public.shared_conversations for select
  using (true);

-- 仅本人可创建自己的分享
drop policy if exists "shared_insert_own" on public.shared_conversations;
create policy "shared_insert_own"
  on public.shared_conversations for insert
  with check (auth.uid() = user_id);

-- 仅本人可撤销（删除）自己的分享
drop policy if exists "shared_delete_own" on public.shared_conversations;
create policy "shared_delete_own"
  on public.shared_conversations for delete
  using (auth.uid() = user_id);

-- 仅本人可更新自己的分享（例如修改过期时间）
drop policy if exists "shared_update_own" on public.shared_conversations;
create policy "shared_update_own"
  on public.shared_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
