-- ============ 会话多端实时同步（Realtime） ============
-- 说明：把 projects / conversations 加入 Realtime 复制。任意端写入后，
--       其他端通过 postgres_changes 立刻收到通知并拉取最新数据，
--       用来取代「手动刷新 / 重新聚焦才更新」。
--
-- 安全：RLS 依然生效，订阅方只能收到自己有权读取的行的事件（策略按 auth.uid() 隔离）。
--
-- 不需要 replica identity full：本方案只用事件作为「有变化了」的触发信号，
-- 真正的数据由客户端重新查询获得，因此不依赖 payload.old 的完整字段
-- （在 RLS 开启时它本来也只含主键）。

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    execute 'alter publication supabase_realtime add table public.conversations';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'projects'
  ) then
    execute 'alter publication supabase_realtime add table public.projects';
  end if;
end $$;
