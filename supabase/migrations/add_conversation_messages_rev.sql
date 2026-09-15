-- ============ 会话消息的乐观锁版本号 ============
-- 说明：conversations.messages 是整列覆盖写入的，两端同时改同一个会话时会互相覆盖。
-- 加一个只随 messages 递增的版本号，写入时带上「我基于哪个版本」作为条件，
-- 于是「另一端已经改过」这件事可以被检测出来，而不是静默覆盖。
--
-- 为什么单独给 messages 一个版本、而不是给整行一个版本：
-- 行级版本会把「一端改标题、另一端改消息」这种本不冲突的并发也判成冲突，
-- 白白抵消掉字段级增量写入带来的好处。
--
-- 其余字段（title / project_id）不参与版本控制：并发改名就是「后写赢」，
-- 不会造成内容丢失。

alter table public.conversations
  add column if not exists messages_rev integer not null default 0;
