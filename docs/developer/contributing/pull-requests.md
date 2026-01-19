# Pull Requests

Guidelines for contributing to RMT Compose via pull requests.

## Before You Start

1. **Check existing issues** - Your change may already be in progress
2. **Open an issue first** for significant changes to discuss approach
3. **Fork the repository** to your GitHub account

## Development Workflow

### 1. Create a Branch

```bash
# Update main
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name
```

Branch naming:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation
- `refactor/` - Code refactoring

### 2. Make Changes

- Follow [Code Style](/developer/contributing/code-style) guidelines
- Keep commits focused and atomic
- Write clear commit messages

### 3. Test Your Changes

```bash
# Run development server
npm run dev

# Test manually:
# - Create notes
# - Edit expressions
# - Play audio
# - Save/load modules
# - Test edge cases

# Build to check for errors
npm run build
```

### 4. Commit

```bash
git add .
git commit -m "Add feature description"
```

#### Commit Message Format

```
<type>: <short description>

<optional longer description>

<optional footer>
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code refactoring
- `perf` - Performance improvement
- `test` - Tests
- `chore` - Build/tooling

Examples:
```
feat: Add 19-TET scale support

Implements 19-tone equal temperament using SymbolicPower
for irrational frequency ratios.

Closes #42
```

```
fix: Prevent circular dependency crash

Check for cycles before adding dependency to graph.
```

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Pull Request Guidelines

### Title

Clear, concise description of the change:
- "Add support for Bohlen-Pierce scale"
- "Fix audio glitch when pausing playback"
- "Improve expression compilation performance"

### Description

Use this template:

```markdown
## Summary
Brief description of what this PR does.

## Changes
- Added X
- Modified Y
- Removed Z

## Testing
How to test these changes:
1. Step one
2. Step two

## Screenshots
(if applicable)

## Related Issues
Closes #123
```

### Checklist

Before submitting:

- [ ] Code follows style guidelines
- [ ] No console errors or warnings
- [ ] Tested in latest Chrome and Firefox
- [ ] Documentation updated (if needed)
- [ ] Commit messages are clear

## Code Review

### What Reviewers Look For

- **Correctness** - Does it work as intended?
- **Code quality** - Is it readable and maintainable?
- **Performance** - Any obvious performance issues?
- **Edge cases** - Are edge cases handled?
- **Documentation** - Are complex parts documented?

### Responding to Feedback

- Address all comments
- Push fixes as new commits (don't force push during review)
- Mark conversations as resolved when addressed

## After Merge

### Cleanup

```bash
# Switch to main
git checkout main

# Update main
git pull origin main

# Delete local branch
git branch -d feature/your-feature-name

# Delete remote branch (usually done automatically)
git push origin --delete feature/your-feature-name
```

### Follow Up

- Verify the change works in production
- Monitor for any reported issues
- Update documentation if needed

## Types of Contributions

### Bug Fixes

1. Reproduce the bug
2. Write a clear description
3. Include steps to reproduce
4. Add fix with test case

### New Features

1. Discuss in an issue first
2. Consider backward compatibility
3. Update documentation
4. Add to user guide if user-facing

### Documentation

1. Check for accuracy
2. Include examples
3. Update screenshots if UI changed
4. Test all code examples

### Performance Improvements

1. Include before/after benchmarks
2. Explain the optimization
3. Ensure no functionality changes

## Getting Help

- **Questions**: Open a [Discussion](https://github.com/3merillon/rmt-compose-poc/discussions)
- **Bugs**: Open an [Issue](https://github.com/3merillon/rmt-compose-poc/issues)
- **Security**: Email privately (don't open public issue)

## See Also

- [Development Setup](/developer/contributing/setup) - Environment setup
- [Code Style](/developer/contributing/code-style) - Style guidelines
- [GitHub Flow](https://guides.github.com/introduction/flow/) - Git workflow
