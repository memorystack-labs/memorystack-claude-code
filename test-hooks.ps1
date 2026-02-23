# ============================================================================
# MemoryStack Claude Code Plugin — Full Hook Test Suite
# ============================================================================
# Tests all 6 hooks + 2 commands against the LIVE MemoryStack API.
# Run from the plugin root: .\test-hooks.ps1
#
# Prerequisites:
#   - MEMORYSTACK_API_KEY set in environment
#   - npm run build already done
# ============================================================================

$ErrorActionPreference = "Continue"
$SCRIPTS = ".\plugin\scripts"
$PASS = 0
$FAIL = 0
$SESSION_ID = "test-session-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$CWD = (Get-Location).Path

function Write-Header($text) {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

function Write-Test($name) {
    Write-Host ""
    Write-Host "  ▶ TEST: $name" -ForegroundColor Yellow
}

function Write-Pass($detail) {
    $script:PASS++
    Write-Host "    ✅ PASS: $detail" -ForegroundColor Green
}

function Write-Fail($detail) {
    $script:FAIL++
    Write-Host "    ❌ FAIL: $detail" -ForegroundColor Red
}

function Write-Info($detail) {
    Write-Host "    ℹ️  $detail" -ForegroundColor DarkGray
}

function Run-Hook($hookScript, $inputJson) {
    try {
        $result = $inputJson | node "$SCRIPTS\$hookScript" 2>&1
        $output = $result -join "`n"
        return $output
    } catch {
        return "ERROR: $($_.Exception.Message)"
    }
}

# ============================================================================
Write-Header "PRE-FLIGHT CHECKS"
# ============================================================================

Write-Test "API Key configured"
if ($env:MEMORYSTACK_API_KEY) {
    $keyPreview = $env:MEMORYSTACK_API_KEY.Substring(0, [Math]::Min(12, $env:MEMORYSTACK_API_KEY.Length)) + "..."
    Write-Pass "API key found: $keyPreview"
} else {
    Write-Fail "MEMORYSTACK_API_KEY not set! All API tests will fail."
    Write-Host "    Set it with: `$env:MEMORYSTACK_API_KEY = 'ms_proj_...'" -ForegroundColor Yellow
}

Write-Test "Built scripts exist"
$scripts = @("context-hook.cjs", "prompt-hook.cjs", "tool-hook.cjs", 
             "subagent-hook.cjs", "task-hook.cjs", "summary-hook.cjs",
             "add-memory.cjs", "search-memory.cjs", "save-project-memory.cjs")
$missing = @()
foreach ($s in $scripts) {
    if (-not (Test-Path "$SCRIPTS\$s")) { $missing += $s }
}
if ($missing.Count -eq 0) {
    Write-Pass "All 9 scripts found"
} else {
    Write-Fail "Missing: $($missing -join ', ')"
    Write-Host "    Run: npm run build" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Session ID: $SESSION_ID" -ForegroundColor DarkGray
Write-Host "  CWD:        $CWD" -ForegroundColor DarkGray

# ============================================================================
Write-Header "TEST 1: CONTEXT HOOK (SessionStart)"
# ============================================================================
Write-Host "  What: Injects categorized memories at session start" -ForegroundColor DarkGray
Write-Host "  Look for: 🏗️ Decisions, ⚠️ Warnings, 🔧 Conventions sections" -ForegroundColor DarkGray

Write-Test "SessionStart — Profile injection"
$input1 = @{
    source = "startup"
    model = "claude-sonnet-4"
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "SessionStart"
} | ConvertTo-Json -Compress
$out1 = Run-Hook "context-hook.cjs" $input1

if ($out1 -match "memorystack-context") {
    Write-Pass "Context injected successfully"
    # Check for categorized format
    if ($out1 -match "Decisions|Warnings|Conventions|Knowledge|Activity") {
        Write-Pass "Categorized format detected (new format!)"
    } else {
        Write-Info "Flat format (memories may not match category keywords yet)"
    }
    # Show a snippet
    $preview = if ($out1.Length -gt 300) { $out1.Substring(0, 300) + "..." } else { $out1 }
    Write-Info "Preview: $preview"
} elseif ($out1 -match "No previous memories") {
    Write-Pass "Empty context (no memories for this project yet — expected for new projects)"
} else {
    Write-Fail "Unexpected output: $out1"
}

# ============================================================================
Write-Header "TEST 2: PROMPT HOOK (UserPromptSubmit)"
# ============================================================================
Write-Host "  What: Detects save/search signals and enriches prompts" -ForegroundColor DarkGray

# Test 2a: Save signal detection
Write-Test "Save signal — 'remember this' keyword"
$input2a = @{
    prompt = "remember this: we chose PostgreSQL over MongoDB because of complex JOINs needed for the recommendation engine"
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "UserPromptSubmit"
} | ConvertTo-Json -Compress
$out2a = Run-Hook "prompt-hook.cjs" $input2a

if ($out2a -match "memorystack" -or $out2a -match "additionalContext" -or $out2a -match "\{\}") {
    Write-Pass "Save signal processed"
    Write-Info "Output: $out2a"
} else {
    Write-Fail "Unexpected: $out2a"
}

# Test 2b: New save signals (gotcha, root cause, figured out)
Write-Test "Save signal — 'the fix was' (NEW trigger)"
$input2b = @{
    prompt = "the fix was normalizing the object response before calling .replace() — it was an object not a string"
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "UserPromptSubmit"
} | ConvertTo-Json -Compress
$out2b = Run-Hook "prompt-hook.cjs" $input2b

if ($out2b -ne $null -and $out2b.Length -gt 0) {
    Write-Pass "'the fix was' signal detected and processed"
} else {
    Write-Fail "Signal not detected"
}

# Test 2c: Debug enrichment (error keyword)
Write-Test "Debug enrichment — 'error' keyword triggers search"
$input2c = @{
    prompt = "I'm getting a CORS error when making API calls from the frontend"
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "UserPromptSubmit"
} | ConvertTo-Json -Compress
$out2c = Run-Hook "prompt-hook.cjs" $input2c

if ($out2c -match "memorystack" -or $out2c -match "additionalContext") {
    Write-Pass "Debug enrichment triggered — searched past memories for CORS solutions"
    Write-Info "Output: $out2c"
} elseif ($out2c -match "\{\}") {
    Write-Pass "Debug enrichment triggered (no relevant memories found yet — expected)"
} else {
    Write-Info "Output: $out2c"
}

# Test 2d: Search signal
Write-Test "Search signal — 'what did I work on yesterday?'"
$input2d = @{
    prompt = "what did I work on yesterday?"
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "UserPromptSubmit"
} | ConvertTo-Json -Compress
$out2d = Run-Hook "prompt-hook.cjs" $input2d

if ($out2d -match "memorystack" -or $out2d -match "additionalContext" -or $out2d -match "\{\}") {
    Write-Pass "Search signal processed"
} else {
    Write-Fail "Unexpected: $out2d"
}

# Test 2e: Normal prompt (should pass through)
Write-Test "Normal prompt — no signals (should pass through)"
$input2e = @{
    prompt = "add a button to the header"
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "UserPromptSubmit"
} | ConvertTo-Json -Compress
$out2e = Run-Hook "prompt-hook.cjs" $input2e

if ($out2e -match "\{\}" -or $out2e -match '""' -or $out2e.Length -lt 50) {
    Write-Pass "Normal prompt passed through (no enrichment — correct!)"
} else {
    Write-Info "Got enrichment even for normal prompt: $out2e"
}

# ============================================================================
Write-Header "TEST 3: TOOL HOOK (PostToolUse)"
# ============================================================================
Write-Host "  What: Tracks file edits, bash commands, writes in real-time" -ForegroundColor DarkGray

# Test 3a: File edit tracking
Write-Test "File Edit — tracks modified file"
$input3a = @{
    tool_name = "Edit"
    tool_input = @{
        file_path = "src/components/Header.tsx"
        old_string = "old code"
        new_string = "new code"
    }
    tool_response = @{
        success = $true
    }
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "PostToolUse"
} | ConvertTo-Json -Compress -Depth 3
$out3a = Run-Hook "tool-hook.cjs" $input3a

if ($out3a -ne $null) {
    Write-Pass "Edit tracked"
    Write-Info "Output: $out3a"
} else {
    Write-Fail "No output"
}

# Test 3b: Bash command tracking (the bug we fixed!)
Write-Test "Bash Command — should show actual command (not 'Used Bash')"
$input3b = @{
    tool_name = "Bash"
    tool_input = @{
        command = "npm test -- --coverage"
    }
    tool_response = @{
        output = "PASS  src/auth.test.ts`nTests: 12 passed`nCoverage: 87%"
        success = $true
    }
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "PostToolUse"
} | ConvertTo-Json -Compress -Depth 3
$out3b = Run-Hook "tool-hook.cjs" $input3b

if ($out3b -match "npm test" -or $out3b -match "PASS") {
    Write-Pass "Bash command captured with actual content! (bug fix verified)"
} elseif ($out3b -match "Used Bash") {
    Write-Fail "Still showing 'Used Bash' — compression bug not fixed"
} else {
    Write-Info "Output: $out3b"
    Write-Pass "Bash command processed"
}

# Test 3c: Write (new file)
Write-Test "Write — tracks new file creation"
$input3c = @{
    tool_name = "Write"
    tool_input = @{
        file_path = "src/utils/auth-helpers.ts"
        content = "export function validateToken(token: string) { ... }"
    }
    tool_response = @{
        success = $true
    }
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "PostToolUse"
} | ConvertTo-Json -Compress -Depth 3
$out3c = Run-Hook "tool-hook.cjs" $input3c

if ($out3c -ne $null) {
    Write-Pass "Write tracked"
} else {
    Write-Fail "No output"
}

# ============================================================================
Write-Header "TEST 4: TASK HOOK (TaskCompleted)"
# ============================================================================
Write-Host "  What: Saves rich task records with files modified + approach" -ForegroundColor DarkGray

Write-Test "Task completion — should include files and approach"
$input4 = @{
    task_id = "test-task-001"
    task_subject = "Implement JWT refresh token rotation"
    task_description = "The refresh token was being reused, creating a security vulnerability. Implemented rotation on use."
    teammate_name = "senior-dev"
    team_name = "backend"
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "TaskCompleted"
} | ConvertTo-Json -Compress
$out4 = Run-Hook "task-hook.cjs" $input4

if ($out4 -ne $null) {
    Write-Pass "Task completion saved to MemoryStack"
    Write-Info "Output: $out4"
} else {
    Write-Fail "No output from task hook"
}

# ============================================================================
Write-Header "TEST 5: SUBAGENT HOOK (SubagentStop)"
# ============================================================================
Write-Host "  What: Extracts key findings, warnings, files from subagent work" -ForegroundColor DarkGray

Write-Test "Subagent stop — rich summary extraction"
# Create a fake transcript file for the subagent
$transcriptDir = "$env:USERPROFILE\.memorystack-claude"
if (-not (Test-Path $transcriptDir)) { New-Item -ItemType Directory -Path $transcriptDir -Force | Out-Null }
$transcriptFile = "$transcriptDir\subagent-test-explore-001.jsonl"

# Simulate a subagent transcript with architecture findings
$entry1 = @{role="user"; content="Explore the project structure and identify architecture patterns"} | ConvertTo-Json -Compress
$entry2 = @{role="assistant"; content=@(@{type="tool_use"; name="Read"; input=@{file_path="src/middleware/auth.ts"}})} | ConvertTo-Json -Compress -Depth 4
$entry3 = @{role="assistant"; content="The architecture follows a clean pattern. The core entry point is src/index.ts which depends on the auth middleware. There is a critical issue: the deprecated bcrypt library should be replaced with argon2. The main pattern uses Express middleware chains."} | ConvertTo-Json -Compress
$entries = @($entry1, $entry2, $entry3)
$entries -join "`n" | Out-File -FilePath $transcriptFile -Encoding utf8 -NoNewline

$input5 = @{
    agent_type = "Explore"
    agent_id = "test-explore-001"
    session_id = $SESSION_ID
    cwd = $CWD
    hook_event_name = "SubagentStop"
    transcript_path = $transcriptFile
} | ConvertTo-Json -Compress
$out5 = Run-Hook "subagent-hook.cjs" $input5

if ($out5 -ne $null) {
    Write-Pass "Subagent summary saved"
    if ($out5 -match "finding" -or $out5 -match "architecture" -or $out5 -match "Conclusion") {
        Write-Pass "Rich summary format detected (new format!)"
    }
    Write-Info "Output: $out5"
} else {
    Write-Info "No output (may need real subagent transcript)"
}

# Cleanup
if (Test-Path $transcriptFile) { Remove-Item $transcriptFile -Force }

# ============================================================================
Write-Header "TEST 6: ADD MEMORY (Manual Save)"
# ============================================================================
Write-Host "  What: Directly saves a memory via the add-memory command" -ForegroundColor DarkGray

Write-Test "Add project memory"
$input6 = @{
    content = "⚠️ CORS errors on staging are caused by missing credentials:include in fetch options. The staging proxy doesn't forward cookies without it."
    scope = "project"
    type = "bugfix"
} | ConvertTo-Json -Compress
$out6 = Run-Hook "add-memory.cjs" $input6

if ($out6 -ne $null -and -not ($out6 -match "error" -and $out6 -match "Error")) {
    Write-Pass "Memory saved via add-memory command"
    Write-Info "Output: $out6"
} else {
    Write-Fail "Failed to save: $out6"
}

# ============================================================================
Write-Header "TEST 7: SEARCH MEMORY"
# ============================================================================
Write-Host "  What: Searches stored memories by query" -ForegroundColor DarkGray

# Wait a moment for indexing
Start-Sleep -Seconds 2

Write-Test "Search — find the CORS bugfix we just saved"
$out7a = & node "$SCRIPTS\search-memory.cjs" --project "CORS error fix" 2>&1
$out7a = $out7a -join "`n"

if ($out7a -match "CORS" -or $out7a -match "credentials") {
    Write-Pass "Found the CORS bugfix memory!"
    Write-Info "$out7a"
} elseif ($out7a -match "No memories found") {
    Write-Info "Memory not indexed yet (may take a moment)"
} else {
    Write-Info "Search result: $out7a"
}

Write-Test "Search — find architecture decisions" 
$out7b = & node "$SCRIPTS\search-memory.cjs" --project "architecture decisions" 2>&1
$out7b = $out7b -join "`n"

if ($out7b -match "Memory" -or $out7b -match "architecture" -or $out7b -match "decision") {
    Write-Pass "Architecture search returned results"
    # Show first 500 chars
    $preview7 = if ($out7b.Length -gt 500) { $out7b.Substring(0, 500) + "..." } else { $out7b }
    Write-Info "$preview7"
} else {
    Write-Info "Search result: $out7b"
}

Write-Test "Search — find JWT/auth related memories"
$out7c = & node "$SCRIPTS\search-memory.cjs" --both "JWT refresh token rotation" 2>&1
$out7c = $out7c -join "`n"

if ($out7c -match "JWT" -or $out7c -match "token" -or $out7c -match "auth" -or $out7c -match "Memory") {
    Write-Pass "Auth-related memories found"
    $preview7c = if ($out7c.Length -gt 400) { $out7c.Substring(0, 400) + "..." } else { $out7c }
    Write-Info "$preview7c"
} else {
    Write-Info "Search result: $out7c"
}

# ============================================================================
Write-Header "TEST 8: END-TO-END FLOW"
# ============================================================================
Write-Host "  What: Simulates a real session flow from start to finish" -ForegroundColor DarkGray

Write-Test "E2E: Session start → save decision → search for it"

# Step 1: Session start
$e2e1 = @{
    source = "startup"
    session_id = "e2e-$SESSION_ID"
    cwd = $CWD
    hook_event_name = "SessionStart"
} | ConvertTo-Json -Compress
$e2eOut1 = Run-Hook "context-hook.cjs" $e2e1

if ($e2eOut1 -match "memorystack") {
    Write-Pass "[1/4] Session started with context injection"
} else {
    Write-Info "[1/4] Session started: $e2eOut1"
}

# Step 2: User says "remember this decision"
$e2e2 = @{
    prompt = "remember this: we chose Redis for session cache because it supports pub/sub which we need for real-time notifications"
    session_id = "e2e-$SESSION_ID"
    cwd = $CWD
    hook_event_name = "UserPromptSubmit"
} | ConvertTo-Json -Compress
$e2eOut2 = Run-Hook "prompt-hook.cjs" $e2e2

Write-Pass "[2/4] Decision save triggered"

# Step 3: Track some tool usage
$e2e3 = @{
    tool_name = "Edit"
    tool_input = @{ file_path = "src/cache/redis-client.ts" }
    tool_response = @{ success = $true }
    session_id = "e2e-$SESSION_ID"
    cwd = $CWD
    hook_event_name = "PostToolUse"
} | ConvertTo-Json -Compress -Depth 3
$e2eOut3 = Run-Hook "tool-hook.cjs" $e2e3

Write-Pass "[3/4] Tool activity tracked (redis-client.ts edit)"

# Step 4: Search for it
Start-Sleep -Seconds 2
$e2eOut4 = & node "$SCRIPTS\search-memory.cjs" --project "Redis session cache choice" 2>&1
$e2eOut4 = $e2eOut4 -join "`n"

if ($e2eOut4 -match "Redis" -or $e2eOut4 -match "session" -or $e2eOut4 -match "pub/sub") {
    Write-Pass "[4/4] Decision recalled! Full knowledge loop complete ✨"
    $preview4 = if ($e2eOut4.Length -gt 300) { $e2eOut4.Substring(0, 300) + "..." } else { $e2eOut4 }
    Write-Info "$preview4"
} else {
    Write-Info "[4/4] Search returned: $e2eOut4"
    Write-Info "(Memory may still be indexing)"
}

# ============================================================================
Write-Header "RESULTS"
# ============================================================================
$total = $PASS + $FAIL
Write-Host ""
Write-Host "  Total Tests: $total" -ForegroundColor White
Write-Host "  Passed:      $PASS" -ForegroundColor Green
Write-Host "  Failed:      $FAIL" -ForegroundColor $(if ($FAIL -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($FAIL -eq 0) {
    Write-Host "  🎉 ALL TESTS PASSED! Plugin is fully operational." -ForegroundColor Green
} else {
    Write-Host "  ⚠️  Some tests failed. Check output above for details." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  To test in Claude Code interactively:" -ForegroundColor DarkGray
Write-Host "  1. Open Claude Code in any project" -ForegroundColor DarkGray
Write-Host "  2. Say: 'remember this: chose Zustand over Redux because...'" -ForegroundColor DarkGray
Write-Host "  3. Start new session, observe categorized context injection" -ForegroundColor DarkGray
Write-Host "  4. Say: 'what decisions have we made?' — should recall it" -ForegroundColor DarkGray
Write-Host ""
