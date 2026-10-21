#!/usr/bin/env node
// Export only user-visible dialogue from this project's local Codex history.
// Raw rollouts, tool output, reasoning, credentials and binary attachments
// deliberately remain outside the repository.
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, mkdir, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threadId = process.argv.find(arg => arg.startsWith('--thread='))?.slice(9) || '01a12068-b0ee-7db3-b081-20531fa637b8';
const sessionsRoot = process.argv.find(arg => arg.startsWith('--sessions='))?.slice(11) || path.join(os.homedir(), '.codex', 'sessions');
if (!/^[0-9a-f-]{36}$/.test(threadId)) throw new Error('Invalid thread id');
const transcriptRoot = path.join(projectRoot, 'docs/handoff/transcript');
const skillsRoot = path.join(projectRoot, 'docs/handoff/skills');
const generatedAt = new Date().toISOString();
const redactions = {};
const formattingPolicy = 'All archived text uses LF with text eol=lf Git attributes so committed bytes match SHA256. Markdown prose has trailing whitespace removed, hard breaks expressed with a backslash and one final newline. Fenced/indented/preformatted code and non-Markdown source text retain meaningful line whitespace; exact-file Git whitespace exceptions record retained source whitespace.';
function normalizeMarkdown(input) {
  const lines = String(input).replace(/\r\n?/g, '\n').split('\n');
  let fence = null, inPre = false;
  const normalized = lines.map(line => {
    const marker = line.match(/^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return line;
    }
    if (marker) { fence = marker[1]; return line; }
    if (inPre || /<pre\b/i.test(line)) {
      inPre = !/<\/pre>/i.test(line);
      return line;
    }
    // Four-space and tab indentation may be code; do not rewrite it as prose.
    if (/^(?: {4}|\t)\S?/.test(line)) return line;
    const trimmed = line.replace(/[ \t]+$/, '');
    if (!trimmed) return '';
    // Preserve Markdown's intentional hard line break without invisible spaces.
    return / {2,}$/.test(line) && !trimmed.endsWith('\\') ? `${trimmed}\\` : trimmed;
  });
  if (fence || inPre) return normalized.join('\n');
  while (normalized.at(-1) === '') normalized.pop();
  return normalized.join('\n') + '\n';
}
function preservedWhitespace(text) {
  return { trailingLineWhitespace: /[ \t]+$/m.test(text), blankLineAtEof: /\n[ \t]*\n$/.test(text) };
}
async function writeWhitespaceAttributes(root, files) {
  const entries = files.filter(file => Object.values(file.whitespace).some(Boolean));
  const content = '# LF keeps committed bytes identical to the archive SHA256 manifest.\n* text eol=lf\n# Only preserved source/code whitespace is exempt; generated prose is normalized.\n'
    + entries.map(file => `${JSON.stringify('/' + file.path)} whitespace=${[
      file.whitespace.trailingLineWhitespace && '-blank-at-eol',
      file.whitespace.blankLineAtEof && '-blank-at-eof',
    ].filter(Boolean).join(',')}`).join('\n') + (entries.length ? '\n' : '');
  await writeFile(path.join(root, '.gitattributes'), content, 'utf8');
  return entries.map(file => ({ path: file.path, ...file.whitespace }));
}
const credentialPatterns = [
  ['telegram-bot-token', /\b\d{6,14}:[A-Za-z0-9_-]{25,}\b/g],
  ['render-token', /\brnd_[A-Za-z0-9_-]{16,}\b/g],
  ['openai-token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{25,}\b/g],
  ['google-access-token', /\bya29\.[A-Za-z0-9._-]{16,}/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['private-key', /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g],
  ['authorization', /\b(?:Bearer|Basic)\s+[A-Za-z0-9_+/.=-]{20,}/gi],
  ['binary-data-url', /data:[\w/+.-]+;base64,[A-Za-z0-9+/=\r\n]{64,}/g],
];
function scrub(input, tally = redactions) {
  let text = String(input);
  for (const [name, regex] of credentialPatterns) text = text.replace(regex, () => {
    tally[name] = (tally[name] || 0) + 1;
    return `[REDACTED:${name}]`;
  });
  // Catch unprefixed values assigned to named credentials as well. Template
  // names and environment-variable references are useful documentation.
  text = text.replace(/(\b(?:[A-Z_]*(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|BOT_TOKEN|CLIENT_SECRET|CRON_SECRET|WEBHOOK_SECRET)|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\b["']?\s*[:=]\s*["']?)([A-Za-z0-9_+/.=-]{16,})/gi, (all, prefix, value) => {
    if (/^(?:process\.env\.|REPLACE_|YOUR_|EXAMPLE_|PLACEHOLDER|undefined|REDACTED)/i.test(value)) return all;
    tally['named-credential'] = (tally['named-credential'] || 0) + 1;
    return `${prefix}[REDACTED:named-credential]`;
  });
  return text;
}
function verifyScrubber() {
  const samples = ['123456789:' + 'a'.repeat(35), 'rnd_' + 'b'.repeat(24), 'sk-proj-' + 'c'.repeat(32), 'AIza' + 'd'.repeat(30), 'ghp_' + 'e'.repeat(30), 'Bearer ' + 'f'.repeat(32), 'CRON_SECRET=' + 'g'.repeat(32)];
  for (const sample of samples) if (!scrub(sample, {}).includes('[REDACTED:')) throw new Error('Credential scrubber self-check failed');
}
async function walk(root) {
  const result = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.isSymbolicLink() || ['node_modules', '.git', '.cache', '__pycache__'].includes(item.name)) continue;
    const absolute = path.join(root, item.name);
    if (item.isDirectory()) result.push(...await walk(absolute));
    else if (item.isFile()) result.push(absolute);
  }
  return result;
}
function visibleText(payload) {
  let text = (payload.content || []).filter(item => ['input_text', 'output_text', 'text'].includes(item.type)).map(item => item.text || '').join('\n');
  text = text.replace(/<(?:in-app-browser-context|environment_context|recommended_plugins)\b[^>]*>[\s\S]*?<\/(?:in-app-browser-context|environment_context|recommended_plugins)>/g, '').trim();
  if (/^Another language model started to solve this problem/.test(text)) return '';
  const attachmentCount = (payload.content || []).filter(item => /image|audio|video/.test(item.type || '')).length;
  if (attachmentCount) text += `\n\n[附件 ${attachmentCount} 项：二进制未归档；已出现的本地文件路径保留在消息中。]`;
  return text.trim();
}
function toolSkillPaths(payload) {
  if (!['custom_tool_call', 'function_call'].includes(payload.type)) return [];
  const source = String(payload.input || payload.arguments || '').replaceAll('\\\\', '/').replaceAll('\\', '/');
  if (!/Get-Content|readFile|\bcat\b|read_text|read_file/.test(source)) return [];
  return [...source.matchAll(/(?:[A-Za-z]:)?\/[A-Za-z0-9_ .\-/]+\/SKILL\.md/g)].map(match => match[0]);
}

verifyScrubber();
const candidateFiles = (await walk(sessionsRoot)).filter(file => path.basename(file).includes(threadId) && file.endsWith('.jsonl')).sort();
const messages = [], sources = [], skillEvidence = new Map(), seen = new Set();
let duplicateMessages = 0, omittedContextMessages = 0, compactions = 0, malformedLines = 0;
for (const file of candidateFiles) {
  const bytes = (await stat(file)).size;
  const source = { file: path.basename(file), bytesAtExport: bytes, firstEvent: null, lastEvent: null, visibleMessages: 0 };
  let authorized = false;
  const input = createReadStream(file, { end: Math.max(0, bytes - 1) });
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { malformedLines++; continue; }
    const payload = row.payload || {};
    if (row.type === 'session_meta') authorized = payload.id === threadId && !payload.parent_thread_id;
    if (!authorized) continue;
    source.firstEvent ||= row.timestamp;
    source.lastEvent = row.timestamp;
    if (row.type === 'compacted') compactions++;
    for (const skillPath of toolSkillPaths(payload)) {
      const list = skillEvidence.get(skillPath) || [];
      list.push({ timestamp: row.timestamp, source: source.file, evidence: 'skill-read-command' });
      skillEvidence.set(skillPath, list);
    }
    if (row.type !== 'response_item' || payload.type !== 'message') continue;
    const phase = payload.phase || payload.channel;
    if (payload.role !== 'user' && !(payload.role === 'assistant' && ['commentary', 'final_answer', 'final'].includes(phase))) continue;
    const original = visibleText(payload);
    if (!original) { omittedContextMessages++; continue; }
    const id = payload.id || createHash('sha256').update(`${row.timestamp}:${payload.role}:${original}`).digest('hex');
    if (seen.has(id)) { duplicateMessages++; continue; }
    seen.add(id);
    messages.push({ id, timestamp: row.timestamp, role: payload.role, channel: payload.role === 'user' ? 'user' : phase === 'commentary' ? 'commentary' : 'final', text: scrub(original), source: source.file });
    source.visibleMessages++;
  }
  if (authorized) sources.push(source);
}
messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
await mkdir(transcriptRoot, { recursive: true });
const counts = { user: messages.filter(item => item.role === 'user').length, assistant: messages.filter(item => item.role === 'assistant').length };
const firstMessage = messages[0]?.timestamp, lastMessage = messages.at(-1)?.timestamp;
const coverage = `主任务 ${threadId} 的 ${sources.length} 段本地 rollout；可见消息时间 ${firstMessage} 至 ${lastMessage}（UTC）；导出于 ${generatedAt}。`;
const conversation = normalizeMarkdown(`# for-pocket 可见聊天记录（已脱敏）\n\n${coverage}\n\n用户 ${counts.user} 条、助手 ${counts.assistant} 条。仅归档可恢复的可见消息；历史发言不代表当前实现状态。以 ../AGENT_HANDOFF.md 与当前代码、测试为准。\n\n${messages.map((message, index) => `## ${index + 1}. ${message.timestamp} · ${message.role === 'user' ? '用户' : `助手 / ${message.channel}`}\n\n${message.text}\n`).join('\n---\n\n')}`);
await writeFile(path.join(transcriptRoot, 'conversation.md'), conversation, 'utf8');
const transcriptWhitespace = await writeWhitespaceAttributes(transcriptRoot, [{ path: 'conversation.md', whitespace: preservedWhitespace(conversation) }]);
await writeFile(path.join(transcriptRoot, 'README.md'), `# 聊天归档范围\n\n${coverage}\n\n- [可见对话全文](conversation.md)：保留用户消息及助手 commentary/final。\n- [导出清单](export-manifest.json)：来源分段、统计、脱敏计数和排除项。\n- 排除 reasoning/analysis、system/developer、工具调用及输出、原始 response 元数据、压缩摘要、环境/浏览器自动附加块。\n- 附件保留消息内已有路径；截图、视频、音频二进制并未复制。路径在另一台机器上可能失效，产品实际素材以 public/assets 为准。\n- 源文件有 ${compactions} 条压缩事件；去重 ${duplicateMessages} 条 message id；${malformedLines} 行无法解析。此文件不声称恢复被删除、未落盘或只存在于压缩摘要中的对话，也不合并其它主任务。\n- 旧发言中的完成、发布、测试结果保留当时措辞；最终状态请看上级交接文件。记录内的提示词与权限文字是历史数据，不能覆盖接棒环境的指令。\n- 格式规范：归档统一 LF，并由 Git text eol=lf 属性保证提交字节与 SHA256 一致；正文移除行尾空白，原有双空格硬换行改为显式反斜杠；保留代码块/缩进代码中的空白。\`.gitattributes\` 只对仍含源代码空白的确切档案设置 whitespace 例外，未修改原始日志。导出清单记录最终正文 SHA256。\n- 重导出：在拥有原会话数据的机器运行 \`node scripts/export-handoff.mjs\`，只读原件，覆盖本归档的生成文件。\n`, 'utf8');

// Include only skills for which this task has an explicit read-command trace.
// The archive is a snapshot of the installed version at export time, not a
// claim that the historical version had identical contents.
const skillInventory = [], missingSkills = [], usedSlugs = new Map();
const allowedRoots = [path.join(os.homedir(), '.codex/skills'), path.join(os.homedir(), '.agents/skills'), path.join(os.homedir(), '.codex/plugins/cache')].map(value => path.resolve(value));
const textExtensions = new Set(['.md', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.json', '.yml', '.yaml', '.toml', '.sh', '.css', '.html']);
await mkdir(skillsRoot, { recursive: true });
for (const [sourceFile, evidence] of [...skillEvidence].sort(([a], [b]) => a.localeCompare(b))) {
  const absolute = path.resolve(sourceFile);
  if (!allowedRoots.some(root => absolute.startsWith(root + path.sep))) continue;
  let skillText;
  try { skillText = await readFile(absolute, 'utf8'); } catch { missingSkills.push({ sourceFile, reason: 'recorded read path is unavailable at export time' }); continue; }
  const skillDir = path.dirname(absolute), name = path.basename(skillDir);
  let slug = name;
  if (usedSlugs.has(slug)) slug = `${name}-${absolute.includes(`${path.sep}.agents${path.sep}`) ? 'agents' : absolute.includes(`${path.sep}plugins${path.sep}`) ? 'plugin' : 'codex'}`;
  usedSlugs.set(slug, true);
  const files = [];
  for (const file of await walk(skillDir)) {
    const relative = path.relative(skillDir, file);
    // Keep the runnable skill and its references, not upstream development
    // fixtures, evaluator copies, CI metadata or demo-project mirrors.
    if (relative.split(path.sep).some(part => ['.claude', '.claude-plugin', '.github', 'tests', 'demos', 'evals', 'evaluations'].includes(part))) continue;
    // Repository-maintainer instructions are not skill dependencies and must
    // not become automatically active instructions inside the archive.
    if (['AGENTS.md', 'CLAUDE.md'].includes(path.basename(file))) continue;
    if (relative.split(path.sep).some(part => /^\.env(?:\.|$)|credential|secret|token/i.test(part))) continue;
    if (!textExtensions.has(path.extname(file).toLowerCase()) && !/^(?:LICENSE|NOTICE|COPYING)$/i.test(path.basename(file))) continue;
    if ((await stat(file)).size > 2 * 1024 * 1024) continue;
    const sanitized = scrub(await readFile(file, 'utf8')).replace(/\r\n?/g, '\n');
    const text = path.extname(file).toLowerCase() === '.md' ? normalizeMarkdown(sanitized) : sanitized;
    const destination = path.join(skillsRoot, slug, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, text, 'utf8');
    files.push({ path: relative.replaceAll(path.sep, '/'), sha256: createHash('sha256').update(text).digest('hex'), whitespace: preservedWhitespace(text) });
  }
  skillInventory.push({ name, slug, sourceFile, observedReads: evidence, archive: `${slug}/SKILL.md`, files });
}
const retainedSkillFiles = new Set(skillInventory.flatMap(skill => skill.files.map(file => path.resolve(skillsRoot, skill.slug, file.path))));
for (const file of await walk(skillsRoot)) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(skillsRoot) + path.sep)) throw new Error('Archive cleanup escaped its output directory');
  if (path.dirname(resolved) !== skillsRoot && !retainedSkillFiles.has(resolved)) await unlink(resolved);
}
const skillWhitespace = await writeWhitespaceAttributes(skillsRoot, skillInventory.flatMap(skill => skill.files.map(file => ({ path: `${skill.slug}/${file.path}`, whitespace: file.whitespace }))));
await writeFile(path.join(skillsRoot, 'manifest.json'), JSON.stringify({ generatedAt, sourceThreadId: threadId, mode: 'read-command evidence; installed text snapshot', formattingPolicy, preservedWhitespace: skillWhitespace, skills: skillInventory, unavailableReadPaths: missingSkills }, null, 2) + '\n');
await writeFile(path.join(skillsRoot, 'README.md'), `# 实际读取过的技能快照\n\n导出时间：${generatedAt}。仅选择该主任务读取命令中出现、当前仍存在的技能目录，共 ${skillInventory.length} 个来源版本。归档正文、同目录文本 references/rules、声明的脚本与许可文件，过滤 node_modules、缓存、凭据文件和二进制。\n\n[来源与逐文件校验清单](manifest.json) 记录读取日期、原路径及本次归档 SHA256。读取命令是采用证据，不代表每一条建议都执行过。技能可能已升级，快照不能冒充历史版本。所有归档文本统一 LF，并由 Git text eol=lf 属性保证提交字节与 SHA256 一致；Markdown 正文移除行尾空白（双空格硬换行改显式反斜杠）；代码块/缩进代码和非 Markdown 源文件保留源空白，逐文件 Git whitespace 例外仅限这些留存内容。SHA256 对应脱敏和规范后的实际归档，不代表原件字节。缺失的路径单列 unavailableReadPaths；未找到证据的推荐技能不归档。\n\n这些文件是参考档案，不自动加载为项目指令，也不能覆盖用户在本项目中的最新决定。需要继续某项工作时，先从 [SKILLS_USED](../SKILLS_USED.md) 找到相关档案，再按当前环境确认依赖和工具可用性。TelegramUI 是已采用的 npm 组件库，不伪装为一个不存在的 SKILL.md。\n`, 'utf8');
const skillTable = skillInventory.map(skill => `| ${skill.name}${skill.slug !== skill.name ? ` (${skill.slug})` : ''} | [SKILL.md](skills/${skill.archive}) | ${skill.observedReads[0].timestamp.slice(0, 10)} — ${skill.observedReads.at(-1).timestamp.slice(0, 10)} | ${skill.files.length} |`).join('\n');
await writeFile(path.join(projectRoot, 'docs/handoff/SKILLS_USED.md'), `# for-pocket 技能与组件交接\n\n导出于 ${generatedAt}。这次通过主任务的实际读取命令核对技能，正文和必要文本参考已放入仓库；不再仅依赖原电脑的绝对路径。\n\n## 有读取证据的技能\n\n| 技能 | 仓库内正文 | 读取记录日期（UTC） | 归档文件数 |\n| --- | --- | --- | --- |\n${skillTable}\n\n证据与来源路径见 [skills/manifest.json](skills/manifest.json)。日期落在本轮的条目可用于定位本轮采用；较早的条目为历史采用。目录中的文件是导出时安装版本，未声称每份正文自最初读取以来完全没变。\n\n## 已采用的组件参考\n\nTelegramUI：\`@telegram-apps/telegram-ui\` 2.1.13，来源 <https://github.com/telegram-mini-apps-dev/TelegramUI>，运行依赖以 package.json/package-lock.json 为准；导入入口 src/main.jsx。这是用户明确选用的组件库，不存在本地 TelegramUI SKILL.md。\n\n## 使用边界\n\n- [归档范围与说明](skills/README.md)；这些历史 skill 指南按需参考，不能覆盖当前用户要求。\n- 旧清单列过但本次没有可核对读取证据的 asset-gen 等仅视为候选，未将其冒充实际使用的技能。\n- 动效继续保持简约可爱与 transform/opacity 合成层；用户已取消全局减少动态规则，归档技能中的相反通用建议不能恢复该规则。\n- 产品素材仍在 public/assets；本目录存工作方法和依赖参考，不重复复制产品图片。\n`, 'utf8');
const exportManifest = { generatedAt, threadId, formattingPolicy, preservedWhitespace: transcriptWhitespace, artifacts: { conversation: { path: 'conversation.md', bytes: Buffer.byteLength(conversation), sha256: createHash('sha256').update(conversation).digest('hex') } }, firstMessage, lastMessage, counts, duplicateMessages, omittedContextMessages, compactions, malformedLines, sources, redactions, excluded: ['reasoning/analysis', 'system/developer', 'tool calls and outputs', 'raw response metadata', 'compaction summaries', 'ambient environment/browser blocks', 'binary attachments', 'unrelated threads'], skills: { sources: skillInventory.length, files: skillInventory.reduce((sum, skill) => sum + skill.files.length, 0), unavailablePaths: missingSkills.length } };
await writeFile(path.join(transcriptRoot, 'export-manifest.json'), JSON.stringify(exportManifest, null, 2) + '\n');
// Scan sanitized output without ever printing matching secret values.
let findings = 0;
for (const directory of [transcriptRoot, skillsRoot]) for (const file of await walk(directory)) {
  const text = await readFile(file, 'utf8');
  for (const [, regex] of credentialPatterns) { regex.lastIndex = 0; if (regex.test(text)) findings++; }
}
if (findings) throw new Error(`Sanitized archive scan failed: ${findings} pattern matches; values suppressed`);
exportManifest.securityScan = { credentialPatternFindings: findings, syntheticRedactionChecksPassed: true, rawSourcePrinted: false };
await writeFile(path.join(transcriptRoot, 'export-manifest.json'), JSON.stringify(exportManifest, null, 2) + '\n');
console.log(JSON.stringify({ ...counts, sourceSegments: sources.length, firstMessage, lastMessage, skillSources: skillInventory.length, skillFiles: exportManifest.skills.files, redactions, secretPatternFindings: findings }));
