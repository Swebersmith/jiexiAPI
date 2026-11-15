import { allowed } from './parser-resolver.mjs';
import { validateParsers } from './parser-services.mjs';

export function validateConfig(value) {
  // The former QL switch controlled a separate upstream. CMS page matching starts enabled.
  const pageEnabled = value?.pageEnabled ?? (typeof value?.qlEnabled === 'boolean' ? true : undefined);
  if (!value || !Array.isArray(value.sources) || value.sources.length > 8 || typeof pageEnabled !== 'boolean') {
    throw Object.assign(new Error('请配置最多 8 个采集源，并设置网页解析开关'), { status: 400 });
  }
  const ids = new Set();
  const sources = value.sources.map(source => {
    if (!source || !/^[a-z0-9_-]{1,32}$/.test(source.id) || ids.has(source.id) || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 60 || typeof source.url !== 'string' || source.url.length > 2048 || typeof source.enabled !== 'boolean') {
      throw Object.assign(new Error('请检查采集源标识、名称、URL 和启用状态，标识须唯一'), { status: 400 });
    }
    ids.add(source.id);
    return { id: source.id, name: source.name.trim(), url: allowed(source.url).href, enabled: source.enabled };
  });
  const parsers = validateParsers(value.parsers);
  const parserMode = value.parserMode ?? 'fallback';
  if (!['fallback', 'combined'].includes(parserMode)) throw Object.assign(new Error('解析接口调用策略无效'), { status: 400 });
  return { sources, pageEnabled, parsers, parserMode };
}

export async function loadConfig(env) {
  if (env.CONFIG_DB) {
    const row = await env.CONFIG_DB.prepare('SELECT value, revision, updated_at FROM service_config WHERE id = 1').first();
    if (row) return { ...validateConfig(JSON.parse(row.value)), revision: row.revision, updatedAt: row.updated_at, storage: 'D1' };
  }
  return { ...validateConfig({ sources: JSON.parse(env.CMS_SOURCES || '[]').map(source => ({ ...source, enabled: source.enabled !== false })), pageEnabled: true, parsers: JSON.parse(env.PARSER_SERVICES || '[]'), parserMode: env.PARSER_MODE || 'fallback' }), revision: 0, updatedAt: null, storage: 'environment' };
}

export async function saveConfig(env, data) {
  if (!env.CONFIG_DB) throw Object.assign(new Error('配置数据库尚未绑定'), { status: 503 });
  if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw Object.assign(new Error('配置版本无效，请刷新页面'), { status: 400 });
  const current = await loadConfig(env);
  const value = JSON.stringify(validateConfig({ ...current, ...data }));
  const updatedAt = new Date().toISOString();
  const statement = data.revision === 0
    ? env.CONFIG_DB.prepare('INSERT OR IGNORE INTO service_config (id, value, revision, updated_at) VALUES (1, ?, 1, ?)').bind(value, updatedAt)
    : env.CONFIG_DB.prepare('UPDATE service_config SET value = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?').bind(value, updatedAt, data.revision);
  const result = await statement.run();
  if (!result.meta.changes) throw Object.assign(new Error('配置已被其他页面更新，请刷新后重试'), { status: 409 });
  return { ...JSON.parse(value), revision: data.revision + 1, updatedAt, storage: 'D1' };
}
