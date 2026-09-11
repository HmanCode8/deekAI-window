import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { PublicModelProfile } from "@shared/bridge-api";
import {
  CUSTOM_PROVIDER_ID,
  PROVIDER_PRESETS,
  getProviderPreset,
  profileSupportsFiles,
  sanitizeModelProfile,
  type ModelProfile,
} from "@shared/model-profiles";
import * as api from "../../lib/api";
import { loadLocalStore, saveModelStore, syncModelStore, type LocalModelStore } from "../../lib/model-profiles";
import { getSupabase } from "../../lib/supabase";

/**
 * 「模型设置」Tab：分两块，互不影响。
 *
 * 1) 我的模型（可增删改）—— 存本机 localStorage（deekai:models:<userId>），
 *    登录后同时同步到 Supabase（表 user_model_configs，按账号 RLS 隔离），
 *    所以同一账号换设备/换端也能拿到同一份配置；未登录或云端不可用时只用本机那份。
 * 2) 内置模型（运营方预置，只读）—— 来自 PublicConfig.serverModelProfiles，
 *    由 app-config.json / .env 提供，所有使用者共享，不可编辑或删除。
 *
 * 每条 = 自定义显示名 + 厂商预设（或自定义）+ Base URL + 厂商真实模型 + 自己的 Key。
 */

interface SettingsModelsTabProps {
  /** 当前登录用户 id（本机条目按账号分键）；内存 / 匿名模式为 null */
  userId: string | null;
  /** 运营方预置条目（只读） */
  serverProfiles: PublicModelProfile[];
  /** 是否同步到云端（登录 + 已配置 Supabase） */
  remote: boolean;
  /** 保存后关闭弹窗 */
  onClose: () => void;
}

