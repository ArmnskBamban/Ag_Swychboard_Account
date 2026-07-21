#!/usr/bin/env node
import ts from 'typescript';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entryFile = path.join(repoRoot, 'src', 'webview', 'main.ts');
const outDir = path.join(repoRoot, 'out', 'webview');
const outFile = path.join(outDir, 'panel.js');

const compilerOptions = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    lib: ['ES2022', 'DOM'],
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
};

function toModuleId(filePath) {
    return path.relative(repoRoot, filePath)
        .replace(/\\/g, '/')
        .replace(/\.(ts|tsx|js)$/, '');
}

function resolveRelativeModule(fromFile, specifier) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        path.join(base, 'index.ts'),
    ];

    const resolved = candidates.find(candidate => existsSync(candidate));
    if (!resolved) {
        throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
    }
    return resolved;
}

function transpile(filePath) {
    const source = readFileSync(filePath, 'utf8');
    const result = ts.transpileModule(source, {
        fileName: filePath,
        compilerOptions,
        reportDiagnostics: true,
    });

    const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (errors.length > 0) {
        const message = errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');
        throw new Error(`TypeScript transpile failed for ${filePath}:\n${message}`);
    }

    return result.outputText;
}

function collectModules(filePath, modules = new Map()) {
    const fullPath = path.resolve(filePath);
    const moduleId = toModuleId(fullPath);
    if (modules.has(moduleId)) return modules;

    const code = transpile(fullPath);
    modules.set(moduleId, { filePath: fullPath, code });

    const requireRe = /require\(["'](.+?)["']\)/g;
    for (const match of code.matchAll(requireRe)) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) {
            throw new Error(`Unsupported non-relative webview import "${specifier}" in ${fullPath}`);
        }
        collectModules(resolveRelativeModule(fullPath, specifier), modules);
    }

    return modules;
}

function jsString(value) {
    return JSON.stringify(value);
}

function buildBundle(modules, entryId) {
    const moduleEntries = [...modules.entries()]
        .map(([id, mod]) => `${jsString(id)}: function(require, module, exports) {\n${mod.code}\n}`)
        .join(',\n');

    return `(function() {
var modules = {
${moduleEntries}
};
var cache = {};

function dirname(id) {
    var index = id.lastIndexOf('/');
    return index === -1 ? '' : id.slice(0, index);
}

function normalize(parts) {
    var out = [];
    for (var part of parts.join('/').split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') out.pop();
        else out.push(part);
    }
    return out.join('/');
}

function resolve(fromId, specifier) {
    if (modules[specifier]) return specifier;
    if (!specifier.startsWith('.')) {
        throw new Error('Unsupported webview import: ' + specifier);
    }
    var resolved = normalize([dirname(fromId), specifier]);
    if (modules[resolved]) return resolved;
    throw new Error('Cannot resolve webview import "' + specifier + '" from ' + fromId);
}

function load(id) {
    if (cache[id]) return cache[id].exports;
    if (!modules[id]) throw new Error('Unknown webview module: ' + id);

    var module = { exports: {} };
    cache[id] = module;
    modules[id](function(specifier) {
        return load(resolve(id, specifier));
    }, module, module.exports);
    return module.exports;
}

load(${jsString(entryId)});
})();`;
}

mkdirSync(outDir, { recursive: true });
copyFileSync(path.join(repoRoot, 'src', 'webview', 'panel.css'), path.join(outDir, 'panel.css'));
copyFileSync(path.join(repoRoot, 'src', 'webview', 'context-detail.css'), path.join(outDir, 'context-detail.css'));

const modules = collectModules(entryFile);
writeFileSync(outFile, buildBundle(modules, toModuleId(entryFile)), 'utf8');

console.log(`[webview] bundled ${modules.size} modules -> out/webview/panel.js`);
console.log('[webview] copied CSS -> out/webview/');
