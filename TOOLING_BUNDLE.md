# Tooling Bundle for tpowersvbt/SVBT

Each section below is labeled with its target path and contains the exact file contents. No application code, CSS, or theme files are touched.

---

## .github/workflows/ci.yml

```yaml
name: CI
on:
  push:
    branches: ["master"]
  pull_request:
    branches: ["master"]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x]
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run lint (if available)
        run: npm run lint --if-present

      - name: Run tests (if available)
        run: npm test --if-present

      - name: Build (if available)
        run: npm run build --if-present
```

---

## .github/workflows/lint.yml

```yaml
name: Lint
on:
  pull_request:
    branches: ["master"]
  push:
    branches: ["master"]

jobs:
  eslint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Run ESLint
        run: npm run lint --if-present
      - name: Check formatting with Prettier
        run: npx prettier --check "**/*.{js,jsx,ts,tsx,html,json,md}" || true
```

---

## .github/workflows/codeql-analysis.yml

```yaml
name: "CodeQL"

on:
  push:
    branches: ["master"]
  pull_request:
    branches: ["master"]
  schedule:
    - cron: '0 3 * * 0'

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v2
        with:
          languages: javascript

      - name: Autobuild
        uses: github/codeql-action/autobuild@v2

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v2
```

---

## .github/dependabot.yml

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    allow:
      - dependency-type: "all"
```

---

## .editorconfig

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
```

---

## .gitattributes

```text
* text=auto
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.woff binary
*.woff2 binary
dist/ linguist-generated=true
node_modules/ linguist-vendored=true
```

---

## .eslintrc.json

```json
{
  "env": { "browser": true, "es2021": true, "node": true },
  "extends": ["eslint:recommended", "plugin:prettier/recommended"],
  "parserOptions": { "ecmaVersion": 12, "sourceType": "module" },
  "rules": {}
}
```

---

## .prettierrc

```json
{
  "printWidth": 100,
  "singleQuote": true,
  "trailingComma": "es5",
  "semi": true
}
```

---

## .prettierignore and .eslintignore

```text
node_modules
dist
build
coverage
```

---

## SECURITY.md

```markdown
# Security policy
If you discover a security vulnerability, please report it privately to the repository owner via GitHub's "Report a vulnerability" feature under the Security tab.
```

---

## .github/ISSUE_TEMPLATE/bug.md

```markdown
# Bug report

- What did you do? Steps to reproduce
- What did you expect to happen?
- What actually happened? Include console output or screenshots
- Environment (node version, OS)
```

---

## .github/ISSUE_TEMPLATE/feature_request.md

```markdown
# Feature request

- What problem are you trying to solve?
- How would you like it to work?
- Any alternatives you considered
```

---

## .github/PULL_REQUEST_TEMPLATE.md

```markdown
### Changes
-

### Checklist
- [ ] Tests pass
- [ ] Linting passes
```

---

## .github/CODEOWNERS

```text
* @tpowersvbt
```