export default function SettingsModelsTab({
  userId,
  serverProfiles,
  remote,
  onClose,
}: SettingsModelsTabProps) {
  const [drafts, setDrafts] = useState<ModelProfile[]>([]);
  const [defaultId, setDefaultId] = useState("");
  const [editing, setEditing] = useState<ModelProfile | null>(null);
  const [fetched, setFetched] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 切换账号/挂载时读取配置：登录态先跟云端同步一次，避免新设备上显示成空的
  useEffect(() => {
    let cancelled = false;

    const apply = (store: LocalModelStore) => {
      if (cancelled) return;
      setDrafts(store.profiles);
      setDefaultId(store.defaultId);
    };

    setEditing(null);
    setFetched([]);
    setFetchError("");
    setPickerOpen(false);
    setBusy(false);
    setError("");

    if (remote && userId) {
      syncModelStore(userId)
        .then(apply)
        .catch(() => apply(loadLocalStore(userId)));
    } else {
      apply(loadLocalStore(userId));
    }

    return () => {
      cancelled = true;
    };
  }, [userId, remote]);

  const openEditor = (draft: ModelProfile) => {
    setEditing({ ...draft });
    setFetched([]);
    setFetchError("");
    setError("");
    setPickerOpen(false);
  };

  const newDraft = (): ModelProfile => {
    const preset = PROVIDER_PRESETS[0];
    return {
      id: crypto.randomUUID(),
      name: preset.label,
      providerId: preset.id,
      baseUrl: preset.baseUrl,
      model: preset.models[0] ?? "",
      apiKey: "",
    };
  };

  const patchEditing = (patch: Partial<ModelProfile>) => {
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  /** 切换厂商：自动带出官方 Base URL 与该厂商的常见模型 */
  const changeProvider = (providerId: string) => {
    const preset = getProviderPreset(providerId);
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            providerId,
            baseUrl: preset?.baseUrl ?? "",
            model: preset?.models[0] ?? "",
          }
        : prev
    );
    setFetched([]);
    setFetchError("");
    setPickerOpen(false);
  };

  const fetchModels = async () => {
    if (!editing || fetching) return;
    setFetching(true);
    setFetchError("");
    try {
      const result = await api.listModels({
        baseUrl: editing.baseUrl,
        apiKey: editing.apiKey,
        profileId: editing.id,
      });
      setFetched(result.models);
      setFetchError(result.error ?? "");
      // 拉取成功后直接展开列表，省一次点击
      if (result.models.length > 0) setPickerOpen(true);
    } catch (err) {
      setFetchError((err as Error).message || "获取模型列表失败");
    } finally {
      setFetching(false);
    }
  };

  const commitEditing = () => {
    if (!editing) return;
    if (!editing.baseUrl.trim() || !editing.model.trim()) {
      setError("请填写 Base URL 与模型名");
      return;
    }
    setDrafts((prev) =>
      prev.some((item) => item.id === editing.id)
        ? prev.map((item) => (item.id === editing.id ? editing : item))
        : [...prev, editing]
    );
    setEditing(null);
    setError("");
  };

  const removeDraft = (id: string) => {
    setDrafts((prev) => prev.filter((item) => item.id !== id));
    if (defaultId === id) setDefaultId("");
  };

  /** 保存：先落本机（立即生效），登录状态下再同步云端 */
  const save = async () => {
    if (busy) return;

    const invalid = drafts.find(
      (draft) => !draft.baseUrl.trim() || !draft.model.trim()
    );
    if (invalid) {
      setError(`「${invalid.name || "未命名"}」还缺少 Base URL 或模型名`);
      return;
    }

    const profiles = drafts
      .map((draft, index) => sanitizeModelProfile(draft, `local-${index}`))
      .filter((item): item is ModelProfile => item !== null);

    const stillExists =
      profiles.some((item) => item.id === defaultId) ||
      serverProfiles.some((item) => item.id === defaultId);

    setError("");
    setBusy(true);
    try {
      const client = remote ? getSupabase() : null;
      await saveModelStore(
        userId,
        { profiles, defaultId: stillExists ? defaultId : "" },
        client
      );
      onClose();
    } catch (err) {
      // 本机那份已经存好了，只有云端没同步上，提示但不阻塞
      setError(`已保存到本机，但云端同步失败：${(err as Error).message}`);
      setBusy(false);
    }
  };

  // ---- 编辑态：表单 ----
  if (editing) {
    const preset = getProviderPreset(editing.providerId);
    // 候选模型 = 厂商预设 + 从服务端拉取的（去重）
    const knownOptions = Array.from(
      new Set([...(preset?.models ?? []), ...fetched].filter(Boolean))
    );
    // 输入框内容当作筛选词；正好命中某个候选时视为"已选定"，仍展示全部
    const keyword = editing.model.trim().toLowerCase();
    const isExact = knownOptions.includes(editing.model);
    const filteredOptions =
      !keyword || isExact
        ? knownOptions
        : knownOptions.filter((id) => id.toLowerCase().includes(keyword));

    return (
      <>
        <div className="settings-body">
          <div className="settings-group-title">
            {drafts.some((item) => item.id === editing.id)
              ? "编辑模型"
              : "添加模型"}
          </div>

          <label className="settings-field">
            <span>显示名称（自己辨认用）</span>
            <input
              value={editing.name}
              onChange={(e) => patchEditing({ name: e.target.value })}
              placeholder="例如：我的 GPT-4o / 快速问答"
            />
          </label>

          <label className="settings-field">
            <span>服务商</span>
            <select
              value={editing.providerId}
              onChange={(e) => changeProvider(e.target.value)}
            >
              {PROVIDER_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span>API Base URL（OpenAI 兼容地址）</span>
            <input
              value={editing.baseUrl}
              onChange={(e) => patchEditing({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com"
            />
          </label>

          <label className="settings-field">
            <span>API Key（仅保存在本机，按账号隔离）</span>
            <input
              type="password"
              value={editing.apiKey}
              onChange={(e) => patchEditing({ apiKey: e.target.value })}
              placeholder="sk-…"
              autoComplete="off"
            />
          </label>

          <div className="settings-field">
            <span>
              模型（厂商提供的实际模型名）
              <button
                type="button"
                className="settings-inline-btn"
                onClick={fetchModels}
                disabled={fetching}
              >
                {fetching ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                {fetching ? "获取中…" : "从服务端获取"}
              </button>
            </span>

            <div className="model-picker">
              <input
                value={editing.model}
                onChange={(e) => {
                  patchEditing({ model: e.target.value });
                  setPickerOpen(true);
                }}
                onFocus={() => setPickerOpen(true)}
                placeholder="deepseek-chat / gpt-4o / qwen-max（可直接输入，也可从下方列表选）"
              />
              <button
                type="button"
                className={`model-picker-toggle${pickerOpen ? " open" : ""}`}
                onClick={() => setPickerOpen((prev) => !prev)}
                disabled={knownOptions.length === 0}
                title={
                  knownOptions.length === 0
                    ? "暂无可选模型：先点「从服务端获取」，或直接手填模型名"
                    : pickerOpen
                      ? "收起模型列表"
                      : "展开模型列表"
                }
              >
                <ChevronDown size={15} />
              </button>
            </div>

            {pickerOpen && knownOptions.length > 0 ? (
              <div className="model-picker-panel">
                <div className="model-picker-head">
                  <span>
                    共 {knownOptions.length} 个模型
                    {filteredOptions.length !== knownOptions.length
                      ? ` · 匹配 ${filteredOptions.length} 个`
                      : ""}
                  </span>
                  <span className="model-picker-hint">
                    {keyword && !isExact ? "正在按输入筛选" : "点选即填入"}
                  </span>
                </div>
                {filteredOptions.length === 0 ? (
                  <div className="model-picker-empty">
                    没有匹配的模型名；你输入的「{editing.model.trim()}」会直接使用
                  </div>
                ) : (
                  <div className="model-picker-list">
                    {filteredOptions.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={`model-option${
                          id === editing.model ? " active" : ""
                        }`}
                        onClick={() => {
                          patchEditing({ model: id });
                          setPickerOpen(false);
                        }}
                      >
                        <span className="model-option-name">{id}</span>
                        {id === editing.model ? <Check size={14} /> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {preset?.note ? (
            <div className="settings-hint">{preset.note}</div>
          ) : null}
          {preset?.docsUrl ? (
            <div className="settings-hint">
              API Key 获取：
              <button
                type="button"
                className="settings-link"
                onClick={() => api.openExternal(preset.docsUrl!)}
              >
                {preset.docsUrl}
              </button>
            </div>
          ) : null}

          <div className="settings-hint">
            {profileSupportsFiles(editing)
              ? "该条目支持图片附件（Files API）。"
              : "该条目不支持图片附件；文档类附件（PDF / DOCX / TXT 等）不受影响。"}
          </div>

          {fetchError ? <div className="auth-error">{fetchError}</div> : null}
          {error ? <div className="auth-error">{error}</div> : null}
        </div>

        <div className="settings-actions settings-actions-bar">
          <span className="settings-actions-spacer" />
          <button
            type="button"
            className="settings-cancel"
            onClick={() => {
              setEditing(null);
              setError("");
            }}
          >
            <X size={15} />
            取消
          </button>
          <button type="button" className="settings-save" onClick={commitEditing}>
            确定
          </button>
        </div>
      </>
    );
  }

  // ---- 列表态 ----
  return (
    <>
      <div className="settings-body">
        <div className="settings-group-title">我的模型（本机保存，仅本账号可见）</div>

        {drafts.length === 0 ? (
          <div className="settings-hint">
            还没有本机条目。点下方「添加模型」填上自己的 Key 即可使用；所有内容只保存在
            本机，不会同步给其他账号或设备。
          </div>
        ) : (
          <div className="profile-list">
            {drafts.map((draft) => {
              const preset = getProviderPreset(draft.providerId);
              const isDefault = draft.id === defaultId;
              const supportsFiles = profileSupportsFiles(draft);
              return (
                <div className="profile-item" key={draft.id}>
                  <div className="profile-main">
                    <div className="profile-name">
                      {draft.name || draft.model || "未命名模型"}
                    </div>
                    <div className="profile-meta">
                      {preset?.label ?? "自定义"} · {draft.model || "未设置模型"}
                    </div>
                    <div className="profile-tags">
                      {isDefault ? (
                        <em className="settings-tag ok">默认</em>
                      ) : null}
                      {draft.apiKey ? (
                        <em className="settings-tag ok">已配置 Key</em>
                      ) : (
                        <em className="settings-tag">未配置 Key</em>
                      )}
                      {supportsFiles ? (
                        <em className="settings-tag">支持图片</em>
                      ) : null}
                    </div>
                  </div>
                  <div className="profile-actions">
                    {!isDefault ? (
                      <button
                        type="button"
                        className="share-btn"
                        title="设为默认"
                        onClick={() => setDefaultId(draft.id)}
                      >
                        <Star size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="share-btn"
                      title="编辑"
                      onClick={() => openEditor(draft)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="share-btn danger"
                      title="删除"
                      onClick={() => removeDraft(draft.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          className="share-btn profile-add"
          onClick={() => openEditor(newDraft())}
        >
          <Plus size={14} />
          添加模型
        </button>

        {serverProfiles.length > 0 ? (
          <>
            <div className="settings-group-title">
              内置模型（运营方预置，只读）
            </div>
            <div className="profile-list">
              {serverProfiles.map((profile) => {
                const isDefault = profile.id === defaultId;
                return (
                  <div className="profile-item" key={profile.id}>
                    <div className="profile-main">
                      <div className="profile-name">{profile.name}</div>
                      <div className="profile-meta">
                        {profile.providerLabel} · {profile.model || "未设置模型"}
                      </div>
                      <div className="profile-tags">
                        {isDefault ? (
                          <em className="settings-tag ok">默认</em>
                        ) : null}
                        <em className="settings-tag">内置</em>
                        {profile.supportsFiles ? (
                          <em className="settings-tag">支持图片</em>
                        ) : null}
                      </div>
                    </div>
                    <div className="profile-actions">
                      {!isDefault ? (
                        <button
                          type="button"
                          className="share-btn"
                          title="设为默认"
                          onClick={() => setDefaultId(profile.id)}
                        >
                          <Star size={14} />
                        </button>
                      ) : null}
                      <span className="settings-tag" title="由运营方维护，不可编辑">
                        <Lock size={12} />
                        只读
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        <div className="settings-hint">
          每条配置独立保存 Key，互不影响；随时可以在对话右上角切换。新厂商只要兼容
          OpenAI 协议（<code>{"{baseUrl}/chat/completions"}</code>），选「
          {getProviderPreset(CUSTOM_PROVIDER_ID)?.label}」手填地址与模型名即可。
        </div>
        {error ? <div className="auth-error">{error}</div> : null}
      </div>

      <div className="settings-actions settings-actions-bar">
        <span className="settings-actions-spacer" />
        <button
          type="button"
          className="settings-cancel"
          onClick={onClose}
        >
          取消
        </button>
        <button type="button" className="settings-save" onClick={save} disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </>
  );
}
