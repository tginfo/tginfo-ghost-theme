#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_API_VERSION = 'v5.0';
const REQUEST_TIMEOUT_MS = 60_000;
const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

function maskSecret(value) {
    if (IS_GITHUB_ACTIONS && value) {
        console.log(`::add-mask::${value}`);
    }
}

function logGroupStart(title) {
    if (IS_GITHUB_ACTIONS) {
        console.log(`::group::${title}`);
    } else {
        console.log(`\n=== ${title} ===`);
    }
}

function logGroupEnd() {
    if (IS_GITHUB_ACTIONS) {
        console.log('::endgroup::');
    }
}

function resolveZipPath() {
    if (process.env.THEME_ZIP_PATH) {
        return path.resolve(process.env.THEME_ZIP_PATH);
    }

    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    if (!pkg.name || typeof pkg.name !== 'string') {
        throw new Error('Could not determine theme name from package.json');
    }

    return path.resolve('dist', `${pkg.name}.zip`);
}

function normalizeAdminApiBase(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Invalid site URL: ${rawUrl}`);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Unsupported URL protocol (${parsed.protocol}) for: ${rawUrl}`);
    }

    let base = rawUrl.trim().replace(/\/+$/, '');
    base = base.replace(/\/ghost(?:\/api(?:\/admin)?)?$/i, '');
    return `${base}/ghost/api/admin`;
}

function createAdminJwt(apiKey) {
    const parts = apiKey.split(':');
    if (parts.length !== 2) {
        throw new Error('Admin API key must be in "<id>:<secret>" format');
    }

    const [id, secret] = parts;
    if (!id || !secret || !/^[0-9a-fA-F]+$/.test(secret) || secret.length % 2 !== 0) {
        throw new Error('Admin API key secret must be a valid hex string');
    }

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT', kid: id})).toString('base64url');
    const payload = Buffer.from(JSON.stringify({iat: now, exp: now + 300, aud: '/admin/'})).toString('base64url');
    const signature = crypto
        .createHmac('sha256', Buffer.from(secret, 'hex'))
        .update(`${header}.${payload}`)
        .digest('base64url');

    return `${header}.${payload}.${signature}`;
}

