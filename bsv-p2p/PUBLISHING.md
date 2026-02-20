# Publishing to npm

This document describes how to publish bsv-p2p to npm.

## Prerequisites

1. npm account with publish permissions
2. GitHub repository access
3. npm token configured as GitHub secret: `NPM_TOKEN`

## Publishing Process

### Manual Publishing

1. **Update version in package.json**
   ```bash
   npm version patch  # or minor, major
   ```

2. **Build and test**
   ```bash
   npm run build
   npm test
   ```

3. **Publish**
   ```bash
   npm publish --access public
   ```

4. **Push tags**
   ```bash
   git push --follow-tags
   ```

### Automated Publishing (GitHub Actions)

Publishing happens automatically when you create a GitHub release:

1. **Create a new release on GitHub**
   - Go to Releases → New Release
   - Tag: `v0.1.0` (follow semver)
   - Title: e.g., "v0.1.0 - Initial release"
   - Description: Release notes

2. **GitHub Actions will automatically**:
   - Build the package
   - Run tests
   - Publish to npm with provenance

### Versioning

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0): Breaking changes
- **MINOR** (0.x.0): New features, backward compatible
- **PATCH** (0.0.x): Bug fixes

### Pre-release versions

For alpha/beta releases:

```bash
npm version prerelease --preid=alpha
npm publish --tag alpha
```

Users can install with:
```bash
npm install bsv-p2p@alpha
```

## Installation Testing

After publishing, verify installation works:

```bash
# Global install
npm install -g bsv-p2p
bsv-p2p --version
bsv-p2p setup

# npx usage
npx bsv-p2p setup
```

## Troubleshooting

### Build fails
- Check TypeScript compilation: `npm run build`
- Verify all dependencies are listed in package.json

### Tests fail
- Run tests locally: `npm test`
- Check Node.js version (must be >=22)

### Publish fails
- Verify npm token is valid
- Check package name availability on npm
- Ensure version hasn't been published already

## Post-publication Checklist

- [ ] Test global installation
- [ ] Test npx usage
- [ ] Verify package appears on npmjs.com
- [ ] Update README with installation instructions
- [ ] Announce release (if applicable)
