/**
 * 子工作空间 / 额外工作区 —— 独立插件。
 *
 * 为什么独立（用户要求）：
 *   > 一个包里面可以有多个插件。……"子工作空间"，额外工作空间。
 *
 * 它和「按计划」权限档是**配套**但可分离的：
 *   · 权限档决定"能不能动"
 *   · 工作空间决定"能动哪里"
 * 没有权限档时，工作空间字段只是一份数据（面板照样显示）；
 * 有权限档时，它才参与路径判定。
 *
 * 依赖：\shared\（text / isAbsolutePath 等）。不依赖 core 的存储。
 */
import { text, isAbsolutePath } from './shared.js';
function splitWorkspaces(raw) {
	const parts = Array.isArray(raw)
		? raw.map((entry) => String(entry ?? ''))
		: String(raw ?? '').split(/[,，;；]/u);
	const seen = new Set();
	const out = [];
	for (const part of parts) {
		const value = part.trim();
		if (value === '') continue;
		if (!isAbsolutePath(value)) {
			throw new Error(`额外工作区必须是绝对路径（含盘符或 UNC），收到「${value}」`);
		}
		const key = value.replace(/\//gu, '\\').toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(value.replace(/\//gu, '\\'));
	}
	return out;
}


/** 从一段命令里抽出绝对路径（Windows 盘符路径 / UNC），用于目录归属判定。 */
function extractPaths(segment) {
	const found = [];
	for (const match of String(segment ?? '').matchAll(/[A-Za-z]:[\\/][^\s"'|;&]*/gu)) {
		found.push(match[0]);
	}
	for (const match of String(segment ?? '').matchAll(/\\\\[^\s"'|;&]+/gu)) {
		found.push(match[0]);
	}
	return found;
}

/**
 * 命令是不是只动允许目录（T-018 第 2 项）。
 *
 * 返回空串 = 放行；否则返回给模型看的原因。
 *
 * 判定口径（偏保守）：
 *   1. 按 `;` `&&` `||` `|` 与换行切成独立分句；
 *   2. 每个分句里抽出的每个绝对路径，都必须落在某个允许目录内；
 *   3. 一个路径都没抽到的分句 → 拒（看不出它写哪，宁可让模型拆成 write/edit）。
 *
 * 已知不完备：`cd` 后接相对路径、重定向 `>`、`node -e "..."` 里的字符串。
 * 真正完备需要按命令解析（T-029 在研究），这里先把已证实的绕过堵掉。
 */
function judgeCommand(command, roots) {
	const segments = String(command ?? '')
		.split(/[;&|\r\n]+/u)
		.map((part) => part.trim())
		.filter((part) => part !== '');
	if (segments.length === 0) return '命令是空的';

	for (const segment of segments) {
		const paths = extractPaths(segment);
		if (paths.length === 0) {
			/* 没写绝对路径：可能是纯粹的计算（echo hi / node --version），
			   也可能是相对路径写入。分不清，只放行明显只读的形态。 */
			if (isPlainReadOnlyCommand(segment)) continue;
			return `分句「${segment.slice(0, 40)}」看不出要动哪个目录`;
		}
		for (const path of paths) {
			if (!roots.some((root) => within(root, path))) {
				return `路径 ${path} 不在允许目录内`;
			}
		}
	}
	return '';
}

/** 明显只读的命令形态（白名单）：只认真正无副作用的。 */

/** 归一化路径用于比较（不访问磁盘，只做字符串层面）。 */
function normalizePath(raw) {
	const parts = String(raw ?? '').replace(/\//gu, '\\').split('\\');
	const out = [];
	for (const part of parts) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			out.pop();
			continue;
		}
		out.push(part);
	}
	return out.join('\\').toLowerCase();
}

/** target 是不是在 root 里面（含等于）。 */
function within(root, target) {
	const base = normalizePath(root);
	const path = normalizePath(target);
	if (base === '' || path === '') return false;
	if (path === base) return true;
	/* normalizePath 已经把 \ 统一成 \，所以只比较反斜杠分隔。 */
	return path.startsWith(base + '\\');
}
/** 明显只读的命令形态（白名单）：只认真正无副作用的。 */
const READONLY_COMMAND_PREFIXES = [
	'echo ',
	'echo"',
	'Write-Output ',
	'Get-ChildItem',
	'Get-Content',
	'Get-Item',
	'Get-Location',
	'Test-Path',
	'Select-String',
	'Measure-Object',
	'node --version',
	'node -v',
	'pnpm --version',
	'git status',
	'git log',
	'git diff',
	'git branch',
	'where ',
	'which ',
];

function isPlainReadOnlyCommand(segment) {
	const text = String(segment ?? '').trim().toLowerCase();
	return READONLY_COMMAND_PREFIXES.some((prefix) => text.startsWith(prefix.toLowerCase()));
}


/*
 * 导出给「按计划」的守卫和面板用。
 * 判定逻辑只有这一份，不要在各处重写。
 */
export {
	splitWorkspaces,
	extractPaths,
	judgeCommand,
	isPlainReadOnlyCommand,
	within,
	normalizePath,
};


