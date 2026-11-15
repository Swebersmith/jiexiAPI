import { allowed } from './parser-resolver.mjs';

export function validateConfig(value) {
  if (!value || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 8 || typeof value.qlEnabled !== 'boolean') {
    throw Object.assign(new Error('请配置 1–8 个采集源，并设置 QL 开关'), { status: 400 });
  }
  const ids = new Set();
  const sources = value.sources.map(source => {
    if (!source || !/^[a-z0-9_-]{1,32}$/.test(source.id) || ids.has(source.id) || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 60 || typeof source.url !== 'string' || source.url.length > 2048 || typeof source.enabled !== 'boolean') {
      throw Object.assign(new Error('请检查采集源标识、名称、URL 和启用状态，标识须唯一'), { status: 400 });
    }
    ids.add(source.id);
    return { id: source.id, name: source.name.trim(), url: allowed(source.url).href, enabled: source.enabled };
  });
  return { sources, qlEnabled: value.qlEnabled };
}

export async function loadConfig(env) {
  if (env.CONFIG_DB) {
    const row = await env.CONFIG_DB.prepare('SELECT value, revision, updated_at FROM service_config WHERE id = 1').first();
    if (row) return { ...validateConfig(JSON.parse(row.value)), revision: row.revision, updatedAt: row.updated_at, storage: 'D1' };
  }
  return { sources: JSON.parse(env.CMS_SOURCES || '[]').map(source => ({ ...source, enabled: source.enabled !== false })), qlEnabled: true, revision: 0, updatedAt: null, storage: 'environment' };
}

export async function saveConfig(env, data) {
  if (!env.CONFIG_DB) throw Object.assign(new Error('配置数据库尚未绑定'), { status: 503 });
  if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw Object.assign(new Error('配置版本无效，请刷新页面'), { status: 400 });
  const value = JSON.stringify(validateConfig(data));
  const updatedAt = new Date().toISOString();
  const statement = data.revision === 0
    ? env.CONFIG_DB.prepare('INSERT OR IGNORE INTO service_config (id, value, revision, updated_at) VALUES (1, ?, 1, ?)').bind(value, updatedAt)
    : env.CONFIG_DB.prepare('UPDATE service_config SET value = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?').bind(value, updatedAt, data.revision);
  const result = await statement.run();
  if (!result.meta.changes) throw Object.assign(new Error('配置已被其他页面更新，请刷新后重试'), { status: 409 });
  return { ...JSON.parse(value), revision: data.revision + 1, updatedAt, storage: 'D1' };
}
