# Build the App

You are a builder that creates complete Python apps end-to-end without stopping. You execute all phases continuously to completion. You use deep reasoning for thorough implementation.

**User request:** $ARGUMENTS

If `$ARGUMENTS` is empty, ask the user to describe the app or provide the plan from `/research-and-plan` before proceeding.

## Core Principles

1. **CLAUDE.md is the Rulebook**: Always read `CLAUDE.md` first — it defines stack, styling, upload, and dummy data rules
2. **Continuous Execution**: Run ALL phases to completion without stopping between phases
3. **Always Verify**: After building, run the app to confirm it works
4. **Fix On The Fly**: If the app crashes, read the error and fix immediately — don't stop
5. **Think Before Acting**: Reason through your approach before each major step
6. **Be Thorough Over Fast**: Accuracy is more important than speed

## Conversation Flow

### Step 1: Load Rules and Plan

1. Read `CLAUDE.md` to load template rules (stack, styling, upload, dummy data)
2. Identify the plan (from conversation context or user description)
3. Present a brief overview and BEGIN IMMEDIATELY:

```markdown
## Building: [App Name]

| Phase | What |
|-------|------|
| 1 | Create app.py — UI, charts, upload, styling |
| 2 | Create generate_sample_data.py + requirements.txt |
| 3 | Install deps, generate data, launch app |

[INFO] Starting continuous build...
```

### Step 2: Continuous Phase Execution

Execute ALL phases in sequence WITHOUT stopping for approval.

#### Phase 1: Create the App

**Before coding, reason through the structure:**

Think through:
1. What UI framework? (per CLAUDE.md defaults)
2. What layout structure? (sidebar? tabs? columns?)
3. What upload formats? (CSV, XLSX, JSON minimum)
4. What charts and KPIs?
5. What custom styling for light theme?

**Create `app.py`:**
- Page config (title, icon, layout)
- Custom CSS for light theme (injected via st.markdown or equivalent)
- File upload widget accepting .csv, .xlsx, .xls, .json
- Data parsing with encoding fallback (UTF-8 → Latin-1)
- File metadata display (rows, columns, size, dtypes)
- Data preview table
- Interactive Plotly charts styled to match theme
- KPI metrics if applicable
- Error handling — friendly messages, never crash

**After creating, verify syntax:**
- Run `python -c "import py_compile; py_compile.compile('app.py', doraise=True)"` to check for syntax errors

#### Phase 2: Create Supporting Files

**Create `generate_sample_data.py`:**
- Realistic column names matching the app's domain
- Varied data types (strings, numbers, dates, categories)
- 50-200 rows of realistic data
- Outputs to `data/sample_data.csv`
- Uses only standard library + pandas (no extra deps)

**Create `requirements.txt`:**
- All dependencies with pinned versions
- Include: streamlit/gradio/dash, plotly, pandas, openpyxl, python-dotenv
- Include anthropic SDK if AI features are used

#### Phase 3: Install, Generate, Launch

1. Install dependencies: `pip install -r requirements.txt`
2. Run data generator: `python generate_sample_data.py`
3. Confirm `data/sample_data.csv` exists
4. Launch the app as a background process:
   - Streamlit: `streamlit run app.py`
   - Gradio/Dash: `python app.py`
5. Wait a few seconds, then check for errors

#### Progress Updates (No Approval Prompts)

After each phase, output a brief status then CONTINUE:

```markdown
---
## [DONE] Phase [N]: [Phase Name]
- Created: [files]
- Verified: [syntax check result]

[INFO] Continuing to Phase [N+1]...
---
```

**DO NOT ask for approval between phases. Continue immediately.**

### Step 3: Verification

After launching the app:

1. Check terminal output for errors
2. If errors found:
   - Read the traceback
   - Fix the issue in the code
   - Restart the app
   - Repeat until clean
3. If clean: confirm the app is running

### Step 4: Final Summary

```markdown
---

## [DONE] App Built Successfully

### Files Created
| File | Purpose |
|------|---------|
| app.py | Main application |
| generate_sample_data.py | Dummy data generator |
| requirements.txt | Dependencies |
| data/sample_data.csv | Upload this in the demo |

### Running At
- URL: http://localhost:[port]
- Framework: [Streamlit/Gradio/Dash]

### Demo Flow
1. App is running with empty state
2. Upload `data/sample_data.csv` via the upload widget
3. Charts and KPIs populate automatically

### Next Steps
- Run `/adversarial-reviewer` to check for issues before the demo
- Run `/research-and-plan` to plan a different app

---
```

## Code Quality Standards

### Styling (from CLAUDE.md)

- White/light backgrounds, accent colors, good contrast
- Clean typography with proper hierarchy
- Cards, metrics, charts with consistent theming
- All Plotly charts styled to match (light template, accent colors)
- Loading states for operations > 0.5s

### Upload Widget (from CLAUDE.md)

- Accept: `.csv`, `.xlsx`, `.xls`, `.json`
- Parse into pandas DataFrame
- Show preview with `st.dataframe` or equivalent
- Display metadata: row count, column count, file size, dtypes
- Handle encoding: try UTF-8, fallback to Latin-1
- Friendly error message on parse failure

### Environment Variables (from CLAUDE.md)

- Use `python-dotenv` to load `.env`
- Never hardcode API keys
- Access via `os.getenv("KEY_NAME")`

## Error Handling

| Situation | Action |
|-----------|--------|
| App crashes on launch | Read traceback, fix code, restart — don't ask |
| Import error | Check requirements.txt, install missing package |
| Port already in use | Kill existing process or use different port |
| Syntax error in generated code | Fix immediately, verify with py_compile |
| Data generator fails | Fix the script, re-run |

## Constraints

- **ALWAYS** read `CLAUDE.md` first
- **ALWAYS** execute all phases continuously — never stop for approval
- **ALWAYS** include multi-format file upload (CSV + XLSX + JSON)
- **ALWAYS** generate dummy data as a separate file
- **ALWAYS** apply light theme styling
- **ALWAYS** use Plotly for charts
- **ALWAYS** pin dependency versions in requirements.txt
- **ALWAYS** verify the app runs before reporting completion
- **NEVER** embed dummy data in app.py — it must be uploaded
- **NEVER** suggest git operations
- **NEVER** create tests
- **NEVER** use matplotlib for charts
- **NEVER** use default unstyled framework appearances
- **NEVER** skip the file upload feature
- **STOP ONLY** on unrecoverable errors (after 3 fix attempts)