function parseSitesConfig(rawJson) {
    if (!rawJson || !rawJson.trim()) {
        throw new Error('GHOST_SITES environment variable is empty or not set');
    }

    let parsed;
    try {
        parsed = JSON.parse(rawJson);
    } catch (err) {
        throw new Error(`GHOST_SITES is not valid JSON: ${err.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('GHOST_SITES must be a JSON object with a "sites" array');
    }

    if (!Array.isArray(parsed.sites) || parsed.sites.length === 0) {
        throw new Error('GHOST_SITES.sites must be a non-empty JSON array');
    }

    return parsed.sites.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`GHOST_SITES.sites[${index}] must be an object`);
        }

        const url = typeof entry.url === 'string' ? entry.url.trim() : '';
        const key = typeof entry.key === 'string' ? entry.key.trim() : '';
        if (!url) {
            throw new Error(`GHOST_SITES.sites[${index}] is missing a valid "url"`);
        }
        if (!key) {
            throw new Error(`GHOST_SITES.sites[${index}] is missing a valid "key"`);
        }

        // Mask the full key and its secret portion individually in GitHub Actions logs.
        maskSecret(key);
        const secretPart = key.split(':')[1];
        if (secretPart) {
            maskSecret(secretPart);
        }

        const adminApiBase = normalizeAdminApiBase(url);
        const hostLabel = new URL(url).host;
        const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : hostLabel;
        const version = typeof entry.version === 'string' && entry.version.trim()
            ? entry.version.trim()
            : DEFAULT_API_VERSION;
        const activate = entry.activate === true;

        return {name, url, adminApiBase, key, version, activate};
    });
}

async function parseResponseBody(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function formatApiError(status, statusText, body) {
    if (body && typeof body === 'object' && Array.isArray(body.errors) && body.errors.length > 0) {
        const details = body.errors
            .map((e) => [e.message, e.context].filter(Boolean).join(' — '))
            .join('; ');
        return `HTTP ${status} ${statusText}: ${details}`;
    }
    if (typeof body === 'string' && body.trim()) {
        return `HTTP ${status} ${statusText}: ${body.slice(0, 300)}`;
    }
    return `HTTP ${status} ${statusText}`;
}

async function deployToSite(site, zipBuffer, zipFileName) {
    const token = createAdminJwt(site.key);
    maskSecret(token);

    const form = new FormData();
    form.append('file', new Blob([zipBuffer], {type: 'application/zip'}), zipFileName);

    const uploadUrl = `${site.adminApiBase}/themes/upload/`;
    console.log(`Uploading ${zipFileName} to ${uploadUrl} (Accept-Version: ${site.version})...`);

    const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            Authorization: `Ghost ${token}`,
            'Accept-Version': site.version
        },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const uploadBody = await parseResponseBody(uploadResponse);
    if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${formatApiError(uploadResponse.status, uploadResponse.statusText, uploadBody)}`);
    }

    const uploadedTheme = uploadBody?.themes?.[0];
    const themeName = uploadedTheme?.name || path.basename(zipFileName, '.zip');
    let isActive = Boolean(uploadedTheme?.active);

    if (Array.isArray(uploadedTheme?.warnings) && uploadedTheme.warnings.length > 0) {
        console.warn(`Ghost reported ${uploadedTheme.warnings.length} theme warning(s):`);
        for (const warning of uploadedTheme.warnings) {
            console.warn(`  - ${warning.rule || warning.message || JSON.stringify(warning)}`);
        }
    }

    console.log(`Uploaded theme "${themeName}" (active: ${isActive}).`);

    if (site.activate && !isActive) {
        const activateUrl = `${site.adminApiBase}/themes/${encodeURIComponent(themeName)}/activate/`;
        console.log(`Activating theme "${themeName}" via ${activateUrl}...`);

        const activateResponse = await fetch(activateUrl, {
            method: 'PUT',
            headers: {
                Authorization: `Ghost ${token}`,
                'Accept-Version': site.version
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        const activateBody = await parseResponseBody(activateResponse);
        if (!activateResponse.ok) {
            throw new Error(`Activation failed: ${formatApiError(activateResponse.status, activateResponse.statusText, activateBody)}`);
        }

        isActive = Boolean(activateBody?.themes?.[0]?.active ?? true);
        console.log(`Activated theme "${themeName}" (active: ${isActive}).`);
    }

    return {themeName, active: isActive};
}

function writeStepSummary(results, zipFileName) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) {
        return;
    }

    const escapeCell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const lines = [
        `## Ghost Theme Deployment (\`${zipFileName}\`)`,
        '',
        '| Site | Status | Active | Details |',
        '| --- | --- | --- | --- |'
    ];

    for (const result of results) {
        const status = result.ok ? 'Succeeded' : 'Failed';
        const active = result.ok ? (result.active ? 'Yes' : 'No') : '—';
        const details = result.ok ? `Uploaded \`${result.themeName}\`` : result.error;
        lines.push(`| ${escapeCell(result.name)} | ${status} | ${active} | ${escapeCell(details)} |`);
    }

    lines.push('');
    fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
    const zipPath = resolveZipPath();
    if (!fs.existsSync(zipPath)) {
        throw new Error(`Theme archive not found at ${zipPath}. Run "pnpm zip" first.`);
    }

    const zipBuffer = fs.readFileSync(zipPath);
    const zipFileName = path.basename(zipPath);
    const sites = parseSitesConfig(process.env.GHOST_SITES);

    console.log(`Deploying ${zipFileName} (${zipBuffer.length} bytes) to ${sites.length} Ghost site(s)...`);

    const results = [];

    for (const site of sites) {
        logGroupStart(`Deploy to ${site.name}`);
        try {
            const {themeName, active} = await deployToSite(site, zipBuffer, zipFileName);
            results.push({name: site.name, ok: true, themeName, active});
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Deployment to ${site.name} failed: ${message}`);
            if (IS_GITHUB_ACTIONS) {
                console.log(`::error title=Ghost deploy failed (${site.name})::${message}`);
            }
            results.push({name: site.name, ok: false, error: message});
        } finally {
            logGroupEnd();
        }
    }

    writeStepSummary(results, zipFileName);

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        console.error(`\nDeployment failed for ${failed.length}/${results.length} site(s): ${failed.map((f) => f.name).join(', ')}`);
        process.exit(1);
    }

    console.log(`\nSuccessfully deployed ${zipFileName} to all ${results.length} site(s).`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
