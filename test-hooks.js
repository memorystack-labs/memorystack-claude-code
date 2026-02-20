/**
 * Test harness for all MemoryStack Claude Code hooks.
 * Pipes mock JSON via stdin and verifies outputs + side effects.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPTS_DIR = path.join(__dirname, 'plugin', 'scripts');
const STATE_DIR = path.join(os.homedir(), '.memorystack-claude');

const SESSION_ID = 'test-session-' + Date.now();

function runHook(scriptName, input) {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const jsonInput = JSON.stringify(input);
    try {
        const output = execSync(`node "${scriptPath}"`, {
            input: jsonInput,
            encoding: 'utf8',
            timeout: 15000,
            env: { ...process.env, MEMORYSTACK_DEBUG: 'true' },
        });
        return { success: true, output: output.trim() };
    } catch (err) {
        return { success: false, error: err.message, stderr: err.stderr?.toString() };
    }
}

function checkFile(filename) {
    const filepath = path.join(STATE_DIR, filename);
    if (fs.existsSync(filepath)) {
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
    return null;
}

console.log('='.repeat(60));
console.log('MemoryStack Claude Code Plugin — Hook Tests');
console.log('Session ID:', SESSION_ID);
console.log('State dir:', STATE_DIR);
console.log('='.repeat(60));

// ─── Test 1: Prompt Hook (UserPromptSubmit) ────────────────
console.log('\n📝 TEST 1: prompt-hook.cjs (UserPromptSubmit)');
console.log('   Input: "remember this architecture decision: JWT with refresh tokens"');

const promptResult = runHook('prompt-hook.cjs', {
    prompt: 'remember this architecture decision: we use JWT with refresh tokens',
    session_id: SESSION_ID,
    cwd: process.cwd(),
    hook_event_name: 'UserPromptSubmit',
});

console.log('   Output:', promptResult.output || '(empty)');
console.log('   Status:', promptResult.success ? '✅ OK' : '❌ FAILED');
if (promptResult.error) console.log('   Error:', promptResult.error);

// Check if flag file was created
const flags = checkFile(`flagged-${SESSION_ID}.json`);
console.log('   Flag file:', flags ? `✅ Created (${flags.length} flags)` : '⚠️ Not created (no API key configured)');
if (flags) console.log('   Flag data:', JSON.stringify(flags[0], null, 2));

// ─── Test 2: Tool Hook (PostToolUse) ──────────────────────
console.log('\n🔧 TEST 2: tool-hook.cjs (PostToolUse — Edit)');
console.log('   Input: Edit auth.ts');

const toolResult = runHook('tool-hook.cjs', {
    tool_name: 'Edit',
    tool_input: {
        file_path: 'src/auth.ts',
        old_string: 'const token = null',
        new_string: 'const token = jwt.sign(payload, secret)',
    },
    tool_response: { success: true },
    session_id: SESSION_ID,
    cwd: process.cwd(),
    hook_event_name: 'PostToolUse',
});

console.log('   Output:', toolResult.output || '(empty)');
console.log('   Status:', toolResult.success ? '✅ OK' : '❌ FAILED');

// Check activity log
const activityFile = path.join(STATE_DIR, `activity-${SESSION_ID}.jsonl`);
if (fs.existsSync(activityFile)) {
    const lines = fs.readFileSync(activityFile, 'utf8').trim().split('\n');
    console.log('   Activity log: ✅', lines.length, 'entries');
    console.log('   Last entry:', lines[lines.length - 1]);
} else {
    console.log('   Activity log: ⚠️ Not created');
}

// Check changes file
const changes = checkFile(`changes-${SESSION_ID}.json`);
console.log('   Changes file:', changes ? `✅ Tracking ${Object.keys(changes).length} files` : '⚠️ Not created');
if (changes) console.log('   Files:', JSON.stringify(changes, null, 2));

// ─── Test 3: Another Tool Hook (PostToolUse — Bash) ───────
console.log('\n🔧 TEST 3: tool-hook.cjs (PostToolUse — Bash)');
console.log('   Input: npm test');

const bashResult = runHook('tool-hook.cjs', {
    tool_name: 'Bash',
    tool_input: { command: 'npm test', description: 'Run tests' },
    tool_response: { output: 'All 42 tests passed' },
    session_id: SESSION_ID,
    cwd: process.cwd(),
    hook_event_name: 'PostToolUse',
});

console.log('   Output:', bashResult.output || '(empty)');
console.log('   Status:', bashResult.success ? '✅ OK' : '❌ FAILED');

// ─── Test 4: Task Hook (TaskCompleted) ────────────────────
console.log('\n🏗️  TEST 4: task-hook.cjs (TaskCompleted)');
console.log('   Input: "Implement user authentication"');

const taskResult = runHook('task-hook.cjs', {
    task_id: 'task-001',
    task_subject: 'Implement user authentication',
    task_description: 'Add JWT login and signup endpoints with refresh tokens',
    teammate_name: 'implementer',
    team_name: 'memorystack',
    session_id: SESSION_ID,
    cwd: process.cwd(),
    hook_event_name: 'TaskCompleted',
});

console.log('   Output:', taskResult.output || '(empty)');
console.log('   Status:', taskResult.success ? '✅ OK' : '❌ FAILED');
if (!taskResult.success) console.log('   Error:', taskResult.stderr || taskResult.error);

// ─── Test 5: Subagent Hook (SubagentStop) ─────────────────
console.log('\n🤖 TEST 5: subagent-hook.cjs (SubagentStop)');
console.log('   Input: Explore agent finished');

const subagentResult = runHook('subagent-hook.cjs', {
    agent_id: 'agent-test-001',
    agent_type: 'Explore',
    agent_transcript_path: '', // no actual transcript file
    session_id: SESSION_ID,
    cwd: process.cwd(),
    hook_event_name: 'SubagentStop',
});

console.log('   Output:', subagentResult.output || '(empty)');
console.log('   Status:', subagentResult.success ? '✅ OK (gracefully skipped — no transcript file)' : '❌ FAILED');

// ─── Test 6: Context Hook (SessionStart) ──────────────────
console.log('\n🟢 TEST 6: context-hook.cjs (SessionStart)');
console.log('   Input: startup session');

const contextResult = runHook('context-hook.cjs', {
    source: 'startup',
    model: 'claude-sonnet-4',
    session_id: SESSION_ID,
    cwd: process.cwd(),
    hook_event_name: 'SessionStart',
});

console.log('   Output:', contextResult.output?.slice(0, 200) || '(empty)');
console.log('   Status:', contextResult.success ? '✅ OK' : '❌ FAILED');

// ─── Summary ──────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const results = [
    { name: 'prompt-hook (UserPromptSubmit)', ...promptResult },
    { name: 'tool-hook (PostToolUse — Edit)', ...toolResult },
    { name: 'tool-hook (PostToolUse — Bash)', ...bashResult },
    { name: 'task-hook (TaskCompleted)', ...taskResult },
    { name: 'subagent-hook (SubagentStop)', ...subagentResult },
    { name: 'context-hook (SessionStart)', ...contextResult },
];

let passed = 0;
for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}`);
    if (r.success) passed++;
}

console.log(`\n  ${passed}/${results.length} hooks passed`);

// Show state files
console.log('\n📁 State files created:');
if (fs.existsSync(STATE_DIR)) {
    const files = fs.readdirSync(STATE_DIR).filter(f => f.includes(SESSION_ID));
    for (const f of files) {
        const stat = fs.statSync(path.join(STATE_DIR, f));
        console.log(`   ${f} (${stat.size} bytes)`);
    }
    if (files.length === 0) console.log('   (none for this session)');
} else {
    console.log('   State directory not yet created');
}

console.log('\n' + '='.repeat(60));
